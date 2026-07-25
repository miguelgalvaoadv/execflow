/**
 * Datas de estadia como CALENDÁRIO puro (YYYY-MM-DD), sem horário.
 *
 * Regra de ocupação: intervalo SEMIABERTO [check_in, check_out).
 * O dia de check-out pode ser check-in de outra reserva (salvo buffer de preparação).
 *
 * Para contar noites e comparar datas evitamos os erros clássicos de fuso/DST
 * ancorando cada data ao MEIO-DIA UTC — assim nenhuma conversão cruza a virada
 * do dia, independentemente do fuso (America/Sao_Paulo hoje não tem horário de
 * verão, mas o código é robusto a isso).
 */

export type LocalDate = string; // "YYYY-MM-DD"

export const TIMEZONE = "America/Sao_Paulo";

const RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string" || !RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function assertLocalDate(s: unknown): LocalDate {
  if (!isValidLocalDate(s)) throw new RangeError(`Data inválida (esperado YYYY-MM-DD): ${String(s)}`);
  return s;
}

/** Âncora ao meio-dia UTC (estável para diferença de dias). */
export function toUtcNoon(d: LocalDate): Date {
  const [y, m, day] = assertLocalDate(d).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0, 0));
}

const DAY_MS = 86_400_000;

/** Número de noites entre check-in e check-out (semiaberto). Deve ser > 0. */
export function nights(checkIn: LocalDate, checkOut: LocalDate): number {
  const a = toUtcNoon(checkIn).getTime();
  const b = toUtcNoon(checkOut).getTime();
  return Math.round((b - a) / DAY_MS);
}

/** Soma (ou subtrai) dias a uma data de calendário. */
export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(toUtcNoon(d).getTime() + days * DAY_MS);
  return fromUtcParts(t);
}

function fromUtcParts(t: Date): LocalDate {
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 0=domingo ... 6=sábado, no calendário local da data. */
export function weekday(d: LocalDate): number {
  return toUtcNoon(d).getUTCDay();
}

/** Lista de datas de NOITE ocupadas por [checkIn, checkOut): exclui o checkout. */
export function nightsInRange(checkIn: LocalDate, checkOut: LocalDate): LocalDate[] {
  const n = nights(checkIn, checkOut);
  if (n <= 0) return [];
  const out: LocalDate[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(checkIn, i));
  return out;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return toUtcNoon(a).getTime() - toUtcNoon(b).getTime();
}

/**
 * Sobreposição de dois intervalos semiabertos [aIn,aOut) e [bIn,bOut).
 * Check-out == check-in do outro NÃO sobrepõe (permitido encostar).
 */
export function rangesOverlap(aIn: LocalDate, aOut: LocalDate, bIn: LocalDate, bOut: LocalDate): boolean {
  return compareDates(aIn, bOut) < 0 && compareDates(bIn, aOut) < 0;
}

export function todayLocal(now: Date = new Date()): LocalDate {
  // Extrai a data-calendário em America/Sao_Paulo de forma robusta.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // en-CA => YYYY-MM-DD
}
