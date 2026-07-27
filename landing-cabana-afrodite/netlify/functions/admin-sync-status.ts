import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard } from "./_shared.js";

/**
 * Estado da sincronização com o Airbnb: última sync bem-sucedida, logs recentes
 * (inclusive erros) e se a URL do iCal está configurada.
 * NUNCA devolve o valor de AIRBNB_ICAL_URL — apenas um booleano.
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const [lastSyncAt, logs] = await Promise.all([repo.lastIcalSyncAt(), repo.listIcalSyncLogs(20)]);
  const maxStalenessMinutes = Math.round(cfg.icalMaxStalenessMs / 60_000);
  const stale = !lastSyncAt || Date.now() - lastSyncAt.getTime() > cfg.icalMaxStalenessMs;

  return json({
    airbnbConfigured: Boolean(cfg.airbnbIcalUrl),
    lastSuccessfulSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
    stale: Boolean(cfg.airbnbIcalUrl) && stale,
    maxStalenessMinutes,
    logs,
  });
};
