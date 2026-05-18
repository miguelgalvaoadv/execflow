import { defineConfig } from 'drizzle-kit'

/**
 * DATABASE_URL must be set in the environment before running any drizzle-kit command.
 * Format: postgresql://user:password@host/dbname?sslmode=require
 *
 * For Neon: copy the connection string from the Neon dashboard.
 * For development: use a Neon branch URL specific to the current developer.
 */
if (!process.env['DATABASE_URL']) {
  throw new Error(
    '[packages/db] DATABASE_URL is required. ' +
    'Set it in your environment or .env.local before running db commands.'
  )
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'],
  },
  /**
   * Verbose: log every SQL statement during push/migrate.
   * Required in a legal system — generated SQL must be inspectable.
   */
  verbose: true,
  /**
   * Strict: fail rather than apply ambiguous migrations automatically.
   * All migrations require review before application.
   */
  strict: true,
})
