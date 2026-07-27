import { getContext } from "../../src/runtime/context.js";
import { ValidationError, NotFoundError, SyncStaleError } from "../../src/services/reservation-service.js";
import { PaymentNotConfiguredError } from "../../src/payments/mercadopago.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/** Regera e reenvia o link de pagamento de uma reserva aprovada. */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const token = str((await readJson<{ token?: string }>(req))?.token, 200);
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  try {
    const pref = await service.createPaymentPreference(r.id);
    await repo.logAudit({ actor: auth.email, action: "payment_link.resend", entity: "reservations", entityId: r.id });
    return json({ initPoint: pref.initPoint, sentTo: r.guest.email });
  } catch (e) {
    if (e instanceof PaymentNotConfiguredError) return json({ error: "Mercado Pago ainda não configurado neste ambiente.", code: "PAYMENT_NOT_CONFIGURED" }, 503);
    if (e instanceof SyncStaleError) return json({ error: e.message, code: "ICAL_STALE" }, 423);
    if (e instanceof ValidationError) return json({ error: e.message }, 422);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    return json({ error: "Não foi possível gerar o link." }, 500);
  }
};
