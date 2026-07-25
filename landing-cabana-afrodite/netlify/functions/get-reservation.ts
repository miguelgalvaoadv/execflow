import { getContext } from "../../src/runtime/context.js";
import { json, methodGuard, rateLimit, clientIp } from "./_shared.js";

/** Página de acompanhamento — visão pública mínima (sem dados sensíveis). */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  if (!rateLimit(`get:${clientIp(req)}`, 60, 60_000)) return json({ error: "Muitas requisições." }, 429);

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "Token ausente." }, 400);

  const { repo } = getContext();
  const r = await repo.getReservationByToken(token);
  if (!r) return json({ error: "Reserva não encontrada." }, 404);

  const canPay = r.status === "awaiting_payment";
  return json({
    code: r.friendlyCode,
    status: r.status,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    guests: { adults: r.adults, children: r.children },
    firstName: r.guest.fullName.split(" ")[0] ?? "",
    totalCents: r.totalCents,
    payNowCents: r.payNowCents,
    currency: r.currency,
    paymentExpiresAt: r.paymentExpiresAt,
    canPay,
  });
};
