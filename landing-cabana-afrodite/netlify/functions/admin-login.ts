import { getContext } from "../../src/runtime/context.js";
import { json, methodGuard, readJson, rateLimit, clientIp, verifyPassword, signSession, str } from "./_shared.js";

export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  if (!rateLimit(`login:${clientIp(req)}`, 6, 60_000)) return json({ error: "Muitas tentativas. Aguarde." }, 429);

  const { cfg } = getContext();
  if (!cfg.admin.email || !cfg.admin.passwordHash || !cfg.admin.sessionSecret) {
    return json({ error: "Admin não configurado (ADMIN_EMAIL/ADMIN_PASSWORD_HASH/ADMIN_SESSION_SECRET)." }, 500);
  }
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = str(body?.email, 160).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";

  const emailOk = email === cfg.admin.email.toLowerCase();
  const passOk = verifyPassword(password, cfg.admin.passwordHash);
  if (!emailOk || !passOk) return json({ error: "Credenciais inválidas." }, 401);

  const token = signSession(email, cfg.admin.sessionSecret, 12);
  return json({ token, expiresInHours: 12 });
};
