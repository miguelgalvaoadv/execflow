import { getContext } from "../../src/runtime/context.js";
import { isValidLocalDate } from "../../src/domain/dates.js";
import { json, methodGuard, readJson, rateLimit, clientIp } from "./_shared.js";

interface Body { checkIn?: string; checkOut?: string; adults?: number; children?: number }

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  if (!rateLimit(`avail:${clientIp(req)}`, 30, 60_000)) return json({ error: "Muitas requisições. Tente novamente em instantes." }, 429);

  const body = await readJson<Body>(req);
  if (!body || !isValidLocalDate(body.checkIn) || !isValidLocalDate(body.checkOut)) {
    return json({ error: "Datas inválidas (use YYYY-MM-DD)." }, 400);
  }
  const adults = Math.max(1, Math.trunc(Number(body.adults ?? 2)));
  const children = Math.max(0, Math.trunc(Number(body.children ?? 0)));

  try {
    const { service } = getContext();
    const avail = await service.checkAvailability(body.checkIn!, body.checkOut!);
    const quote = await service.priceQuote({ checkIn: body.checkIn!, checkOut: body.checkOut!, adults, children });
    return json({
      available: avail.available,
      bookable: avail.available && quote.issues.length === 0,
      issues: quote.issues,
      quote: {
        nights: quote.nights,
        nightlyGroups: quote.nightlyGroups,
        accommodationCents: quote.accommodationCents,
        discount: quote.discount,
        cleaningFeeCents: quote.cleaningFeeCents,
        extraGuest: quote.extraGuest,
        totalCents: quote.totalCents,
        payNowCents: quote.payNowCents,
        remainingCents: quote.remainingCents,
        paymentMode: quote.paymentMode,
        currency: quote.currency,
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};
