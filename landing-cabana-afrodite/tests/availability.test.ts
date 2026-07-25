import { describe, it, expect } from "vitest";
import { findConflicts, isAvailable, type BusyPeriod } from "../src/domain/availability.js";

const busy: BusyPeriod[] = [
  { checkIn: "2026-08-10", checkOut: "2026-08-13", source: "reservation", ref: "r1" },
  { checkIn: "2026-08-20", checkOut: "2026-08-22", source: "manual_block", ref: "b1" },
  { checkIn: "2026-09-01", checkOut: "2026-09-05", source: "ical_airbnb", ref: "i1" },
];

describe("availability", () => {
  it("detecta sobreposição direta", () => {
    expect(isAvailable({ checkIn: "2026-08-11", checkOut: "2026-08-12" }, busy)).toBe(false);
    expect(findConflicts({ checkIn: "2026-08-11", checkOut: "2026-08-12" }, busy)).toHaveLength(1);
  });

  it("check-in no dia do check-out de outra é permitido (buffer 0)", () => {
    expect(isAvailable({ checkIn: "2026-08-13", checkOut: "2026-08-15" }, busy)).toBe(true);
  });

  it("check-out no dia do check-in de outra é permitido (encostar)", () => {
    expect(isAvailable({ checkIn: "2026-08-08", checkOut: "2026-08-10" }, busy)).toBe(true);
  });

  it("buffer de preparação bloqueia encostar", () => {
    expect(isAvailable({ checkIn: "2026-08-13", checkOut: "2026-08-15" }, busy, 1)).toBe(false);
  });

  it("período totalmente livre está disponível", () => {
    expect(isAvailable({ checkIn: "2026-10-01", checkOut: "2026-10-04" }, busy)).toBe(true);
  });

  it("candidato que engloba um período ocupado conflita", () => {
    expect(isAvailable({ checkIn: "2026-08-19", checkOut: "2026-08-23" }, busy)).toBe(false);
  });
});
