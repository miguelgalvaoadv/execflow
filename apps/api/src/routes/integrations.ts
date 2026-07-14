/**
 * Integrações — estado honesto de cada fonte externa (spec §22).
 *
 * REGRA DE ENTREGA: nenhuma integração fingida. O status vem de:
 *   1. Presença REAL da credencial no ambiente (hasCredential).
 *   2. Última execução registrada (health checks / sync logs).
 * Conectores sem credencial ficam 'pending_credential' com a alternativa
 * manual indicada — nunca aparecem como "conectado".
 *
 * GET /api/v1/integrations — lista (semeia os conectores padrão na 1ª chamada)
 */

import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { integrationConnectors } from '@execflow/db/schema'
import type { HonoVariables } from '../context/types.ts'

export const integrationsRouter = new Hono<{ Variables: HonoVariables }>()

integrationsRouter.use('*', authMiddleware, orgMiddleware)

type ConnectorSeed = {
  kind: string
  name: string
  category: string
  manualImportAvailable: boolean
  notes: string | null
  /** Lê o ambiente e diz se a credencial está configurada. */
  credentialCheck: () => boolean
  /** Kill-switch de ambiente (se existir). */
  enabledCheck?: () => boolean
}

const CONNECTOR_SEEDS: ConnectorSeed[] = [
  {
    kind: 'datajud',
    name: 'DataJud (CNJ) — metadados públicos',
    category: 'movimentacoes',
    manualImportAvailable: false,
    notes:
      'API pública do CNJ por número de processo conhecido. Credencial vive no serviço de workers — o status aqui usa evidência de execução registrada.',
    credentialCheck: () => Boolean(process.env['DATAJUD_API_KEY']),
  },
  {
    kind: 'jusbrasil',
    name: 'Jusbrasil — monitoramento (webhook)',
    category: 'movimentacoes',
    manualImportAvailable: false,
    notes: 'Extra opcional — só roda se JUSBRASIL_API_KEY estiver configurada.',
    credentialCheck: () => Boolean(process.env['JUSBRASIL_API_KEY']),
  },
  {
    kind: 'djen',
    name: 'DJEN / Comunica — intimações por OAB',
    category: 'intimacoes',
    manualImportAvailable: false,
    notes:
      'Diário de Justiça Eletrônico Nacional. GRÁTIS, sem CNPJ, sem chave — consulta por OAB. Rodando no worker.',
    credentialCheck: () => true, // não exige credencial
    enabledCheck: () => process.env['DJEN_ENABLED'] !== 'false',
  },
  {
    kind: 'infosimples',
    name: 'InfoSimples — descoberta+monitoramento por OAB (TJSP e-SAJ)',
    category: 'movimentacoes',
    manualImportAvailable: false,
    notes:
      'Busca todos os processos de execução penal por OAB no TJSP e-SAJ (R$0,20/página) e cadastra automaticamente. Credencial vive no worker.',
    credentialCheck: () => Boolean(process.env['INFOSIMPLES_TOKEN']),
  },
  {
    kind: 'email_smtp',
    name: 'E-mail (SMTP) — notificações do escritório',
    category: 'notificacao',
    manualImportAvailable: false,
    notes: null,
    credentialCheck: () => Boolean(process.env['SMTP_USER'] && process.env['SMTP_PASS']),
  },
  // Conectores planejados — estrutura pronta, aguardando credencial/viabilidade.
  // NUNCA aparecem como conectados; a alternativa funcional é a importação CSV.
  ...(
    [
      ['esaj_1g', 'e-SAJ 1º grau (TJSP)', 'movimentacoes'],
      ['esaj_2g', 'e-SAJ 2º grau (TJSP)', 'movimentacoes'],
      ['pje', 'PJe', 'movimentacoes'],
      ['eproc', 'eproc', 'movimentacoes'],
      ['projudi', 'Projudi', 'movimentacoes'],
      ['seeu', 'SEEU — execução penal', 'movimentacoes'],
      ['stj', 'STJ', 'movimentacoes'],
      ['stf', 'STF', 'movimentacoes'],
      ['dje', 'DJE — Diário de Justiça Eletrônico', 'intimacoes'],
      ['djen', 'DJEN — Diário de Justiça Eletrônico Nacional', 'intimacoes'],
      ['domicilio_eletronico', 'Domicílio Judicial Eletrônico', 'intimacoes'],
    ] as const
  ).map(([kind, name, category]) => ({
    kind,
    name,
    category,
    manualImportAvailable: true,
    notes: 'Pendente de credencial/configuração. Alternativa funcional: importação CSV no Inventário por OAB.',
    credentialCheck: () => false,
  })),
]

integrationsRouter.get('/', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')

  // Semear/atualizar conectores com o estado REAL do ambiente.
  for (const seed of CONNECTOR_SEEDS) {
    const hasCredential = seed.credentialCheck()
    const enabled = seed.enabledCheck ? seed.enabledCheck() : true
    const status = !hasCredential
      ? 'pending_credential'
      : !enabled
        ? 'disabled'
        : 'never_synced' // promovido a 'connected' abaixo, se houver execução registrada

    const [existing] = await db
      .select()
      .from(integrationConnectors)
      .where(
        and(
          eq(integrationConnectors.organizationId, organization.id),
          eq(integrationConnectors.kind, seed.kind)
        )
      )
      .limit(1)

    if (!existing) {
      await db.insert(integrationConnectors).values({
        organizationId: organization.id,
        kind: seed.kind,
        name: seed.name,
        category: seed.category,
        status,
        hasCredential,
        manualImportAvailable: seed.manualImportAvailable,
        notes: seed.notes,
      })
    } else {
      // Atualiza só o estado derivado — nunca sobrescreve execuções.
      // EVIDÊNCIA > env: credenciais que vivem no serviço de workers (DataJud,
      // Astrea) não são visíveis ao processo da API; uma execução bem-sucedida
      // registrada é prova suficiente de que a credencial existe lá.
      const evidence = existing.lastSuccessAt !== null
      const effectiveCredential = hasCredential || evidence
      const derivedStatus =
        evidence && enabled
          ? 'connected'
          : !effectiveCredential
            ? 'pending_credential'
            : !enabled
              ? 'disabled'
              : 'never_synced'
      await db
        .update(integrationConnectors)
        .set({ hasCredential: effectiveCredential, status: derivedStatus, updatedAt: new Date() })
        .where(eq(integrationConnectors.id, existing.id))
    }
  }

  const connectors = await db
    .select()
    .from(integrationConnectors)
    .where(eq(integrationConnectors.organizationId, organization.id))
    .orderBy(integrationConnectors.category, integrationConnectors.name)

  return c.json({ data: connectors })
})
