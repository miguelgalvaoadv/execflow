/**
 * Geração do calendário .ics exportado pelo site (para o Airbnb importar).
 * PRIVACIDADE: inclui apenas id técnico, datas e "indisponível". NENHUM dado
 * pessoal (nome, CPF, e-mail, telefone, valor, pagamento, endereço).
 *
 * Datas de dia inteiro (VALUE=DATE), ocupação semiaberta [checkIn, checkOut).
 */
import type { LocalDate } from "../domain/dates.js";

export interface BusyExport {
  uid: string; // UID estável (ex.: reservation id / block id)
  checkIn: LocalDate;
  checkOut: LocalDate; // exclusivo
  kind: "reservation" | "manual_block";
}

const PRODID = "-//Cabana Afrodite//Reservas//PT-BR";

function toIcsDate(d: LocalDate): string {
  return d.replace(/-/g, "");
}

function dtstamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escapa texto conforme RFC 5545 (vírgula, ponto e vírgula, barra, quebra). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Dobra linhas em 75 octetos (aprox. por caractere) conforme RFC 5545. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

export function generateIcs(events: BusyExport[], now: Date = new Date()): string {
  const stamp = dtstamp(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Cabana Afrodite — Indisponibilidade",
  ];
  for (const e of events) {
    if (!(e.checkIn < e.checkOut)) continue; // ignora períodos inválidos
    const label = e.kind === "manual_block" ? "Indisponível (bloqueio)" : "Indisponível (reservado)";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${esc(e.uid)}@cabana-afrodite`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(e.checkIn)}`,
      `DTEND;VALUE=DATE:${toIcsDate(e.checkOut)}`,
      `SUMMARY:${esc(label)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
