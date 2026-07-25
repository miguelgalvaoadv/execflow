/**
 * ⚠️ VALORES DE DEMONSTRAÇÃO — NÃO SÃO OS VALORES REAIS DO CLIENTE.
 * Servem apenas para o sistema funcionar em modo mock/sandbox. Todos são
 * editáveis pelo painel administrativo (tabela `settings`/`pricing_rules`),
 * SEM alterar código. O proprietário copiará os preços reais do Airbnb.
 */
import { reaisToCents } from "../domain/money.js";
import type { PricingConfig } from "../domain/pricing.js";

export const DEMO_PRICING: PricingConfig = {
  currency: "BRL",
  // DEMO: diária padrão
  defaultNightlyCents: reaisToCents(450),
  // DEMO: fim de semana mais caro (5=sex, 6=sáb)
  weekdayNightlyCents: {
    5: reaisToCents(590), // sexta
    6: reaisToCents(650), // sábado
  },
  // DEMO: período especial (ex.: alta temporada)
  specialPeriods: [
    {
      id: "demo-reveillon",
      name: "Réveillon (DEMO)",
      start: "2026-12-28",
      end: "2027-01-02",
      nightlyCents: reaisToCents(1200),
      minNights: 4,
    },
  ],
  // DEMO: feriado avulso
  dateOverrides: {
    "2026-09-07": reaisToCents(720), // Independência (DEMO)
  },
  cleaningFeeCents: reaisToCents(150), // DEMO
  includedGuests: 2, // a cabana acomoda 2 confortavelmente
  extraGuestFeeCents: reaisToCents(80), // DEMO por hóspede adicional
  extraGuestPer: "night",
  maxGuests: 4, // conforme anúncio (até 4)
  minNights: 2, // DEMO
  maxNights: 30,
  minReservationCents: reaisToCents(450), // DEMO
  flatDiscountPercent: 0,
  lengthOfStayDiscounts: [
    { minNights: 5, percent: 5 }, // DEMO
    { minNights: 7, percent: 10 }, // DEMO
  ],
  securityDepositCents: reaisToCents(300), // DEMO caução (reembolsável)
  chargeDepositUpfront: false,
  payment: {
    mode: "full", // DEMO: pagamento integral (pode virar "signal")
    signalPercent: 30, // usado se mode==="signal"
    expirationHours: Number(process.env.RESERVATION_PAYMENT_EXPIRATION_HOURS ?? 24),
    maxInstallments: 12,
  },
  prepBufferNights: 0, // DEMO: sem intervalo de preparação
};

/** Regras não-monetárias de demonstração (editáveis no painel). */
export const DEMO_SETTINGS = {
  timezone: "America/Sao_Paulo",
  checkInTime: "15:00", // DEMO
  checkOutTime: "11:00", // DEMO
  cancellationPolicy:
    "DEMO — Política não reembolsável. Troca de data uma única vez, até 15 dias antes da estadia.",
  houseRules: "DEMO — Não fumantes. Silêncio após 22h. Sem festas.",
  contact: {
    // DEMO — confirmar com o cliente antes de produção
    whatsapp: "+5521972887766",
    email: "reservas@exemplo.com",
    instagram: "@cabanaafrodite",
  },
} as const;
