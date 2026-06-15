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

  // Query a suggested opportunity to test
  console.log('[validate] 3) Finding a suggested opportunity in DB...')
  const oppRows = await sql`
    select id::text as id, status, summary, execution_case_id::text as case_id
    from opportunities
    where organization_id = ${orgId}::uuid and status = 'suggested'
    limit 1
  `

  let opportunityId = oppRows[0]?.id
  let caseId = oppRows[0]?.case_id

  if (!opportunityId) {
    console.log('[validate] No suggested opportunity found. Creating a manual suggested opportunity first...')
    // Let's find a case
    const caseRows = await sql`select id::text as id from execution_cases where organization_id = ${orgId}::uuid limit 1`
    caseId = caseRows[0]?.id
    if (!caseId) throw new Error('No cases found to bind opportunity.')

    const createRes = await fetch(`${apiBase}/api/v1/opportunities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
      body: JSON.stringify({
        executionCaseId: caseId,
        opportunityType: 'manual',
        summary: 'Oportunidade de teste e2e workflow',
        rationale: 'Esta é uma oportunidade proposta manualmente para testar transições.',
        requiresReview: true,
      }),
    })

    if (!createRes.ok) {
      throw new Error(`Failed to create manual opportunity: ${await createRes.text()}`)
    }
    const createBody = await createRes.json() as any
    opportunityId = createBody.data.id
    console.log(`[validate] Manual opportunity created with ID: ${opportunityId}`)
  } else {
    console.log(`[validate] Found suggested opportunity: ${opportunityId} ("${oppRows[0]?.summary}")`)
  }

  // A) TEST QUALIFY (suggested -> qualified)
  console.log('\n--- TEST A: QUALIFY OPPORTUNITY ---')
  const reviewQualifyRes = await fetch(`${apiBase}/api/v1/opportunities/${opportunityId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      reviewAction: 'qualified',
      explanation: 'Justificativa para qualificação da oportunidade - Válido legalmente.',
    }),
  })

  if (!reviewQualifyRes.ok) {
    throw new Error(`Failed to qualify opportunity: ${await reviewQualifyRes.text()}`)
  }
  console.log('[validate] Opportunity successfully qualified via API.')

  // Assert DB status
  const [dbOppA] = await sql`select status, qualified_at, qualified_by_user_id from opportunities where id = ${opportunityId}::uuid`
  console.log(`[validate] DB Check: status=${dbOppA?.status}, qualified_at=${dbOppA?.qualified_at}, qualified_by_user_id=${dbOppA?.qualified_by_user_id}`)
  if (dbOppA?.status !== 'qualified') throw new Error('DB Status was not updated to qualified.')

  // Check review log
  const reviewRowsA = await sql`select * from opportunity_reviews where opportunity_id = ${opportunityId}::uuid`
  console.log(`[validate] DB Check: opportunity_reviews row count = ${reviewRowsA.length}`)
  if (reviewRowsA.length !== 1) throw new Error('Expected 1 review log row in DB.')
  console.log(`[validate] Review Log: action=${reviewRowsA[0]?.review_action}, explanation="${reviewRowsA[0]?.explanation}"`)

  // Check history log
  const historyRowsA = await sql`select * from opportunity_status_history where opportunity_id = ${opportunityId}::uuid`
  console.log(`[validate] DB Check: status_history row count = ${historyRowsA.length}`)

  // B) TEST DEFER (qualified -> qualified, but isPendingReview = false and deferred review logged)
  console.log('\n--- TEST B: DEFER OPPORTUNITY ---')
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const deferRes = await fetch(`${apiBase}/api/v1/opportunities/${opportunityId}/defer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      deferredUntil: tomorrow,
      explanation: 'Justificativa para adiar a oportunidade - aguardando manifestação do Ministério Público.',
    }),
  })

  if (!deferRes.ok) {
    throw new Error(`Failed to defer opportunity: ${await deferRes.text()}`)
  }
  console.log('[validate] Opportunity successfully deferred via API.')

  const [dbOppB] = await sql`select status, is_pending_review from opportunities where id = ${opportunityId}::uuid`
  console.log(`[validate] DB Check: status=${dbOppB?.status}, is_pending_review=${dbOppB?.is_pending_review}`)

  const reviewRowsB = await sql`select * from opportunity_reviews where opportunity_id = ${opportunityId}::uuid order by reviewed_at desc`
  console.log(`[validate] DB Check: opportunity_reviews row count = ${reviewRowsB.length}`)
  if (reviewRowsB.length !== 2) throw new Error('Expected 2 review log rows in DB.')
  console.log(`[validate] Defer Review Log: action=${reviewRowsB[0]?.review_action}, deferred_until=${reviewRowsB[0]?.deferred_until}`)

  // C) TEST DISMISS (qualified -> dismissed)
  console.log('\n--- TEST C: DISMISS OPPORTUNITY ---')
  const reviewDismissRes = await fetch(`${apiBase}/api/v1/opportunities/${opportunityId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      reviewAction: 'rejected',
      explanation: 'Justificativa para descarte da oportunidade - o réu cometeu nova falta grave recentemente.',
      rejectionReasonCode: 'prior_dismissal',
    }),
  })

  if (!reviewDismissRes.ok) {
    throw new Error(`Failed to dismiss opportunity: ${await reviewDismissRes.text()}`)
  }
  console.log('[validate] Opportunity successfully dismissed via API.')

  const [dbOppC] = await sql`select status, dismissed_at, dismissed_by_user_id, dismissed_reason from opportunities where id = ${opportunityId}::uuid`
  console.log(`[validate] DB Check: status=${dbOppC?.status}, dismissed_at=${dbOppC?.dismissed_at}, dismissed_by_user_id=${dbOppC?.dismissed_by_user_id}`)
  if (dbOppC?.status !== 'dismissed') throw new Error('DB Status was not updated to dismissed.')

  const reviewRowsC = await sql`select * from opportunity_reviews where opportunity_id = ${opportunityId}::uuid order by reviewed_at desc`
  console.log(`[validate] DB Check: opportunity_reviews row count = ${reviewRowsC.length}`)
  if (reviewRowsC.length !== 3) throw new Error('Expected 3 review log rows in DB.')

  // D) TEST TERMINAL PROTECTION (expect error if we try to change state of a dismissed opportunity)
  console.log('\n--- TEST D: TERMINAL STATE PROTECTION ---')
  const terminalRes = await fetch(`${apiBase}/api/v1/opportunities/${opportunityId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      reviewAction: 'qualified',
      explanation: 'Tentativa inválida de requalificar oportunidade descartada.',
    }),
  })

  console.log(`[validate] API response code: ${terminalRes.status}`)
  if (terminalRes.status !== 409) {
    throw new Error(`Expected 409 Conflict for terminal state modification, got ${terminalRes.status}`)
  }
  const terminalText = await terminalRes.text()
  console.log(`[validate] Expected conflict message: ${terminalText}`)

  // E) TEST GET REVIEWS ROUTE (new endpoint verification)
  console.log('\n--- TEST E: GET OPPORTUNITY REVIEWS ENDPOINT ---')
  const reviewsGetRes = await fetch(`${apiBase}/api/v1/opportunities/${opportunityId}/reviews`, {
    headers: {
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
  })
  if (!reviewsGetRes.ok) {
    throw new Error(`Failed to GET opportunity reviews: ${await reviewsGetRes.text()}`)
  }
  const reviewsGetBody = await reviewsGetRes.json() as any
  console.log(`[validate] GET reviews successfully returned ${reviewsGetBody.data.length} reviews.`)
  if (reviewsGetBody.data.length !== 3) {
    throw new Error(`Expected 3 reviews returned by endpoint, got ${reviewsGetBody.data.length}`)
  }

  console.log('\n=========================================')
  console.log('ALL TESTS PASSED SUCCESSFULLY! 🚀')
  console.log('=========================================')

  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error('[validate] Fatal error:', err)
  process.exit(1)
})
