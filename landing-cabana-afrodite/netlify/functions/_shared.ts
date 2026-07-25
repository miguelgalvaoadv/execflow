/**
 * Helpers compartilhados das Netlify Functions:
 * respostas JSON, CORS restritivo, rate limiting (best-effort por instância),
 * autenticação administrativa (hash scrypt + sessão HMAC).
 */
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";

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

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// ---------------- senha (scrypt) ----------------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const calc = scryptSync(password, salt!, 64);
  const expected = Buffer.from(hash!, "hex");
  return calc.length === expected.length && timingSafeEqual(calc, expected);
}

// ---------------- sessão admin (token HMAC) ----------------
export function signSession(email: string, secret: string, ttlHours = 12): string {
  const exp = Date.now() + ttlHours * 3600_000;
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | null, secret: string): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export function requireAdmin(req: Request, secret: string | null): { email: string } | Response {
  if (!secret) return json({ error: "Sessão administrativa não configurada" }, 500);
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const session = verifySession(token, secret);
  if (!session) return json({ error: "Não autorizado" }, 401);
  return session;
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
