-- ============================================================================
-- 0012 — Impressão digital de movimentação (dedup cruzado entre fontes)
-- Uma movimentação é "a mesma" se: mesmo processo + mesmo dia + mesmo texto
-- normalizado (sem tag de fonte, sem acento/pontuação). Assim DataJud, DJEN,
-- InfoSimples e AASP não empilham o mesmo fato, mesmo com textos diferentes.
-- Hand-written + idempotente.
-- ============================================================================

ALTER TABLE "timeline_events"
  ADD COLUMN IF NOT EXISTS "dedup_fingerprint" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "timeline_events_dedup_fingerprint_idx"
  ON "timeline_events" USING btree ("execution_case_id", "dedup_fingerprint");
