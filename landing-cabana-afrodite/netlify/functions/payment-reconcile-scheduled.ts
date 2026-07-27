import type { Config } from "@netlify/functions";
import { getContext } from "../../src/runtime/context.js";

/**
 * Reconciliação agendada de pagamentos (Netlify Scheduled Function).
 * A cada 15 min, consulta o Mercado Pago para reservas ainda aguardando pagamento
 * e confirma as que já foram pagas — mesmo que o webhook não tenha chegado e o
 * hóspede não tenha voltado ao site. No-op em mock.
 */
export default async (): Promise<Response> => {
  const { cfg, service } = getContext();
  if (cfg.mode === "mock") {
    return new Response(JSON.stringify({ skipped: true, reason: "mock" }), { status: 200 });
  }
  const results = await service.reconcileAllPending();
  return new Response(JSON.stringify({ reconciled: results.length, results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
