import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard } from "./_shared.js";

/** Lista as transações de pagamento registradas (auditoria financeira). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 50)));
  return json({ payments: await repo.listPaymentTransactions(limit) });
};
