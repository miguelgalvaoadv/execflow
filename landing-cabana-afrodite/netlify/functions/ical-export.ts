import { getContext } from "../../src/runtime/context.js";
import { generateIcs, type BusyExport } from "../../src/ical/generate.js";
import { timingSafeEqual } from "node:crypto";

/** /api/calendar/reservations-<TOKEN>.ics — só reservas confirmadas/pagas + bloqueios. */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return new Response("Método não permitido", { status: 405 });

  const { cfg, repo } = getContext();
  // aceita com ou sem a extensão .ics (o redirect do Netlify pode removê-la)
  const file = (new URL(req.url).searchParams.get("file") || "").replace(/\.ics$/i, "");
  const m = /^reservations-(.+)$/.exec(file);
  const token = m?.[1] ?? "";

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
      "content-disposition": `inline; filename="${file}"`,
      "cache-control": "public, max-age=300",
    },
  });
};
