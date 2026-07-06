/**
 * IntegrationConnector — estado honesto de cada fonte externa.
 *
 * REGRA DE ENTREGA: nenhuma integração fingida. Cada conector declara
 * explicitamente se está conectado, pendente de credencial ou só disponível
 * via importação manual. A tela /settings/integracoes lê daqui — nunca de
 * valores hardcoded no frontend.
 *
 * SEGREDOS NÃO MORAM AQUI. configJson guarda apenas configuração não-sensível
 * (URLs, flags, cron). Credenciais ficam em variáveis de ambiente; este registro
 * apenas informa SE estão configuradas (hasCredential), nunca o valor.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organizations } from './organization.ts'

export const integrationConnectors = pgTable(
  'integration_connectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),

    /** Nome de exibição. Ex.: "AASP — Intimações". */
    name: text('name').notNull(),

    /**
     * Identificador estável do conector:
     * 'aasp' | 'datajud' | 'astrea_email' | 'jusbrasil' | 'esaj_1g' | 'esaj_2g'
     * | 'pje' | 'eproc' | 'projudi' | 'seeu' | 'stj' | 'stf' | 'dje' | 'djen'
     * | 'domicilio_eletronico' | 'google_calendar' | 'email_smtp'
     */
    kind: text('kind').notNull(),

    /**
     * Categoria funcional: 'intimacoes' | 'movimentacoes' | 'autos' | 'agenda' | 'notificacao'.
     */
    category: text('category').notNull(),

    /**
     * Estado honesto:
     * 'connected'          → credencial válida, sincronizando
     * 'pending_credential' → estrutura pronta, falta credencial/registro externo
     * 'auth_error'         → credencial configurada mas falhando
     * 'disabled'           → desligado por decisão operacional (kill-switch)
     * 'never_synced'       → configurado mas nunca rodou
     */
    status: text('status').notNull().default('pending_credential'),

    /** A credencial (env var) está presente no ambiente? Informativo, sem valor. */
    hasCredential: boolean('has_credential').notNull().default(false),

    /** Importação manual (CSV/planilha/upload) disponível como alternativa? */
    manualImportAvailable: boolean('manual_import_available').notNull().default(false),

    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),

    /** Contadores acumulados da última execução. */
    recordsImported: integer('records_imported').notNull().default(0),
    recordsUpdated: integer('records_updated').notNull().default(0),

    /** Configuração NÃO-sensível (URLs, flags, cron). Nunca credenciais. */
    configJson: jsonb('config_json'),

    /** Observações operacionais (ex.: "aguardando registro no portal AASP"). */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integration_connectors_org_kind_unique').on(
      table.organizationId,
      table.kind
    ),
  ]
)

export type IntegrationConnector = typeof integrationConnectors.$inferSelect
export type NewIntegrationConnector = typeof integrationConnectors.$inferInsert
