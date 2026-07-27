import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard } from "./_shared.js";

/** Lista bloqueios manuais ativos + períodos ocupados (para o calendário do painel). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const [blocks, busy] = await Promise.all([repo.listManualBlocks(), repo.listBusyPeriods()]);
  return json({ blocks, busy });
};
