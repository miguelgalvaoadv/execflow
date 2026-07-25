import { describe, it, expect } from "vitest";
import { generateIcs, type BusyExport } from "../src/ical/generate.js";
import { parseIcs } from "../src/ical/parse.js";

const events: BusyExport[] = [
  { uid: "res-abc", checkIn: "2026-08-10", checkOut: "2026-08-13", kind: "reservation" },
  { uid: "block-xyz", checkIn: "2026-08-20", checkOut: "2026-08-22", kind: "manual_block" },
];

describe("ical generate", () => {
  const ics = generateIcs(events, new Date("2026-07-25T12:00:00Z"));

  it("é um VCALENDAR válido com VEVENTs", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(ics.includes("\r\n")).toBe(true); // CRLF
  });

  it("usa datas de dia inteiro e UID estável", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20260810");
    expect(ics).toContain("DTEND;VALUE=DATE:20260813");
    expect(ics).toContain("UID:res-abc@cabana-afrodite");
  });

  it("PRIVACIDADE: não vaza nenhum dado pessoal", () => {
    const forbidden = ["@gmail", "CPF", "nome", "telefone", "R$", "email", "payment", "cartão"];
    for (const f of forbidden) expect(ics.toLowerCase()).not.toContain(f.toLowerCase());
  });

  it("é reimportável pelo próprio parser (round-trip)", () => {
    const parsed = parseIcs(ics);
    expect(parsed).toHaveLength(2);
    const res = parsed.find((e) => e.uid.startsWith("res-abc"))!;
    expect(res.checkIn).toBe("2026-08-10");
    expect(res.checkOut).toBe("2026-08-13");
  });

  it("ignora períodos inválidos (checkout <= checkin)", () => {
    const bad = generateIcs([{ uid: "x", checkIn: "2026-08-10", checkOut: "2026-08-10", kind: "reservation" }]);
    expect((bad.match(/BEGIN:VEVENT/g) || []).length).toBe(0);
  });
});
