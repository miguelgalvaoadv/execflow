import type { Config } from "@netlify/functions";
import { getContext } from "../../src/runtime/context.js";
import { syncAirbnbIcal } from "../../src/services/ical-sync.js";

/**
 * Sincronização periódica do calendário do Airbnb (Netlify Scheduled Function).
 * Cadência padrão: a cada 30 minutos. Ajuste em `config.schedule` (cron).
 * No-op se AIRBNB_ICAL_URL não estiver configurada ou em modo mock.
 */
export default async (): Promise<Response> => {
  const { cfg, repo } = getContext();
  if (cfg.mode === "mock" || !cfg.airbnbIcalUrl) {
    return new Response(JSON.stringify({ skipped: true, reason: "mock-or-no-url" }), { status: 200 });
  }
  const r = await syncAirbnbIcal(repo, cfg.airbnbIcalUrl, { force: true });
  return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  schedule: "*/30 * * * *",
};
