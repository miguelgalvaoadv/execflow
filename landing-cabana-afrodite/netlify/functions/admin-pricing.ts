import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import type { PricingConfig } from "../../src/domain/pricing.js";
import { json, methodGuard, readJson } from "./_shared.js";

const INT_FIELDS = [
  "defaultNightlyCents", "cleaningFeeCents", "includedGuests", "extraGuestFeeCents",
  "maxGuests", "minNights", "maxNights", "minReservationCents", "securityDepositCents", "prepBufferNights",
] as const;

/** GET: regras de preço atuais · PUT: atualiza (valores em centavos, inteiros). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET", "PUT", "POST"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  if (req.method === "GET") {
    return json({ pricing: await repo.getActivePricingConfig() });
  }

  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return json({ error: "Corpo inválido." }, 400);

  const patch: Partial<PricingConfig> = {};
  for (const f of INT_FIELDS) {
    const v = body[f];
    if (v === undefined || v === null) continue;
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 0) return json({ error: `Valor inválido para ${f}.` }, 422);
    (patch as Record<string, unknown>)[f] = n;
  }
  if (body.extraGuestPer === "night" || body.extraGuestPer === "stay") patch.extraGuestPer = body.extraGuestPer;
  if (body.chargeDepositUpfront !== undefined) patch.chargeDepositUpfront = Boolean(body.chargeDepositUpfront);
  if (body.flatDiscountPercent !== undefined) {
    const p = Number(body.flatDiscountPercent);
    if (!Number.isFinite(p) || p < 0 || p > 100) return json({ error: "Desconto deve estar entre 0 e 100." }, 422);
    patch.flatDiscountPercent = p;
  }
  if (Array.isArray(body.lengthOfStayDiscounts)) {
    patch.lengthOfStayDiscounts = (body.lengthOfStayDiscounts as any[])
      .map((d) => ({ minNights: Math.trunc(Number(d?.minNights)), percent: Number(d?.percent) }))
      .filter((d) => Number.isFinite(d.minNights) && d.minNights > 0 && d.percent >= 0 && d.percent <= 100);
  }
  if (Number.isFinite(Number(body.weekdayNightlyCents))) { /* ignora escalar inválido */ }
  if (body.weekdayNightlyCents && typeof body.weekdayNightlyCents === "object") {
    const wd: Record<number, number> = {};
    for (const [k, v] of Object.entries(body.weekdayNightlyCents as Record<string, unknown>)) {
      const day = Number(k), cents = Math.trunc(Number(v));
      if (day >= 0 && day <= 6 && Number.isFinite(cents) && cents >= 0) wd[day] = cents;
    }
    patch.weekdayNightlyCents = wd;
  }
  const pay: Record<string, unknown> = {};
  if (body.paymentMode === "full" || body.paymentMode === "signal") pay.mode = body.paymentMode;
  if (body.signalPercent !== undefined) {
    const p = Number(body.signalPercent);
    if (!Number.isFinite(p) || p < 0 || p > 100) return json({ error: "Sinal deve estar entre 0 e 100." }, 422);
    pay.signalPercent = p;
  }
  if (body.paymentExpirationHours !== undefined) {
    const h = Math.trunc(Number(body.paymentExpirationHours));
    if (!Number.isFinite(h) || h < 1) return json({ error: "Prazo de pagamento inválido." }, 422);
    pay.expirationHours = h;
  }
  if (body.maxInstallments !== undefined) {
    const i = Math.trunc(Number(body.maxInstallments));
    if (!Number.isFinite(i) || i < 1 || i > 24) return json({ error: "Parcelas devem estar entre 1 e 24." }, 422);
    pay.maxInstallments = i;
  }
  if (Object.keys(pay).length) patch.payment = pay as PricingConfig["payment"];

  await repo.updatePricingConfig(patch);
  await repo.logAudit({ actor: auth.email, action: "pricing.update", entity: "pricing_rules", metadata: { fields: Object.keys(patch) } });
  return json({ ok: true, pricing: await repo.getActivePricingConfig() });
};
