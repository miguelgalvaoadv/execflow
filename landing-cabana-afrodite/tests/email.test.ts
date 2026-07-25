import { describe, it, expect } from "vitest";
import { DevEmailProvider, ResendEmailProvider, createEmailProvider } from "../src/email/provider.js";
import { renderTemplate } from "../src/email/templates.js";
import { ReservationService } from "../src/services/reservation-service.js";
import { InMemoryRepository } from "../src/db/memory.js";
import { MockMercadoPago } from "../src/payments/mercadopago.js";
import type { PricingConfig } from "../src/domain/pricing.js";
import type { GuestData } from "../src/db/repository.js";

describe("email — provider e templates", () => {
  it("dev provider registra e nunca falha", async () => {
    const dev = new DevEmailProvider();
    const r = await dev.send({ to: "a@b.com", subject: "s", text: "t" }, "from@x.com");
    expect(r.ok).toBe(true);
    expect(dev.sent).toHaveLength(1);
  });

  it("resend usa a API e trata erro sem lançar", async () => {
    const fetchOk = (async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 })) as unknown as typeof fetch;
    const ok = await new ResendEmailProvider("key", fetchOk).send({ to: "a@b.com", subject: "s", text: "t" }, "f@x.com");
    expect(ok).toEqual({ ok: true, id: "re_1" });

    const fetchErr = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const bad = await new ResendEmailProvider("key", fetchErr).send({ to: "a@b.com", subject: "s", text: "t" }, "f@x.com");
    expect(bad.ok).toBe(false);
  });

  it("factory cai para dev sem api key", () => {
    expect(createEmailProvider({ provider: "resend", apiKey: null }).name).toBe("dev");
    expect(createEmailProvider({ provider: "resend", apiKey: "k" }).name).toBe("resend");
    expect(createEmailProvider({ provider: "unknown", apiKey: null }).name).toBe("dev");
  });

  it("templates conhecidos renderizam; desconhecidos retornam null", () => {
    expect(renderTemplate("reservation_confirmed", { code: "CAF-1" })?.subject).toContain("CAF-1");
    expect(renderTemplate("inexistente", {})).toBeNull();
  });
});

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

describe("email — integração no fluxo", () => {
  it("envia e-mail de confirmação ao confirmar a reserva", async () => {
    const repo = new InMemoryRepository(testPricing());
    const payments = new MockMercadoPago();
    const email = new DevEmailProvider();
    const svc = new ReservationService({
      repo, payments, email, emailFrom: "Cabana <no-reply@x.com>",
      config: { siteUrl: "https://x", notificationUrl: "https://x/api/webhooks/mercadopago", mode: "mock", webhookSecret: "s" },
    });
    const { reservation } = await svc.requestReservation({ checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2, guest });
    await svc.approveReservation(reservation.id, "admin");
    payments.seedPayment({ id: "pay-1", status: "approved", externalReference: reservation.externalReference, amountCents: 105000, currency: "BRL", liveMode: false });
    await svc.processPaymentWebhook({ signatureValid: true, eventKey: "e1", paymentId: "pay-1", rawPayload: {} });

    const subjects = email.sent.map((m) => m.subject);
    expect(subjects.some((s) => s.includes("Recebemos sua solicitação"))).toBe(true);
    expect(subjects.some((s) => s.includes("confirmada"))).toBe(true);
  });
});
