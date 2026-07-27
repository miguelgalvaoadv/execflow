import type { Config } from "@netlify/functions";
import { getContext } from "../../src/runtime/context.js";

/**
 * Manutenção horária das reservas (Netlify Scheduled Function):
 *  1. expira reservas aprovadas e não pagas dentro do prazo — LIBERANDO as datas
 *     (sem isto, uma reserva não paga bloquearia o calendário para sempre);
 *  2. envia lembretes de pagamento (prazo perto de vencer) e de check-in.
 *
 * Reservas com pagamento aprovado NUNCA expiram (proteção em expireOverdue).
 * No-op em modo mock.
 */
export default async (): Promise<Response> => {
  const { cfg, service } = getContext();
  if (cfg.mode === "mock") {
    return new Response(JSON.stringify({ skipped: true, reason: "mock" }), { status: 200 });
  }
  const expired = await service.expireOverdue();
  const reminders = await service.sendDueReminders();
  return new Response(JSON.stringify({ expired: expired.length, reminders }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  schedule: "0 * * * *",
};
