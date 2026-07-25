import { describe, it, expect } from "vitest";
import { signSession, verifySession, hashPassword, verifyPassword } from "../src/auth/session.js";
import { authenticateAdmin } from "../src/auth/admin.js";
import { loadConfig } from "../src/config/env.js";

const SECRET = "sess-secret-123";
const mockCfg = loadConfig({ APP_ENV: "mock", ADMIN_EMAIL: "admin@x.com", ADMIN_SESSION_SECRET: SECRET } as any);

function reqWith(token?: string): Request {
  return new Request("http://x/api/admin/reservations", { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

describe("auth — sessão e senha", () => {
  it("scrypt: hash e verificação", () => {
    const h = hashPassword("minhasenha");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("minhasenha", h)).toBe(true);
    expect(verifyPassword("errada", h)).toBe(false);
  });

  it("sessão HMAC: round-trip, adulteração e expiração", () => {
    const t = signSession("admin@x.com", SECRET, 1);
    expect(verifySession(t, SECRET)?.email).toBe("admin@x.com");
    expect(verifySession(t + "x", SECRET)).toBeNull();
    expect(verifySession(t, "outro-secret")).toBeNull();
    const expired = signSession("a@x.com", SECRET, -1);
    expect(verifySession(expired, SECRET)).toBeNull();
  });

  it("authenticateAdmin (mock): aceita token válido, recusa sem token", async () => {
    const token = signSession("admin@x.com", SECRET, 1);
    expect((await authenticateAdmin(reqWith(token), mockCfg))?.email).toBe("admin@x.com");
    expect(await authenticateAdmin(reqWith(), mockCfg)).toBeNull();
    expect(await authenticateAdmin(reqWith("lixo"), mockCfg)).toBeNull();
  });
});

describe("auth — rotas admin protegidas", () => {
  it("admin-reservations retorna 401 sem autenticação", async () => {
    process.env.APP_ENV = "mock";
    process.env.ADMIN_EMAIL = "admin@x.com";
    process.env.ADMIN_SESSION_SECRET = SECRET;
    const { default: handler } = await import("../netlify/functions/admin-reservations.js");
    const res = await handler(reqWith());
    expect(res.status).toBe(401);
  });
});
