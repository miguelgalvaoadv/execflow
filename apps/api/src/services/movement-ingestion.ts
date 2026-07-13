/**
 * Ingestão de movimentação/intimação num caso — cadeia reusada por qualquer
 * fonte (DataJud, DJEN, InfoSimples, manual) via o endpoint interno
 * /api/v1/internal/case-movements. AASP foi removida em 13/07/2026 (nunca
 * teve credencial real — exige CNPJ que o Miguel não tem).
 *
 * O que a cadeia faz, dado um caso + uma movimentação nova:
 *   1. Dedup (não reprocessa a mesma movimentação).
 *   2. IA classifica a criticidade (tier 1/2/3) e cria oportunidades sugeridas.
 *   3. Insere o evento na timeline COM o tier (tabela append-only).
 *   4. Tier 1/2 → marca o caso 'stale' + registra QUAL movimentação causou
 *      (é o "foi por causa de tal movimentação" que trava a peça e pede autos).
 *   5. Intimação/possível prazo → court_communication + prazo PROVISÓRIO crítico.
 *   6. Emite domain event + notifica o escritório.
 *
 * Tudo entra como SUGESTÃO — o advogado valida ou descarta. Nada é definitivo.
 */

import { createHash } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import {
  executionCases,
  timelineEvents,
  courtCommunications,
  domainEvents,
  deadlines,
  memberships,
  users,
  organizations,
  inventoryItems,
  type ExecutionCase,
} from '@execflow/db/schema'
import { NotificationService } from './notifications.ts'
import { detectOpportunitiesFromMovements } from './opportunity-detector.ts'

const notifications = new NotificationService()

export type MovementItem = {
  tipo: string
  conteudo: string
  /** Quando ocorreu / foi disponibilizada — usada como termo inicial do prazo. */
  occurredAt: Date
  /** Fonte: 'datajud' | 'djen' | 'infosimples' | 'manual'. */
  source: string
  /** 'movimentacao' (andamento público) | 'intimacao' (comunicação com prazo). */
  kind: 'movimentacao' | 'intimacao'
  /** Chave estável única da movimentação (hash DJEN, código+data DataJud) — dedup. */
  dedupKey: string
  link?: string | null
  rawPayload?: unknown
}

export type MovementIngestResult = {
  status: 'processed' | 'duplicate'
  timelineEventId: string | null
  criticalityTier: '1' | '2' | '3' | null
  opportunitiesCreated: number
  opportunityTitles: string[]
  markedStale: boolean
  provisionalDeadlineId: string | null
}

/** Sinais textuais de que a comunicação provavelmente abre prazo (spec §10). */
function hasDeadlineSignal(tipo: string, conteudo: string): boolean {
  const t = `${tipo} ${conteudo}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return [
    'intima',
    'publicad',
    'disponibilizad',
    'ciencia',
    'prazo',
    'vista a defesa',
    'vista da defesa',
    'sentenc',
    'acordao',
    'decisao',
  ].some((k) => t.includes(k))
}

/**
 * Achado 13/07/2026 (Miguel testando a aba Intimações): a InfoSimples/DataJud
 * mandam MOVIMENTAÇÃO comum (ex.: "Expedição de documento", "Conclusos para
 * decisão") no mesmo fluxo que o DJEN manda intimação de verdade — e o código
 * gravava TUDO em court_communications sem distinguir, inflando "Recebidas"
 * com ruído que já aparece igual na aba Movimentações do caso (763 registros,
 * dos quais só ~4 eram intimação/publicação real).
 *
 * Esta função é mais ESTREITA que `hasDeadlineSignal` acima (que serve pra
 * outra pergunta: "isso pode ter peso jurídico?" — ampla de propósito, inclui
 * sentença/decisão/prazo). Aqui a pergunta é diferente: "isso É, em si, um ATO
 * DE COMUNICAÇÃO (intimação/citação/publicação/notificação)?" — só isso deve
 * virar court_communication. "Conclusos para decisão" tem peso jurídico mas
 * NÃO é uma comunicação (ainda não foi publicado/intimado nada).
 */
function isFormalCommunication(tipo: string, conteudo: string): boolean {
  const t = `${tipo} ${conteudo}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return [
    'intima',
    'publicad',
    'disponibilizad',
    'citac',
    'notifica',
    'remetido ao dje',
    'remetido ao diario',
    'ciencia',
  ].some((k) => t.includes(k))
}

/** Remove HTML e normaliza espaços (o DJEN devolve o texto com tags). */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(td|tr|p|div|table)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function communicationHash(cnj: string, dedupKey: string): string {
  return createHash('sha256').update(`${cnj.trim()}|${dedupKey.trim()}`).digest('hex')
}

/**
 * Impressão digital SOURCE-AGNOSTIC de uma movimentação, para dedup CRUZADO
 * entre DataJud/DJEN/InfoSimples/AASP. Duas fontes que relatam o mesmo fato
 * (mesmo processo, mesmo dia, texto equivalente) colidem aqui e não empilham.
 * Normaliza: só dígitos do CNJ | AAAAMMDD | texto sem acento/pontuação/tags,
 * cortado em 80 chars (sobra o suficiente pra identificar, tolera variação de cauda).
 */
export function movementFingerprint(cnj: string, occurredAt: Date, text: string): string {
  const digits = cnj.replace(/\D/g, '')
  const ymd = isNaN(occurredAt.getTime())
    ? '00000000'
    : `${occurredAt.getUTCFullYear()}${String(occurredAt.getUTCMonth() + 1).padStart(2, '0')}${String(occurredAt.getUTCDate()).padStart(2, '0')}`
  const norm = stripHtml(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\[[a-z]+\]/g, '') // remove tags [datajud]/[infosimples]
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return createHash('sha256').update(`${digits}|${ymd}|${norm}`).digest('hex')
}

/**
 * Prazo PROVISÓRIO: 5 dias corridos a partir da disponibilização (contagem
 * conservadora). status='open', origin='extracted', priority='critical' — exige
 * validação humana; o sweep de SLA alerta se ninguém validar.
 */
async function createProvisionalDeadline(input: {
  organizationId: string
  executionCaseId: string
  tipo: string
  conteudo: string
  publishedAt: Date
  sourceEventId: string | null
  source: string
}): Promise<string | null> {
  try {
    const [actor] = await db
      .select({ userId: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, input.organizationId))
      .limit(1)
    if (!actor) return null

    const dueAt = new Date(input.publishedAt.getTime() + 5 * 86_400_000)
    const [deadline] = await db
      .insert(deadlines)
      .values({
        organizationId: input.organizationId,
        executionCaseId: input.executionCaseId,
        title: `PROVISÓRIO — validar prazo: ${input.tipo}`.substring(0, 255),
        description:
          `Prazo provisório criado automaticamente a partir de comunicação (${input.source}) ` +
          `disponibilizada em ${input.publishedAt.toLocaleDateString('pt-BR')}.\n\n` +
          `Conteúdo: ${input.conteudo.substring(0, 500)}\n\n` +
          `⚠ CONTAGEM CONSERVADORA de 5 dias corridos a partir da disponibilização. ` +
          `Confira o termo inicial real (disponibilização × publicação × ciência), a natureza da ` +
          `peça (embargos de declaração = 2 dias!) e dias úteis/feriados antes de confiar nesta data. ` +
          `Valide ou descarte — este prazo NÃO é definitivo.`,
        dueAt,
        deadlineClass: 'legal',
        origin: 'extracted',
        priority: 'critical',
        status: 'open',
        sourceEventId: input.sourceEventId,
        legalBasis: 'Provisório — pendente de enquadramento legal na validação humana.',
        createdByUserId: actor.userId,
      })
      .returning()
    return deadline?.id ?? null
  } catch (e) {
    console.warn('[movement-ingestion] Falha ao criar prazo provisório:', e)
    return null
  }
}

/**
 * Processa UMA movimentação para um caso já identificado.
 * Idempotente: se a movimentação (dedupKey) já foi vista, retorna 'duplicate'
 * sem reprocessar (nem chama a IA, nem duplica prazo).
 */
export async function ingestMovementForCase(
  execCase: ExecutionCase,
  item: MovementItem
): Promise<MovementIngestResult> {
  const cnj = execCase.executionProcessNumber ?? ''
  const cleanText = stripHtml(item.conteudo).substring(0, 4000)
  const contentHash = communicationHash(cnj, item.dedupKey)
  const fingerprint = movementFingerprint(cnj, item.occurredAt, `${item.tipo}: ${cleanText}`)

  const empty: MovementIngestResult = {
    status: 'duplicate',
    timelineEventId: null,
    criticalityTier: null,
    opportunitiesCreated: 0,
    opportunityTitles: [],
    markedStale: false,
    provisionalDeadlineId: null,
  }

  // ── Dedup 1 (mesma fonte): comunicação com o mesmo contentHash?
  const [existingComm] = await db
    .select({ id: courtCommunications.id })
    .from(courtCommunications)
    .where(
      and(
        eq(courtCommunications.organizationId, execCase.organizationId),
        eq(courtCommunications.contentHash, contentHash)
      )
    )
    .limit(1)
  if (existingComm) return empty

  // ── Dedup 2 (CRUZADO entre fontes): já existe evento com esta impressão
  // digital? Evita empilhar o mesmo fato vindo de InfoSimples + DataJud, etc.
  const [existingFp] = await db
    .select({ id: timelineEvents.id })
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.executionCaseId, execCase.id),
        eq(timelineEvents.dedupFingerprint, fingerprint)
      )
    )
    .limit(1)
  if (existingFp) return empty

  const summary = `[${item.source}] ${item.tipo}: ${cleanText}`.substring(0, 255)

  // ── IA: criticidade + oportunidades (uma chamada; sem custo extra)
  let criticalityTier: '1' | '2' | '3' | null = null
  let opportunitiesCreated = 0
  let opportunityTitles: string[] = []
  try {
    const oppResult = await detectOpportunitiesFromMovements({
      organizationId: execCase.organizationId,
      executionCaseId: execCase.id,
      movements: [`${item.tipo}: ${cleanText}`.substring(0, 1000)],
    })
    criticalityTier = oppResult.criticalityTier
    opportunitiesCreated = oppResult.oportunidadesCriadas
    opportunityTitles = oppResult.titulos
  } catch (e) {
    console.warn('[movement-ingestion] Detector de oportunidades falhou:', e)
  }

  // ── Timeline event COM o tier (append-only)
  const [newEvent] = await db
    .insert(timelineEvents)
    .values({
      organizationId: execCase.organizationId,
      executionCaseId: execCase.id,
      eventCategory: 'court',
      eventType: 'process_movement',
      occurredAt: item.occurredAt,
      summary,
      source: 'integration',
      actorType: 'system',
      actorId: `${item.source}-sync`,
      criticalityTier,
      dedupFingerprint: fingerprint,
    })
    .returning()

  // ── Tier 1/2 → caso 'stale' + registra a movimentação causadora
  let markedStale = false
  if (criticalityTier === '1' || criticalityTier === '2') {
    await db
      .update(executionCases)
      .set({
        documentFreshnessStatus: 'stale',
        pendingCriticalMovementSince: item.occurredAt,
        pendingCriticalMovementType: item.tipo,
        updatedAt: new Date(),
      })
      .where(eq(executionCases.id, execCase.id))
    markedStale = true
  }

  // ── Comunicação oficial (intimação/publicação/citação) → court_communication
  // + prazo provisório. Achado 13/07/2026: SÓ grava aqui quando o item É, em
  // si, um ato de comunicação (ver isFormalCommunication) — não toda
  // movimentação. Movimentação comum (ex.: "Conclusos para decisão") já foi
  // gravada acima na timeline; duplicá-la aqui só inflava "Recebidas" com
  // ruído sem virar comunicação de verdade nenhuma.
  const isComm = item.kind === 'intimacao' || isFormalCommunication(item.tipo, cleanText)
  const possibleDeadline =
    isComm &&
    (item.kind === 'intimacao' ||
      hasDeadlineSignal(item.tipo, cleanText) ||
      criticalityTier === '1' ||
      criticalityTier === '2')

  let provisionalDeadlineId: string | null = null
  if (isComm) {
   try {
    const [comm] = await db
      .insert(courtCommunications)
      .values({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        processNumber: cnj,
        kind: item.kind === 'intimacao' ? 'intimacao' : 'publicacao',
        source: item.source,
        content: `${item.tipo}: ${cleanText}`.substring(0, 8000),
        availableAt: item.occurredAt,
        publishedAt: item.occurredAt,
        possibleDeadline,
        status: 'processed',
        rawPayload: (item.rawPayload ?? null) as never,
        contentHash,
      })
      .onConflictDoNothing()
      .returning()

    // Achado 13/07/2026: antes só disparava pra kind==='intimacao' (só o DJEN
    // usa essa tag) — uma publicação real vinda da InfoSimples com
    // possibleDeadline=true NUNCA gerava prazo provisório (0 em 763 gravados).
    // Agora que o insert acima já é gated por isComm, basta possibleDeadline.
    if (comm && possibleDeadline) {
      provisionalDeadlineId = await createProvisionalDeadline({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        tipo: item.tipo,
        conteudo: cleanText,
        publishedAt: item.occurredAt,
        sourceEventId: newEvent?.id ?? null,
        source: item.source,
      })
      if (provisionalDeadlineId && comm) {
        await db
          .update(courtCommunications)
          .set({ deadlineId: provisionalDeadlineId, updatedAt: new Date() })
          .where(eq(courtCommunications.id, comm.id))
      }
    }
   } catch (e) {
    console.warn('[movement-ingestion] Falha em court_communication/prazo:', e)
   }
  }

  // ── Domain event
  if (newEvent) {
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId: execCase.organizationId,
      eventType: 'case.movements.received',
      aggregateId: execCase.id,
      aggregateType: 'execution_case',
      correlationId: crypto.randomUUID(),
      actorType: 'system',
      actorId: `${item.source}-sync`,
      occurredAt: new Date(),
      recordedAt: new Date(),
      payload: {
        executionCaseId: execCase.id,
        cnj,
        newEventIds: [newEvent.id],
        source: item.source,
        criticalityTier,
      },
      metadata: { source: item.source },
    })
  }

  // ── Notifica o escritório
  try {
    await notifications.sendProcessUpdate(
      execCase.organizationId,
      execCase.id,
      cnj,
      item.tipo,
      cleanText || 'Nova movimentação processual.'
    )
    if (opportunitiesCreated > 0) {
      await notifications.sendProcessUpdate(
        execCase.organizationId,
        execCase.id,
        cnj,
        'Oportunidade detectada',
        `${opportunitiesCreated} nova(s) oportunidade(s) sugerida(s): ${opportunityTitles.join('; ')}`
      )
    }
  } catch (e) {
    console.warn('[movement-ingestion] Falha ao notificar:', e)
  }

  return {
    status: 'processed',
    timelineEventId: newEvent?.id ?? null,
    criticalityTier,
    opportunitiesCreated,
    opportunityTitles,
    markedStale,
    provisionalDeadlineId,
  }
}

/**
 * Encontra o caso pelo CNJ e processa uma lista de movimentações.
 * Usada pelo endpoint interno chamado pelos workers DataJud/DJEN.
 */
export async function ingestMovementsByCnj(
  cnj: string,
  items: MovementItem[]
): Promise<{ matched: boolean; results: MovementIngestResult[]; orphaned: number }> {
  const normalized = cnj.replace(/\D/g, '')
  const [execCase] = await db
    .select()
    .from(executionCases)
    .where(eq(executionCases.executionProcessNumber, cnj.trim()))
    .limit(1)

  // Tenta também casar por dígitos (o caso pode estar salvo com pontuação diferente)
  let target = execCase ?? null
  if (!target && normalized.length === 20) {
    const all = await db
      .select()
      .from(executionCases)
    target = all.find((c) => (c.executionProcessNumber ?? '').replace(/\D/g, '') === normalized) ?? null
  }

  if (!target) {
    // Sem caso: registra as intimações como ÓRFÃS (triagem) — nada se perde.
    // Vincula ao inventário se o CNJ bater com um item lá.
    const orphaned = await recordOrphanCommunications(cnj.trim(), items)
    return { matched: false, results: [], orphaned }
  }

  const results: MovementIngestResult[] = []
  for (const item of items) {
    results.push(await ingestMovementForCase(target, item))
  }
  return { matched: true, results, orphaned: 0 }
}

/**
 * Intimações de processo SEM caso operacional → court_communications órfãs
 * (aparecem em /intimations para triagem). Vincula ao inventário se o CNJ bater.
 * Dedup por contentHash. Single-tenant: resolve a organização única.
 */
async function recordOrphanCommunications(cnj: string, items: MovementItem[]): Promise<number> {
  try {
    const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1)
    if (!org) return 0
    const normalized = cnj.replace(/\D/g, '')

    const [invItem] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, org.id),
          eq(inventoryItems.processNumber, cnj)
        )
      )
      .limit(1)

    let count = 0
    for (const item of items) {
      const cleanText = stripHtml(item.conteudo).substring(0, 8000)
      // Mesmo filtro do caminho com caso vinculado (ver isFormalCommunication):
      // movimentação comum de um processo órfão vira ruído duplicado igual,
      // sem virar comunicação de verdade — não grava.
      if (item.kind !== 'intimacao' && !isFormalCommunication(item.tipo, cleanText)) continue
      const contentHash = communicationHash(cnj, item.dedupKey)
      const [inserted] = await db
        .insert(courtCommunications)
        .values({
          organizationId: org.id,
          inventoryItemId: invItem?.id ?? null,
          processNumber: normalized.length === 20 ? cnj : cnj,
          kind: item.kind === 'intimacao' ? 'intimacao' : 'publicacao',
          source: item.source,
          content: `${item.tipo}: ${cleanText}`.substring(0, 8000),
          availableAt: item.occurredAt,
          publishedAt: item.occurredAt,
          possibleDeadline: item.kind === 'intimacao' || hasDeadlineSignal(item.tipo, cleanText),
          status: invItem ? 'new' : 'orphan',
          rawPayload: (item.rawPayload ?? null) as never,
          contentHash,
        })
        .onConflictDoNothing()
        .returning({ id: courtCommunications.id })
      if (inserted) count++
    }
    return count
  } catch (e) {
    console.warn('[movement-ingestion] Falha ao registrar órfãs:', e)
    return 0
  }
}
