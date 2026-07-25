/**
 * Disponibilidade — detecção de conflitos entre um período candidato e os
 * períodos ocupados (reservas próprias confirmadas/pendentes-de-pagamento,
 * bloqueios manuais e eventos importados do iCal do Airbnb).
 *
 * Ocupação em intervalo SEMIABERTO [check_in, check_out).
 * O "buffer de preparação" (prepBufferNights) exige N noites livres após um
 * check-out antes do próximo check-in. É aplicado expandindo o fim de cada
 * período (candidato e ocupados) para manter a simetria.
 */
import { addDays, rangesOverlap, assertLocalDate, type LocalDate } from "./dates.js";

export type BusySource = "reservation" | "manual_block" | "ical_airbnb";

export interface BusyPeriod {
  checkIn: LocalDate;
  checkOut: LocalDate;
  source: BusySource;
  ref?: string; // id da reserva/bloqueio/evento
}

export interface Candidate {
  checkIn: LocalDate;
  checkOut: LocalDate;
}

export interface Conflict {
  with: BusyPeriod;
}

export function findConflicts(candidate: Candidate, busy: BusyPeriod[], prepBufferNights = 0): Conflict[] {
  const cIn = assertLocalDate(candidate.checkIn);
  const cOutBuffered = addDays(assertLocalDate(candidate.checkOut), prepBufferNights);

  const conflicts: Conflict[] = [];
  for (const b of busy) {
    const bIn = assertLocalDate(b.checkIn);
    const bOutBuffered = addDays(assertLocalDate(b.checkOut), prepBufferNights);
    if (rangesOverlap(cIn, cOutBuffered, bIn, bOutBuffered)) {
      conflicts.push({ with: b });
    }
  }
  return conflicts;
}

export function isAvailable(candidate: Candidate, busy: BusyPeriod[], prepBufferNights = 0): boolean {
  return findConflicts(candidate, busy, prepBufferNights).length === 0;
}
