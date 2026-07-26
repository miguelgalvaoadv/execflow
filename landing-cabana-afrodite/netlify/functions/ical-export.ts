import { getContext } from "../../src/runtime/context.js";
import { generateIcs, type BusyExport } from "../../src/ical/generate.js";
import { timingSafeEqual } from "node:crypto";

/** /api/calendar/reservations-<TOKEN>.ics — só reservas confirmadas/pagas + bloqueios. */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return new Response("Método não permitido", { status: 405 });

  const { cfg, repo } = getContext();
  // Extrai o token do parâmetro `file` OU direto do caminho da URL
  // (/api/calendar/reservations-<token>.ics) — robusto ao redirect do Netlify.
  const url = new URL(req.url);
  const extract = (s: string | null): string => {
    const c = (s || "").replace(/\.ics$/i, "");
    const m = /reservations-([^/]+)$/.exec(c);
    return m?.[1] ?? "";
  };
  const token = (url.searchParams.get("token") || "") || extract(url.searchParams.get("file")) || extract(url.pathname);

  const expected = cfg.icalExportToken;
  const a = Buffer.from(token), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Não encontrado", { status: 404 });
  }

  const confirmed = await repo.listReservations({ status: "confirmed" });
  const paid = await repo.listReservations({ status: "paid" });
  const busy = await repo.listBusyPeriods();

  const events: BusyExport[] = [
    ...[...confirmed, ...paid].map((r) => ({ uid: r.id, checkIn: r.checkIn, checkOut: r.checkOut, kind: "reservation" as const })),
    ...busy.filter((p) => p.source === "manual_block").map((p) => ({ uid: p.ref ?? `${p.checkIn}_${p.checkOut}`, checkIn: p.checkIn, checkOut: p.checkOut, kind: "manual_block" as const })),
  ];

  const ics = generateIcs(events);
  return new Response(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="reservations-${token}.ics"`,
      "cache-control": "public, max-age=300",
    },
  });
};
