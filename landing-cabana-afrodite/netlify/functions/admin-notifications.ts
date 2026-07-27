import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard } from "./_shared.js";

/** Mensagens disparadas pelo sistema: o que saiu, o que falhou, o que ficou sem template. */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const limit = Math.min(300, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 100)));
  return json({ notifications: await repo.listNotifications(limit) });
};
