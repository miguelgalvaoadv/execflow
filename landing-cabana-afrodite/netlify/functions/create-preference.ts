import { getContext } from "../../src/runtime/context.js";
import { ValidationError, NotFoundError, SyncStaleError } from "../../src/services/reservation-service.js";
import { json, methodGuard, readJson, rateLimit, clientIp, str } from "./_shared.js";

/** Gera o link de pagamento (Checkout Pro) para uma reserva já aprovada. */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  if (!rateLimit(`pref:${clientIp(req)}`, 15, 60_000)) return json({ error: "Muitas requisições." }, 429);

  const body = await readJson<{ token?: string }>(req);
  const token = str(body?.token, 200);
  if (!token) return json({ error: "Token ausente." }, 400);

  try {
    const { repo, service } = getContext();
    const r = await repo.getReservationByToken(token);
    if (!r) return json({ error: "Reserva não encontrada." }, 404);
    const pref = await service.createPaymentPreference(r.id);
    return json({ initPoint: pref.initPoint });
  } catch (e) {
    if (e instanceof SyncStaleError) {
      return json({ error: "Estamos confirmando a disponibilidade com o calendário. Tente novamente em instantes ou fale com o anfitrião.", code: "ICAL_STALE" }, 423);
    }
    if (e instanceof ValidationError) return json({ error: e.message }, 422);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    return json({ error: "Não foi possível gerar o pagamento." }, 500);
  }
};
