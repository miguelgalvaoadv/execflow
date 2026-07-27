import { getContext } from "../../src/runtime/context.js";
import { NotFoundError } from "../../src/services/reservation-service.js";
import { InvalidTransitionError } from "../../src/domain/reservation-state.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/** Cancela uma reserva. Reembolso real permanece manual (Mercado Pago). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const body = await readJson<{ token?: string; reason?: string; refundCents?: number; refundNote?: string }>(req);
  const token = str(body?.token, 200);
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  try {
    const out = await service.cancelReservation(r.id, auth.email, {
      reason: str(body?.reason, 500) || undefined,
      refundCents: typeof body?.refundCents === "number" && body.refundCents >= 0 ? Math.trunc(body.refundCents) : undefined,
      refundNote: str(body?.refundNote, 500) || undefined,
    });
    return json(out);
  } catch (e) {
    if (e instanceof InvalidTransitionError) return json({ error: `Não é possível cancelar uma reserva com status ${r.status}.` }, 422);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    return json({ error: (e as Error).message }, 400);
  }
};
