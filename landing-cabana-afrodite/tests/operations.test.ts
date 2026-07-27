import { describe, it, expect } from "vitest";
import { ReservationService, PENDING_AIRBNB_KEY, type PendingAirbnbBlock } from "../src/services/reservation-service.js";
import { InMemoryRepository } from "../src/db/memory.js";
import { MockMercadoPago } from "../src/payments/mercadopago.js";
import { DevEmailProvider } from "../src/email/provider.js";
import type { PricingConfig } from "../src/domain/pricing.js";
import type { GuestData } from "../src/db/repository.js";
import { addDays, todayLocal } from "../src/domain/dates.js";

function testPricing(over: Partial<PricingConfig> = {}): PricingConfig {
  return {
    currency: "BRL", defaultNightlyCents: 45000, weekdayNightlyCents: {}, specialPeriods: [],
    dateOverrides: {}, cleaningFeeCents: 15000,
    includedGuests: 2, extraGuestFeeCents: 8000, extraGuestPer: "night", maxGuests: 4,
    minNights: 1, maxNights: 30, minReservationCents: 0, flatDiscountPercent: 0, lengthOfStayDiscounts: [],
    securityDepositCents: 0, chargeDepositUpfront: false,
    payment: { mode: "full", signalPercent: 30, expirationHours: 24, maxInstallments: 12 }, prepBufferNights: 0,
    ...over,
  };
}
const guest: GuestData = { fullName: "Maria Teste", email: "maria@exemplo.com", acceptedRules: true, acceptedCancellation: true, acceptedPrivacy: true };
const ADMIN = "anfitriao@exemplo.com";

function make(now?: () => Date, pricing = testPricing()) {
  const repo = new InMemoryRepository(pricing);
  const payments = new MockMercadoPago();
  const email = new DevEmailProvider();
  const svc = new ReservationService({
    repo, payments, email, adminEmail: ADMIN, emailFrom: "Cabana <no-reply@x.com>", now,
    config: { siteUrl: "https://x", notificationUrl: "https://x/w", mode: "mock", webhookSecret: "s" },
  });
  return { repo, payments, email, svc };
}
/** datas futuras relativas a "hoje", para os testes de lembrete. */
function futureStay(daysAhead: number) {
  const checkIn = addDays(todayLocal(), daysAhead);
  return { checkIn, checkOut: addDays(checkIn, 2), adults: 2 };
}

describe("expiração — o bug de bloquear datas para sempre", () => {
  it("expira reserva aprovada e não paga, liberando as datas", async () => {
    let t = new Date("2026-04-01T12:00:00Z");
    const { repo, svc } = make(() => t);
    const stay = futureStay(60);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    expect((await svc.checkAvailability(stay.checkIn, stay.checkOut)).available).toBe(false);

    t = new Date("2026-04-03T12:00:00Z"); // > 24h de prazo
    const expired = await svc.expireOverdue();
    expect(expired).toContain(reservation.id);
    expect((await repo.getReservationById(reservation.id))!.status).toBe("expired");
    expect((await svc.checkAvailability(stay.checkIn, stay.checkOut)).available).toBe(true);
  });

  it("reserva com pagamento aprovado NUNCA expira", async () => {
    let t = new Date("2026-04-01T12:00:00Z");
    const { repo, payments, svc } = make(() => t);
    const stay = futureStay(70);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    await repo.upsertPaymentTx({ reservationId: reservation.id, provider: "mercadopago", paymentId: "p1", status: "approved", amountCents: 105000, currency: "BRL" });
    t = new Date("2026-04-05T12:00:00Z");
    expect(await svc.expireOverdue()).not.toContain(reservation.id);
  });
});

describe("alertas ao anfitrião", () => {
  it("nova solicitação notifica o admin (e não o hóspede no mesmo template)", async () => {
    const { email, svc } = make();
    await svc.requestReservation({ ...futureStay(40), guest });
    const adminMail = email.sent.find((m) => m.subject.includes("Nova solicitação"));
    expect(adminMail).toBeDefined();
    expect(adminMail!.to).toBe(ADMIN);
    const guestMail = email.sent.find((m) => m.subject.includes("Recebemos sua solicitação"));
    expect(guestMail!.to).toBe(guest.email);
  });

  it("alerta de pagamento sem confirmação automática chega ao admin", async () => {
    const { repo, payments, email, svc } = make();
    // força iCal desatualizado -> confirmação retida
    (svc as any).ensureIcalFresh = async () => ({ ok: false, lastSyncAt: null, reason: "stale" });
    const stay = futureStay(50);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin", { overrideStaleIcal: true });
    payments.seedPayment({ id: "p1", status: "approved", externalReference: reservation.externalReference, amountCents: 105000, currency: "BRL", liveMode: false });
    const out = await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "p1", rawPayload: {} });
    expect(out.status).toBe("stale_needs_manual");

    const alert = email.sent.find((m) => m.subject.includes("AÇÃO NECESSÁRIA"));
    expect(alert).toBeDefined();
    expect(alert!.to).toBe(ADMIN);
    const logs = await repo.listNotifications();
    expect(logs.find((l) => l.template === "payment_needs_manual")!.status).toBe("sent");
  });

  it("template inexistente é registrado como template_missing (não some em silêncio)", async () => {
    const { repo, svc } = make();
    await (svc as any).notify("template_que_nao_existe", { to: "x@y.com", reservationId: null });
    const logs = await repo.listNotifications();
    expect(logs[0]!.status).toBe("template_missing");
  });
});

describe("aviso de bloqueio no Airbnb", () => {
  it("confirmação registra pendência e alerta o admin; admin consegue baixar", async () => {
    const { repo, payments, email, svc } = make();
    const stay = futureStay(45);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    payments.seedPayment({ id: "p1", status: "approved", externalReference: reservation.externalReference, amountCents: 105000, currency: "BRL", liveMode: false });
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "p1", rawPayload: {} });

    const pend = await svc.listPendingAirbnbBlocks();
    expect(pend).toHaveLength(1);
    expect(pend[0]!.code).toBe(reservation.friendlyCode);
    expect(email.sent.some((m) => m.subject.includes("Bloqueie estas datas no Airbnb") && m.to === ADMIN)).toBe(true);

    const after = await svc.clearPendingAirbnbBlock(reservation.friendlyCode, "admin@x");
    expect(after).toHaveLength(0);
    expect(await repo.getSetting<PendingAirbnbBlock[]>(PENDING_AIRBNB_KEY)).toEqual([]);
    expect((await repo.listAuditLogs())[0]!.action).toBe("airbnb_block.acknowledge");
  });
});

describe("histórico e lembretes", () => {
  it("a criação da reserva já aparece no histórico", async () => {
    const { repo, svc } = make();
    const { reservation } = await svc.requestReservation({ ...futureStay(30), guest });
    const hist = await repo.listStatusHistory(reservation.id);
    expect(hist).toHaveLength(1);
    expect(hist[0]!.fromStatus).toBeNull();
    expect(hist[0]!.toStatus).toBe("pending_approval");
    expect(hist[0]!.origin).toBe("guest");
  });

  it("lembrete de pagamento sai uma única vez, só perto do prazo", async () => {
    let t = new Date();
    const { email, svc } = make(() => t);
    const { reservation } = await svc.requestReservation({ ...futureStay(35), guest });
    await svc.approveReservation(reservation.id, "admin");

    // ainda longe do prazo (24h): nada
    expect((await svc.sendDueReminders()).payment).toBe(0);

    // faltando ~3h para expirar
    t = new Date(t.getTime() + 21 * 3600_000);
    expect((await svc.sendDueReminders()).payment).toBe(1);
    // idempotente
    expect((await svc.sendDueReminders()).payment).toBe(0);
    expect(email.sent.filter((m) => m.subject.includes("vence em breve"))).toHaveLength(1);
  });

  it("lembrete de check-in sai para reserva confirmada próxima", async () => {
    const { payments, email, svc } = make();
    const stay = futureStay(1); // check-in amanhã
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    payments.seedPayment({ id: "p1", status: "approved", externalReference: reservation.externalReference, amountCents: 105000, currency: "BRL", liveMode: false });
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "p1", rawPayload: {} });

    expect((await svc.sendDueReminders()).checkin).toBe(1);
    expect((await svc.sendDueReminders()).checkin).toBe(0); // idempotente
    expect(email.sent.some((m) => m.subject.includes("Sua estadia está chegando"))).toBe(true);
  });
});
