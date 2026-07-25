import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseIcs, icsToBusyPeriods } from "../src/ical/parse.js";

const sample = readFileSync(new URL("./fixtures/airbnb-sample.ics", import.meta.url), "utf8");
const empty = readFileSync(new URL("./fixtures/empty.ics", import.meta.url), "utf8");

function byUid(ics: string) {
  const map = new Map<string, ReturnType<typeof parseIcs>[number]>();
  for (const e of parseIcs(ics)) map.set(e.uid, e);
  return map;
}

describe("ical parse", () => {
  it("calendário vazio => nenhum evento", () => {
    expect(parseIcs(empty)).toEqual([]);
  });

  it("dedup por UID (duplicados e alterados)", () => {
    const events = parseIcs(sample);
    const uids = events.map((e) => e.uid);
    // 10 UIDs únicos
    expect(new Set(uids).size).toBe(uids.length);
    expect(new Set(uids).size).toBe(10);
  });

  it("reserva comum de dia inteiro (semiaberto)", () => {
    const e = byUid(sample).get("reserva-comum-1@airbnb")!;
    expect(e.checkIn).toBe("2026-08-10");
    expect(e.checkOut).toBe("2026-08-13");
  });

  it("evento cancelado é marcado e excluído dos períodos ocupados", () => {
    const e = byUid(sample).get("cancelado-1@airbnb")!;
    expect(e.cancelled).toBe(true);
    const busy = icsToBusyPeriods(sample);
    expect(busy.find((b) => b.ref === "cancelado-1@airbnb")).toBeUndefined();
  });

  it("DATE-TIME UTC convertido para data de São Paulo", () => {
    const e = byUid(sample).get("datetime-utc-1@airbnb")!;
    expect(e.checkIn).toBe("2026-07-01");
    expect(e.checkOut).toBe("2026-07-03");
  });

  it("DATE-TIME em fuso diferente convertido corretamente", () => {
    const e = byUid(sample).get("datetime-tz-1@airbnb")!;
    expect(e.checkIn).toBe("2026-06-10");
    expect(e.checkOut).toBe("2026-06-12");
  });

  it("dia inteiro sem DTEND => 1 noite", () => {
    const e = byUid(sample).get("sem-dtend-1@airbnb")!;
    expect(e.checkIn).toBe("2026-10-05");
    expect(e.checkOut).toBe("2026-10-06");
  });

  it("evento alterado: maior SEQUENCE vence", () => {
    const e = byUid(sample).get("alterado-1@airbnb")!;
    expect(e.checkIn).toBe("2026-11-10");
    expect(e.checkOut).toBe("2026-11-12");
  });

  it("períodos consecutivos preservam datas (checkout==checkin)", () => {
    const m = byUid(sample);
    expect(m.get("consecutivo-a@airbnb")!.checkOut).toBe("2026-09-03");
    expect(m.get("consecutivo-b@airbnb")!.checkIn).toBe("2026-09-03");
  });

  it("gera períodos ocupados corretos (exclui cancelados)", () => {
    const busy = icsToBusyPeriods(sample);
    expect(busy).toHaveLength(9); // 10 únicos - 1 cancelado
    expect(busy.every((b) => b.source === "ical_airbnb")).toBe(true);
  });
});
