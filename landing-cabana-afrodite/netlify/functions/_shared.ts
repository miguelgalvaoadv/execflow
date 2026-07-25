/**
 * Helpers compartilhados das Netlify Functions:
 * respostas JSON, rate limiting (best-effort por instância), leitura/validação.
 * Autenticação admin: ver src/auth/admin.ts (Supabase Auth em sandbox/prod).
 */
export { hashPassword, verifyPassword, signSession, verifySession } from "../../src/auth/session.js";

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function methodGuard(req: Request, allowed: string[]): Response | null {
  if (!allowed.includes(req.method)) return json({ error: "Método não permitido" }, 405);
  return null;
}

// ---------------- rate limiting (best-effort, por instância) ----------------
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

/**
 * IP do cliente. Prioriza `x-nf-client-connection-ip` — cabeçalho definido pela
 * borda do Netlify, NÃO manipulável pelo cliente. `x-forwarded-for` só é usado
 * como fallback em ambiente local (dev), nunca como fonte primária em produção.
 */
export function clientIp(req: Request): string {
  const nf = req.headers.get("x-nf-client-connection-ip");
  if (nf) return nf;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "unknown";
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
