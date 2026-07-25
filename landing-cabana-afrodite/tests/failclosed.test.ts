import { describe, it, expect } from "vitest";
import { ReservationService, SyncStaleError } from "../src/services/reservation-service.js";
import type { IcalFreshness } from "../src/services/ical-sync.js";
import { InMemoryRepository } from "../src/db/memory.js";
import { MockMercadoPago } from "../src/payments/mercadopago.js";
import type { PricingConfig } from "../src/domain/pricing.js";
import type { GuestData } from "../src/db/repository.js";

function testPricing(): PricingConfig {
  return {
    currency: "BRL", defaultNightlyCents: 45000, weekdayNightlyCents: {}, specialPeriods: [],
    dateOverrides: { "2026-05-04": 45000, "2026-05-05": 45000 }, cleaningFeeCents: 15000,
    includedGuests: 2, extraGuestFeeCents: 8000, extraGuestPer: "night", maxGuests: 4,
    minNights: 2, maxNights: 30, minReservationCents: 0, flatDiscountPercent: 0, lengthOfStayDiscounts: [],
    securityDepositCents: 0, chargeDepositUpfront: false,
    payment: { mode: "full", signalPercent: 30, expirationHours: 24, maxInstallments: 12 }, prepBufferNights: 0,
  };
}
const guest: GuestData = { fullName: "Maria Teste", email: "maria@exemplo.com", acceptedRules: true, acceptedCancellation: true, acceptedPrivacy: true };
const stay = { checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2 };
const TOTAL = 105000;

const FRESH: IcalFreshness = { ok: true, lastSyncAt: new Date(), reason: "fresh" };
const STALE: IcalFreshness = { ok: false, lastSyncAt: new Date(Date.now() - 20 * 60_000), reason: "stale" };

function make(freshness: () => IcalFreshness) {
  const repo = new InMemoryRepository(testPricing());
  const payments = new MockMercadoPago();
  const svc = new ReservationService({
    repo, payments, ensureIcalFresh: async () => freshness(),
    config: { siteUrl: "https://x", notificationUrl: "https://x/api/webhooks/mercadopago", mode: "sandbox", webhookSecret: "s" },
  });
  return { repo, payments, svc };
}

describe("fail-closed — iCal desatualizado nos pontos críticos", () => {
  it("1. consulta pública usa último estado válido e sinaliza desatualização", async () => {
    const { svc } = make(() => STALE);
    const a = await svc.checkAvailability("2026-05-04", "2026-05-06");
    expect(a.available).toBe(true); // não bloqueia a consulta
    expect(a.icalStale).toBe(true); // mas sinaliza
  });

  it("2. aprovação com iCal desatualizado é BLOQUEADA (fail-closed)", async () => {
    const { svc } = make(() => STALE);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await expect(svc.approveReservation(reservation.id, "admin")).rejects.toBeInstanceOf(SyncStaleError);
  });

  it("3. criação da preferência com iCal desatualizado é BLOQUEADA", async () => {
    let fresh = FRESH;
    const { svc } = make(() => fresh);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin"); // fresco: aprova
    fresh = STALE; // iCal cai antes do pagamento
    await expect(svc.createPaymentPreference(reservation.id)).rejects.toBeInstanceOf(SyncStaleError);
  });

  it("4. webhook aprovado com iCal desatualizado NÃO confirma (pagamento retido p/ manual)", async () => {
    let fresh = FRESH;
    const { repo, payments, svc } = make(() => fresh);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    payments.seedPayment({ id: "pay-1", status: "approved", externalReference: reservation.externalReference, amountCents: TOTAL, currency: "BRL", liveMode: false });
    fresh = STALE; // iCal cai durante o webhook
    const out = await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "pay-1", rawPayload: {} });
    expect(out.status).toBe("stale_needs_manual");
    expect((await repo.getReservationById(reservation.id))!.status).toBe("awaiting_payment"); // continua bloqueada, não confirmada
    expect(await repo.latestPaymentForReservation(reservation.id)).not.toBeNull(); // pagamento registrado
  });

  it("5. dentro do limite (fresco): aprovação prossegue", async () => {
    const { svc } = make(() => FRESH);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    const r = await svc.approveReservation(reservation.id, "admin");
    expect(r.status).toBe("awaiting_payment");
  });

  it("6. fora do limite (stale): aprovação bloqueada, mas override explícito passa e registra", async () => {
    const { repo, svc } = make(() => STALE);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await expect(svc.approveReservation(reservation.id, "admin")).rejects.toBeInstanceOf(SyncStaleError);
    const r = await svc.approveReservation(reservation.id, "admin", { overrideStaleIcal: true, overrideNote: "conferi no Airbnb" });
    expect(r.status).toBe("awaiting_payment");
  });

  it("7 e 8. confirmação administrativa manual confirma e registra a justificativa", async () => {
    let fresh = FRESH;
    const { repo, payments, svc } = make(() => fresh);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    payments.seedPayment({ id: "pay-1", status: "approved", externalReference: reservation.externalReference, amountCents: TOTAL, currency: "BRL", liveMode: false });
    fresh = STALE;
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "pay-1", rawPayload: {} });

    const confirmed = await svc.confirmPaymentManually(reservation.id, "admin@x", { overrideStaleIcal: true, note: "conferido manualmente no Airbnb" });
    expect(confirmed.status).toBe("confirmed");

    const history = repo._statusHistory();
    const manual = history.find((h) => h.toStatus === "confirmed");
    expect(manual?.origin).toBe("admin");
    expect(manual?.note).toMatch(/manual/i);
    expect(manual?.note).toMatch(/conferido manualmente/i);
  });

  it("reserva com pagamento recebido NÃO expira automaticamente", async () => {
    let t = new Date("2026-04-01T12:00:00Z");
    const { repo, payments, svc } = make(() => FRESH);
    (svc as any).now = () => t;
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    payments.seedPayment({ id: "pay-1", status: "approved", externalReference: reservation.externalReference, amountCents: TOTAL, currency: "BRL", liveMode: false });
    // webhook com iCal ok confirmaria; simulamos retenção manual seedando o pagamento e forçando stale no webhook
    (svc as any).ensureIcalFresh = async () => STALE;
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "pay-1", rawPayload: {} });
    t = new Date("2026-04-03T12:00:00Z"); // além do prazo
    const expired = await svc.expireOverdue();
    expect(expired).not.toContain(reservation.id); // pagamento recebido -> não expira
  });
});
