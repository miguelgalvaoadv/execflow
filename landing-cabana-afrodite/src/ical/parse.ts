/**
 * Parser de iCalendar (RFC 5545) focado no que o Airbnb exporta: períodos
 * indisponíveis. NÃO importa preços, taxas ou regras — apenas datas ocupadas.
 *
 * Trata: desdobramento de linhas (folding), VEVENT, DTSTART/DTEND em
 * VALUE=DATE (dia inteiro), DATE-TIME com Z (UTC), TZID e horário flutuante,
 * STATUS:CANCELLED, DURATION, eventos sem DTEND, duplicados e alterados (por UID).
 *
 * Saída em datas de calendário (YYYY-MM-DD) no fuso alvo, com ocupação
 * semiaberta [checkIn, checkOut).
 */
import { TIMEZONE, addDays, type LocalDate } from "../domain/dates.js";
import type { BusyPeriod } from "../domain/availability.js";

export interface IcsEvent {
  uid: string;
  checkIn: LocalDate;
  checkOut: LocalDate;
  summary: string | null;
  cancelled: boolean;
  sequence: number;
}

interface RawLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Desdobra linhas continuadas (começam com espaço/tab) e as parseia. */
function unfoldAndSplit(ics: string): RawLine[] {
  const physical = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (line === "") continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical.map(parseLine).filter((l): l is RawLine => l !== null);
}

function parseLine(line: string): RawLine | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  const name = (parts[0] ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const [k, v] = parts[i]!.split("=");
    if (k) params[k.toUpperCase()] = v ?? "";
  }
  return { name, params, value };
}

/** Instante UTC de uma parede horária em um fuso arbitrário. */
function zonedWallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(guess))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  let hh = p.hour ?? 0;
  if (hh === 24) hh = 0;
  const shown = Date.UTC(p.year!, (p.month! - 1), p.day!, hh, p.minute!, p.second!);
  const offset = shown - guess;
  return new Date(guess - offset);
}

/** Data de calendário (YYYY-MM-DD) de um instante no fuso alvo. */
function localDateInTz(instant: Date, tz: string): LocalDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

interface ParsedDate {
  localDate: LocalDate;
  allDay: boolean;
}

function parseIcsDate(value: string, params: Record<string, string>, tz: string): ParsedDate | null {
  const v = value.trim();
  // Dia inteiro: VALUE=DATE ou 8 dígitos
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    return { localDate: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  }
  // DATE-TIME
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, Z] = m;
  const y = Number(Y), mo = Number(Mo), d = Number(D), h = Number(H), mi = Number(Mi), s = Number(S);
  if (Z === "Z") {
    return { localDate: localDateInTz(new Date(Date.UTC(y, mo - 1, d, h, mi, s)), tz), allDay: false };
  }
  if (params.TZID && params.TZID !== tz) {
    const utc = zonedWallToUtc(y, mo, d, h, mi, s, params.TZID);
    return { localDate: localDateInTz(utc, tz), allDay: false };
  }
  // TZID == alvo ou flutuante: a parede já está no fuso alvo
  return { localDate: `${Y}-${Mo}-${D}`, allDay: false };
}

function parseDuration(dur: string): number | null {
  // Suporta P#D / P#W / PT#H (para janelas de dias). Retorna dias (arredonda p/ cima).
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur.trim());
  if (!m) return null;
  const weeks = Number(m[1] ?? 0), days = Number(m[2] ?? 0), hours = Number(m[3] ?? 0);
  const totalDays = weeks * 7 + days + (hours > 0 ? 1 : 0);
  return totalDays > 0 ? totalDays : 1;
}

/** Parseia todos os VEVENT em eventos com datas de calendário. */
export function parseIcs(ics: string, tz: string = TIMEZONE): IcsEvent[] {
  const lines = unfoldAndSplit(ics);
  const events: IcsEvent[] = [];
  let cur: Partial<{ uid: string; start: ParsedDate; end: ParsedDate; duration: string; summary: string; status: string; sequence: number }> | null = null;

  for (const l of lines) {
    if (l.name === "BEGIN" && l.value.trim().toUpperCase() === "VEVENT") { cur = {}; continue; }
    if (l.name === "END" && l.value.trim().toUpperCase() === "VEVENT") {
      if (cur && cur.uid && cur.start) {
        const startD = cur.start;
        let checkOut: LocalDate;
        if (cur.end) checkOut = cur.end.localDate;
        else if (cur.duration) {
          const days = parseDuration(cur.duration) ?? 1;
          checkOut = addDays(startD.localDate, days);
        } else {
          checkOut = addDays(startD.localDate, 1); // dia inteiro sem DTEND => 1 noite
        }
        events.push({
          uid: cur.uid,
          checkIn: startD.localDate,
          checkOut,
          summary: cur.summary ?? null,
          cancelled: (cur.status ?? "").toUpperCase() === "CANCELLED",
          sequence: cur.sequence ?? 0,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    switch (l.name) {
      case "UID": cur.uid = l.value.trim(); break;
      case "DTSTART": { const p = parseIcsDate(l.value, l.params, tz); if (p) cur.start = p; break; }
      case "DTEND": { const p = parseIcsDate(l.value, l.params, tz); if (p) cur.end = p; break; }
      case "DURATION": cur.duration = l.value.trim(); break;
      case "SUMMARY": cur.summary = l.value.trim(); break;
      case "STATUS": cur.status = l.value.trim(); break;
      case "SEQUENCE": cur.sequence = Number(l.value.trim()) || 0; break;
    }
  }

  // Dedup por UID: mantém a maior SEQUENCE (evento "alterado" vence), senão o último.
  const byUid = new Map<string, IcsEvent>();
  for (const e of events) {
    const prev = byUid.get(e.uid);
    if (!prev || e.sequence >= prev.sequence) byUid.set(e.uid, e);
  }
  return [...byUid.values()];
}

/** Converte um iCal em períodos ocupados (exclui cancelados e sem noites). */
export function icsToBusyPeriods(ics: string, tz: string = TIMEZONE): BusyPeriod[] {
  return parseIcs(ics, tz)
    .filter((e) => !e.cancelled && e.checkIn < e.checkOut)
    .map((e) => ({ checkIn: e.checkIn, checkOut: e.checkOut, source: "ical_airbnb" as const, ref: e.uid }));
}
