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
  SpecialPeriodRecord,
  IcalSyncLogRecord,
  AuditLogRecord,
  ManualBlockRecord,
  NotificationLogRecord,
  PhotoRecord,
  PhotoCategory,
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
  private statusHistory: (StatusChange & { reservationId: string })[] = [];
  private manualBlocks: ManualBlock[] = [];
  private icalEvents: BusyPeriod[] = [];
  private payments: (PaymentTxRecord & { createdAt: string })[] = [];
  private webhooks = new Map<string, { signatureOk: boolean; processed: boolean; payload: unknown }>();
  private notifications: NotificationLogRecord[] = [];
  private settings = new Map<string, unknown>();
  private photos: PhotoRecord[] = [];
  private specialPeriods: SpecialPeriodRecord[] = [];
  private syncLogs: IcalSyncLogRecord[] = [];
  private auditLogs: AuditLogRecord[] = [];
  private icalToken: string | null = null;
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
    this.statusHistory.push({ ...change, reservationId: id });
  }

  async listStatusHistory(reservationId: string): Promise<StatusChange[]> {
    return this.statusHistory.filter((h) => h.reservationId === reservationId).map(({ reservationId: _id, ...rest }) => rest);
  }

  async appendStatusHistory(reservationId: string, change: StatusChange): Promise<void> {
    this.statusHistory.push({ ...change, reservationId });
  }

  async setReservationExpiry(id: string, expiresAtIso: string): Promise<void> {
    const r = this.reservations.get(id);
    if (r) r.paymentExpiresAt = expiresAtIso;
  }

  async listReservations(filter?: { status?: ReservationStatus; search?: string }): Promise<ReservationRecord[]> {
    let all = [...this.reservations.values()];
    if (filter?.status) all = all.filter((r) => r.status === filter.status);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      all = all.filter((r) => r.guest.fullName.toLowerCase().includes(q) || r.guest.email.toLowerCase().includes(q) || r.friendlyCode.toLowerCase().includes(q));
    }
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
  async listManualBlocks(): Promise<ManualBlockRecord[]> {
    return this.manualBlocks
      .filter((b) => b.active)
      .map((b) => ({ id: b.id, checkIn: b.checkIn, checkOut: b.checkOut, reason: b.reason ?? null, active: b.active }));
  }

  async updatePricingConfig(patch: Partial<PricingConfig>): Promise<void> {
    this.pricing = { ...this.pricing, ...patch, payment: { ...this.pricing.payment, ...(patch.payment ?? {}) } };
  }

  async listSpecialPeriods(): Promise<SpecialPeriodRecord[]> {
    return this.specialPeriods.map((p) => ({ ...p }));
  }
  async createSpecialPeriod(p: Omit<SpecialPeriodRecord, "id">): Promise<string> {
    const id = randomUUID();
    this.specialPeriods.push({ id, ...p });
    // reflete imediatamente no motor de preços
    this.pricing = {
      ...this.pricing,
      specialPeriods: [
        ...this.pricing.specialPeriods,
        { id, name: p.name, start: p.startDate, end: p.endDate, nightlyCents: p.nightlyCents ?? this.pricing.defaultNightlyCents, minNights: p.minNights ?? undefined, discountPercent: p.discountPercent ?? undefined },
      ],
    };
    return id;
  }
  async deleteSpecialPeriod(id: string): Promise<void> {
    this.specialPeriods = this.specialPeriods.filter((p) => p.id !== id);
    this.pricing = { ...this.pricing, specialPeriods: this.pricing.specialPeriods.filter((p) => p.id !== id) };
  }

  async listPaymentTransactions(limit = 50): Promise<(PaymentTxRecord & { createdAt: string })[]> {
    return this.payments.slice(-limit).reverse().map((p) => ({ ...p }));
  }
  async listIcalSyncLogs(limit = 20): Promise<IcalSyncLogRecord[]> {
    return this.syncLogs.slice(-limit).reverse().map((l) => ({ ...l }));
  }

  async getIcalExportToken(): Promise<string | null> {
    return this.icalToken;
  }
  async setIcalExportToken(token: string): Promise<void> {
    this.icalToken = token;
  }

  async listPhotos(opts: { includeInactive?: boolean } = {}): Promise<PhotoRecord[]> {
    return this.photos
      .filter((p) => opts.includeInactive || p.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({ ...p }));
  }
  async createPhoto(p: { url: string; storagePath?: string | null; category: PhotoCategory; caption?: string | null; sortOrder?: number }): Promise<string> {
    if (this.photos.some((x) => x.url === p.url)) throw new Error("Foto já cadastrada (url duplicada).");
    const id = randomUUID();
    this.photos.push({
      id, url: p.url, storagePath: p.storagePath ?? null, category: p.category,
      caption: p.caption ?? null, sortOrder: p.sortOrder ?? (await this.nextPhotoSortOrder()),
      active: true, isCover: false, source: p.storagePath ? "upload" : "builtin",
    });
    return id;
  }
  async updatePhoto(id: string, patch: Partial<Pick<PhotoRecord, "category" | "caption" | "sortOrder" | "active" | "isCover">>): Promise<void> {
    const p = this.photos.find((x) => x.id === id);
    if (!p) throw new Error("Foto não encontrada.");
    Object.assign(p, patch);
  }
  async deletePhoto(id: string): Promise<{ storagePath: string | null; source: "builtin" | "upload" } | null> {
    const p = this.photos.find((x) => x.id === id);
    if (!p) return null;
    // builtin: só esconde (o arquivo estático continua no deploy)
    if (p.source === "builtin") { p.active = false; return { storagePath: null, source: "builtin" }; }
    this.photos = this.photos.filter((x) => x.id !== id);
    return { storagePath: p.storagePath, source: "upload" };
  }
  async setCoverPhoto(id: string): Promise<void> {
    this.photos.forEach((p) => { p.isCover = p.id === id; });
  }
  async nextPhotoSortOrder(): Promise<number> {
    return this.photos.reduce((m, p) => Math.max(m, p.sortOrder), -1) + 1;
  }

  async logAudit(entry: { actor?: string | null; action: string; entity?: string | null; entityId?: string | null; metadata?: Record<string, unknown> | null }): Promise<void> {
    this.auditLogs.push({
      actor: entry.actor ?? null, action: entry.action, entity: entry.entity ?? null,
      entityId: entry.entityId ?? null, metadata: entry.metadata ?? null, createdAt: new Date().toISOString(),
    });
  }
  async listAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
    return this.auditLogs.slice(-limit).reverse().map((a) => ({ ...a }));
  }

  private lastSync: Date | null = null;
  async replaceIcalEvents(events: BusyPeriod[], _sourceUrl: string | null): Promise<void> {
    this.icalEvents = events.map((e) => ({ ...e }));
  }
  async logIcalSync(log: { success: boolean; eventsFound?: number; periodsImported?: number; durationMs?: number; error?: string | null }): Promise<void> {
    if (log.success) this.lastSync = new Date();
    const now = new Date().toISOString();
    this.syncLogs.push({
      startedAt: now, finishedAt: now, success: log.success,
      eventsFound: log.eventsFound ?? null, periodsImported: log.periodsImported ?? null,
      durationMs: log.durationMs ?? null, errorMessage: log.error ?? null,
    });
  }
  async lastIcalSyncAt(): Promise<Date | null> {
    return this.lastSync;
  }

  async upsertPaymentTx(tx: PaymentTxRecord): Promise<void> {
    const existing = tx.paymentId ? this.payments.find((p) => p.paymentId === tx.paymentId) : undefined;
    if (existing) Object.assign(existing, tx);
    else this.payments.push({ ...tx, createdAt: new Date().toISOString() });
  }

  async latestPaymentForReservation(reservationId: string): Promise<PaymentTxRecord | null> {
    const matches = this.payments.filter((p) => p.reservationId === reservationId && p.paymentId);
    return matches.length ? { ...matches[matches.length - 1]! } : null;
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

  async logNotification(n: { reservationId?: string | null; template: string; recipient?: string | null; status?: string }): Promise<void> {
    this.notifications.push({
      reservationId: n.reservationId ?? null, template: n.template,
      recipient: n.recipient ?? null, status: n.status ?? "queued", createdAt: new Date().toISOString(),
    });
  }
  async hasNotification(reservationId: string, template: string): Promise<boolean> {
    return this.notifications.some((n) => n.reservationId === reservationId && n.template === template);
  }
  async listNotifications(limit = 100): Promise<NotificationLogRecord[]> {
    return this.notifications.slice(-limit).reverse().map((n) => ({ ...n }));
  }

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    return (this.settings.has(key) ? (this.settings.get(key) as T) : null);
  }
  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value);
  }

  // helpers de teste
  _statusHistory(): StatusChange[] {
    return this.statusHistory;
  }
  _notifications(): unknown[] {
    return this.notifications;
  }
}
