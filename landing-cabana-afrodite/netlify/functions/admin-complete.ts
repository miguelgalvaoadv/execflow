import { getContext } from "../../src/runtime/context.js";
import { NotFoundError } from "../../src/services/reservation-service.js";
import { InvalidTransitionError } from "../../src/domain/reservation-state.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/** Marca uma reserva confirmada como concluída (após a estadia). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const body = await readJson<{ token?: string; note?: string }>(req);
  const token = str(body?.token, 200);
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  try {
    return json(await service.completeReservation(r.id, auth.email, str(body?.note, 500) || undefined));
  } catch (e) {
    if (e instanceof InvalidTransitionError) return json({ error: `Só é possível concluir uma reserva confirmada (atual: ${r.status}).` }, 422);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    return json({ error: (e as Error).message }, 400);
  }
};
