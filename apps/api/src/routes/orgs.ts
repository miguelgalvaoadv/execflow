/**
 * Rotas de organização — gestão de equipe (membros, papéis, acessos).
 *
 * MODELO DE PROVISIONAMENTO (decidido 14/07/2026):
 * O admin do escritório cria o acesso direto — nome, e-mail, papel e senha.
 * A conta (login real) é criada no servidor via Better Auth (signUpEmail) e o
 * vínculo com a organização (membership) é criado na mesma ação. A senha é
 * mostrada UMA vez para o admin repassar (WhatsApp/pessoalmente), pois não há
 * envio de e-mail configurado. Não existe auto-cadastro público.
 *
 * Endpoints:
 *   GET   /members                         — lista membros (+status)
 *   POST  /members                         — cria acesso (login) + vínculo, OU
 *                                            vincula conta já existente
 *   PATCH /members/:userId                 — troca o papel
 *   PATCH /members/:userId/status          — suspende / reativa (soft)
 *   POST  /members/:userId/reset-password  — define nova senha temporária
 *
 * SEGURANÇA:
 * - Todas exigem papel 'admin' na organização (requireMinRole('admin')).
 * - Proteções: não dá para rebaixar/suspender a si mesmo, nem deixar o
 *   escritório sem nenhum admin ativo (protege o último admin).
 * - 'client' (portal) NÃO é criado aqui — depende de vínculo com um Client.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { auth } from '../lib/auth.ts'
import { memberships, users, authUsers } from '@execflow/db/schema'
import { parseBody } from '../lib/zod-helpers.ts'
import { unprocessable, forbidden, notFound, internalError } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const orgsRouter = new Hono<{ Variables: HonoVariables }>()

orgsRouter.use('*', authMiddleware, orgMiddleware)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Papéis de equipe (staff). 'client' fica de fora — é acesso de portal. */
const STAFF_ROLES = ['admin', 'lawyer', 'assistant'] as const

/**
 * Gera uma senha temporária forte (16 chars) evitando caracteres ambíguos
 * (0/O, 1/l/I) para facilitar o repasse por voz/WhatsApp. Garante ao menos
 * uma maiúscula, uma minúscula, um dígito e um símbolo. Mínimo do Better Auth
 * é 12; usamos 16.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*?'
  const all = upper + lower + digits + symbols
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  for (let i = chars.length; i < 16; i++) chars.push(pick(all))
  // Embaralha (Fisher-Yates) para não deixar os 4 obrigatórios sempre no início.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

/** Conta quantos admins ATIVOS a organização tem (para proteger o último). */
async function countActiveAdmins(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, 'admin'),
        eq(memberships.status, 'active')
      )
    )
  return rows.length
}

// ---------------------------------------------------------------------------
// GET /members — lista membros da organização
// ---------------------------------------------------------------------------

orgsRouter.get('/members', requireMinRole('admin'), async (c) => {
  const { organization } = c.get('org')

  const members = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      status: memberships.status,
      email: users.email,
      displayName: users.displayName,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organization.id))

  return c.json({ data: members })
})

// ---------------------------------------------------------------------------
// POST /members — cria acesso (login) + vínculo, ou vincula conta existente
// ---------------------------------------------------------------------------

const CreateMemberSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório.').max(200),
  email: z.string().email('E-mail inválido.'),
  role: z.enum(STAFF_ROLES),
  /** Opcional: se ausente, o sistema gera uma senha temporária forte. */
  password: z.string().min(12, 'A senha deve ter ao menos 12 caracteres.').max(128).optional(),
})

orgsRouter.post('/members', requireMinRole('admin'), async (c) => {
  const { organization } = c.get('org')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return unprocessable(c, 'Corpo da requisição inválido (JSON).')
  }

  const parsed = parseBody(CreateMemberSchema, body)
  if (!parsed.success) {
    return unprocessable(c, parsed.message, parsed.issues)
  }

  const email = parsed.data.email.trim().toLowerCase()
  const { name, role } = parsed.data

  // Já existe uma conta (login) com esse e-mail?
  const [existingAuthUser] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, email))
    .limit(1)

  // ---- Caminho A: conta já existe → só vincular (sem criar senha) ----
  if (existingAuthUser) {
    // O users domain tem o mesmo id do ba_user (hook de criação).
    const targetUserId = existingAuthUser.id

    const [existingMembership] = await db
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organization.id),
          eq(memberships.userId, targetUserId)
        )
      )
      .limit(1)

    if (existingMembership) {
      // Se estava suspenso, reativa; se já ativo, erro amigável.
      if (existingMembership.status === 'active') {
        return unprocessable(c, 'Já existe um membro ativo com esse e-mail.')
      }
      const [reactivated] = await db
        .update(memberships)
        .set({ status: 'active', role, suspendedAt: null, suspensionReason: null, updatedAt: new Date() })
        .where(eq(memberships.id, existingMembership.id))
        .returning()
      return c.json({ data: reactivated, created: false, linked: true, password: null }, 200)
    }

    const [linked] = await db
      .insert(memberships)
      .values({
        organizationId: organization.id,
        userId: targetUserId,
        role,
        status: 'active',
      })
      .returning()
    return c.json({ data: linked, created: false, linked: true, password: null }, 201)
  }

  // ---- Caminho B: conta não existe → criar login + vínculo ----
  const password = parsed.data.password ?? generateTempPassword()
  const generated = parsed.data.password === undefined

  let newUserId: string
  try {
    // Cria o ba_user + ba_account(credential). O databaseHook user.create.after
    // (packages/auth) cria o registro em `users` com o MESMO id — é o mesmo
    // caminho de todo login do sistema. autoSignIn:false → sem sessão órfã e
    // sem tocar na sessão do admin que está criando.
    const result = await auth.api.signUpEmail({
      body: { email, password, name },
    })
    newUserId = result.user.id
  } catch (err) {
    // Erros do Better Auth (ex.: senha fraca) chegam aqui.
    const message =
      err instanceof Error && err.message ? err.message : 'Falha ao criar a conta de acesso.'
    return unprocessable(c, message)
  }

  // Confirma que o registro de domínio já existe (criado pelo hook). Em geral
  // já está pronto quando signUpEmail retorna; damos algumas tentativas curtas
  // para cobrir qualquer atraso do hook antes de criar o vínculo (FK).
  let domainReady = false
  for (let attempt = 0; attempt < 10; attempt++) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, newUserId)).limit(1)
    if (row) { domainReady = true; break }
    await new Promise((r) => setTimeout(r, 50))
  }
  if (!domainReady) {
    return internalError(c, new Error('Conta criada, mas o registro de usuário ainda não estava pronto. Recarregue e tente vincular.'))
  }

  const [membership] = await db
    .insert(memberships)
    .values({
      organizationId: organization.id,
      userId: newUserId,
      role,
      status: 'active',
    })
    .returning()

  return c.json(
    {
      data: membership,
      created: true,
      linked: false,
      // Senha mostrada UMA vez para o admin repassar. Só quando foi gerada
      // pelo sistema — se o admin digitou a própria, ele já a conhece.
      password: generated ? password : null,
    },
    201
  )
})

// ---------------------------------------------------------------------------
// PATCH /members/:userId — troca o papel
// ---------------------------------------------------------------------------

const UpdateRoleSchema = z.object({
  role: z.enum(STAFF_ROLES),
})

orgsRouter.patch('/members/:userId', requireMinRole('admin'), async (c) => {
  const targetUserId = c.req.param('userId')
  const { organization, domainUserId } = c.get('org')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return unprocessable(c, 'Corpo da requisição inválido (JSON).')
  }

  const parsed = parseBody(UpdateRoleSchema, body)
  if (!parsed.success) {
    return unprocessable(c, parsed.message, parsed.issues)
  }

  if (targetUserId === domainUserId) {
    return forbidden(c, 'Você não pode alterar a sua própria permissão.')
  }

  // Papel atual do alvo — para proteger o último admin.
  const [current] = await db
    .select({ role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    )
    .limit(1)

  if (!current) {
    return notFound(c, 'Membro não encontrado.')
  }

  // Rebaixar o único admin ativo deixaria o escritório sem administrador.
  if (current.role === 'admin' && parsed.data.role !== 'admin') {
    if ((await countActiveAdmins(organization.id)) <= 1) {
      return forbidden(c, 'Não é possível rebaixar o único administrador do escritório. Promova outro admin antes.')
    }
  }

  const [updated] = await db
    .update(memberships)
    .set({ role: parsed.data.role, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    )
    .returning()

  return c.json({ data: updated })
})

// ---------------------------------------------------------------------------
// PATCH /members/:userId/status — suspende / reativa (soft, nunca apaga)
// ---------------------------------------------------------------------------

const UpdateStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().max(500).optional(),
})

orgsRouter.patch('/members/:userId/status', requireMinRole('admin'), async (c) => {
  const targetUserId = c.req.param('userId')
  const { organization, domainUserId } = c.get('org')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return unprocessable(c, 'Corpo da requisição inválido (JSON).')
  }

  const parsed = parseBody(UpdateStatusSchema, body)
  if (!parsed.success) {
    return unprocessable(c, parsed.message, parsed.issues)
  }

  if (targetUserId === domainUserId) {
    return forbidden(c, 'Você não pode suspender o seu próprio acesso.')
  }

  const [current] = await db
    .select({ role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    )
    .limit(1)

  if (!current) {
    return notFound(c, 'Membro não encontrado.')
  }

  // Suspender o único admin ativo deixaria o escritório sem administrador.
  if (parsed.data.status === 'suspended' && current.role === 'admin') {
    if ((await countActiveAdmins(organization.id)) <= 1) {
      return forbidden(c, 'Não é possível suspender o único administrador do escritório.')
    }
  }

  const [updated] = await db
    .update(memberships)
    .set({
      status: parsed.data.status,
      suspendedAt: parsed.data.status === 'suspended' ? new Date() : null,
      suspensionReason: parsed.data.status === 'suspended' ? parsed.data.reason ?? null : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    )
    .returning()

  return c.json({ data: updated })
})

// ---------------------------------------------------------------------------
// POST /members/:userId/reset-password — define nova senha temporária
// ---------------------------------------------------------------------------

const ResetPasswordSchema = z.object({
  /** Opcional: se ausente, gera uma senha temporária forte. */
  password: z.string().min(12).max(128).optional(),
})

orgsRouter.post('/members/:userId/reset-password', requireMinRole('admin'), async (c) => {
  const targetUserId = c.req.param('userId')
  const { organization } = c.get('org')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  const parsed = parseBody(ResetPasswordSchema, body ?? {})
  if (!parsed.success) {
    return unprocessable(c, parsed.message, parsed.issues)
  }

  // O alvo precisa ser membro DESTA organização (isolamento).
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    )
    .limit(1)

  if (!membership) {
    return notFound(c, 'Membro não encontrado.')
  }

  const password = parsed.data.password ?? generateTempPassword()
  const generated = parsed.data.password === undefined

  try {
    // Mesmo procedimento interno do plugin admin do Better Auth:
    // hash + internalAdapter.updatePassword no ba_account 'credential'.
    const ctx = await auth.$context
    const hashed = await ctx.password.hash(password)
    await ctx.internalAdapter.updatePassword(targetUserId, hashed)
  } catch (err) {
    return internalError(c, err)
  }

  return c.json({ success: true, password: generated ? password : null })
})
