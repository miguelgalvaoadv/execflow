/**
 * Repositório em memória — usado no modo `mock` e nos testes.
 * Reproduz a garantia atômica anti-sobreposição da constraint do Postgres:
 * ao transicionar para um status bloqueante, verifica conflito com outras
 * reservas bloqueantes, bloqueios manuais e eventos do iCal.
 */
import { randomUUID } from "node:crypto";
import type {
  Repository,
  ReservationRecord,
  PaymentTxRecord,
  WebhookRecordResult,
} from "./repository.js";
import { BLOCKING_STATUSES, ConflictError } from "./repository.js";
import type { PricingConfig } from "../domain/pricing.js";
import type { BusyPeriod } from "../domain/availability.js";
import { findConflicts } from "../domain/availability.js";
import type { ReservationStatus, StatusChange } from "../domain/reservation-state.js";
import { assertTransition } from "../domain/reservation-state.js";
import type { LocalDate } from "../domain/dates.js";
import { DEMO_PRICING } from "../config/settings.js";

interface ManualBlock { id: string; checkIn: LocalDate; checkOut: LocalDate; reason?: string; active: boolean }

export class InMemoryRepository implements Repository {
  private reservations = new Map<string, ReservationRecord>();
  private statusHistory: StatusChange[] = [];
  private manualBlocks: ManualBlock[] = [];
  private icalEvents: BusyPeriod[] = [];
  private payments: PaymentTxRecord[] = [];
  private webhooks = new Map<string, { signatureOk: boolean; processed: boolean; payload: unknown }>();
  private notifications: unknown[] = [];
  private pricing: PricingConfig;

  constructor(pricing: PricingConfig = DEMO_PRICING) {
    this.pricing = pricing;
  }

  async getActivePricingConfig(): Promise<PricingConfig> {
    return this.pricing;
  }

  private blockingReservationPeriods(excludeId?: string): BusyPeriod[] {
    const out: BusyPeriod[] = [];
    for (const r of this.reservations.values()) {
      if (r.id === excludeId) continue;
      if (BLOCKING_STATUSES.includes(r.status)) {
        out.push({ checkIn: r.checkIn, checkOut: r.checkOut, source: "reservation", ref: r.id });
      }
    }
    return out;
  }

  async listBusyPeriods(): Promise<BusyPeriod[]> {
    return [
      ...this.blockingReservationPeriods(),
      ...this.manualBlocks.filter((b) => b.active).map((b) => ({ checkIn: b.checkIn, checkOut: b.checkOut, source: "manual_block" as const, ref: b.id })),
      ...this.icalEvents,
    ];
  }

  async createReservation(rec: ReservationRecord): Promise<void> {
    this.reservations.set(rec.id, structuredClone(rec));
  }

  async getReservationById(id: string): Promise<ReservationRecord | null> {
    const r = this.reservations.get(id);
    return r ? structuredClone(r) : null;
  }
  async getReservationByToken(token: string): Promise<ReservationRecord | null> {
    for (const r of this.reservations.values()) if (r.publicToken === token) return structuredClone(r);
    return null;
  }
  async getReservationByExternalRef(ref: string): Promise<ReservationRecord | null> {
    for (const r of this.reservations.values()) if (r.externalReference === ref) return structuredClone(r);
    return null;
  }

  async transitionStatus(id: string, to: ReservationStatus, change: StatusChange): Promise<void> {
    const r = this.reservations.get(id);
    if (!r) throw new Error(`reserva não encontrada: ${id}`);
    assertTransition(r.status, to);

    // Ao virar bloqueante, garante ausência de sobreposição (atômico).
    if (BLOCKING_STATUSES.includes(to)) {
      const prep = this.pricing.prepBufferNights;
      const busy = [
        ...this.blockingReservationPeriods(id),
        ...this.manualBlocks.filter((b) => b.active).map((b) => ({ checkIn: b.checkIn, checkOut: b.checkOut, source: "manual_block" as const, ref: b.id })),
        ...this.icalEvents,
      ];
      if (findConflicts({ checkIn: r.checkIn, checkOut: r.checkOut }, busy, prep).length > 0) {
        throw new ConflictError();
      }
    }
    r.status = to;
    this.statusHistory.push(change);
  }

  async setReservationExpiry(id: string, expiresAtIso: string): Promise<void> {
    const r = this.reservations.get(id);
    if (r) r.paymentExpiresAt = expiresAtIso;
  }

  async listReservations(filter?: { status?: ReservationStatus }): Promise<ReservationRecord[]> {
    let all = [...this.reservations.values()];
    if (filter?.status) all = all.filter((r) => r.status === filter.status);
    return all.map((r) => structuredClone(r));
  }

  async addManualBlock(b: { checkIn: LocalDate; checkOut: LocalDate; reason?: string; createdBy?: string }): Promise<string> {
    const id = randomUUID();
    this.manualBlocks.push({ id, checkIn: b.checkIn, checkOut: b.checkOut, reason: b.reason, active: true });
    return id;
  }
  async removeManualBlock(id: string): Promise<void> {
    const b = this.manualBlocks.find((x) => x.id === id);
    if (b) b.active = false;
  }

  async replaceIcalEvents(events: BusyPeriod[], _sourceUrl: string | null): Promise<void> {
    this.icalEvents = events.map((e) => ({ ...e }));
  }
  async logIcalSync(): Promise<void> {
    /* memória: no-op de log */
  }

  async upsertPaymentTx(tx: PaymentTxRecord): Promise<void> {
    const existing = tx.paymentId ? this.payments.find((p) => p.paymentId === tx.paymentId) : undefined;
    if (existing) Object.assign(existing, tx);
    else this.payments.push({ ...tx });
  }

  async recordWebhookEvent(eventKey: string, signatureOk: boolean, payload: unknown): Promise<WebhookRecordResult> {
    const existing = this.webhooks.get(eventKey);
    if (existing) return { alreadyProcessed: existing.processed };
    this.webhooks.set(eventKey, { signatureOk, processed: false, payload });
    return { alreadyProcessed: false };
  }
  async markWebhookProcessed(eventKey: string): Promise<void> {
    const e = this.webhooks.get(eventKey);
    if (e) e.processed = true;
  }

  async logNotification(n: unknown): Promise<void> {
    this.notifications.push(n);
  }

  // helpers de teste
  _statusHistory(): StatusChange[] {
    return this.statusHistory;
  }
  _notifications(): unknown[] {
    return this.notifications;
  }
}
