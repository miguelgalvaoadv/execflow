import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard } from "./_shared.js";

/** Histórico de mudanças de status de uma reserva (auditoria). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const token = new URL(req.url).searchParams.get("token") || "";
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  return json({ code: r.friendlyCode, status: r.status, history: await repo.listStatusHistory(r.id) });
};
