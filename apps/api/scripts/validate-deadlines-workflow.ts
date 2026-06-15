import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

function cookieHeaderFrom(response: Response): string {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : []
  if (list.length > 0) {
    return list.map((c) => c.split(';')[0]).filter(Boolean).join('; ')
  }
  const single = response.headers.get('set-cookie')
  return single !== null ? single.split(',').map((p) => p.split(';')[0].trim()).join('; ') : ''
}

async function resolveOrgId(sql: postgres.Sql): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select id::text as id from organizations where slug = 'execflow-demo' limit 1
  `
  const id = rows[0]?.id
  if (id === undefined) throw new Error('Organization execflow-demo not found.')
  return id
}

async function main() {
  const dbUrl = process.env['DATABASE_URL'] || 'postgresql://execflow:execflow@localhost:5432/execflow'
  const apiBase = process.env['API_BASE'] || 'http://localhost:3001'
  const trustedOrigin = 'http://localhost:3000'
  const email = 'admin@execflow.local'
  const password = 'ExecflowDevSmoke123!'

  const sql = postgres(dbUrl)
  console.log('[validate] Connecting to database and resolving org...')
  const orgId = await resolveOrgId(sql)

  console.log('[validate] 1) Sign in...')
  const signInRes = await fetch(`${apiBase}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({ email, password }),
  })

  if (!signInRes.ok) {
    throw new Error(`Sign-in failed: ${await signInRes.text()}`)
  }

  let jar = cookieHeaderFrom(signInRes)

  console.log('[validate] 2) Set active organization...')
  const putOrg = await fetch(`${apiBase}/api/v1/me/session/active-organization`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
    },
    body: JSON.stringify({ organizationId: orgId }),
  })
  if (!putOrg.ok) {
    throw new Error(`Active-organization failed: ${await putOrg.text()}`)
  }
  const extraCookies = cookieHeaderFrom(putOrg)
  if (extraCookies !== '') jar = `${jar}; ${extraCookies}`

  // A) CREATE DEADLINE
  console.log('\n--- TEST A: CREATE MANUAL DEADLINE ---')
  const caseRows = await sql`select id::text as id from execution_cases where organization_id = ${orgId}::uuid limit 1`
  const caseId = caseRows[0]?.id
  if (!caseId) throw new Error('No cases found to bind deadline.')

  const testDocId = randomUUID()

  const createRes = await fetch(`${apiBase}/api/v1/deadlines`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      executionCaseId: caseId,
      title: 'Prazo de Manifestação - MP Cálculo',
      description: 'Testando fluxo de criação manual de prazos e auditoria',
      dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      deadlineClass: 'legal',
      origin: 'manual',
      priority: 'high',
      sourceDocumentId: testDocId,
    }),
  })

  if (!createRes.ok) {
    throw new Error(`Failed to create deadline: ${await createRes.text()}`)
  }
  const createBody = (await createRes.json()) as any
  const deadlineId = createBody.data.id
  console.log(`[validate] Deadline created with ID: ${deadlineId}`)

  // Assert DB open state
  const [dbDeadlineA] = await sql`select status, title, source_document_id from deadlines where id = ${deadlineId}::uuid`
  console.log(`[validate] DB Check: status=${dbDeadlineA?.status}, title="${dbDeadlineA?.title}", source_document_id=${dbDeadlineA?.source_document_id}`)
  if (dbDeadlineA?.status !== 'open') throw new Error('DB status is not open.')

  // B) ACKNOWLEDGE DEADLINE
  console.log('\n--- TEST B: ACKNOWLEDGE DEADLINE ---')
  const ackRes = await fetch(`${apiBase}/api/v1/deadlines/${deadlineId}/acknowledge`, {
    method: 'POST',
    headers: {
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
  })
  if (!ackRes.ok) {
    throw new Error(`Failed to acknowledge deadline: ${await ackRes.text()}`)
  }
  console.log('[validate] Deadline acknowledged via API.')

  // Assert DB status
  const [dbDeadlineB] = await sql`select status, acknowledged_at from deadlines where id = ${deadlineId}::uuid`
  console.log(`[validate] DB Check: status=${dbDeadlineB?.status}, acknowledged_at=${dbDeadlineB?.acknowledged_at}`)
  if (dbDeadlineB?.status !== 'acknowledged') throw new Error('DB status is not acknowledged.')

  // C) COMPLETE DEADLINE WITH JUSTIFICATION AND EVIDENCE
  console.log('\n--- TEST C: COMPLETE DEADLINE ---')
  const evidenceDocId = randomUUID()
  const compRes = await fetch(`${apiBase}/api/v1/deadlines/${deadlineId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      completionEvidenceType: 'filing',
      completionEvidenceId: evidenceDocId,
      reason: 'Petição protocolada com sucesso. Comprovante anexado.',
    }),
  })
  if (!compRes.ok) {
    throw new Error(`Failed to complete deadline: ${await compRes.text()}`)
  }
  console.log('[validate] Deadline completed via API.')

  // Assert DB status & evidence
  const [dbDeadlineC] = await sql`
    select status, completed_at, completion_evidence_type, completion_evidence_id
    from deadlines
    where id = ${deadlineId}::uuid
  `
  console.log(
    `[validate] DB Check: status=${dbDeadlineC?.status}, completed_at=${dbDeadlineC?.completed_at}, evidence_type=${dbDeadlineC?.completion_evidence_type}, evidence_id=${dbDeadlineC?.completion_evidence_id}`
  )
  if (dbDeadlineC?.status !== 'completed') throw new Error('DB status is not completed.')

  // D) AUDIT HISTORY FOR LOG ENTRY & REASON
  console.log('\n--- TEST D: HISTORY AND AUDIT ---')
  const histRes = await fetch(`${apiBase}/api/v1/deadlines/${deadlineId}/history`, {
    headers: {
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
  })
  if (!histRes.ok) {
    throw new Error(`Failed to fetch deadline history: ${await histRes.text()}`)
  }
  const histBody = (await histRes.json()) as any
  console.log(`[validate] Deadline history logs length: ${histBody.data.length}`)

  const completedEvent = histBody.data.find((h: any) => h.changeType === 'completed')
  if (!completedEvent) throw new Error('Completed event not found in history logs.')
  console.log(
    `[validate] Completed History Event: change_type=${completedEvent.changeType}, reason="${completedEvent.reason}"`
  )
  if (completedEvent.reason !== 'Petição protocolada com sucesso. Comprovante anexado.') {
    throw new Error('Justification was not saved in the history log.')
  }

  // E) CREATE SECOND DEADLINE & DISMISS IT
  console.log('\n--- TEST E: CREATE & DISMISS DEADLINE ---')
  const create2Res = await fetch(`${apiBase}/api/v1/deadlines`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      executionCaseId: caseId,
      title: 'Prazo para Manifestação MP 2',
      dueAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      deadlineClass: 'legal',
      origin: 'manual',
    }),
  })
  const deadlineId2 = ((await create2Res.json()) as any).data.id

  const dismissRes = await fetch(`${apiBase}/api/v1/deadlines/${deadlineId2}/dismiss`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      dismissedReason: 'Descartado porque o Ministério Público retirou o recurso correspondente.',
      dismissedReasonCode: 'court_extension',
    }),
  })
  if (!dismissRes.ok) {
    throw new Error(`Failed to dismiss deadline: ${await dismissRes.text()}`)
  }
  console.log('[validate] Second deadline dismissed successfully via API.')

  // F) TERMINAL PROTECTION
  console.log('\n--- TEST F: TERMINAL STATE PROTECTION ---')
  const terminalRes = await fetch(`${apiBase}/api/v1/deadlines/${deadlineId2}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      reason: 'Tentativa inválida de concluir prazo já descartado.',
    }),
  })
  console.log(`[validate] API terminal state check response: ${terminalRes.status}`)
  if (terminalRes.status !== 409) {
    throw new Error(`Expected 409 conflict, got ${terminalRes.status}`)
  }

  console.log('\n=========================================')
  console.log('ALL DEADLINE WORKFLOW TESTS PASSED! 🚀')
  console.log('=========================================')
  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error('[validate] Fatal error:', err)
  process.exit(1)
})
