/**
 * Motor de preços da Cabana Afrodite.
 * Cálculo 100% em centavos (inteiros). É a fonte da verdade — o backend SEMPRE
 * recalcula com este módulo antes de: criar solicitação, aprovar, criar
 * preferência de pagamento e confirmar o pagamento.
 *
 * Prioridade da tarifa da noite:
 *   1) override de data específica (dateOverrides / feriado)
 *   2) período especial (specialPeriods)
 *   3) tarifa do dia da semana (weekdayNightlyCents)
 *   4) tarifa padrão (defaultNightlyCents)
 */
import { assertCents, applyPercent, sum, type Cents } from "./money.js";
import {
  assertLocalDate,
  nights as countNights,
  nightsInRange,
  weekday,
  compareDates,
  type LocalDate,
} from "./dates.js";

export type PaymentMode = "full" | "signal";

export interface SpecialPeriod {
  id: string;
  name: string;
  start: LocalDate; // primeira NOITE do período (inclusive)
  end: LocalDate; // última NOITE do período (inclusive)
  nightlyCents: Cents;
  minNights?: number;
  discountPercent?: number; // desconto próprio do período
}

export interface LengthOfStayDiscount {
  minNights: number;
  percent: number;
}

export interface PricingConfig {
  currency: "BRL";
  defaultNightlyCents: Cents;
  /** override por dia da semana: 0=domingo … 6=sábado */
  weekdayNightlyCents: Partial<Record<number, Cents>>;
  specialPeriods: SpecialPeriod[];
  dateOverrides: Record<LocalDate, Cents>;
  cleaningFeeCents: Cents;
  includedGuests: number;
  extraGuestFeeCents: Cents;
  extraGuestPer: "night" | "stay";
  maxGuests: number;
  minNights: number;
  maxNights?: number;
  minReservationCents: Cents;
  /** desconto percentual plano aplicado a qualquer estadia */
  flatDiscountPercent?: number;
  /** descontos por quantidade de noites (aplica o mais vantajoso) */
  lengthOfStayDiscounts: LengthOfStayDiscount[];
  /** caução (reembolsável) — informativa por padrão */
  securityDepositCents: Cents;
  chargeDepositUpfront: boolean;
  payment: {
    mode: PaymentMode;
    signalPercent: number; // usado quando mode === "signal"
    expirationHours: number;
    maxInstallments: number;
  };
  /** noites de preparação bloqueadas após um check-out (usado na disponibilidade) */
  prepBufferNights: number;
}

export type PricingIssueCode =
  | "MIN_NIGHTS"
  | "MAX_NIGHTS"
  | "MAX_GUESTS"
  | "MIN_VALUE"
  | "PERIOD_MIN_NIGHTS";

export interface PricingIssue {
  code: PricingIssueCode;
  message: string;
}

export interface NightlyLine {
  date: LocalDate;
  cents: Cents;
  source: "override" | "special" | "weekday" | "default";
}

export interface NightlyGroup {
  rateCents: Cents;
  count: number;
  subtotalCents: Cents;
}

export interface Quote {
  currency: "BRL";
  checkIn: LocalDate;
  checkOut: LocalDate;
  nights: number;
  guests: { adults: number; children: number; total: number };
  nightly: NightlyLine[];
  nightlyGroups: NightlyGroup[];
  accommodationCents: Cents; // soma das noites, antes do desconto
  discount: { percent: number; cents: Cents; reason: string | null };
  cleaningFeeCents: Cents;
  extraGuest: { extraGuests: number; cents: Cents };
  securityDepositCents: Cents;
  totalCents: Cents; // valor da reserva (sem caução, salvo cobrança antecipada)
  grandTotalWithDepositCents: Cents;
  payNowCents: Cents; // valor a pagar agora (Mercado Pago)
  remainingCents: Cents; // restante
  paymentMode: PaymentMode;
  issues: PricingIssue[];
}

export interface QuoteInput {
  checkIn: LocalDate;
  checkOut: LocalDate;
  adults: number;
  children?: number;
}

function inPeriod(date: LocalDate, p: SpecialPeriod): boolean {
  return compareDates(date, p.start) >= 0 && compareDates(date, p.end) <= 0;
}

function rateForNight(date: LocalDate, cfg: PricingConfig): { cents: Cents; source: NightlyLine["source"]; period?: SpecialPeriod } {
  const override = cfg.dateOverrides[date];
  if (override !== undefined) return { cents: assertCents(override, "dateOverride"), source: "override" };

  const period = cfg.specialPeriods.find((p) => inPeriod(date, p));
  if (period) return { cents: assertCents(period.nightlyCents, "specialPeriod"), source: "special", period };

  const wd = cfg.weekdayNightlyCents[weekday(date)];
  if (wd !== undefined) return { cents: assertCents(wd, "weekday"), source: "weekday" };

  return { cents: assertCents(cfg.defaultNightlyCents, "default"), source: "default" };
}

function groupNightly(lines: NightlyLine[]): NightlyGroup[] {
  const map = new Map<Cents, NightlyGroup>();
  for (const l of lines) {
    const g = map.get(l.cents) ?? { rateCents: l.cents, count: 0, subtotalCents: 0 };
    g.count += 1;
    g.subtotalCents += l.cents;
    map.set(l.cents, g);
  }
  return [...map.values()].sort((a, b) => a.rateCents - b.rateCents);
}

/** Melhor desconto aplicável (não empilha: escolhe o maior percentual). */
function bestDiscount(nightsCount: number, touchedPeriods: SpecialPeriod[], cfg: PricingConfig): { percent: number; reason: string | null } {
  const candidates: { percent: number; reason: string }[] = [];
  if (cfg.flatDiscountPercent && cfg.flatDiscountPercent > 0) {
    candidates.push({ percent: cfg.flatDiscountPercent, reason: "Desconto promocional" });
  }
  for (const los of cfg.lengthOfStayDiscounts) {
    if (nightsCount >= los.minNights) {
      candidates.push({ percent: los.percent, reason: `Desconto ${los.minNights}+ noites` });
    }
  }
  for (const p of touchedPeriods) {
    if (p.discountPercent && p.discountPercent > 0) {
      candidates.push({ percent: p.discountPercent, reason: `Desconto ${p.name}` });
    }
  }
  if (candidates.length === 0) return { percent: 0, reason: null };
  return candidates.reduce((best, c) => (c.percent > best.percent ? c : best));
}

export function quote(input: QuoteInput, cfg: PricingConfig): Quote {
  const checkIn = assertLocalDate(input.checkIn);
  const checkOut = assertLocalDate(input.checkOut);
  const n = countNights(checkIn, checkOut);
  if (n <= 0) throw new RangeError("check-out deve ser posterior ao check-in");

  const adults = Math.trunc(input.adults);
  const children = Math.trunc(input.children ?? 0);
  if (adults < 1) throw new RangeError("é necessário ao menos 1 adulto");
  if (children < 0) throw new RangeError("crianças não pode ser negativo");
  const totalGuests = adults + children;

  // noites
  const nightly: NightlyLine[] = [];
  const touchedPeriods = new Map<string, SpecialPeriod>();
  for (const date of nightsInRange(checkIn, checkOut)) {
    const r = rateForNight(date, cfg);
    nightly.push({ date, cents: r.cents, source: r.source });
    if (r.period) touchedPeriods.set(r.period.id, r.period);
  }
  const accommodationCents = sum(...nightly.map((l) => l.cents));
  const nightlyGroups = groupNightly(nightly);

  // desconto (sobre acomodação apenas)
  const disc = bestDiscount(n, [...touchedPeriods.values()], cfg);
  const discountCents = applyPercent(accommodationCents, disc.percent);

  // hóspede adicional
  const extraGuests = Math.max(0, totalGuests - cfg.includedGuests);
  const extraGuestCents =
    extraGuests > 0
      ? cfg.extraGuestFeeCents * extraGuests * (cfg.extraGuestPer === "night" ? n : 1)
      : 0;

  const cleaningFeeCents = assertCents(cfg.cleaningFeeCents, "cleaningFee");
  const totalCents = accommodationCents - discountCents + cleaningFeeCents + extraGuestCents;

  const securityDepositCents = assertCents(cfg.securityDepositCents, "securityDeposit");
  const grandTotalWithDepositCents = totalCents + (cfg.chargeDepositUpfront ? securityDepositCents : 0);

  // pagamento agora vs restante
  const mode = cfg.payment.mode;
  let payNowCents: Cents;
  if (mode === "signal") {
    payNowCents = applyPercent(totalCents, cfg.payment.signalPercent);
  } else {
    payNowCents = grandTotalWithDepositCents;
  }
  if (cfg.chargeDepositUpfront && mode === "signal") {
    payNowCents += securityDepositCents;
  }
  const remainingCents = grandTotalWithDepositCents - payNowCents;

  // validações (não lançam — sinalizam)
  const issues: PricingIssue[] = [];
  if (n < cfg.minNights) issues.push({ code: "MIN_NIGHTS", message: `Estadia mínima de ${cfg.minNights} noites.` });
  if (cfg.maxNights && n > cfg.maxNights) issues.push({ code: "MAX_NIGHTS", message: `Estadia máxima de ${cfg.maxNights} noites.` });
  if (totalGuests > cfg.maxGuests) issues.push({ code: "MAX_GUESTS", message: `Capacidade máxima de ${cfg.maxGuests} hóspedes.` });
  if (totalCents < cfg.minReservationCents) issues.push({ code: "MIN_VALUE", message: `Valor mínimo de reserva não atingido.` });
  for (const p of touchedPeriods.values()) {
    if (p.minNights && n < p.minNights) {
      issues.push({ code: "PERIOD_MIN_NIGHTS", message: `${p.name} exige mínimo de ${p.minNights} noites.` });
    }
  }

  return {
    currency: "BRL",
    checkIn,
    checkOut,
    nights: n,
    guests: { adults, children, total: totalGuests },
    nightly,
    nightlyGroups,
    accommodationCents,
    discount: { percent: disc.percent, cents: discountCents, reason: disc.reason },
    cleaningFeeCents,
    extraGuest: { extraGuests, cents: extraGuestCents },
    securityDepositCents,
    totalCents,
    grandTotalWithDepositCents,
    payNowCents,
    remainingCents,
    paymentMode: mode,
    issues,
  };
}

export function isBookable(q: Quote): boolean {
  return q.issues.length === 0;
}
