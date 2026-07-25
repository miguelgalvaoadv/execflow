/**
 * Carregamento e validação de variáveis de ambiente. Falha com mensagem clara
 * (nunca erro genérico) quando uma configuração obrigatória do modo atual falta.
 */
export type AppMode = "mock" | "sandbox" | "production";

export interface AppConfig {
  mode: AppMode;
  siteUrl: string;
  timezone: string;
  paymentExpirationHours: number;
  /** Idade máxima aceitável (ms) da última sincronização iCal bem-sucedida nos
   *  pontos críticos (fail-closed). DEMO: 10 min. Editável por ICAL_MAX_STALENESS_MINUTES. */
  icalMaxStalenessMs: number;
  airbnbIcalUrl: string | null;
  icalExportToken: string;
  mp: { accessToken: string | null; publicKey: string | null; webhookSecret: string | null };
  supabase: { url: string | null; anonKey: string | null; serviceRoleKey: string | null };
  email: { provider: string; apiKey: string | null; from: string };
  admin: { email: string | null; passwordHash: string | null; sessionSecret: string | null };
}

function req(env: NodeJS.ProcessEnv, key: string, mode: AppMode): string {
  const v = env[key];
  if (!v || v.trim() === "") {
    throw new Error(
      `Configuração ausente: ${key} é obrigatória no modo "${mode}". Defina-a no ambiente (ver .env.example).`,
    );
  }
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = (env.APP_ENV as AppMode) || "mock";
  if (!["mock", "sandbox", "production"].includes(mode)) {
    throw new Error(`APP_ENV inválido: "${mode}". Use mock | sandbox | production.`);
  }

  const cfg: AppConfig = {
    mode,
    siteUrl: env.SITE_URL || "http://localhost:8888",
    timezone: env.TIMEZONE || "America/Sao_Paulo",
    paymentExpirationHours: Number(env.RESERVATION_PAYMENT_EXPIRATION_HOURS ?? 24),
    icalMaxStalenessMs: Number(env.ICAL_MAX_STALENESS_MINUTES ?? 10) * 60_000,
    airbnbIcalUrl: env.AIRBNB_ICAL_URL || null,
    icalExportToken: env.ICAL_EXPORT_TOKEN || "dev-token",
    mp: {
      accessToken: env.MERCADO_PAGO_ACCESS_TOKEN || null,
      publicKey: env.MERCADO_PAGO_PUBLIC_KEY || null,
      webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET || null,
    },
    supabase: {
      url: env.SUPABASE_URL || null,
      anonKey: env.SUPABASE_ANON_KEY || null,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    },
    email: {
      provider: env.EMAIL_PROVIDER || "dev",
      apiKey: env.EMAIL_API_KEY || null,
      from: env.EMAIL_FROM || "Cabana Afrodite <reservas@exemplo.com>",
    },
    admin: {
      email: env.ADMIN_EMAIL || null,
      passwordHash: env.ADMIN_PASSWORD_HASH || null,
      sessionSecret: env.ADMIN_SESSION_SECRET || null,
    },
  };

  // Em sandbox/production, exige o mínimo para não quebrar em runtime.
  if (mode === "sandbox" || mode === "production") {
    req(env, "MERCADO_PAGO_ACCESS_TOKEN", mode);
    req(env, "MERCADO_PAGO_WEBHOOK_SECRET", mode);
    req(env, "SUPABASE_URL", mode);
    req(env, "SUPABASE_ANON_KEY", mode); // Supabase Auth (login do painel)
    req(env, "SUPABASE_SERVICE_ROLE_KEY", mode);
    req(env, "ICAL_EXPORT_TOKEN", mode);
    req(env, "ADMIN_EMAIL", mode); // e-mail autorizado do painel
  }
  return cfg;
}

export function isMock(cfg: AppConfig): boolean {
  return cfg.mode === "mock";
}
