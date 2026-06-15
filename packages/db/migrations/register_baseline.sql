CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO __drizzle_migrations (hash, created_at)
VALUES ('0000_baseline_v2', EXTRACT(EPOCH FROM NOW()) * 1000);
