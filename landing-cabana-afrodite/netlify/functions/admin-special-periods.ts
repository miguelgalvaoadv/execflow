import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { isValidLocalDate, compareDates } from "../../src/domain/dates.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/** GET lista · POST cria · DELETE remove períodos especiais / feriados. */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET", "POST", "DELETE"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  if (req.method === "GET") {
    return json({ periods: await repo.listSpecialPeriods() });
  }

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id") || str((await readJson<{ id?: string }>(req))?.id, 60);
    if (!id) return json({ error: "id ausente." }, 400);
    await repo.deleteSpecialPeriod(id);
    await repo.logAudit({ actor: auth.email, action: "special_period.delete", entity: "special_periods", entityId: id });
    return json({ ok: true });
  }

  const b = await readJson<{ name?: string; startDate?: string; endDate?: string; nightlyCents?: number; minNights?: number; discountPercent?: number }>(req);
  const name = str(b?.name, 120);
  if (!name) return json({ error: "Informe o nome do período." }, 422);
  if (!isValidLocalDate(b?.startDate) || !isValidLocalDate(b?.endDate)) return json({ error: "Datas inválidas (YYYY-MM-DD)." }, 422);
  if (compareDates(b!.startDate!, b!.endDate!) > 0) return json({ error: "A data final deve ser igual ou posterior à inicial." }, 422);

  const nightlyCents = b?.nightlyCents !== undefined ? Math.trunc(Number(b.nightlyCents)) : null;
  if (nightlyCents !== null && (!Number.isFinite(nightlyCents) || nightlyCents < 0)) return json({ error: "Tarifa inválida." }, 422);
  const minNights = b?.minNights !== undefined && b.minNights !== null ? Math.trunc(Number(b.minNights)) : null;
  const discountPercent = b?.discountPercent !== undefined && b.discountPercent !== null ? Number(b.discountPercent) : null;
  if (discountPercent !== null && (discountPercent < 0 || discountPercent > 100)) return json({ error: "Desconto deve estar entre 0 e 100." }, 422);

  const id = await repo.createSpecialPeriod({ name, startDate: b!.startDate!, endDate: b!.endDate!, nightlyCents, minNights, discountPercent });
  await repo.logAudit({ actor: auth.email, action: "special_period.create", entity: "special_periods", entityId: id, metadata: { name } });
  return json({ id }, 201);
};
