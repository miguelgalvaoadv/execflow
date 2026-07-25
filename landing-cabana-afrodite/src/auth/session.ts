/**
 * Helpers de sessão/senha usados APENAS no modo mock (dev local, sem Supabase).
 * Em sandbox/production a autenticação do painel usa Supabase Auth (ver admin.ts).
 */
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";

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
    return { email: String(data.email) };
  } catch {
    return null;
  }
}
