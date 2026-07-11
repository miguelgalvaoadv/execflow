/**
 * Lembrete recorrente pra casos em segredo de justiça.
 *
 * Achado 08/07/2026 (pergunta do Miguel): nem InfoSimples nem DJEN conseguem
 * ler movimentação de processo sigiloso (são fontes públicas por natureza).
 * O único caminho real hoje é o advogado conferir manualmente (portal do
 * tribunal com credencial própria) e, se houver novidade, subir os autos
 * atualizados + "Analisar autos". O painel "Astrea sigilosos"
 * (astrea-sealed-cases.ts) só lembra de renovar a CREDENCIAL — não lembra
 * de CONFERIR O ANDAMENTO. Sem esse sweep, um caso sigiloso podia ficar
 * anos sem ninguém olhar de novo, porque nada automático avisa.
 *
 * Idempotente: só cria um prazo novo se o caso não tiver nenhum aberto
 * ainda. Depois que o advogado conclui, a próxima passada do sweep cria o
 * próximo automaticamente — é assim que vira "recorrente" sem precisar de
 * lógica especial de recriação.
 */
import { eq, and, inArray } from 'drizzle-orm'
import { executionCases, deadlines, memberships, users } from '@execflow/db/schema'
import type { WorkersDb } from '../lib/db.ts'

export const SEALED_REMINDER_TITLE = 'Conferir andamento — processo em segredo de justiça'
export const SEALED_REMINDER_INTERVAL_DAYS = 21

export async function runSealedCaseReminderSweep(
  db: WorkersDb
): Promise<{ sealedCases: number; created: number }> {
  const sealed = await db
    .select({ id: executionCases.id, organizationId: executionCases.organizationId })
    .from(executionCases)
    .where(eq(executionCases.monitoringStatus, 'sealed'))

  let created = 0
  for (const c of sealed) {
    const [existing] = await db
      .select({ id: deadlines.id })
      .from(deadlines)
      .where(
        and(
          eq(deadlines.executionCaseId, c.id),
          eq(deadlines.title, SEALED_REMINDER_TITLE),
          inArray(deadlines.status, ['open', 'acknowledged', 'overdue'])
        )
      )
      .limit(1)
    if (existing) continue

    // Sem "usuário atual" (job de fundo) — pega qualquer membro da
    // organização como responsável pela criação, mesmo padrão já usado em
    // movement-ingestion.ts pro prazo provisório automático.
    const [actor] = await db
      .select({ userId: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, c.organizationId))
      .limit(1)
    if (!actor) continue

    await db.insert(deadlines).values({
      organizationId: c.organizationId,
      executionCaseId: c.id,
      title: SEALED_REMINDER_TITLE,
      description:
        'Este processo está marcado como segredo de justiça — InfoSimples e DJEN não leem ' +
        'nada dele (são fontes públicas). Nenhuma automação está monitorando este caso hoje. ' +
        'Confira manualmente o andamento (portal do tribunal, credencial própria) e, se houver ' +
        'novidade, baixe os autos atualizados e suba na aba Documentos + "Analisar autos".',
      dueAt: new Date(Date.now() + SEALED_REMINDER_INTERVAL_DAYS * 86_400_000),
      deadlineClass: 'recurring',
      origin: 'recurring',
      priority: 'normal',
      status: 'open',
      createdByUserId: actor.userId,
    })
    created++
  }

  console.info(
    `[sealed-case-reminder-sweep] ${sealed.length} caso(s) sigiloso(s), ${created} lembrete(s) novo(s) criado(s).`
  )
  return { sealedCases: sealed.length, created }
}
