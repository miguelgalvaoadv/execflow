import { getContext } from "../../src/runtime/context.js";
import { icsToBusyPeriods } from "../../src/ical/parse.js";
import { json, methodGuard, requireAdmin } from "./_shared.js";

/** Força a sincronização do calendário do Airbnb (AIRBNB_ICAL_URL, só backend). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = requireAdmin(req, cfg.admin.sessionSecret);
  if (auth instanceof Response) return auth;

  if (!cfg.airbnbIcalUrl) {
    return json({ error: "AIRBNB_ICAL_URL não configurada. Cole o link 'Exportar calendário' do Airbnb no ambiente." }, 400);
  }

  const started = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(cfg.airbnbIcalUrl, { signal: ctrl.signal, headers: { "user-agent": "CabanaAfrodite/1.0" } });
    if (!res.ok) throw new Error(`Airbnb respondeu ${res.status}`);
    const text = await res.text();
    const busy = icsToBusyPeriods(text);
    await repo.replaceIcalEvents(busy, cfg.airbnbIcalUrl);
    const durationMs = Date.now() - started;
    await repo.logIcalSync({ success: true, eventsFound: busy.length, periodsImported: busy.length, durationMs, sourceUrl: cfg.airbnbIcalUrl });
    return json({ ok: true, periodsImported: busy.length, durationMs });
  } catch (e) {
    const durationMs = Date.now() - started;
    await repo.logIcalSync({ success: false, eventsFound: 0, periodsImported: 0, durationMs, error: (e as Error).message, sourceUrl: cfg.airbnbIcalUrl });
    return json({ ok: false, error: (e as Error).message }, 502);
  } finally {
    clearTimeout(timeout);
  }
};
