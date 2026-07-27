import { describe, it, expect, beforeEach } from "vitest";
import { ReservationService } from "../src/services/reservation-service.js";
import { InMemoryRepository } from "../src/db/memory.js";
import { MockMercadoPago } from "../src/payments/mercadopago.js";
import { InvalidTransitionError } from "../src/domain/reservation-state.js";
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

function make() {
  const repo = new InMemoryRepository(testPricing());
  const payments = new MockMercadoPago();
  const svc = new ReservationService({
    repo, payments,
    config: { siteUrl: "https://x", notificationUrl: "https://x/api/webhooks/mercadopago", mode: "mock", webhookSecret: "s" },
  });
  return { repo, payments, svc };
}

describe("ações administrativas — cancelar e concluir", () => {
  it("cancela uma reserva pendente e registra no histórico + audit log", async () => {
    const { repo, svc } = make();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    const out = await svc.cancelReservation(reservation.id, "admin@x", { reason: "hóspede desistiu" });
    expect(out.status).toBe("cancelled");
    expect(out.requiresManualRefund).toBe(false);

    const hist = await repo.listStatusHistory(reservation.id);
    const last = hist[hist.length - 1]!;
    expect(last.toStatus).toBe("cancelled");
    expect(last.origin).toBe("admin");
    expect(last.adminUser).toBe("admin@x");
    expect(last.note).toMatch(/desistiu/);

    const logs = await repo.listAuditLogs();
    expect(logs[0]!.action).toBe("reservation.cancel");
    expect(logs[0]!.actor).toBe("admin@x");
  });

  it("cancelar reserva paga sinaliza reembolso manual na nota", async () => {
    const { repo, payments, svc } = make();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(reservation.id, "admin@x");
    payments.seedPayment({ id: "p1", status: "approved", externalReference: reservation.externalReference, amountCents: TOTAL, currency: "BRL", liveMode: false });
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "p1", rawPayload: {} });

    const out = await svc.cancelReservation(reservation.id, "admin@x", { refundCents: TOTAL });
    expect(out.requiresManualRefund).toBe(true);
    const hist = await repo.listStatusHistory(reservation.id);
    expect(hist[hist.length - 1]!.note).toMatch(/manualmente no painel do Mercado Pago/);
  });

  it("cancelar libera as datas para nova reserva", async () => {
    const { svc } = make();
    const a = await svc.requestReservation({ ...stay, guest });
    await svc.approveReservation(a.reservation.id, "admin@x");
    expect((await svc.checkAvailability(stay.checkIn, stay.checkOut)).available).toBe(false);
    await svc.cancelReservation(a.reservation.id, "admin@x");
    expect((await svc.checkAvailability(stay.checkIn, stay.checkOut)).available).toBe(true);
  });

  it("concluir só é permitido a partir de confirmada", async () => {
    const { repo, payments, svc } = make();
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    await expect(svc.completeReservation(reservation.id, "admin@x")).rejects.toBeInstanceOf(InvalidTransitionError);

    await svc.approveReservation(reservation.id, "admin@x");
    payments.seedPayment({ id: "p1", status: "approved", externalReference: reservation.externalReference, amountCents: TOTAL, currency: "BRL", liveMode: false });
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "p1", rawPayload: {} });
    const out = await svc.completeReservation(reservation.id, "admin@x");
    expect(out.status).toBe("completed");
    expect((await repo.getReservationById(reservation.id))!.status).toBe("completed");
  });
});

describe("repositório administrativo", () => {
  let repo: InMemoryRepository;
  beforeEach(() => { repo = new InMemoryRepository(testPricing()); });

  it("atualiza preços e reflete na config ativa", async () => {
    await repo.updatePricingConfig({ defaultNightlyCents: 52000, cleaningFeeCents: 18000 });
    const cfg = await repo.getActivePricingConfig();
    expect(cfg.defaultNightlyCents).toBe(52000);
    expect(cfg.cleaningFeeCents).toBe(18000);
    expect(cfg.maxGuests).toBe(4); // campos não enviados permanecem
  });

  it("período especial criado passa a valer no motor de preços", async () => {
    const id = await repo.createSpecialPeriod({ name: "Réveillon", startDate: "2026-12-30", endDate: "2026-12-31", nightlyCents: 120000, minNights: 3, discountPercent: null });
    const cfg = await repo.getActivePricingConfig();
    expect(cfg.specialPeriods.some((p) => p.id === id && p.nightlyCents === 120000)).toBe(true);
    await repo.deleteSpecialPeriod(id);
    expect((await repo.getActivePricingConfig()).specialPeriods.some((p) => p.id === id)).toBe(false);
    expect(await repo.listSpecialPeriods()).toHaveLength(0);
  });

  it("token do .ics é persistido e regenerável", async () => {
    expect(await repo.getIcalExportToken()).toBeNull();
    await repo.setIcalExportToken("tok-1");
    expect(await repo.getIcalExportToken()).toBe("tok-1");
    await repo.setIcalExportToken("tok-2");
    expect(await repo.getIcalExportToken()).toBe("tok-2");
  });

  it("busca reservas por nome, e-mail ou código", async () => {
    const payments = new MockMercadoPago();
    const svc = new ReservationService({ repo, payments, config: { siteUrl: "https://x", notificationUrl: "https://x/w", mode: "mock", webhookSecret: "s" } });
    const { reservation } = await svc.requestReservation({ ...stay, guest });
    expect(await repo.listReservations({ search: "maria" })).toHaveLength(1);
    expect(await repo.listReservations({ search: "MARIA@EXEMPLO" })).toHaveLength(1);
    expect(await repo.listReservations({ search: reservation.friendlyCode })).toHaveLength(1);
    expect(await repo.listReservations({ search: "inexistente" })).toHaveLength(0);
  });

  it("lista bloqueios manuais ativos e some ao remover", async () => {
    const id = await repo.addManualBlock({ checkIn: "2026-09-01", checkOut: "2026-09-05", reason: "manutenção" });
    expect(await repo.listManualBlocks()).toHaveLength(1);
    await repo.removeManualBlock(id);
    expect(await repo.listManualBlocks()).toHaveLength(0);
  });

  it("registra logs de sincronização do iCal", async () => {
    await repo.logIcalSync({ success: true, eventsFound: 5, periodsImported: 4, durationMs: 120 });
    await repo.logIcalSync({ success: false, eventsFound: 0, periodsImported: 0, durationMs: 90, error: "timeout" });
    const logs = await repo.listIcalSyncLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]!.success).toBe(false);
    expect(logs[0]!.errorMessage).toBe("timeout");
  });
});
