import { describe, it, expect } from "vitest";
import {
  nights,
  addDays,
  weekday,
  rangesOverlap,
  nightsInRange,
  isValidLocalDate,
  todayLocal,
} from "../src/domain/dates.js";

describe("dates", () => {
  it("conta noites (semiaberto)", () => {
    expect(nights("2026-08-10", "2026-08-13")).toBe(3);
    expect(nights("2026-08-10", "2026-08-11")).toBe(1);
  });

  it("addDays atravessa mês e ano", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("weekday correto (0=domingo)", () => {
    expect(weekday("2026-08-09")).toBe(0); // domingo
    expect(weekday("2026-08-10")).toBe(1); // segunda
  });

  it("nightsInRange exclui o checkout", () => {
    expect(nightsInRange("2026-08-10", "2026-08-13")).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("checkout == checkin do outro NÃO sobrepõe", () => {
    expect(rangesOverlap("2026-09-01", "2026-09-03", "2026-09-03", "2026-09-05")).toBe(false);
  });

  it("sobreposição real é detectada", () => {
    expect(rangesOverlap("2026-09-01", "2026-09-04", "2026-09-03", "2026-09-05")).toBe(true);
  });

  it("valida formato de data", () => {
    expect(isValidLocalDate("2026-02-29")).toBe(false); // 2026 não é bissexto
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isValidLocalDate("2026-08-10")).toBe(true);
    expect(isValidLocalDate("10/08/2026")).toBe(false);
  });

  it("todayLocal retorna YYYY-MM-DD no fuso de São Paulo", () => {
    // 2026-01-01 00:30 UTC ainda é 2025-12-31 em São Paulo (UTC-3)
    expect(todayLocal(new Date("2026-01-01T00:30:00Z"))).toBe("2025-12-31");
  });
});
