/**
 * Serviço de reservas — regra de negócio do fluxo obrigatório.
 * NUNCA confia na URL de retorno do navegador: a confirmação só ocorre via
 * webhook validado + re-consulta na API do provedor + conferência de valor.
 */
import { quote, isBookable, type Quote } from "../domain/pricing.js";
import { findConflicts } from "../domain/availability.js";
import { buildStatusChange, type ReservationStatus } from "../domain/reservation-state.js";
import { publicToken, externalReference, friendlyCode } from "../domain/tokens.js";
import { ConflictError, type Repository, type GuestData, type ReservationRecord } from "../db/repository.js";
import type { PaymentProvider } from "../payments/types.js";
import type { EmailProvider } from "../email/provider.js";
import { renderTemplate, type TemplateData } from "../email/templates.js";
import { randomUUID } from "node:crypto";

export interface ServiceConfig {
  siteUrl: string;
  notificationUrl: string;
  mode: "mock" | "sandbox" | "production";
  webhookSecret: string | null;
}

export interface ServiceDeps {
  repo: Repository;
  payments: PaymentProvider;
  config: ServiceConfig;
  now?: () => Date;
  /** Atualiza o iCal do Airbnb (com cache/throttle). Best-effort; no-op em mock. */
  refreshIcal?: () => Promise<void>;
  email?: EmailProvider;
  emailFrom?: string;
}

export interface RequestInput {
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  guest: GuestData;
}

export interface WebhookOutcome {
  handled: boolean;
  status: "confirmed" | "already_processed" | "invalid_signature" | "rejected" | "mismatch" | "ignored" | "not_found";
  detail?: string;
}

export class ReservationService {
  private repo: Repository;
  private payments: PaymentProvider;
  private config: ServiceConfig;
  private now: () => Date;
  private refreshIcal: () => Promise<void>;
  private email?: EmailProvider;
  private emailFrom: string;

  constructor(deps: ServiceDeps) {
    this.repo = deps.repo;
    this.payments = deps.payments;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    this.refreshIcal = deps.refreshIcal ?? (async () => {});
    this.email = deps.email;
    this.emailFrom = deps.emailFrom ?? "Cabana Afrodite <reservas@exemplo.com>";
  }

  /** Sincroniza o Airbnb sem quebrar o fluxo se falhar (dados em cache seguem válidos). */
  private async syncIcal(): Promise<void> {
    try { await this.refreshIcal(); } catch { /* mantém cache; erro já registrado no log de sync */ }
  }

  private trackUrl(token: string): string {
    return `${this.config.siteUrl}/?reserva=${encodeURIComponent(token)}`;
  }

  /** Registra a notificação e envia e-mail (best-effort — nunca quebra o fluxo). */
  private async notify(template: string, opts: { to?: string | null; reservationId?: string | null; data?: TemplateData }): Promise<void> {
    let status = "queued";
    if (this.email && opts.to) {
      try {
        const rendered = renderTemplate(template, opts.data ?? {});
        if (rendered) {
          const r = await this.email.send({ to: opts.to, subject: rendered.subject, text: rendered.text }, this.emailFrom);
          status = r.ok ? "sent" : "failed";
        }
      } catch { status = "failed"; }
    }
    await this.repo.logNotification({ reservationId: opts.reservationId ?? null, template, recipient: opts.to ?? null, status });
  }

  async priceQuote(input: { checkIn: string; checkOut: string; adults: number; children?: number }): Promise<Quote> {
    const cfg = await this.repo.getActivePricingConfig();
    return quote(input, cfg);
  }

  async checkAvailability(checkIn: string, checkOut: string): Promise<{ available: boolean; conflicts: number }> {
    await this.syncIcal();
    const cfg = await this.repo.getActivePricingConfig();
    const busy = await this.repo.listBusyPeriods();
    const conflicts = findConflicts({ checkIn, checkOut }, busy, cfg.prepBufferNights);
    return { available: conflicts.length === 0, conflicts: conflicts.length };
  }

  /** Passos 1–15 do fluxo: cria a solicitação como pending_approval. */
  async requestReservation(input: RequestInput): Promise<{ reservation: ReservationRecord; quote: Quote }> {
    await this.syncIcal();
    const cfg = await this.repo.getActivePricingConfig();
    const q = quote(input, cfg);
    if (!isBookable(q)) {
      throw new ValidationError(q.issues.map((i) => i.message).join(" "));
    }
    // aceites obrigatórios
    const g = input.guest;
    if (!g.acceptedRules || !g.acceptedCancellation || !g.acceptedPrivacy) {
      throw new ValidationError("É necessário aceitar regras, cancelamento e privacidade.");
    }
    // disponibilidade informativa (pending não bloqueia, mas evita solicitação inútil)
    const busy = await this.repo.listBusyPeriods();
    if (findConflicts({ checkIn: input.checkIn, checkOut: input.checkOut }, busy, cfg.prepBufferNights).length > 0) {
      throw new ConflictError("As datas selecionadas não estão mais disponíveis.");
    }

    const id = randomUUID();
    const now = this.now();
    const rec: ReservationRecord = {
      id,
      friendlyCode: friendlyCode(now),
      publicToken: publicToken(),
      externalReference: externalReference(),
      status: "pending_approval",
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults: q.guests.adults,
      children: q.guests.children,
      quote: q,
      totalCents: q.totalCents,
      payNowCents: q.payNowCents,
      currency: "BRL",
      paymentExpiresAt: null,
      createdAt: now.toISOString(),
      guest: g,
    };
    await this.repo.createReservation(rec);
    await this.notify("request_received", { to: g.email, reservationId: id, data: { code: rec.friendlyCode, checkIn: rec.checkIn, checkOut: rec.checkOut, trackUrl: this.trackUrl(rec.publicToken), firstName: g.fullName.split(" ")[0] } });
    return { reservation: rec, quote: q };
  }

  /** Passos 16–18: admin aprova após re-checar disponibilidade. */
  async approveReservation(id: string, adminUser: string): Promise<ReservationRecord> {
    await this.syncIcal();
    const cfg = await this.repo.getActivePricingConfig();
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    const expiresAt = new Date(this.now().getTime() + cfg.payment.expirationHours * 3600_000).toISOString();
    // transitionStatus reforça a ausência de sobreposição de forma atômica
    await this.repo.transitionStatus(
      id,
      "awaiting_payment",
      buildStatusChange({ from: r.status, to: "awaiting_payment", origin: "admin", adminUser, technicalId: randomUUID(), note: "Aprovada; aguardando pagamento" }),
    );
    await this.repo.setReservationExpiry(id, expiresAt);
    await this.notify("request_approved", { to: r.guest.email, reservationId: id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, payUrl: this.trackUrl(r.publicToken), trackUrl: this.trackUrl(r.publicToken) } });
    return { ...r, status: "awaiting_payment", paymentExpiresAt: expiresAt };
  }

  async rejectReservation(id: string, adminUser: string, reason?: string): Promise<void> {
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    await this.repo.transitionStatus(
      id,
      "rejected",
      buildStatusChange({ from: r.status, to: "rejected", origin: "admin", adminUser, technicalId: randomUUID(), note: reason ?? null }),
    );
    await this.notify("request_rejected", { to: r.guest.email, reservationId: id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut } });
  }

  /** Passos 19–20: cria a preferência de pagamento (só após aprovação). */
  async createPaymentPreference(id: string): Promise<{ initPoint: string; preferenceId: string }> {
    await this.syncIcal();
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    if (r.status !== "awaiting_payment") throw new ValidationError("Reserva não está aguardando pagamento.");

    // Recalcula para proteger contra adulteração de preço no navegador.
    const cfg = await this.repo.getActivePricingConfig();
    const fresh = quote({ checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children }, cfg);
    const amount = fresh.payNowCents;

    const pref = await this.payments.createPreference({
      externalReference: r.externalReference,
      title: `Cabana Afrodite — ${r.checkIn} a ${r.checkOut}`,
      amountCents: amount,
      currency: "BRL",
      backUrls: {
        success: `${this.config.siteUrl}/reserva/${r.publicToken}?p=aprovado`,
        pending: `${this.config.siteUrl}/reserva/${r.publicToken}?p=pendente`,
        failure: `${this.config.siteUrl}/reserva/${r.publicToken}?p=recusado`,
      },
      notificationUrl: this.config.notificationUrl,
      expiresAt: r.paymentExpiresAt,
      maxInstallments: cfg.payment.maxInstallments,
      idempotencyKey: `pref-${r.externalReference}`,
      metadata: { reservationId: r.id },
    });
    await this.repo.upsertPaymentTx({
      reservationId: r.id,
      provider: "mercadopago",
      preferenceId: pref.id,
      externalReference: r.externalReference,
      amountCents: amount,
      currency: "BRL",
    });
    await this.notify("payment_link", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode, payUrl: pref.initPoint, trackUrl: this.trackUrl(r.publicToken) } });
    return { initPoint: pref.initPoint, preferenceId: pref.id };
  }

  /**
   * Passos 22–32: processa o webhook do Mercado Pago.
   * Idempotente. Só confirma após validar assinatura, re-consultar a API e
   * conferir valor/moeda/referência.
   */
  async processPaymentWebhook(params: {
    signatureValid: boolean;
    eventKey: string;
    paymentId: string;
    rawPayload: unknown;
  }): Promise<WebhookOutcome> {
    if (!params.signatureValid) {
      await this.repo.recordWebhookEvent(params.eventKey, false, params.rawPayload);
      return { handled: false, status: "invalid_signature" };
    }
    const rec = await this.repo.recordWebhookEvent(params.eventKey, true, params.rawPayload);
    if (rec.alreadyProcessed) return { handled: true, status: "already_processed" };

    // Re-consulta o pagamento na API (nunca confia só no payload/URL).
    const payment = await this.payments.getPayment(params.paymentId);

    if (payment.status !== "approved") {
      await this.repo.upsertPaymentTx({ reservationId: "", provider: "mercadopago", paymentId: payment.id, status: payment.status, externalReference: payment.externalReference, amountCents: payment.amountCents, currency: payment.currency, liveMode: payment.liveMode, raw: payment.raw });
      return { handled: true, status: "ignored", detail: `status=${payment.status}` };
    }

    if (!payment.externalReference) {
      return { handled: true, status: "not_found", detail: "sem external_reference" };
    }
    const r = await this.repo.getReservationByExternalRef(payment.externalReference);
    if (!r) return { handled: true, status: "not_found", detail: payment.externalReference };

    // Confere moeda e valor esperado (o que deveria ser pago agora).
    if (payment.currency !== r.currency || payment.amountCents !== r.payNowCents) {
      await this.notify("payment_mismatch", { reservationId: r.id });
      return { handled: true, status: "mismatch", detail: `esperado ${r.payNowCents} ${r.currency}, recebido ${payment.amountCents} ${payment.currency}` };
    }

    // Registra a transação de pagamento.
    await this.repo.upsertPaymentTx({
      reservationId: r.id, provider: "mercadopago", paymentId: payment.id, status: payment.status,
      amountCents: payment.amountCents, currency: payment.currency, liveMode: payment.liveMode,
      externalReference: payment.externalReference, raw: payment.raw,
    });

    // Re-sincroniza o Airbnb ANTES de confirmar: se surgiu uma reserva nova no
    // Airbnb durante o pagamento, o exclusion check abaixo detecta o conflito.
    await this.syncIcal();

    // paid -> confirmed (transitionStatus reforça anti-sobreposição).
    try {
      await this.repo.transitionStatus(r.id, "paid",
        buildStatusChange({ from: r.status, to: "paid", origin: "webhook", externalEvent: `mp:${payment.id}`, technicalId: randomUUID() }));
      await this.repo.transitionStatus(r.id, "confirmed",
        buildStatusChange({ from: "paid", to: "confirmed", origin: "webhook", externalEvent: `mp:${payment.id}`, technicalId: randomUUID() }));
    } catch (e) {
      if (e instanceof ConflictError) {
        await this.notify("payment_after_conflict", { reservationId: r.id });
        await this.repo.markWebhookProcessed(params.eventKey);
        return { handled: true, status: "mismatch", detail: "conflito de disponibilidade após pagamento — tratar manualmente" };
      }
      throw e;
    }

    await this.notify("reservation_confirmed", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, trackUrl: this.trackUrl(r.publicToken) } });
    await this.repo.markWebhookProcessed(params.eventKey);
    return { handled: true, status: "confirmed", detail: r.id };
  }

  /** Passo 15 (expiração): libera reservas aprovadas e não pagas no prazo. */
  async expireOverdue(): Promise<string[]> {
    const now = this.now();
    const expired: string[] = [];
    for (const r of await this.repo.listReservations()) {
      if ((r.status === "awaiting_payment" || r.status === "payment_pending") && r.paymentExpiresAt && new Date(r.paymentExpiresAt) < now) {
        await this.repo.transitionStatus(r.id, "expired",
          buildStatusChange({ from: r.status, to: "expired", origin: "system", technicalId: randomUUID(), note: "Prazo de pagamento expirado" }));
        await this.notify("reservation_expired", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode } });
        expired.push(r.id);
      }
    }
    return expired;
  }
}

export class ValidationError extends Error { constructor(m: string) { super(m); this.name = "ValidationError"; } }
export class NotFoundError extends Error { constructor(m: string) { super(m); this.name = "NotFoundError"; } }
