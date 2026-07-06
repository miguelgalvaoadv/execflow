/**
 * Registro em massa de processos descobertos (InfoSimples por OAB) como casos.
 *
 * Para cada processo de execução penal descoberto:
 *   1. Cria/reusa o CLIENTE (executado/réu) — dedup por internalRef estável.
 *   2. Cria/reusa o CASO (execution_case) — dedup por CNJ.
 *   3. Insere as movimentações na timeline (dedup por summary).
 *   4. Marca documentFreshnessStatus='unknown' (sem autos → avisa, não bloqueia)
 *      e cria a TAREFA "Anexar autos" — é o "pedido de autos" que o Miguel pediu,
 *      para que prazos/oportunidades melhorem quando os autos entrarem.
 *
 * Escrita DIRETA no banco de propósito: registrar 250 casos via createCase()
 * dispararia 250 syncs Jusbrasil e 250 cadeias de evento — caro e desnecessário.
 * A análise profunda (IA) acontece quando o advogado sobe os autos e clica
 * "Analisar", não no cadastro em massa.
 */

import { eq, and } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import { movementFingerprint } from './movement-ingestion.ts'
import {
  clients,
  executionCases,
  timelineEvents,
  workflowTasks,
  documents,
  memberships,
  users,
  organizations,
} from '@execflow/db/schema'

export type DiscoveredMovement = { data: string; texto: string }

export type DiscoveredProcess = {
  cnj: string
  clientName: string | null
  courtName: string | null
  jurisdiction: string | null
  classe: string | null
  source: string
  movements: DiscoveredMovement[]
}

export type RegistrationResult = {
  clientsCreated: number
  casesCreated: number
  casesExisting: number
  casesArchived: number
  movementsInserted: number
  autosTasksCreated: number
  skipped: number
}

const SENSITIVE = [
  'sentenc', 'acordao', 'decisao', 'transito', 'falta grave', 'regress',
  'homologacao de calculo', 'progress', 'livramento', 'extin', 'mandado',
  'alvara', 'prisao',
]

/**
 * Movimentos que ENCERRAM a execução penal (tabela CNJ — movimento 22 "Baixa
 * Definitiva", extinção da punibilidade/pena, arquivamento definitivo).
 * Quando a movimentação MAIS RECENTE bate com um destes, o caso é auto-arquivado
 * (o advogado pode reabrir). Fonte: TPU/CNJ + prática e-SAJ execução penal.
 */
const TERMINAL_MOVEMENTS = [
  /baixa definitiva/,
  /arquivamento definitivo/,
  /arquivad[oa] definitivamente/,
  /definitivo o arquivamento/,
  /extint[ao] a punibilidade/,
  /extincao da punibilidade/,
  /extint[ao] a pena/,
  /extincao da pena/,
  /extint[ao] a execucao/,
  /julgo extinta a (execucao|pena|punibilidade)/,
  /declaro extinta a (execucao|pena|punibilidade)/,
]

function isTerminalMovement(text: string): boolean {
  const t = norm(text)
  return TERMINAL_MOVEMENTS.some((re) => re.test(t))
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** dd/mm/yyyy → Date (meio-dia UTC). */
function parseBrDate(s: string): Date {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }
  return new Date()
}

/** Resolve org única + primeiro advogado/admin (para os campos NOT NULL). */
async function resolveSystemActor(): Promise<{ orgId: string; userId: string } | null> {
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1)
  if (!org) return null
  const [actor] = await db
    .select({ userId: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, org.id))
    .limit(1)
  if (!actor) return null
  return { orgId: org.id, userId: actor.userId }
}

export async function registerDiscoveredProcesses(
  processes: DiscoveredProcess[]
): Promise<RegistrationResult> {
  const result: RegistrationResult = {
    clientsCreated: 0,
    casesCreated: 0,
    casesExisting: 0,
    casesArchived: 0,
    movementsInserted: 0,
    autosTasksCreated: 0,
    skipped: 0,
  }

  const actor = await resolveSystemActor()
  if (!actor) {
    console.warn('[case-registration] Sem organização/usuário — nada registrado.')
    return result
  }
  const { orgId, userId } = actor

  for (const proc of processes) {
    const cnj = proc.cnj.trim()
    if (!cnj) {
      result.skipped++
      continue
    }

    try {
      // ── 1. Caso já existe?
      const [existingCase] = await db
        .select()
        .from(executionCases)
        .where(
          and(
            eq(executionCases.organizationId, orgId),
            eq(executionCases.executionProcessNumber, cnj)
          )
        )
        .limit(1)

      let execCase = existingCase ?? null

      if (!execCase) {
        // ── 2. Cliente (executado) — dedup por internalRef estável
        const clientRef = `INFOSIMPLES-${cnj.replace(/\D/g, '')}`
        const clientName = proc.clientName?.trim() || `Executado (processo ${cnj})`
        const [existingClient] = await db
          .select()
          .from(clients)
          .where(and(eq(clients.organizationId, orgId), eq(clients.internalRef, clientRef)))
          .limit(1)

        let clientId = existingClient?.id ?? null
        if (!clientId) {
          const [newClient] = await db
            .insert(clients)
            .values({
              organizationId: orgId,
              fullName: clientName,
              internalRef: clientRef,
              responsibleLawyerUserId: userId,
              status: 'active',
              registrationOrigin: 'infosimples',
              createdByUserId: userId,
              notes: `Cadastro automático via InfoSimples (${proc.source}) a partir do processo ${cnj}. Executado: ${proc.clientName ?? '—'}. Conferir/completar dados.`,
            } as never)
            .returning()
          clientId = newClient?.id ?? null
          if (clientId) result.clientsCreated++
        }
        if (!clientId) {
          result.skipped++
          continue
        }

        // ── 3. Caso
        const [newCase] = await db
          .insert(executionCases)
          .values({
            organizationId: orgId,
            clientId,
            internalRef: `EXE-${cnj.replace(/\D/g, '').slice(0, 12)}`,
            executionProcessNumber: cnj,
            courtName: proc.courtName ?? null,
            courtJurisdiction: proc.jurisdiction ?? null,
            caseKind: 'primary',
            status: 'active',
            responsibleLawyerUserId: userId,
            openedAt: new Date(),
            monitoringStatus: 'monitored',
            lastSyncedAt: new Date(),
            // Sem autos → 'unknown': avisa, não bloqueia (spec §7/§9)
            documentFreshnessStatus: 'unknown',
            priority: 'medium',
            priorityReason: `Importado por OAB (${proc.source}). Classe: ${proc.classe ?? 'Execução da Pena'}.`,
            createdByUserId: userId,
          } as never)
          .returning()
        execCase = newCase ?? null
        if (execCase) result.casesCreated++
      } else {
        result.casesExisting++
      }

      if (!execCase) {
        result.skipped++
        continue
      }

      // ── 4. Movimentações — dedup CRUZADO por impressão digital (mesma usada
      // por DataJud/DJEN/AASP), para nunca empilhar o mesmo fato entre fontes.
      const existing = await db
        .select({ fp: timelineEvents.dedupFingerprint, summary: timelineEvents.summary })
        .from(timelineEvents)
        .where(eq(timelineEvents.executionCaseId, execCase.id))
      const seenFp = new Set(existing.map((e) => e.fp).filter(Boolean) as string[])
      const seenSummary = new Set(existing.map((e) => e.summary))
      let hasSensitive = false

      for (const mov of proc.movements) {
        const occurredAt = parseBrDate(mov.data)
        const fingerprint = movementFingerprint(execCase.executionProcessNumber ?? '', occurredAt, mov.texto)
        const summary = `[${proc.source}] ${mov.texto}`.substring(0, 255)
        if (seenFp.has(fingerprint) || seenSummary.has(summary)) continue
        if (SENSITIVE.some((k) => norm(mov.texto).includes(k))) hasSensitive = true
        await db.insert(timelineEvents).values({
          organizationId: orgId,
          executionCaseId: execCase.id,
          eventCategory: 'court',
          eventType: 'process_movement',
          occurredAt,
          summary,
          source: 'integration',
          actorType: 'system',
          actorId: `${proc.source}-sync`,
          dedupFingerprint: fingerprint,
        } as never)
        seenFp.add(fingerprint)
        seenSummary.add(summary)
        result.movementsInserted++
      }

      // ── 5. ENCERRAMENTO: se a movimentação MAIS RECENTE for terminal
      // (baixa definitiva / extinção / arquivamento), auto-arquiva o caso.
      // Só arquiva casos ativos; nunca "desarquiva" (o advogado reabre à mão).
      const latest = proc.movements.reduce<{ at: Date; texto: string } | null>((acc, m) => {
        const at = parseBrDate(m.data)
        return !acc || at > acc.at ? { at, texto: m.texto } : acc
      }, null)
      if (latest && isTerminalMovement(latest.texto) && execCase.status === 'active') {
        await db
          .update(executionCases)
          .set({
            status: 'archived',
            closedAt: latest.at,
            closedReason: `Encerramento detectado pela última movimentação: "${latest.texto.slice(0, 150)}". Reabra se ainda houver providência.`,
            priority: 'low',
            updatedAt: new Date(),
          })
          .where(eq(executionCases.id, execCase.id))
        result.casesArchived++
      } else if (hasSensitive) {
        // Movimentação sensível (não terminal) eleva a prioridade (regra barata, sem IA)
        await db
          .update(executionCases)
          .set({
            priority: 'high',
            priorityReason: 'Movimentação sensível detectada (sentença/decisão/falta grave/etc.) — conferir e anexar autos.',
            updatedAt: new Date(),
          })
          .where(eq(executionCases.id, execCase.id))
      }

      // ── 6. Pedido de autos (só para casos ATIVOS sem autos)
      const stillActive = !(latest && isTerminalMovement(latest.texto))
      if (stillActive) await ensureAutosTask(orgId, execCase.id, userId, result)
    } catch (e) {
      console.warn(`[case-registration] Falha no processo ${cnj}:`, e instanceof Error ? e.message : e)
      result.skipped++
    }
  }

  return result
}

/**
 * Garante uma tarefa "Anexar autos" viva para o caso, se ele não tem autos
 * confirmados. Idempotente: não duplica se já existe uma tarefa aberta.
 */
export async function ensureAutosTask(
  orgId: string,
  executionCaseId: string,
  userId: string,
  result?: RegistrationResult
): Promise<void> {
  const autosClasses = ['autos_iniciais', 'autos_integral']
  const [hasAutos] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.executionCaseId, executionCaseId),
        eq(documents.status, 'confirmed')
      )
    )
    .limit(1)
  // Se já há QUALQUER documento confirmado de autos, não pede.
  if (hasAutos) {
    const [autosDoc] = await db
      .select({ id: documents.id, cls: documents.documentClass })
      .from(documents)
      .where(and(eq(documents.executionCaseId, executionCaseId), eq(documents.status, 'confirmed')))
      .limit(50)
    if (autosDoc && autosClasses.includes(String(autosDoc.cls))) return
  }

  // Já existe tarefa de autos aberta?
  const openTask = await db
    .select({ id: workflowTasks.id, status: workflowTasks.status, type: workflowTasks.taskType })
    .from(workflowTasks)
    .where(eq(workflowTasks.executionCaseId, executionCaseId))
  const alreadyOpen = openTask.some(
    (t) =>
      t.type === 'collect_missing_data' &&
      ['pending', 'claimed', 'in_progress', 'blocked', 'released'].includes(String(t.status))
  )
  if (alreadyOpen) return

  await db.insert(workflowTasks).values({
    organizationId: orgId,
    taskType: 'collect_missing_data',
    title: 'Anexar autos do processo',
    description:
      'Este caso ainda não tem os autos no ExecFlow. As movimentações já entram automaticamente, ' +
      'mas os PRAZOS e as OPORTUNIDADES só ficam confiáveis com os autos. Suba o PDF dos autos na ' +
      'aba Documentos e clique em "Analisar autos (IA)".',
    priority: 'high',
    executionCaseId,
    requiresReview: false,
    createdByUserId: userId,
    taskMetadata: { reason: 'sem_autos', autoCreated: true },
  } as never)
  if (result) result.autosTasksCreated++
}
