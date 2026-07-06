/**
 * Inventário por OAB — descoberta e triagem em massa de processos do escritório.
 *
 * Resolve a dor: "tenho ~200 processos na minha OAB; como jogar todos no painel
 * sem baixar os autos de todos?" O fluxo correto é:
 *   1. Descobrir os processos pela OAB (fonte configurada ou importação CSV/XLSX).
 *   2. Registrar SÓ os metadados aqui (inventory_items) — não vira ExecutionCase ainda.
 *   3. Monitorar movimentações/intimações e classificar prioridade automaticamente.
 *   4. Promover a ExecutionCase (e baixar autos) apenas os importantes/urgentes.
 *
 * inventory_items é a ANTESSALA do ExecutionCase: um item promovido ganha
 * executionCaseId e sai da triagem; um item "não é nosso" é arquivado sem poluir
 * o operacional. Nada aqui alimenta o engine — só ExecutionCase alimenta.
 *
 * FONTES HONESTAS: cada item registra sourceInfo. Conectores sem credencial
 * ficam com status 'pending_credential' em integration_connectors; a alternativa
 * funcional é sempre a importação manual por CSV/planilha.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'
import { clients } from './client.ts'
import { executionCases } from './execution-case.ts'
import { users } from './user.ts'

export const oabProfiles = pgTable(
  'oab_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /** Nome do advogado como consta na OAB. */
    lawyerName: text('lawyer_name').notNull(),

    /** Número da inscrição OAB (sem UF). Ex.: "123456". */
    oabNumber: text('oab_number').notNull(),

    /** UF da seccional. Ex.: "SP". */
    oabUf: text('oab_uf').notNull(),

    /** Tribunal principal de atuação. Ex.: "TJSP". */
    primaryTribunal: text('primary_tribunal'),

    /** Sistema processual principal. Ex.: 'esaj' | 'pje' | 'eproc' | 'projudi' | 'seeu'. */
    primarySystem: text('primary_system'),

    /**
     * Fonte de busca configurada para este perfil.
     * 'csv_import'  → só importação manual (padrão — sempre funciona)
     * 'datajud'     → enriquecimento por CNJ conhecido (API pública CNJ)
     * 'esaj_1g' | 'esaj_2g' | 'pje' | ... → conectores diretos (quando autorizados)
     */
    searchSource: text('search_source').notNull().default('csv_import'),

    /**
     * Estado da última busca/sincronização.
     * 'never_synced' | 'syncing' | 'synced' | 'error' | 'pending_credential'
     */
    searchStatus: text('search_status').notNull().default('never_synced'),

    /** Última sincronização bem-sucedida de qualquer fonte. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),

    /** Detalhe do último erro de sincronização, se houver. */
    lastSyncError: text('last_sync_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('oab_profiles_org_oab_unique').on(
      table.organizationId,
      table.oabNumber,
      table.oabUf
    ),
  ]
)

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /** Perfil OAB que originou este item. NULL para importações avulsas. */
    oabProfileId: uuid('oab_profile_id').references(() => oabProfiles.id),

    // -------------------------------------------------------------------------
    // Identificação do processo (metadados — NÃO são os autos)
    // -------------------------------------------------------------------------

    /** Número CNJ do processo. Normalizado (com pontuação padrão). */
    processNumber: text('process_number').notNull(),

    /** Tribunal. Ex.: "TJSP", "TRF3", "STJ". */
    tribunal: text('tribunal'),

    /** Grau/instância: '1' | '2' | 'STJ' | 'STF' | 'execucao'. */
    degree: text('degree'),

    /** Sistema processual: 'esaj' | 'pje' | 'eproc' | 'projudi' | 'seeu' | outro. */
    system: text('system'),

    comarca: text('comarca'),
    vara: text('vara'),

    /** Classe processual. Ex.: "Apelação Criminal", "Execução Penal". */
    courtClass: text('court_class'),

    /** Área. Ex.: 'criminal' | 'execucao_penal' | 'civel' | outra. */
    area: text('area'),

    /** Situação declarada pela fonte: 'ativo' | 'arquivado' | 'suspenso' | 'baixado' | outro. */
    situation: text('situation'),

    /** Partes em texto livre, como vieram da fonte/planilha. */
    partiesText: text('parties_text'),

    /** Link direto para o processo no sistema de origem. */
    link: text('link'),

    // -------------------------------------------------------------------------
    // Última movimentação conhecida (metadado público — não substitui autos)
    // -------------------------------------------------------------------------

    lastMovementText: text('last_movement_text'),
    lastMovementAt: timestamp('last_movement_at', { withTimezone: true }),

    // -------------------------------------------------------------------------
    // Triagem e classificação
    // -------------------------------------------------------------------------

    /**
     * Prioridade calculada por regra determinística (ver inventory-classifier):
     * 'high' | 'medium' | 'low' | null (não classificado ainda).
     */
    priority: text('priority'),

    /** Justificativa legível da prioridade. Ex.: "movimentação contém 'sentença'". */
    priorityReason: text('priority_reason'),

    /** Marcado quando os autos completos precisam ser baixados/anexados. */
    needsAutos: boolean('needs_autos').notNull().default(false),

    /** Autos completos já anexados/importados para este processo. */
    autosDownloaded: boolean('autos_downloaded').notNull().default(false),

    /** Processo em segredo de justiça (declarado pela fonte ou marcado à mão). */
    isSealed: boolean('is_sealed').notNull().default(false),

    /**
     * Estado de conferência humana:
     * 'unreviewed' → importado, ninguém olhou
     * 'confirmed'  → é do escritório, dados conferidos
     * 'not_ours'   → não é mais do escritório (sai das contagens ativas)
     * 'archived'   → arquivado/baixado, manter só como histórico
     */
    reviewStatus: text('review_status').notNull().default('unreviewed'),

    // -------------------------------------------------------------------------
    // Vínculos (preenchidos na triagem/promoção)
    // -------------------------------------------------------------------------

    /** Cliente identificado para este processo. NULL = "sem cliente identificado". */
    clientId: uuid('client_id').references(() => clients.id),

    /** Preenchido quando o item é promovido a caso operacional. */
    executionCaseId: uuid('execution_case_id').references(() => executionCases.id),

    // -------------------------------------------------------------------------
    // Proveniência
    // -------------------------------------------------------------------------

    /**
     * De onde veio este item:
     * 'csv_import' | 'xlsx_import' | 'datajud' | 'aasp' | 'manual' | 'esaj' | outro.
     */
    sourceInfo: text('source_info').notNull().default('manual'),

    /** Identificador do lote de importação (mesmo arquivo → mesmo batch). */
    importBatchId: text('import_batch_id'),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Um processo aparece uma única vez por organização no inventário. */
    uniqueIndex('inventory_items_org_process_unique').on(
      table.organizationId,
      table.processNumber
    ),
    index('inventory_items_org_priority_idx').on(
      table.organizationId,
      table.priority,
      table.reviewStatus
    ),
    index('inventory_items_profile_idx').on(table.oabProfileId),
    index('inventory_items_client_idx').on(table.clientId),
  ]
)

export type OabProfile = typeof oabProfiles.$inferSelect
export type NewOabProfile = typeof oabProfiles.$inferInsert
export type InventoryItem = typeof inventoryItems.$inferSelect
export type NewInventoryItem = typeof inventoryItems.$inferInsert
