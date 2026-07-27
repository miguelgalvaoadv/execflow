/**
 * Serviço de reservas — regra de negócio do fluxo obrigatório.
 * NUNCA confia na URL de retorno do navegador: a confirmação só ocorre via
 * webhook validado + re-consulta na API do provedor + conferência de valor.
 */
import { quote, isBookable, type Quote } from "../domain/pricing.js";
import { findConflicts } from "../domain/availability.js";
import { buildStatusChange, type ReservationStatus } from "../domain/reservation-state.js";
import { publicToken, externalReference, friendlyCode } from "../domain/tokens.js";
import { addDays, todayLocal } from "../domain/dates.js";
import { ConflictError, type Repository, type GuestData, type ReservationRecord } from "../db/repository.js";
import type { PaymentProvider, PaymentInfo } from "../payments/types.js";
import type { EmailProvider } from "../email/provider.js";
import type { IcalFreshness } from "./ical-sync.js";
import { renderTemplate, ADMIN_TEMPLATES, type TemplateData } from "../email/templates.js";
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
  /** Sincroniza o Airbnb e informa o frescor (cache/throttle). No-op ok em mock/sem URL. */
  ensureIcalFresh?: () => Promise<IcalFreshness>;
  email?: EmailProvider;
  emailFrom?: string;
  /** Destino dos alertas operacionais (ADMIN_EMAIL). */
  adminEmail?: string | null;
}

export interface RequestInput {
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  guest: GuestData;
}

/** Chave em `settings` com as reservas confirmadas ainda não bloqueadas no Airbnb. */
export const PENDING_AIRBNB_KEY = "pending_airbnb_blocks";

export interface PendingAirbnbBlock {
  code: string;
  checkIn: string;
  checkOut: string;
  confirmedAt: string;
}

export interface WebhookOutcome {
  handled: boolean;
  status: "confirmed" | "already_processed" | "invalid_signature" | "rejected" | "mismatch" | "ignored" | "not_found" | "stale_needs_manual";
  detail?: string;
}

export class ReservationService {
  private repo: Repository;
  private payments: PaymentProvider;
  private config: ServiceConfig;
  private now: () => Date;
  private ensureIcalFresh: () => Promise<IcalFreshness>;
  private email?: EmailProvider;
  private emailFrom: string;
  private adminEmail: string | null;

  constructor(deps: ServiceDeps) {
    this.repo = deps.repo;
    this.payments = deps.payments;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    this.ensureIcalFresh = deps.ensureIcalFresh ?? (async () => ({ ok: true, lastSyncAt: null, reason: "no-external-calendar" }));
    this.email = deps.email;
    this.emailFrom = deps.emailFrom ?? "Cabana Afrodite <reservas@exemplo.com>";
    this.adminEmail = deps.adminEmail ?? null;
  }

  /** Frescor do iCal, best-effort (nunca lança — para pontos não-críticos). */
  private async icalStatus(): Promise<IcalFreshness> {
    try { return await this.ensureIcalFresh(); }
    catch { return { ok: false, lastSyncAt: null, reason: "never-synced" }; }
  }

  /** FAIL-CLOSED: exige iCal fresco antes de criar bloqueio efetivo, salvo override admin. */
  private async requireFresh(override?: boolean): Promise<IcalFreshness> {
    const f = await this.icalStatus();
    if (!f.ok && !override) throw new SyncStaleError(f);
    return f;
  }

  private staleNote(f: IcalFreshness, adminUser?: string): string {
    return `Decisão manual com iCal ${f.reason}${f.lastSyncAt ? ` (última sync ${f.lastSyncAt.toISOString()})` : ""}${adminUser ? ` por ${adminUser}` : ""}`;
  }

  private trackUrl(token: string): string {
    return `${this.config.siteUrl}/?reserva=${encodeURIComponent(token)}`;
  }

  private adminUrl(): string {
    return `${this.config.siteUrl}/admin`;
  }

  /**
   * Registra a notificação e envia e-mail (best-effort — nunca quebra o fluxo).
   * `audience: "admin"` envia ao anfitrião (ADMIN_EMAIL), ignorando `to`; assim
   * um alerta operacional nunca vaza para o hóspede (e vice-versa).
   */
  private async notify(
    template: string,
    opts: { to?: string | null; reservationId?: string | null; data?: TemplateData; audience?: "guest" | "admin" },
  ): Promise<void> {
    const isAdmin = opts.audience === "admin" || ADMIN_TEMPLATES.has(template);
    const recipient = isAdmin ? this.adminEmail : opts.to ?? null;
    const data: TemplateData = isAdmin ? { adminUrl: this.adminUrl(), ...(opts.data ?? {}) } : (opts.data ?? {});

    let status = "queued";
    const rendered = renderTemplate(template, data);
    if (!rendered) {
      // Antes isso sumia em silêncio: o alerta era "registrado" mas nunca enviado.
      status = "template_missing";
    } else if (!recipient) {
      status = isAdmin ? "no_admin_email" : "no_recipient";
    } else if (this.email) {
      try {
        const r = await this.email.send({ to: recipient, subject: rendered.subject, text: rendered.text }, this.emailFrom);
        status = r.ok ? "sent" : "failed";
      } catch { status = "failed"; }
    }
    await this.repo.logNotification({ reservationId: opts.reservationId ?? null, template, recipient, status });
  }

  async priceQuote(input: { checkIn: string; checkOut: string; adults: number; children?: number }): Promise<Quote> {
    const cfg = await this.repo.getActivePricingConfig();
    return quote(input, cfg);
  }

  async checkAvailability(checkIn: string, checkOut: string): Promise<{ available: boolean; conflicts: number; icalLastSyncAt: string | null; icalStale: boolean }> {
    const fresh = await this.icalStatus(); // best-effort: consulta pública usa último estado válido
    const cfg = await this.repo.getActivePricingConfig();
    const busy = await this.repo.listBusyPeriods();
    const conflicts = findConflicts({ checkIn, checkOut }, busy, cfg.prepBufferNights);
    return {
      available: conflicts.length === 0,
      conflicts: conflicts.length,
      icalLastSyncAt: fresh.lastSyncAt ? fresh.lastSyncAt.toISOString() : null,
      icalStale: !fresh.ok && fresh.reason !== "no-external-calendar",
    };
  }

  /** Passos 1–15 do fluxo: cria a solicitação como pending_approval. */
  async requestReservation(input: RequestInput): Promise<{ reservation: ReservationRecord; quote: Quote }> {
    await this.icalStatus(); // best-effort: pending_approval não bloqueia; admin revalida na aprovação
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
    // Estado inicial no histórico (spec §8: registrar TODAS as mudanças de status).
    await this.repo.appendStatusHistory(id, buildStatusChange({
      from: null, to: "pending_approval", origin: "guest", technicalId: randomUUID(), note: "Solicitação enviada pelo site",
    }));
    await this.notify("request_received", { to: g.email, reservationId: id, data: { code: rec.friendlyCode, checkIn: rec.checkIn, checkOut: rec.checkOut, trackUrl: this.trackUrl(rec.publicToken), firstName: g.fullName.split(" ")[0] } });
    // Spec §7 passo 15: o administrador recebe uma notificação.
    await this.notify("admin_new_request", { reservationId: id, audience: "admin", data: { code: rec.friendlyCode, checkIn: rec.checkIn, checkOut: rec.checkOut, guestName: g.fullName } });
    return { reservation: rec, quote: q };
  }

  /** Passos 16–18: admin aprova após re-checar disponibilidade. */
  async approveReservation(id: string, adminUser: string, opts: { overrideStaleIcal?: boolean; overrideNote?: string } = {}): Promise<ReservationRecord> {
    // FAIL-CLOSED: exige iCal fresco (a aprovação transforma a data em bloqueio efetivo).
    const fresh = await this.requireFresh(opts.overrideStaleIcal);
    const cfg = await this.repo.getActivePricingConfig();
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    const expiresAt = new Date(this.now().getTime() + cfg.payment.expirationHours * 3600_000).toISOString();
    const note = fresh.ok
      ? "Aprovada; aguardando pagamento"
      : `Aprovada MANUALMENTE apesar de falha de sincronização. ${this.staleNote(fresh, adminUser)}. ${opts.overrideNote ?? ""}`.trim();
    // transitionStatus reforça a ausência de sobreposição de forma atômica
    await this.repo.transitionStatus(
      id,
      "awaiting_payment",
      buildStatusChange({ from: r.status, to: "awaiting_payment", origin: "admin", adminUser, technicalId: randomUUID(), note }),
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
    await this.requireFresh(false); // FAIL-CLOSED: não gera link de pagamento com iCal desatualizado
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

    const outcome = await this.applyApprovedPayment(r, payment, "webhook");
    await this.repo.markWebhookProcessed(params.eventKey);
    return { handled: true, status: outcome.status, detail: outcome.detail };
  }

  /**
   * Aplica um pagamento APROVADO a uma reserva (usado pelo webhook e pela
   * reconciliação). Confere valor/moeda, registra a transação, aplica fail-closed
   * de iCal e confirma (awaiting_payment/payment_pending -> paid -> confirmed).
   */
  private async applyApprovedPayment(
    r: ReservationRecord,
    payment: PaymentInfo,
    origin: "webhook" | "system" | "admin",
  ): Promise<{ status: WebhookOutcome["status"]; detail?: string }> {
    if (payment.currency !== r.currency || payment.amountCents !== r.payNowCents) {
      await this.notify("payment_mismatch", { reservationId: r.id });
      return { status: "mismatch", detail: `esperado ${r.payNowCents} ${r.currency}, recebido ${payment.amountCents} ${payment.currency}` };
    }
    await this.repo.upsertPaymentTx({
      reservationId: r.id, provider: "mercadopago", paymentId: payment.id, status: payment.status,
      amountCents: payment.amountCents, currency: payment.currency, liveMode: payment.liveMode,
      externalReference: payment.externalReference, raw: payment.raw,
    });
    // FAIL-CLOSED: sem iCal fresco não confirma automaticamente (pagamento fica
    // registrado, reserva segue bloqueada, admin confirma manualmente).
    const fresh = await this.icalStatus();
    if (!fresh.ok) {
      await this.notify("payment_needs_manual", { reservationId: r.id });
      return { status: "stale_needs_manual", detail: `iCal ${fresh.reason} — pagamento recebido, confirmar manualmente` };
    }
    try {
      if (r.status === "awaiting_payment" || r.status === "payment_pending") {
        await this.repo.transitionStatus(r.id, "paid",
          buildStatusChange({ from: r.status, to: "paid", origin, externalEvent: `mp:${payment.id}`, technicalId: randomUUID() }));
      }
      await this.repo.transitionStatus(r.id, "confirmed",
        buildStatusChange({ from: "paid", to: "confirmed", origin, externalEvent: `mp:${payment.id}`, technicalId: randomUUID() }));
    } catch (e) {
      if (e instanceof ConflictError) {
        await this.notify("payment_after_conflict", { reservationId: r.id });
        return { status: "mismatch", detail: "conflito de disponibilidade após pagamento — tratar manualmente" };
      }
      throw e;
    }
    await this.notify("reservation_confirmed", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, trackUrl: this.trackUrl(r.publicToken) } });
    // Spec §7 passo 31: avisar o admin para bloquear a data no Airbnb IMEDIATAMENTE
    // (o Airbnb pode demorar horas para reimportar o .ics — janela de dupla reserva).
    await this.addPendingAirbnbBlock(r);
    await this.notify("airbnb_block_needed", { reservationId: r.id, audience: "admin", data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut } });
    return { status: "confirmed", detail: r.id };
  }

  /** Pendências de bloqueio manual no Airbnb (exibidas em destaque no painel). */
  private async addPendingAirbnbBlock(r: ReservationRecord): Promise<void> {
    try {
      const list = (await this.repo.getSetting<PendingAirbnbBlock[]>(PENDING_AIRBNB_KEY)) ?? [];
      if (list.some((p) => p.code === r.friendlyCode)) return;
      list.push({ code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, confirmedAt: this.now().toISOString() });
      await this.repo.setSetting(PENDING_AIRBNB_KEY, list);
    } catch { /* aviso é best-effort: nunca impede a confirmação */ }
  }

  async listPendingAirbnbBlocks(): Promise<PendingAirbnbBlock[]> {
    return (await this.repo.getSetting<PendingAirbnbBlock[]>(PENDING_AIRBNB_KEY)) ?? [];
  }

  /** Admin marcou "já bloqueei no Airbnb". */
  async clearPendingAirbnbBlock(code: string, adminUser: string): Promise<PendingAirbnbBlock[]> {
    const list = (await this.repo.getSetting<PendingAirbnbBlock[]>(PENDING_AIRBNB_KEY)) ?? [];
    const next = list.filter((p) => p.code !== code);
    await this.repo.setSetting(PENDING_AIRBNB_KEY, next);
    await this.repo.logAudit({ actor: adminUser, action: "airbnb_block.acknowledge", entity: "settings", entityId: code });
    return next;
  }

  /**
   * Lembretes automáticos (rodam na função agendada):
   *  - pagamento a vencer (reservas awaiting_payment perto do prazo);
   *  - check-in próximo (reservas confirmadas).
   * Idempotente: cada lembrete sai uma única vez por reserva.
   */
  async sendDueReminders(opts: { paymentWindowHours?: number; checkinWindowDays?: number } = {}): Promise<{ payment: number; checkin: number }> {
    const paymentWindowMs = (opts.paymentWindowHours ?? 6) * 3600_000;
    const checkinWindowDays = opts.checkinWindowDays ?? 2;
    const now = this.now();
    let payment = 0, checkin = 0;

    for (const r of await this.repo.listReservations({ status: "awaiting_payment" })) {
      if (!r.paymentExpiresAt) continue;
      const left = new Date(r.paymentExpiresAt).getTime() - now.getTime();
      if (left <= 0 || left > paymentWindowMs) continue;
      if (await this.repo.hasNotification(r.id, "payment_reminder")) continue;
      await this.notify("payment_reminder", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, firstName: r.guest.fullName.split(" ")[0], trackUrl: this.trackUrl(r.publicToken) } });
      payment++;
    }

    const limit = addDays(todayLocal(now), checkinWindowDays);
    for (const r of await this.repo.listReservations({ status: "confirmed" })) {
      if (r.checkIn > limit || r.checkIn < todayLocal(now)) continue;
      if (await this.repo.hasNotification(r.id, "checkin_reminder")) continue;
      await this.notify("checkin_reminder", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, firstName: r.guest.fullName.split(" ")[0] } });
      checkin++;
    }
    return { payment, checkin };
  }

  /**
   * RECONCILIAÇÃO: consulta o Mercado Pago pelo external_reference e confirma a
   * reserva se houver pagamento aprovado. Rede de segurança para quando o webhook
   * não chega. Re-consulta a API (não confia na URL de retorno).
   */
  async reconcileReservation(token: string): Promise<{ status: string; reservation: ReservationRecord | null }> {
    const r = await this.repo.getReservationByToken(token);
    if (!r) return { status: "not_found", reservation: null };
    if (r.status !== "awaiting_payment" && r.status !== "payment_pending") {
      return { status: r.status, reservation: r }; // nada a reconciliar
    }
    let payment: PaymentInfo | null = null;
    try { payment = await this.payments.findApprovedByExternalRef(r.externalReference); }
    catch { return { status: r.status, reservation: r }; } // MP indisponível/não configurado
    if (!payment) return { status: r.status, reservation: r };
    const outcome = await this.applyApprovedPayment(r, payment, "system");
    const updated = await this.repo.getReservationByToken(token);
    return { status: outcome.status, reservation: updated };
  }

  /**
   * Varredura de reconciliação (função agendada): reconcilia TODAS as reservas
   * aguardando pagamento. Fecha a brecha de "pagou e não voltou ao site" quando
   * o webhook não chega. Best-effort por reserva.
   */
  async reconcileAllPending(): Promise<{ code: string; status: string }[]> {
    const pending = [
      ...(await this.repo.listReservations({ status: "awaiting_payment" })),
      ...(await this.repo.listReservations({ status: "payment_pending" })),
    ];
    const results: { code: string; status: string }[] = [];
    for (const r of pending) {
      try {
        const res = await this.reconcileReservation(r.publicToken);
        results.push({ code: r.friendlyCode, status: res.status });
      } catch { results.push({ code: r.friendlyCode, status: "error" }); }
    }
    return results;
  }

  /**
   * Confirmação MANUAL pelo admin de uma reserva cujo pagamento foi recebido mas a
   * confirmação automática foi retida por falha de sincronização do iCal.
   * Re-valida o pagamento na API, exige iCal fresco (ou override explícito) e registra
   * a decisão manual no histórico.
   */
  async confirmPaymentManually(id: string, adminUser: string, opts: { overrideStaleIcal?: boolean; note?: string } = {}): Promise<ReservationRecord> {
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    if (r.status !== "awaiting_payment" && r.status !== "payment_pending" && r.status !== "paid") {
      throw new ValidationError(`Reserva não está em estado confirmável manualmente (${r.status}).`);
    }
    // Re-valida o pagamento na API do provedor.
    const tx = await this.repo.latestPaymentForReservation(id);
    if (!tx?.paymentId) throw new ValidationError("Nenhum pagamento registrado para esta reserva.");
    const payment = await this.payments.getPayment(tx.paymentId);
    if (payment.status !== "approved") throw new ValidationError(`Pagamento não aprovado (status=${payment.status}).`);
    if (payment.currency !== r.currency || payment.amountCents !== r.payNowCents) {
      throw new ValidationError(`Valor divergente: esperado ${r.payNowCents} ${r.currency}, pago ${payment.amountCents} ${payment.currency}.`);
    }
    const fresh = await this.requireFresh(opts.overrideStaleIcal);
    const decisionNote = `Confirmação MANUAL por ${adminUser}. ${this.staleNote(fresh, adminUser)}. ${opts.note ?? ""}`.trim();

    if (r.status === "awaiting_payment" || r.status === "payment_pending") {
      await this.repo.transitionStatus(r.id, "paid",
        buildStatusChange({ from: r.status, to: "paid", origin: "admin", adminUser, externalEvent: `mp:${payment.id}`, technicalId: randomUUID(), note: decisionNote }));
    }
    await this.repo.transitionStatus(r.id, "confirmed",
      buildStatusChange({ from: "paid", to: "confirmed", origin: "admin", adminUser, externalEvent: `mp:${payment.id}`, technicalId: randomUUID(), note: decisionNote }));
    await this.notify("reservation_confirmed", { to: r.guest.email, reservationId: r.id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut, trackUrl: this.trackUrl(r.publicToken) } });
    return { ...r, status: "confirmed" };
  }

  /**
   * Cancelamento administrativo. Libera as datas (cancelled não bloqueia).
   * Se a reserva já estava paga/confirmada, registra a informação de reembolso
   * no histórico — o reembolso REAL é feito manualmente pelo admin no Mercado
   * Pago (a spec exige confirmação explícita; não automatizamos estorno).
   */
  async cancelReservation(
    id: string,
    adminUser: string,
    opts: { reason?: string; refundCents?: number; refundNote?: string } = {},
  ): Promise<{ status: ReservationStatus; requiresManualRefund: boolean }> {
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    const wasPaid = r.status === "paid" || r.status === "confirmed";
    const parts = [opts.reason?.trim() || "Cancelada pelo administrador"];
    if (wasPaid) {
      parts.push(
        `Pagamento já recebido (${(r.payNowCents / 100).toFixed(2)} ${r.currency}).`,
        opts.refundCents !== undefined ? `Reembolso previsto: ${(opts.refundCents / 100).toFixed(2)} ${r.currency}.` : "Reembolso a definir.",
        "Estorno deve ser feito manualmente no painel do Mercado Pago.",
      );
      if (opts.refundNote) parts.push(opts.refundNote);
    }
    const note = parts.join(" ");
    await this.repo.transitionStatus(id, "cancelled",
      buildStatusChange({ from: r.status, to: "cancelled", origin: "admin", adminUser, technicalId: randomUUID(), note }));
    await this.repo.logAudit({
      actor: adminUser, action: "reservation.cancel", entity: "reservations", entityId: id,
      metadata: { previousStatus: r.status, wasPaid, refundCents: opts.refundCents ?? null },
    });
    await this.notify("reservation_cancelled", { to: r.guest.email, reservationId: id, data: { code: r.friendlyCode, checkIn: r.checkIn, checkOut: r.checkOut } });
    return { status: "cancelled", requiresManualRefund: wasPaid };
  }

  /** Marca uma reserva confirmada como concluída (após a estadia). */
  async completeReservation(id: string, adminUser: string, note?: string): Promise<{ status: ReservationStatus }> {
    const r = await this.repo.getReservationById(id);
    if (!r) throw new NotFoundError("Reserva não encontrada.");
    await this.repo.transitionStatus(id, "completed",
      buildStatusChange({ from: r.status, to: "completed", origin: "admin", adminUser, technicalId: randomUUID(), note: note ?? "Estadia concluída" }));
    await this.repo.logAudit({ actor: adminUser, action: "reservation.complete", entity: "reservations", entityId: id, metadata: { previousStatus: r.status } });
    return { status: "completed" };
  }

  /** Passo 15 (expiração): libera reservas aprovadas e não pagas no prazo. */
  async expireOverdue(): Promise<string[]> {
    const now = this.now();
    const expired: string[] = [];
    for (const r of await this.repo.listReservations()) {
      if ((r.status === "awaiting_payment" || r.status === "payment_pending") && r.paymentExpiresAt && new Date(r.paymentExpiresAt) < now) {
        // NUNCA expira uma reserva com pagamento já recebido (aguardando confirmação manual).
        const tx = await this.repo.latestPaymentForReservation(r.id);
        if (tx?.status === "approved") continue;
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
export class SyncStaleError extends Error {
  constructor(public freshness: IcalFreshness) {
    super(`Sincronização do Airbnb indisponível ou desatualizada (${freshness.reason}). Confira o Airbnb e confirme manualmente.`);
    this.name = "SyncStaleError";
  }
}
