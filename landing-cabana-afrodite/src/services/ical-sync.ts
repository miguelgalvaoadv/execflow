/**
 * Sincronização do iCal do Airbnb, com CACHE e THROTTLE para não chamar em excesso.
 *
 * Reações a falha:
 *  - iCal indisponível / lento: timeout + 1 retry; mantém os últimos períodos
 *    conhecidos (não apaga) e registra o erro. Disponibilidade continua usando
 *    o cache — falha "fail-safe" (não libera datas por causa de um erro de rede).
 *  - evento alterado: o parser resolve por UID/SEQUENCE (o mais novo vence).
 *  - evento cancelado: excluído dos períodos ocupados.
 *  - nova reserva do Airbnb durante o pagamento / pagamento após indisponível:
 *    tratados no fluxo do webhook (re-sync + exclusion check antes de confirmar).
 */
import { icsToBusyPeriods } from "../ical/parse.js";
import type { Repository } from "../db/repository.js";
import type { AppConfig } from "../config/env.js";

export interface SyncResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  periodsImported?: number;
  durationMs?: number;
  error?: string;
}

// Throttle por instância: nunca busca com menos de MIN_INTERVAL entre tentativas.
const MIN_INTERVAL_MS = 30_000;
let lastAttemptMs = 0;

export async function syncAirbnbIcal(
  repo: Repository,
  url: string,
  opts: { force?: boolean; maxAgeMs?: number; timeoutMs?: number; retries?: number; fetchImpl?: typeof fetch } = {},
): Promise<SyncResult> {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60_000; // considera "fresco" por 5 min
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = opts.retries ?? 1;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = Date.now();

  if (!opts.force) {
    if (now - lastAttemptMs < MIN_INTERVAL_MS) return { ok: true, skipped: true, reason: "throttled" };
    const last = await repo.lastIcalSyncAt();
    if (last && now - last.getTime() < maxAgeMs) return { ok: true, skipped: true, reason: "fresh-cache" };
  }
  lastAttemptMs = now;

  const started = Date.now();
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: ctrl.signal, headers: { "user-agent": "CabanaAfrodite/1.0" } });
      if (!res.ok) throw new Error(`Airbnb respondeu ${res.status}`);
      const text = await res.text();
      const busy = icsToBusyPeriods(text);
      await repo.replaceIcalEvents(busy, url);
      const durationMs = Date.now() - started;
      await repo.logIcalSync({ success: true, eventsFound: busy.length, periodsImported: busy.length, durationMs, sourceUrl: url });
      return { ok: true, periodsImported: busy.length, durationMs };
    } catch (e) {
      lastErr = (e as Error).message;
      // pequena espera antes do retry (não bloqueante longo)
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500));
    } finally {
      clearTimeout(timer);
    }
  }
  const durationMs = Date.now() - started;
  // NÃO limpa os eventos existentes — mantém o último estado bom conhecido.
  await repo.logIcalSync({ success: false, eventsFound: 0, periodsImported: 0, durationMs, error: lastErr, sourceUrl: url });
  return { ok: false, error: lastErr, durationMs };
}

/** Garante um iCal razoavelmente fresco antes de operações críticas. No-op em mock/sem URL. */
export async function ensureFreshIcal(repo: Repository, cfg: AppConfig, maxAgeMs?: number): Promise<SyncResult> {
  if (cfg.mode === "mock" || !cfg.airbnbIcalUrl) return { ok: true, skipped: true, reason: "mock-or-no-url" };
  return syncAirbnbIcal(repo, cfg.airbnbIcalUrl, { force: false, maxAgeMs });
}

export interface IcalFreshness {
  /** true = seguro prosseguir (dados frescos, ou não há calendário externo). */
  ok: boolean;
  lastSyncAt: Date | null;
  reason: "no-external-calendar" | "fresh" | "stale" | "never-synced";
  staleMs?: number;
}

/**
 * FAIL-CLOSED: exigido antes de operações que criam bloqueio efetivo da data
 * (aprovação, preferência, confirmação). Tenta sincronizar e só retorna ok:true
 * se a última sincronização BEM-SUCEDIDA estiver dentro de icalMaxStalenessMs.
 * Quando não há calendário externo (mock/sem URL), retorna ok:true (nada a falhar).
 */
export async function requireFreshIcal(repo: Repository, cfg: AppConfig): Promise<IcalFreshness> {
  if (cfg.mode === "mock" || !cfg.airbnbIcalUrl) {
    return { ok: true, lastSyncAt: null, reason: "no-external-calendar" };
  }
  await syncAirbnbIcal(repo, cfg.airbnbIcalUrl, { force: false, maxAgeMs: cfg.icalMaxStalenessMs });
  const last = await repo.lastIcalSyncAt();
  if (!last) return { ok: false, lastSyncAt: null, reason: "never-synced" };
  const staleMs = Date.now() - last.getTime();
  if (staleMs <= cfg.icalMaxStalenessMs) return { ok: true, lastSyncAt: last, reason: "fresh", staleMs };
  return { ok: false, lastSyncAt: last, reason: "stale", staleMs };
}

/** Reseta o throttle (apenas testes). */
export function _resetThrottle() {
  lastAttemptMs = 0;
}
