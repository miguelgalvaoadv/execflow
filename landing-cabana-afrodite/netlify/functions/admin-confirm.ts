import { getContext } from "../../src/runtime/context.js";
import { ConflictError } from "../../src/db/repository.js";
import { SyncStaleError, ValidationError, NotFoundError } from "../../src/services/reservation-service.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/**
 * Confirmação MANUAL de reserva cujo pagamento foi recebido mas a confirmação
 * automática foi retida (falha de sincronização do iCal). Re-valida o pagamento,
 * exige iCal fresco OU override explícito (com justificativa registrada).
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo, service } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const body = await readJson<{ token?: string; overrideStaleIcal?: boolean; note?: string }>(req);
  const token = str(body?.token, 200);
  const r = token ? await repo.getReservationByToken(token) : null;
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  try {
    const updated = await service.confirmPaymentManually(r.id, auth.email, {
      overrideStaleIcal: body?.overrideStaleIcal === true,
      note: str(body?.note, 500) || undefined,
    });
    return json({ status: updated.status });
  } catch (e) {
    if (e instanceof SyncStaleError) return json({ error: e.message, code: "ICAL_STALE", requiresManual: true }, 423);
    if (e instanceof ConflictError) return json({ error: "Conflito de disponibilidade — confira o Airbnb.", code: "CONFLICT" }, 409);
    if (e instanceof ValidationError) return json({ error: e.message }, 422);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    return json({ error: "Não foi possível confirmar." }, 500);
  }
};
