import { createClient } from "@supabase/supabase-js";
import { getContext } from "../../src/runtime/context.js";
import { json, methodGuard, readJson, rateLimit, clientIp, verifyPassword, signSession, str } from "./_shared.js";

/**
 * Login do painel.
 *   - mock:               confere email/senha local (ADMIN_PASSWORD_HASH) e emite token HMAC.
 *   - sandbox/production:  autentica no Supabase Auth (signInWithPassword) e retorna o access_token.
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  if (!rateLimit(`login:${clientIp(req)}`, 6, 60_000)) return json({ error: "Muitas tentativas. Aguarde." }, 429);

  const { cfg } = getContext();
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = str(body?.email, 160).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return json({ error: "Informe e-mail e senha." }, 400);

  if (cfg.mode === "mock") {
    if (!cfg.admin.email || !cfg.admin.passwordHash || !cfg.admin.sessionSecret) {
      return json({ error: "Admin não configurado (ADMIN_EMAIL/ADMIN_PASSWORD_HASH/ADMIN_SESSION_SECRET)." }, 500);
    }
    if (email !== cfg.admin.email.toLowerCase() || !verifyPassword(password, cfg.admin.passwordHash)) {
      return json({ error: "Credenciais inválidas." }, 401);
    }
    return json({ token: signSession(email, cfg.admin.sessionSecret, 12), mode: "mock", expiresInHours: 12 });
  }

  // sandbox / production -> Supabase Auth
  if (!cfg.supabase.url || !cfg.supabase.anonKey) return json({ error: "Supabase não configurado." }, 500);
  if (email !== (cfg.admin.email || "").toLowerCase()) return json({ error: "Credenciais inválidas." }, 401);
  const client = createClient(cfg.supabase.url, cfg.supabase.anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return json({ error: "Credenciais inválidas." }, 401);
  return json({ token: data.session.access_token, mode: cfg.mode, expiresAt: data.session.expires_at });
};
