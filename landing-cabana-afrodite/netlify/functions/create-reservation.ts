import { getContext } from "../../src/runtime/context.js";
import { isValidLocalDate } from "../../src/domain/dates.js";
import { ValidationError, NotFoundError } from "../../src/services/reservation-service.js";
import { ConflictError } from "../../src/db/repository.js";
import { json, methodGuard, readJson, rateLimit, clientIp, str } from "./_shared.js";

interface Body {
  checkIn?: string; checkOut?: string; adults?: number; children?: number;
  fullName?: string; email?: string; phone?: string; document?: string; notes?: string;
  acceptedRules?: boolean; acceptedCancellation?: boolean; acceptedPrivacy?: boolean;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  if (!rateLimit(`res:${clientIp(req)}`, 8, 60_000)) return json({ error: "Muitas solicitações. Aguarde um instante." }, 429);

  const b = await readJson<Body>(req);
  if (!b || !isValidLocalDate(b.checkIn) || !isValidLocalDate(b.checkOut)) return json({ error: "Datas inválidas." }, 400);
  const fullName = str(b.fullName, 120);
  const email = str(b.email, 160);
  if (fullName.length < 2) return json({ error: "Informe o nome completo." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "E-mail inválido." }, 400);
  if (!b.acceptedRules || !b.acceptedCancellation || !b.acceptedPrivacy) {
    return json({ error: "É necessário aceitar as regras, a política de cancelamento e a de privacidade." }, 400);
  }

  try {
    const { service } = getContext();
    const { reservation, quote } = await service.requestReservation({
      checkIn: b.checkIn!, checkOut: b.checkOut!,
      adults: Math.max(1, Math.trunc(Number(b.adults ?? 2))),
      children: Math.max(0, Math.trunc(Number(b.children ?? 0))),
      guest: {
        fullName, email, phone: str(b.phone, 40) || null, document: str(b.document, 30) || null, notes: str(b.notes, 1000) || null,
        acceptedRules: true, acceptedCancellation: true, acceptedPrivacy: true,
      },
    });
    // Nunca expõe o id interno — só o token público e o código amigável.
    return json({
      token: reservation.publicToken,
      code: reservation.friendlyCode,
      status: reservation.status,
      totalCents: quote.totalCents,
      payNowCents: quote.payNowCents,
    }, 201);
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: e.message }, 409);
    if (e instanceof ValidationError) return json({ error: e.message }, 422);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    return json({ error: "Não foi possível criar a solicitação." }, 500);
  }
};
