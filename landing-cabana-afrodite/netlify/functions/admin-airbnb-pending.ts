import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/**
 * Reservas confirmadas que ainda precisam ser bloqueadas manualmente no Airbnb.
 * GET lista · POST { code } marca como já bloqueada.
 * (O Airbnb pode demorar horas para reimportar o .ics — esta é a proteção contra
 * dupla reserva nesse intervalo.)
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET", "POST"]);
  if (guard) return guard;
  const { cfg, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  if (req.method === "POST") {
    const code = str((await readJson<{ code?: string }>(req))?.code, 40);
    if (!code) return json({ error: "code ausente." }, 400);
    return json({ pending: await service.clearPendingAirbnbBlock(code, auth.email) });
  }
  return json({ pending: await service.listPendingAirbnbBlocks() });
};
