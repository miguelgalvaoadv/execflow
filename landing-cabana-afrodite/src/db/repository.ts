/**
 * Contrato de acesso a dados. Duas implementações:
 *   - InMemoryRepository (mock/testes) — src/db/memory.ts
 *   - SupabaseRepository (sandbox/production) — src/db/supabase.ts
 *
 * O serviço de reservas depende APENAS desta interface.
 */
import type { PricingConfig } from "../domain/pricing.js";
import type { BusyPeriod } from "../domain/availability.js";
import type { ReservationStatus, StatusChange } from "../domain/reservation-state.js";
import type { LocalDate } from "../domain/dates.js";
import type { Cents } from "../domain/money.js";

export interface GuestData {
  fullName: string;
  email: string;
  phone?: string | null;
  document?: string | null;
  notes?: string | null;
  acceptedRules: boolean;
  acceptedCancellation: boolean;
  acceptedPrivacy: boolean;
}

export interface ReservationRecord {
  id: string;
  friendlyCode: string;
  publicToken: string;
  externalReference: string;
  status: ReservationStatus;
  checkIn: LocalDate;
  checkOut: LocalDate;
  adults: number;
  children: number;
  quote: unknown;
  totalCents: Cents;
  payNowCents: Cents;
  currency: string;
  paymentExpiresAt: string | null;
  createdAt: string;
  guest: GuestData;
}

export interface PaymentTxRecord {
  reservationId: string;
  provider: string;
  preferenceId?: string | null;
  paymentId?: string | null;
  status?: string | null;
  amountCents?: Cents | null;
  currency?: string | null;
  liveMode?: boolean | null;
  externalReference?: string | null;
  raw?: unknown;
}

/** Períodos que devem bloquear o calendário (status bloqueantes). */
export const BLOCKING_STATUSES: ReservationStatus[] = [
  "awaiting_payment",
  "payment_pending",
  "paid",
  "confirmed",
];

export class ConflictError extends Error {
  constructor(message = "Período indisponível") {
    super(message);
    this.name = "ConflictError";
  }
}

export interface WebhookRecordResult {
  alreadyProcessed: boolean;
}

/** Período especial / feriado com tarifa própria (editável pelo painel). */
export interface SpecialPeriodRecord {
  id: string;
  name: string;
  startDate: LocalDate;
  endDate: LocalDate;
  nightlyCents: Cents | null;
  minNights: number | null;
  discountPercent: number | null;
}

/** Log de uma tentativa de sincronização do iCal do Airbnb. */
export interface IcalSyncLogRecord {
  startedAt: string;
  finishedAt: string | null;
  success: boolean | null;
  eventsFound: number | null;
  periodsImported: number | null;
  durationMs: number | null;
  errorMessage: string | null;
}

/** Entrada do log administrativo (quem fez o quê). */
export interface AuditLogRecord {
  actor: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Notificação registrada (enviada, falhada ou sem template). */
export interface NotificationLogRecord {
  reservationId: string | null;
  template: string;
  recipient: string | null;
  status: string;
  createdAt: string;
}

export type PhotoCategory = "externa" | "banho" | "quarto" | "interior" | "mais";
export const PHOTO_CATEGORIES: PhotoCategory[] = ["externa", "banho", "quarto", "interior", "mais"];

/** Foto da galeria. `builtin` = arquivo estático do deploy; `upload` = Supabase Storage. */
export interface PhotoRecord {
  id: string;
  url: string;
  storagePath: string | null;
  category: PhotoCategory;
  caption: string | null;
  sortOrder: number;
  active: boolean;
  isCover: boolean;
  source: "builtin" | "upload";
}

export interface ManualBlockRecord {
  id: string;
  checkIn: LocalDate;
  checkOut: LocalDate;
  reason: string | null;
  active: boolean;
}

export interface Repository {
  // preços / configuração
  getActivePricingConfig(): Promise<PricingConfig>;

  // disponibilidade
  listBusyPeriods(): Promise<BusyPeriod[]>;

  // reservas
  createReservation(rec: ReservationRecord): Promise<void>;
  getReservationById(id: string): Promise<ReservationRecord | null>;
  getReservationByToken(token: string): Promise<ReservationRecord | null>;
  getReservationByExternalRef(ref: string): Promise<ReservationRecord | null>;
  /** Transição atômica de status + histórico. Lança ConflictError se, ao virar
   *  status bloqueante, houver sobreposição. */
  transitionStatus(id: string, to: ReservationStatus, change: StatusChange): Promise<void>;
  /** Persiste o prazo de pagamento (definido na aprovação). */
  setReservationExpiry(id: string, expiresAtIso: string): Promise<void>;
  /** `search` filtra por nome ou e-mail do hóspede (case-insensitive). */
  listReservations(filter?: { status?: ReservationStatus; search?: string }): Promise<ReservationRecord[]>;
  /** Histórico de mudanças de status de uma reserva (mais antigo primeiro). */
  listStatusHistory(reservationId: string): Promise<StatusChange[]>;
  /** Grava uma entrada de histórico sem transicionar (ex.: estado inicial). */
  appendStatusHistory(reservationId: string, change: StatusChange): Promise<void>;

  // bloqueios manuais
  addManualBlock(b: { checkIn: LocalDate; checkOut: LocalDate; reason?: string; createdBy?: string }): Promise<string>;
  removeManualBlock(id: string): Promise<void>;
  listManualBlocks(): Promise<ManualBlockRecord[]>;

  // preços e períodos especiais (editáveis pelo painel)
  updatePricingConfig(patch: Partial<PricingConfig>): Promise<void>;
  listSpecialPeriods(): Promise<SpecialPeriodRecord[]>;
  createSpecialPeriod(p: Omit<SpecialPeriodRecord, "id">): Promise<string>;
  deleteSpecialPeriod(id: string): Promise<void>;

  // consultas administrativas
  listPaymentTransactions(limit?: number): Promise<(PaymentTxRecord & { createdAt: string })[]>;
  listIcalSyncLogs(limit?: number): Promise<IcalSyncLogRecord[]>;

  // token do calendário .ics (regenerável pelo painel)
  getIcalExportToken(): Promise<string | null>;
  setIcalExportToken(token: string): Promise<void>;

  // galeria de fotos (gerenciável pelo painel)
  /** `includeInactive` só no painel; a galeria pública recebe apenas as ativas. */
  listPhotos(opts?: { includeInactive?: boolean }): Promise<PhotoRecord[]>;
  createPhoto(p: { url: string; storagePath?: string | null; category: PhotoCategory; caption?: string | null; sortOrder?: number }): Promise<string>;
  updatePhoto(id: string, patch: Partial<Pick<PhotoRecord, "category" | "caption" | "sortOrder" | "active" | "isCover">>): Promise<void>;
  /** Remove o registro; devolve o storagePath para apagar o arquivo (quando upload). */
  deletePhoto(id: string): Promise<{ storagePath: string | null; source: "builtin" | "upload" } | null>;
  /** Marca uma foto como capa e desmarca as demais (índice único exige atomicidade). */
  setCoverPhoto(id: string): Promise<void>;
  nextPhotoSortOrder(): Promise<number>;

  // log administrativo
  logAudit(entry: { actor?: string | null; action: string; entity?: string | null; entityId?: string | null; metadata?: Record<string, unknown> | null }): Promise<void>;
  listAuditLogs(limit?: number): Promise<AuditLogRecord[]>;

  // iCal
  replaceIcalEvents(events: BusyPeriod[], sourceUrl: string | null): Promise<void>;
  logIcalSync(log: { success: boolean; eventsFound: number; periodsImported: number; durationMs: number; error?: string | null; sourceUrl?: string | null }): Promise<void>;
  /** Timestamp da última sincronização BEM-SUCEDIDA do iCal (para throttle/cache). */
  lastIcalSyncAt(): Promise<Date | null>;

  // pagamentos
  upsertPaymentTx(tx: PaymentTxRecord): Promise<void>;
  /** Último pagamento registrado para a reserva (para confirmação manual). */
  latestPaymentForReservation(reservationId: string): Promise<PaymentTxRecord | null>;
  recordWebhookEvent(eventKey: string, signatureOk: boolean, payload: unknown): Promise<WebhookRecordResult>;
  markWebhookProcessed(eventKey: string): Promise<void>;

  // notificações
  logNotification(n: { reservationId?: string | null; template: string; recipient?: string | null; status?: string }): Promise<void>;
  /** Já existe notificação deste template para esta reserva? (idempotência de lembretes) */
  hasNotification(reservationId: string, template: string): Promise<boolean>;
  listNotifications(limit?: number): Promise<NotificationLogRecord[]>;

  // configurações genéricas (chave/valor em `settings`)
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;
}
