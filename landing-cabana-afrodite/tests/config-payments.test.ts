import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createPaymentProvider, PaymentNotConfiguredError } from "../src/payments/mercadopago.js";

describe("config + pagamento opcional em sandbox", () => {
  const sandboxEnv = {
    APP_ENV: "sandbox",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    ICAL_EXPORT_TOKEN: "tok",
    ADMIN_EMAIL: "a@x.com",
  } as any;

  it("sandbox SEM Mercado Pago não quebra o boot", () => {
    const cfg = loadConfig(sandboxEnv);
    expect(cfg.mode).toBe("sandbox");
    expect(cfg.mp.accessToken).toBeNull();
  });

  it("provedor nulo falha apenas ao ser usado", async () => {
    const p = createPaymentProvider({ mode: "sandbox", accessToken: null });
    await expect(p.createPreference({} as any)).rejects.toBeInstanceOf(PaymentNotConfiguredError);
  });

  it("produção SEM Mercado Pago é bloqueada no boot", () => {
    expect(() => loadConfig({ ...sandboxEnv, APP_ENV: "production" })).toThrow(/MERCADO_PAGO/);
  });

  it("sandbox exige Supabase", () => {
    expect(() => loadConfig({ APP_ENV: "sandbox" } as any)).toThrow(/SUPABASE_URL/);
  });
});
