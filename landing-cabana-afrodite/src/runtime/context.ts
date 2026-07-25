/**
 * Monta o serviço de reservas conforme APP_ENV:
 *   mock       -> InMemoryRepository + MockMercadoPago
 *   sandbox    -> SupabaseRepository + RealMercadoPago (credenciais de teste)
 *   production -> SupabaseRepository + RealMercadoPago (credenciais de produção)
 */
import { loadConfig, type AppConfig } from "../config/env.js";
import { InMemoryRepository } from "../db/memory.js";
import { SupabaseRepository } from "../db/supabase.js";
import { createPaymentProvider } from "../payments/mercadopago.js";
import { ReservationService } from "../services/reservation-service.js";
import { requireFreshIcal } from "../services/ical-sync.js";
import { createEmailProvider } from "../email/provider.js";
import type { Repository } from "../db/repository.js";

let cached: { cfg: AppConfig; repo: Repository; service: ReservationService } | null = null;

export function getContext(env: NodeJS.ProcessEnv = process.env) {
  if (cached) return cached;
  const cfg = loadConfig(env);

  const repo: Repository =
    cfg.mode === "mock"
      ? new InMemoryRepository()
      : new SupabaseRepository(cfg.supabase.url!, cfg.supabase.serviceRoleKey!);

  const payments = createPaymentProvider({ mode: cfg.mode, accessToken: cfg.mp.accessToken });
  const email = createEmailProvider({ provider: cfg.email.provider, apiKey: cfg.email.apiKey });

  const service = new ReservationService({
    repo,
    payments,
    config: {
      siteUrl: cfg.siteUrl,
      notificationUrl: `${cfg.siteUrl}/api/webhooks/mercadopago`,
      mode: cfg.mode,
      webhookSecret: cfg.mp.webhookSecret,
    },
    ensureIcalFresh: () => requireFreshIcal(repo, cfg),
    email,
    emailFrom: cfg.email.from,
  });

  cached = { cfg, repo, service };
  return cached;
}

/** Apenas para testes: limpa o cache do contexto. */
export function resetContext() {
  cached = null;
}
