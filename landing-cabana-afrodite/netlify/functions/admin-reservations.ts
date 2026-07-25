import { getContext } from "../../src/runtime/context.js";
import { json, methodGuard, requireAdmin } from "./_shared.js";
import type { ReservationStatus } from "../../src/domain/reservation-state.js";

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = requireAdmin(req, cfg.admin.sessionSecret);
  if (auth instanceof Response) return auth;

  const status = new URL(req.url).searchParams.get("status") as ReservationStatus | null;
  const list = await repo.listReservations(status ? { status } : undefined);
  return json({
    reservations: list.map((r) => ({
      code: r.friendlyCode, token: r.publicToken, status: r.status,
      checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children,
      totalCents: r.totalCents, payNowCents: r.payNowCents, currency: r.currency,
      paymentExpiresAt: r.paymentExpiresAt, createdAt: r.createdAt,
      guest: { name: r.guest.fullName, email: r.guest.email, phone: r.guest.phone },
    })),
  });
};
