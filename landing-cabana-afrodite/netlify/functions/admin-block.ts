import { getContext } from "../../src/runtime/context.js";
import { isValidLocalDate, nights } from "../../src/domain/dates.js";
import { json, methodGuard, readJson, requireAdmin, str } from "./_shared.js";

/** Cria ou remove bloqueios manuais de datas. */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = requireAdmin(req, cfg.admin.sessionSecret);
  if (auth instanceof Response) return auth;

  const body = await readJson<{ checkIn?: string; checkOut?: string; reason?: string; removeId?: string }>(req);

  if (body?.removeId) {
    await repo.removeManualBlock(str(body.removeId, 60));
    return json({ removed: true });
  }
  if (!isValidLocalDate(body?.checkIn) || !isValidLocalDate(body?.checkOut) || nights(body!.checkIn!, body!.checkOut!) <= 0) {
    return json({ error: "Período inválido." }, 400);
  }
  const id = await repo.addManualBlock({ checkIn: body!.checkIn!, checkOut: body!.checkOut!, reason: str(body?.reason, 200), createdBy: auth.email });
  return json({ id }, 201);
};
