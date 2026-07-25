import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { syncAirbnbIcal } from "../../src/services/ical-sync.js";
import { json, methodGuard } from "./_shared.js";

/** Força a sincronização do calendário do Airbnb (AIRBNB_ICAL_URL, só backend). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  if (!cfg.airbnbIcalUrl) {
    return json({ error: "AIRBNB_ICAL_URL não configurada. Cole o link 'Exportar calendário' do Airbnb no ambiente." }, 400);
  }
  const r = await syncAirbnbIcal(repo, cfg.airbnbIcalUrl, { force: true });
  return json(r, r.ok ? 200 : 502);
};
