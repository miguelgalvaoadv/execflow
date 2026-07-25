/**
 * Autenticação administrativa.
 *   - mock:               token de sessão HMAC local (dev, sem Supabase).
 *   - sandbox/production:  Supabase Auth. O painel faz login (email/senha) e
 *                          envia o access_token (JWT) como Bearer; aqui o token
 *                          é validado no servidor de auth do Supabase e o e-mail
 *                          é conferido contra ADMIN_EMAIL.
 *
 * Vantagens de usar Supabase Auth: reset de senha por e-mail, MFA, revogação de
 * sessão, rotação de chaves e proteção a força bruta são responsabilidade do
 * Supabase — não reimplementamos criptografia de credenciais em produção.
 */
import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env.js";
import { verifySession } from "./session.js";

export interface AdminSession {
  email: string;
}

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function authenticateAdmin(req: Request, cfg: AppConfig): Promise<AdminSession | null> {
  const token = bearer(req);
  if (!token) return null;

  if (cfg.mode === "mock") {
    if (!cfg.admin.sessionSecret) return null;
    return verifySession(token, cfg.admin.sessionSecret);
  }

  // sandbox / production -> valida o JWT no Supabase Auth.
  if (!cfg.supabase.url || !cfg.supabase.anonKey) return null;
  const client = createClient(cfg.supabase.url, cfg.supabase.anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.email) return null;

  const email = data.user.email.toLowerCase();
  const allowed = (cfg.admin.email || "").toLowerCase();
  if (!allowed || email !== allowed) return null; // apenas o admin configurado
  return { email };
}
