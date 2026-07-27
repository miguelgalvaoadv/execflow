import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { newIcalExportToken } from "../../src/domain/tokens.js";
import { json, methodGuard } from "./_shared.js";

/**
 * GET: devolve a URL atual do calendário .ics (para colar no Airbnb).
 * POST: regenera o token — a URL antiga deixa de funcionar imediatamente e
 * precisa ser reimportada no Airbnb.
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET", "POST"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  if (req.method === "POST") {
    const token = newIcalExportToken();
    await repo.setIcalExportToken(token);
    await repo.logAudit({ actor: auth.email, action: "ical_token.regenerate", entity: "settings", entityId: "ical_export_token" });
    return json({ url: `${cfg.siteUrl}/api/calendar/reservations-${token}.ics`, regenerated: true });
  }

  const stored = await repo.getIcalExportToken();
  const token = stored ?? cfg.icalExportToken;
  return json({ url: `${cfg.siteUrl}/api/calendar/reservations-${token}.ics`, source: stored ? "database" : "env" });
};
