/**
 * Repositório Supabase (sandbox/production). Usa a SERVICE ROLE KEY (backend).
 * A garantia anti-sobreposição reserva-vs-reserva vem da exclusion constraint
 * do Postgres (0001_init.sql); violação vira ConflictError. Para bloqueios
 * manuais e iCal, faz verificação explícita antes de transicionar.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  BLOCKING_STATUSES,
  ConflictError,
  type Repository,
  type ReservationRecord,
  type PaymentTxRecord,
  type WebhookRecordResult,
} from "./repository.js";
import type { PricingConfig, SpecialPeriod } from "../domain/pricing.js";
import type { BusyPeriod } from "../domain/availability.js";
import { findConflicts } from "../domain/availability.js";
import type { ReservationStatus, StatusChange } from "../domain/reservation-state.js";
import { assertTransition } from "../domain/reservation-state.js";
import type { LocalDate } from "../domain/dates.js";

const EXCLUSION_VIOLATION = "23P01"; // exclusion_violation

export class SupabaseRepository implements Repository {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async getActivePricingConfig(): Promise<PricingConfig> {
    const { data: rule, error } = await this.db.from("pricing_rules").select("*").eq("is_active", true).limit(1).single();
    if (error) throw new Error(`pricing_rules: ${error.message}`);
    const { data: periods } = await this.db.from("special_periods").select("*");
    const specialPeriods: SpecialPeriod[] = (periods ?? []).map((p: any) => ({
      id: p.id, name: p.name, start: p.start_date, end: p.end_date,
      nightlyCents: p.nightly_cents ?? rule.default_nightly_cents,
      minNights: p.min_nights ?? undefined, discountPercent: p.discount_percent ?? undefined,
    }));
    return {
      currency: "BRL",
      defaultNightlyCents: rule.default_nightly_cents,
      weekdayNightlyCents: rule.weekday_nightly_cents ?? {},
      specialPeriods,
      dateOverrides: {},
      cleaningFeeCents: rule.cleaning_fee_cents,
      includedGuests: rule.included_guests,
      extraGuestFeeCents: rule.extra_guest_fee_cents,
      extraGuestPer: rule.extra_guest_per,
      maxGuests: rule.max_guests,
      minNights: rule.min_nights,
      maxNights: rule.max_nights ?? undefined,
      minReservationCents: rule.min_reservation_cents,
      flatDiscountPercent: Number(rule.flat_discount_percent ?? 0),
      lengthOfStayDiscounts: rule.length_of_stay_discounts ?? [],
      securityDepositCents: rule.security_deposit_cents,
      chargeDepositUpfront: rule.charge_deposit_upfront,
      payment: {
        mode: rule.payment_mode,
        signalPercent: Number(rule.signal_percent ?? 30),
        expirationHours: rule.payment_expiration_hours,
        maxInstallments: rule.max_installments,
      },
      prepBufferNights: rule.prep_buffer_nights,
    };
  }

  async listBusyPeriods(): Promise<BusyPeriod[]> {
    const [res, blocks, ical] = await Promise.all([
      this.db.from("reservations").select("id,check_in,check_out,status").in("status", BLOCKING_STATUSES),
      this.db.from("manual_blocks").select("id,check_in,check_out").eq("active", true),
      this.db.from("ical_imported_events").select("uid,check_in,check_out").eq("cancelled", false),
    ]);
    const out: BusyPeriod[] = [];
    for (const r of res.data ?? []) out.push({ checkIn: r.check_in, checkOut: r.check_out, source: "reservation", ref: r.id });
    for (const b of blocks.data ?? []) out.push({ checkIn: b.check_in, checkOut: b.check_out, source: "manual_block", ref: b.id });
    for (const e of ical.data ?? []) out.push({ checkIn: e.check_in, checkOut: e.check_out, source: "ical_airbnb", ref: e.uid });
    return out;
  }

  async createReservation(rec: ReservationRecord): Promise<void> {
    const { error } = await this.db.from("reservations").insert({
      id: rec.id, friendly_code: rec.friendlyCode, public_token: rec.publicToken,
      external_reference: rec.externalReference, status: rec.status,
      check_in: rec.checkIn, check_out: rec.checkOut, adults: rec.adults, children: rec.children,
      quote: rec.quote, total_cents: rec.totalCents, pay_now_cents: rec.payNowCents,
      currency: rec.currency, payment_expires_at: rec.paymentExpiresAt,
    });
    if (error) throw new Error(`createReservation: ${error.message}`);
    const { error: gErr } = await this.db.from("reservation_guests").insert({
      reservation_id: rec.id, full_name: rec.guest.fullName, email: rec.guest.email,
      phone: rec.guest.phone ?? null, document: rec.guest.document ?? null, notes: rec.guest.notes ?? null,
      accepted_rules: rec.guest.acceptedRules, accepted_cancellation: rec.guest.acceptedCancellation,
      accepted_privacy: rec.guest.acceptedPrivacy, accepted_at: new Date().toISOString(),
    });
    if (gErr) throw new Error(`createReservationGuest: ${gErr.message}`);
  }

  private async hydrate(row: any): Promise<ReservationRecord | null> {
    if (!row) return null;
    const { data: g } = await this.db.from("reservation_guests").select("*").eq("reservation_id", row.id).limit(1).single();
    return {
      id: row.id, friendlyCode: row.friendly_code, publicToken: row.public_token,
      externalReference: row.external_reference, status: row.status,
      checkIn: row.check_in, checkOut: row.check_out, adults: row.adults, children: row.children,
      quote: row.quote, totalCents: row.total_cents, payNowCents: row.pay_now_cents,
      currency: row.currency, paymentExpiresAt: row.payment_expires_at, createdAt: row.created_at,
      guest: {
        fullName: g?.full_name ?? "", email: g?.email ?? "", phone: g?.phone ?? null,
        document: g?.document ?? null, notes: g?.notes ?? null,
        acceptedRules: g?.accepted_rules ?? false, acceptedCancellation: g?.accepted_cancellation ?? false,
        acceptedPrivacy: g?.accepted_privacy ?? false,
      },
    };
  }

  async getReservationById(id: string): Promise<ReservationRecord | null> {
    const { data } = await this.db.from("reservations").select("*").eq("id", id).limit(1).single();
    return this.hydrate(data);
  }
  async getReservationByToken(token: string): Promise<ReservationRecord | null> {
    const { data } = await this.db.from("reservations").select("*").eq("public_token", token).limit(1).single();
    return this.hydrate(data);
  }
  async getReservationByExternalRef(ref: string): Promise<ReservationRecord | null> {
    const { data } = await this.db.from("reservations").select("*").eq("external_reference", ref).limit(1).single();
    return this.hydrate(data);
  }

  async transitionStatus(id: string, to: ReservationStatus, change: StatusChange): Promise<void> {
    const current = await this.getReservationById(id);
    if (!current) throw new Error(`reserva não encontrada: ${id}`);
    assertTransition(current.status, to);

    if (BLOCKING_STATUSES.includes(to)) {
      const cfg = await this.getActivePricingConfig();
      const busy = (await this.listBusyPeriods()).filter((b) => b.ref !== id);
      if (findConflicts({ checkIn: current.checkIn, checkOut: current.checkOut }, busy, cfg.prepBufferNights).length > 0) {
        throw new ConflictError();
      }
    }

    const patch: Record<string, unknown> = { status: to };
    if (to === "confirmed") patch.confirmed_at = new Date().toISOString();
    if (to === "awaiting_payment") patch.approved_at = new Date().toISOString();

    const { error } = await this.db.from("reservations").update(patch).eq("id", id).eq("status", current.status);
    if (error) {
      if ((error as any).code === EXCLUSION_VIOLATION) throw new ConflictError();
      throw new Error(`transitionStatus: ${error.message}`);
    }
    await this.db.from("reservation_status_history").insert({
      reservation_id: id, from_status: change.fromStatus, to_status: change.toStatus,
      origin: change.origin, admin_user: change.adminUser, external_event: change.externalEvent,
      note: change.note, technical_id: change.technicalId,
    });
  }

  async setReservationExpiry(id: string, expiresAtIso: string): Promise<void> {
    await this.db.from("reservations").update({ payment_expires_at: expiresAtIso }).eq("id", id);
  }

  async listReservations(filter?: { status?: ReservationStatus }): Promise<ReservationRecord[]> {
    let q = this.db.from("reservations").select("*").order("created_at", { ascending: false });
    if (filter?.status) q = q.eq("status", filter.status);
    const { data } = await q;
    const out: ReservationRecord[] = [];
    for (const row of data ?? []) { const r = await this.hydrate(row); if (r) out.push(r); }
    return out;
  }

  async addManualBlock(b: { checkIn: LocalDate; checkOut: LocalDate; reason?: string; createdBy?: string }): Promise<string> {
    const { data, error } = await this.db.from("manual_blocks")
      .insert({ check_in: b.checkIn, check_out: b.checkOut, reason: b.reason ?? null, created_by: b.createdBy ?? null })
      .select("id").single();
    if (error) throw new Error(`addManualBlock: ${error.message}`);
    return data.id;
  }
  async removeManualBlock(id: string): Promise<void> {
    await this.db.from("manual_blocks").update({ active: false }).eq("id", id);
  }

  async replaceIcalEvents(events: BusyPeriod[], sourceUrl: string | null): Promise<void> {
    await this.db.from("ical_imported_events").delete().eq("cancelled", false);
    if (events.length > 0) {
      await this.db.from("ical_imported_events").upsert(
        events.map((e) => ({ uid: e.ref ?? `${e.checkIn}_${e.checkOut}`, check_in: e.checkIn, check_out: e.checkOut, cancelled: false, source_url: sourceUrl })),
        { onConflict: "uid" },
      );
    }
  }
  async logIcalSync(log: { success: boolean; eventsFound: number; periodsImported: number; durationMs: number; error?: string | null; sourceUrl?: string | null }): Promise<void> {
    await this.db.from("ical_sync_logs").insert({
      finished_at: new Date().toISOString(), success: log.success, events_found: log.eventsFound,
      periods_imported: log.periodsImported, duration_ms: log.durationMs, error_message: log.error ?? null, source_url: log.sourceUrl ?? null,
    });
  }
  async lastIcalSyncAt(): Promise<Date | null> {
    const { data } = await this.db.from("ical_sync_logs")
      .select("started_at").eq("success", true).order("started_at", { ascending: false }).limit(1).maybeSingle();
    return data?.started_at ? new Date(data.started_at) : null;
  }

  async upsertPaymentTx(tx: PaymentTxRecord): Promise<void> {
    await this.db.from("payment_transactions").upsert({
      reservation_id: tx.reservationId || null, provider: tx.provider, preference_id: tx.preferenceId ?? null,
      payment_id: tx.paymentId ?? null, status: tx.status ?? null, amount_cents: tx.amountCents ?? null,
      currency: tx.currency ?? "BRL", live_mode: tx.liveMode ?? null, external_reference: tx.externalReference ?? null, raw: tx.raw ?? null,
    }, { onConflict: "payment_id" });
  }

  async recordWebhookEvent(eventKey: string, signatureOk: boolean, payload: unknown): Promise<WebhookRecordResult> {
    const { data: existing } = await this.db.from("payment_webhook_events").select("processed").eq("provider", "mercadopago").eq("event_key", eventKey).limit(1).maybeSingle();
    if (existing) return { alreadyProcessed: Boolean(existing.processed) };
    await this.db.from("payment_webhook_events").insert({ provider: "mercadopago", event_key: eventKey, signature_ok: signatureOk, payload });
    return { alreadyProcessed: false };
  }
  async markWebhookProcessed(eventKey: string): Promise<void> {
    await this.db.from("payment_webhook_events").update({ processed: true }).eq("provider", "mercadopago").eq("event_key", eventKey);
  }

  async logNotification(n: { reservationId?: string | null; template: string; recipient?: string | null; status?: string }): Promise<void> {
    await this.db.from("notification_logs").insert({
      reservation_id: n.reservationId ?? null, template: n.template, recipient: n.recipient ?? null, status: n.status ?? "queued",
    });
  }
}
