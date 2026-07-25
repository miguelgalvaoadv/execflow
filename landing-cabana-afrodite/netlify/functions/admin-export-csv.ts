import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { methodGuard, json } from "./_shared.js";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const rows = await repo.listReservations();
  const header = ["codigo", "status", "check_in", "check_out", "adultos", "criancas", "total_brl", "pago_agora_brl", "hospede", "email", "telefone", "criada_em"];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push([
      r.friendlyCode, r.status, r.checkIn, r.checkOut, r.adults, r.children,
      (r.totalCents / 100).toFixed(2), (r.payNowCents / 100).toFixed(2),
      r.guest.fullName, r.guest.email, r.guest.phone ?? "", r.createdAt,
    ].map(csvCell).join(";"));
  }
  const csv = "﻿" + lines.join("\r\n"); // BOM p/ Excel PT-BR
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reservas-cabana-afrodite.csv"`,
    },
  });
};
