import { describe, it, expect } from "vitest";
import { quote, isBookable, type PricingConfig } from "../src/domain/pricing.js";
import { weekday } from "../src/domain/dates.js";

function baseCfg(over: Partial<PricingConfig> = {}): PricingConfig {
  return {
    currency: "BRL",
    defaultNightlyCents: 40000,
    weekdayNightlyCents: { 5: 60000, 6: 70000 }, // sex 600, sáb 700
    specialPeriods: [
      { id: "ny", name: "Réveillon", start: "2026-12-30", end: "2027-01-01", nightlyCents: 120000, minNights: 3 },
    ],
    dateOverrides: { "2026-09-07": 80000 },
    cleaningFeeCents: 15000,
    includedGuests: 2,
    extraGuestFeeCents: 8000,
    extraGuestPer: "night",
    maxGuests: 4,
    minNights: 2,
    maxNights: 30,
    minReservationCents: 40000,
    flatDiscountPercent: 0,
    lengthOfStayDiscounts: [{ minNights: 5, percent: 10 }],
    securityDepositCents: 30000,
    chargeDepositUpfront: false,
    payment: { mode: "full", signalPercent: 30, expirationHours: 24, maxInstallments: 12 },
    prepBufferNights: 0,
    ...over,
  };
}

describe("pricing — diária padrão e total", () => {
  it("2 noites com override determinístico", () => {
    const cfg = baseCfg({ dateOverrides: { "2026-05-04": 40000, "2026-05-05": 40000 } });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2 }, cfg);
    expect(q.nights).toBe(2);
    expect(q.accommodationCents).toBe(80000);
    expect(q.cleaningFeeCents).toBe(15000);
    expect(q.discount.cents).toBe(0);
    expect(q.totalCents).toBe(95000);
    expect(q.payNowCents).toBe(95000); // full
    expect(q.remainingCents).toBe(0);
    expect(isBookable(q)).toBe(true);
  });
});

describe("pricing — dia da semana", () => {
  it("sexta e sábado usam tarifa própria", () => {
    // 2026-08-07 é sexta, 2026-08-08 é sábado
    expect(weekday("2026-08-07")).toBe(5);
    expect(weekday("2026-08-08")).toBe(6);
    const q = quote({ checkIn: "2026-08-07", checkOut: "2026-08-09", adults: 2 }, baseCfg());
    expect(q.nightly[0]!.cents).toBe(60000);
    expect(q.nightly[0]!.source).toBe("weekday");
    expect(q.nightly[1]!.cents).toBe(70000);
    expect(q.accommodationCents).toBe(130000);
  });
});

describe("pricing — período especial e feriado", () => {
  it("período especial aplica tarifa e mínimo de noites", () => {
    const q = quote({ checkIn: "2026-12-30", checkOut: "2027-01-01", adults: 2 }, baseCfg());
    expect(q.nightly.every((n) => n.cents === 120000)).toBe(true);
    expect(q.nightly[0]!.source).toBe("special");
    expect(q.accommodationCents).toBe(240000);
    expect(q.issues.map((i) => i.code)).toContain("PERIOD_MIN_NIGHTS");
    expect(isBookable(q)).toBe(false);
  });

  it("feriado (dateOverride) tem prioridade máxima", () => {
    const q = quote({ checkIn: "2026-09-06", checkOut: "2026-09-08", adults: 2 }, baseCfg());
    const holiday = q.nightly.find((n) => n.date === "2026-09-07");
    expect(holiday!.cents).toBe(80000);
    expect(holiday!.source).toBe("override");
  });
});

describe("pricing — hóspede adicional", () => {
  it("cobra por hóspede extra por noite", () => {
    const cfg = baseCfg({ dateOverrides: { "2026-05-04": 40000, "2026-05-05": 40000 } });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 3 }, cfg);
    expect(q.extraGuest.extraGuests).toBe(1);
    expect(q.extraGuest.cents).toBe(16000); // 8000 * 1 extra * 2 noites
    expect(q.totalCents).toBe(80000 + 15000 + 16000);
  });
});

describe("pricing — descontos", () => {
  it("desconto por 5+ noites aplicado sobre a acomodação", () => {
    const over: Record<string, number> = {};
    for (const d of ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]) over[d] = 40000;
    const cfg = baseCfg({ dateOverrides: over });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-09", adults: 2 }, cfg);
    expect(q.nights).toBe(5);
    expect(q.accommodationCents).toBe(200000);
    expect(q.discount.percent).toBe(10);
    expect(q.discount.cents).toBe(20000);
    expect(q.totalCents).toBe(200000 - 20000 + 15000);
  });
});

describe("pricing — sinal e caução", () => {
  it("modo sinal cobra apenas percentual agora", () => {
    const cfg = baseCfg({
      dateOverrides: { "2026-05-04": 40000, "2026-05-05": 40000 },
      payment: { mode: "signal", signalPercent: 30, expirationHours: 24, maxInstallments: 12 },
    });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2 }, cfg);
    expect(q.totalCents).toBe(95000);
    expect(q.payNowCents).toBe(28500); // 30% de 95000
    expect(q.remainingCents).toBe(66500);
  });

  it("caução cobrada antecipadamente entra no total a pagar", () => {
    const cfg = baseCfg({ dateOverrides: { "2026-05-04": 40000, "2026-05-05": 40000 }, chargeDepositUpfront: true });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2 }, cfg);
    expect(q.grandTotalWithDepositCents).toBe(95000 + 30000);
    expect(q.payNowCents).toBe(125000);
  });
});

describe("pricing — validações", () => {
  it("mínimo de noites sinaliza issue", () => {
    const cfg = baseCfg({ dateOverrides: { "2026-05-04": 40000 } });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-05", adults: 2 }, cfg);
    expect(q.issues.map((i) => i.code)).toContain("MIN_NIGHTS");
  });

  it("excesso de hóspedes sinaliza issue", () => {
    const cfg = baseCfg({ dateOverrides: { "2026-05-04": 40000, "2026-05-05": 40000 } });
    const q = quote({ checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 5 }, cfg);
    expect(q.issues.map((i) => i.code)).toContain("MAX_GUESTS");
  });

  it("check-out anterior ao check-in lança erro", () => {
    expect(() => quote({ checkIn: "2026-05-06", checkOut: "2026-05-04", adults: 2 }, baseCfg())).toThrow();
  });
});
