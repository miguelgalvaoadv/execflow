import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { memberships, users } from '@execflow/db/schema'
import { parseBody } from '../lib/zod-helpers.ts'
import { unprocessable, forbidden, notFound } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const orgsRouter = new Hono<{ Variables: HonoVariables }>()

orgsRouter.use('*', authMiddleware, orgMiddleware)

/**
 * GET /api/v1/orgs/members
 * Lista os membros da organização.
 * Piso 'assistant': e-mails/papéis da equipe nunca vazam para role 'client'.
 */
orgsRouter.get('/members', requireMinRole('assistant'), async (c) => {
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

/**
 * POST /api/v1/orgs/invites
 * Convida um usuário (ou adiciona diretamente) para a organização.
 * Exige papel de admin.
 */
const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'lawyer', 'assistant']),
})

orgsRouter.post('/invites', requireMinRole('admin'), async (c) => {
  const { organization } = c.get('org')
  
  let body
  try {
    body = await c.req.json()
  } catch {
    return unprocessable(c, 'Invalid JSON body')
  }

  const parsed = parseBody(InviteSchema, body)
  if (!parsed.success) {
    return unprocessable(c, parsed.message, parsed.issues)
  }

  const { email, role } = parsed.data

  // Verifica se o usuário existe no sistema
  const [targetUser] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  if (!targetUser) {
    return unprocessable(c, 'Usuário não encontrado. O usuário deve criar uma conta primeiro.')
  }

  // Verifica se já é membro
  const [existingMembership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUser.id)
      )
    )
    .limit(1)

  if (existingMembership) {
    return unprocessable(c, 'O usuário já é membro desta organização.')
  }

  // Cria a membership
  const [newMembership] = await db.insert(memberships).values({
    organizationId: organization.id,
    userId: targetUser.id,
    role: role as 'admin' | 'lawyer' | 'assistant',
    status: 'active',
  }).returning()

  return c.json({ data: newMembership }, 201)
})

/**
 * PATCH /api/v1/orgs/members/:userId
 * Altera a role de um membro.
 */
const UpdateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'lawyer', 'assistant']),
})

orgsRouter.patch('/members/:userId', requireMinRole('admin'), async (c) => {
  const targetUserId = c.req.param('userId')
  const { organization, domainUserId } = c.get('org')
  
  let body
  try {
    body = await c.req.json()
  } catch {
    return unprocessable(c, 'Invalid JSON body')
  }

  const parsed = parseBody(UpdateMemberSchema, body)
  if (!parsed.success) {
    return unprocessable(c, parsed.message, parsed.issues)
  }

  if (targetUserId === domainUserId) {
    return forbidden(c, 'Você não pode alterar sua própria permissão.')
  }

  const [updated] = await db.update(memberships)
    .set({ role: parsed.data.role as 'admin' | 'lawyer' | 'assistant', updatedAt: new Date() })
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    ).returning()

  if (!updated) {
    return notFound(c, 'Membro não encontrado.')
  }

  return c.json({ data: updated })
})

/**
 * DELETE /api/v1/orgs/members/:userId
 * Remove um membro da organização.
 */
orgsRouter.delete('/members/:userId', requireMinRole('admin'), async (c) => {
  const targetUserId = c.req.param('userId')
  const { organization, domainUserId } = c.get('org')
  
  if (targetUserId === domainUserId) {
    return forbidden(c, 'Você não pode remover a si mesmo.')
  }

  const [removed] = await db.delete(memberships)
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.userId, targetUserId)
      )
    ).returning()

  if (!removed) {
    return notFound(c, 'Membro não encontrado.')
  }

  return c.json({ success: true })
})
