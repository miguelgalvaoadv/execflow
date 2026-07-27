import { describe, it, expect } from "vitest";
import { ReservationService, ValidationError } from "../src/services/reservation-service.js";
import { InMemoryRepository } from "../src/db/memory.js";
import { MockMercadoPago } from "../src/payments/mercadopago.js";
import { ConflictError } from "../src/db/repository.js";
import type { PricingConfig } from "../src/domain/pricing.js";
import type { GuestData } from "../src/db/repository.js";

function testPricing(): PricingConfig {
  return {
    currency: "BRL",
    defaultNightlyCents: 45000,
    weekdayNightlyCents: {},
    specialPeriods: [],
    dateOverrides: { "2026-05-04": 45000, "2026-05-05": 45000, "2026-05-10": 45000, "2026-05-11": 45000 },
    cleaningFeeCents: 15000,
    includedGuests: 2,
    extraGuestFeeCents: 8000,
    extraGuestPer: "night",
    maxGuests: 4,
    minNights: 2,
    maxNights: 30,
    minReservationCents: 0,
    flatDiscountPercent: 0,
    lengthOfStayDiscounts: [],
    securityDepositCents: 0,
    chargeDepositUpfront: false,
    payment: { mode: "full", signalPercent: 30, expirationHours: 24, maxInstallments: 12 },
    prepBufferNights: 0,
  };
}

const guest: GuestData = {
  fullName: "Maria Teste",
  email: "maria@exemplo.com",
  phone: "11999999999",
  acceptedRules: true,
  acceptedCancellation: true,
  acceptedPrivacy: true,
};

function makeService(now?: () => Date) {
  const repo = new InMemoryRepository(testPricing());
  const payments = new MockMercadoPago();
  const svc = new ReservationService({
    repo,
    payments,
    config: { siteUrl: "https://cabana.example", notificationUrl: "https://cabana.example/api/webhooks/mercadopago", mode: "mock", webhookSecret: "s" },
    now,
  });
  return { repo, payments, svc };
}

const stay = { checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2 };
const EXPECTED_TOTAL = 105000; // 45000*2 + 15000

describe("reservation service — fluxo completo", () => {
  it("caminho feliz: solicita -> aprova -> preferência -> webhook -> confirmada", async () => {
    const { repo, payments, svc } = makeService();
    const { reservation, quote } = await svc.requestReservation({ ...stay, guest });
    expect(reservation.status).toBe("pending_approval");
    expect(quote.payNowCents).toBe(EXPECTED_TOTAL);

    await svc.approveReservation(reservation.id, "admin@teste");
    const pref = await svc.createPaymentPreference(reservation.id);
    expect(pref.initPoint).toContain("http");

    payments.seedPayment({
      id: "pay-1", status: "approved", externalReference: reservation.externalReference,
      amountCents: EXPECTED_TOTAL, currency: "BRL", liveMode: false,
    });
    const out = await svc.processPaymentWebhook({ signatureValid: true, eventKey: "evt-pay-1", paymentId: "pay-1", rawPayload: {} });
    expect(out.status).toBe("confirmed");

    const confirmed = await repo.getReservationById(reservation.id);
    expect(confirmed!.status).toBe("confirmed");
    const templates = (repo._notifications() as any[]).map((n) => n.template);
    expect(templates).toContain("reservation_confirmed");
  });

  it("webhook idempotente: reprocessar não duplica", async () => {
    const { repo, payments, svc } = makeService();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "a");
    payments.seedPayment({ id: "pay-1", status: "approved", externalReference: reservation.externalReference, amountCents: EXPECTED_TOTAL, currency: "BRL", liveMode: false });

    const first = await svc.processPaymentWebhook({ signatureValid: true, eventKey: "evt-1", paymentId: "pay-1", rawPayload: {} });
    const second = await svc.processPaymentWebhook({ signatureValid: true, eventKey: "evt-1", paymentId: "pay-1", rawPayload: {} });
    expect(first.status).toBe("confirmed");
    expect(second.status).toBe("already_processed");
    const confirmed = await repo.getReservationById(reservation.id);
    expect(confirmed!.status).toBe("confirmed");
  });

  it("assinatura inválida não confirma", async () => {
    const { repo, svc } = makeService();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "a");
    const out = await svc.processPaymentWebhook({ signatureValid: false, eventKey: "evt-x", paymentId: "pay-1", rawPayload: {} });
    expect(out.status).toBe("invalid_signature");
    expect((await repo.getReservationById(reservation.id))!.status).toBe("awaiting_payment");
  });

  it("valor divergente não confirma (proteção contra adulteração)", async () => {
    const { repo, payments, svc } = makeService();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "a");
    payments.seedPayment({ id: "pay-1", status: "approved", externalReference: reservation.externalReference, amountCents: 100, currency: "BRL", liveMode: false });
    const out = await svc.processPaymentWebhook({ signatureValid: true, eventKey: "evt-1", paymentId: "pay-1", rawPayload: {} });
    expect(out.status).toBe("mismatch");
    expect((await repo.getReservationById(reservation.id))!.status).toBe("awaiting_payment");
  });

  it("anti-sobreposição: não aprova duas reservas para o mesmo período", async () => {
    const { svc } = makeService();
    const a = await svc.requestReservation({ ...stay, guest });
    const b = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(a.reservation.id, "admin");
    await expect(svc.approveReservation(b.reservation.id, "admin")).rejects.toBeInstanceOf(ConflictError);
  });

  it("expiração libera reserva aprovada e não paga", async () => {
    let t = new Date("2026-04-01T12:00:00Z");
    const { repo, svc } = makeService(() => t);
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    // avança 48h (> 24h de prazo)
    t = new Date("2026-04-03T12:00:00Z");
    const expired = await svc.expireOverdue();
    expect(expired).toContain(reservation.id);
    expect((await repo.getReservationById(reservation.id))!.status).toBe("expired");
  });

  it("rejeita aceite faltando", async () => {
    const { svc } = makeService();
    await expect(
      svc.requestReservation({ ...stay, guest: { ...guest, acceptedPrivacy: false } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("reconciliação confirma quando o webhook não chega (consulta a API por external_reference)", async () => {
    const { repo, payments, svc } = makeService();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    // pagamento aprovado existe no MP, mas o webhook NÃO chegou
    payments.seedPayment({ id: "pay-recon", status: "approved", externalReference: reservation.externalReference, amountCents: EXPECTED_TOTAL, currency: "BRL", liveMode: false });
    const before = await repo.getReservationById(reservation.id);
    expect(before!.status).toBe("awaiting_payment");
    const res = await svc.reconcileReservation(reservation.publicToken);
    expect(res.status).toBe("confirmed");
    expect((await repo.getReservationById(reservation.id))!.status).toBe("confirmed");
  });

  it("varredura agendada reconcilia todas as pendentes pagas", async () => {
    const { repo, payments, svc } = makeService();
    const a = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(a.reservation.id, "admin");
    payments.seedPayment({ id: "pay-sweep", status: "approved", externalReference: a.reservation.externalReference, amountCents: EXPECTED_TOTAL, currency: "BRL", liveMode: false });
    const results = await svc.reconcileAllPending();
    expect(results.some((x) => x.status === "confirmed")).toBe(true);
    expect((await repo.getReservationById(a.reservation.id))!.status).toBe("confirmed");
  });

  it("reconciliação não faz nada se não há pagamento aprovado", async () => {
    const { svc } = makeService();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin");
    const res = await svc.reconcileReservation(reservation.publicToken);
    expect(res.status).toBe("awaiting_payment");
  });

  it("após aprovar, período fica indisponível para novas datas sobrepostas", async () => {
    const { svc } = makeService();
    const a = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(a.reservation.id, "admin");
    const avail = await svc.checkAvailability("2026-05-05", "2026-05-07");
    expect(avail.available).toBe(false);
  });
});
