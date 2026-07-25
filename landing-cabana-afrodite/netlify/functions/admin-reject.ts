import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const body = await readJson<{ token?: string; reason?: string }>(req);
  const token = str(body?.token, 200);
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  try {
    await service.rejectReservation(r.id, auth.email, str(body?.reason, 500) || undefined);
    return json({ status: "rejected" });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};
