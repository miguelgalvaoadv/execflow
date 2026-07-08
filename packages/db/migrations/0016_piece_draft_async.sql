-- ============================================================================
-- 0016 — piece_drafts: geração de peça vira assíncrona (mesmo padrão do
-- 0015/case_analysis_runs), + status 'failed' pra nunca ficar preso em
-- 'generating' pra sempre.
--
-- Achado 08/07/2026: POST /piece-drafts/generate/:opportunityId era
-- síncrono e chamava o Claude com os mesmos PDFs grandes usados na análise
-- de autos (60-120s+ pra autos reais) — sujeito ao MESMO corte do proxy do
-- Next.js já corrigido em /analyze (0015). Além disso, quando a chamada ao
-- Claude falhava (ex.: sem crédito), o registro ficava travado em
-- 'generating' pra sempre — o enum nem tinha um status de falha. Corrigido:
-- rota responde rápido com o registro em 'generating', roda a chamada ao
-- Claude em segundo plano, e agora pode marcar 'failed' com error_message.
-- Hand-written + idempotente (drizzle-kit generate exige TTY interativo,
-- indisponível neste ambiente).
-- ============================================================================

ALTER TYPE "piece_draft_status" ADD VALUE IF NOT EXISTS 'failed';
--> statement-breakpoint

ALTER TABLE "piece_drafts" ADD COLUMN IF NOT EXISTS "error_message" text;
