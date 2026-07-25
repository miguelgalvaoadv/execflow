import { describe, it, expect, beforeEach } from "vitest";
import { resetContext } from "../src/runtime/context.js";

// Modo mock (memória + MP mock) antes de importar handlers.
process.env.APP_ENV = "mock";

import availability from "../netlify/functions/availability.js";
import createReservation from "../netlify/functions/create-reservation.js";
import getReservation from "../netlify/functions/get-reservation.js";
import icalExport from "../netlify/functions/ical-export.js";

function post(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" } });
}

beforeEach(() => resetContext());

describe("netlify functions (mock)", () => {
  it("availability retorna disponibilidade + preço", async () => {
    const res = await availability(post("http://x/api/availability", { checkIn: "2026-05-04", checkOut: "2026-05-06", adults: 2 }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.available).toBe(true);
    expect(data.quote.nights).toBe(2);
    expect(data.quote.totalCents).toBeGreaterThan(0);
  });

  it("rejeita datas inválidas", async () => {
    const res = await availability(post("http://x/api/availability", { checkIn: "04/05/2026", checkOut: "2026-05-06", adults: 2 }));
    expect(res.status).toBe(400);
  });

  it("cria reserva e permite acompanhar pelo token", async () => {
    resetContext();
    const created = await createReservation(post("http://x/api/reservations", {
      checkIn: "2026-06-10", checkOut: "2026-06-13", adults: 2,
      fullName: "Maria Teste", email: "maria@exemplo.com",
      acceptedRules: true, acceptedCancellation: true, acceptedPrivacy: true,
    }));
    // mesmo contexto (mesma instância em memória) por causa do cache
    expect(created.status).toBe(201);
    const body = (await created.json()) as any;
    expect(body.token).toBeTruthy();
    expect(body.status).toBe("pending_approval");

    const track = await getReservation(new Request(`http://x/api/reservations/${body.token}?token=${body.token}`, { headers: { "x-forwarded-for": "1.2.3.4" } }));
    expect(track.status).toBe(200);
    const t = (await track.json()) as any;
    expect(t.code).toBe(body.code);
    expect(t.status).toBe("pending_approval");
    // NÃO deve expor id interno nem e-mail completo além do necessário
    expect(t.id).toBeUndefined();
  });

  it("recusa aceite faltando", async () => {
    const res = await createReservation(post("http://x/api/reservations", {
      checkIn: "2026-06-10", checkOut: "2026-06-13", adults: 2,
      fullName: "Maria Teste", email: "maria@exemplo.com",
      acceptedRules: true, acceptedCancellation: false, acceptedPrivacy: true,
    }));
    expect(res.status).toBe(400);
  });

  it("ical-export exige token correto", async () => {
    const bad = await icalExport(new Request("http://x/api/calendar/reservations-ERRADO.ics?file=reservations-ERRADO.ics"));
    expect(bad.status).toBe(404);
    const ok = await icalExport(new Request("http://x/api/calendar/reservations-dev-token.ics?file=reservations-dev-token.ics"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/calendar");
  });
});
