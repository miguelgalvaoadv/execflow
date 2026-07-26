import { getContext } from "../../src/runtime/context.js";
import { json, methodGuard, readJson, rateLimit, clientIp, str } from "./_shared.js";

/**
 * Reconciliação: o hóspede volta do checkout e o front chama esta rota. O backend
 * consulta o Mercado Pago pelo external_reference e confirma a reserva se o
 * pagamento estiver aprovado (mesma validação do webhook). Rede de segurança
 * caso o webhook não chegue. Aceita GET e POST com ?token= / {token}.
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST", "GET"]);
  if (guard) return guard;
  if (!rateLimit(`reconcile:${clientIp(req)}`, 20, 60_000)) return json({ error: "Muitas requisições." }, 429);

  let token = new URL(req.url).searchParams.get("token") || "";
  if (!token && req.method === "POST") token = str((await readJson<{ token?: string }>(req))?.token, 200);
  if (!token) return json({ error: "Token ausente." }, 400);

  try {
    const { service } = getContext();
    const r = await service.reconcileReservation(token);
    if (!r.reservation) return json({ error: "Reserva não encontrada." }, 404);
    return json({ status: r.status });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
