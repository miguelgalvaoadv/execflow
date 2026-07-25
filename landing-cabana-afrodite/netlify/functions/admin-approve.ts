import { getContext } from "../../src/runtime/context.js";
import { ConflictError } from "../../src/db/repository.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const token = str((await readJson<{ token?: string }>(req))?.token, 200);
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  try {
    const updated = await service.approveReservation(r.id, auth.email);
    return json({ status: updated.status, paymentExpiresAt: updated.paymentExpiresAt });
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: "Conflito de disponibilidade — verifique o calendário." }, 409);
    return json({ error: (e as Error).message }, 400);
  }
};
