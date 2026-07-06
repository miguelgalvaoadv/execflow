/**
 * Cria um usuário-CLIENTE de teste para o portal restrito (spec §17).
 *
 * Uso: pnpm --filter @execflow/db exec tsx --env-file=.env.local scripts/seed-client-user.ts <email> <clientId>
 *   <email>    e-mail de login do cliente (ex.: cliente@execflow.local)
 *   <clientId> uuid do registro em clients ao qual o portal fica vinculado
 *
 * Senha: EXECFLOW_SEED_AUTH_PASSWORD ou o padrão de dev.
 * Idempotente: se o e-mail já existir, só atualiza vínculo/role.
 */

import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { users } from '../src/schema/user.ts'
import { memberships } from '../src/schema/membership.ts'
import { authUsers } from '../src/schema/auth-user.ts'
import { authAccounts } from '../src/schema/auth-account.ts'
import { clients } from '../src/schema/client.ts'

const email = process.argv[2]
const clientId = process.argv[3]
if (!email || !clientId) {
  console.error('Uso: tsx scripts/seed-client-user.ts <email> <clientId>')
  process.exit(1)
}

const sql = postgres(process.env['DATABASE_URL']!)
const db = drizzle(sql)

const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1)
if (!client) {
  console.error(`Cliente ${clientId} não encontrado.`)
  process.exit(1)
}

const password = process.env['EXECFLOW_SEED_AUTH_PASSWORD'] ?? 'ExecflowDevSmoke123!'
const now = new Date()

const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
let userId: string

if (existing) {
  userId = existing.id
  console.log(`Usuário ${email} já existe (${userId}) — atualizando vínculo.`)
  await db
    .update(memberships)
    .set({ role: 'client', linkedClientId: client.id, updatedAt: now })
    .where(eq(memberships.userId, userId))
} else {
  userId = randomUUID()
  await db.insert(users).values({
    id: userId,
    email,
    displayName: client.displayName ?? client.fullName,
    status: 'active',
  })
  await db.insert(memberships).values({
    id: randomUUID(),
    organizationId: client.organizationId,
    userId,
    role: 'client',
    linkedClientId: client.id,
    status: 'active',
  })
  await db.insert(authUsers).values({
    id: userId,
    name: client.displayName ?? client.fullName,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(authAccounts).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  })
}

console.log(`✅ Usuário-cliente pronto: ${email} → cliente "${client.fullName}" (${client.id})`)
console.log('   Role: client (acesso APENAS ao portal restrito)')
process.exit(0)
