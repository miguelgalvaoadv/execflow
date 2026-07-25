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
  listReservations(filter?: { status?: ReservationStatus }): Promise<ReservationRecord[]>;

  // bloqueios manuais
  addManualBlock(b: { checkIn: LocalDate; checkOut: LocalDate; reason?: string; createdBy?: string }): Promise<string>;
  removeManualBlock(id: string): Promise<void>;

  // iCal
  replaceIcalEvents(events: BusyPeriod[], sourceUrl: string | null): Promise<void>;
  logIcalSync(log: { success: boolean; eventsFound: number; periodsImported: number; durationMs: number; error?: string | null; sourceUrl?: string | null }): Promise<void>;
  /** Timestamp da última sincronização BEM-SUCEDIDA do iCal (para throttle/cache). */
  lastIcalSyncAt(): Promise<Date | null>;

  // pagamentos
  upsertPaymentTx(tx: PaymentTxRecord): Promise<void>;
  recordWebhookEvent(eventKey: string, signatureOk: boolean, payload: unknown): Promise<WebhookRecordResult>;
  markWebhookProcessed(eventKey: string): Promise<void>;

  // notificações
  logNotification(n: { reservationId?: string | null; template: string; recipient?: string | null; status?: string }): Promise<void>;
}
