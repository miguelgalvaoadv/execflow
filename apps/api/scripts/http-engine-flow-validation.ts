/**
 * Validates authenticated HTTP → engine evaluate → persistence using existing routes only.
 *
 * Prerequisites:
 * - API running with DATABASE_URL + Better Auth env
 * - db:migrate + db:seed (provisions Better Auth credential for admin@execflow.local)
 *
 * DATABASE_URL is required (org resolution, snapshot HTTP bootstrap + DB assertions).
 * Override org UUID with EXECFLOW_ORG_ID when needed.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... API_BASE=http://localhost:3001 pnpm --filter @execflow/api validate:http-engine
 */

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
  const fromEnv = process.env['EXECFLOW_ORG_ID']
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv

  const rows = await sql<{ id: string }[]>`
    select id::text as id from organizations where slug = 'execflow-demo' limit 1
  `
  const id = rows[0]?.id
  if (id === undefined) throw new Error('Organization execflow-demo not found — run db:seed.')
  console.info('[validate:http-engine] Resolved org id via DATABASE_URL / execflow-demo')
  return id
}

async function resolvePlaybookVersionId(sql: postgres.Sql): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select pv.id::text as id
    from playbook_versions pv
    inner join playbook_families pf on pf.id = pv.family_id
    where pf.slug = 'execflow-br-fed-base'
      and pv.version_label = 'v1.0-SEED'
      and pv.status = 'published'
    limit 1
  `
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error('Published playbook v1.0-SEED not found — run db:seed first.')
  }
  return id
}

async function countDomainEvents(sql: postgres.Sql, orgId: string): Promise<number> {
  const rows = await sql<{ c: number }[]>`
    select count(*)::int as c from domain_events where organization_id = ${orgId}::uuid
  `
  return rows[0]?.c ?? 0
}

async function main(): Promise<void> {
  const dbUrl = process.env['DATABASE_URL']?.trim()
  if (dbUrl === undefined || dbUrl === '') {
    throw new Error('DATABASE_URL is required (org lookup, snapshot bootstrap, DB verification).')
  }

  const apiBase = process.env['API_BASE'] ?? 'http://localhost:3001'
  const trustedOrigin = process.env['EXECFLOW_VALIDATE_ORIGIN'] ?? 'http://localhost:3000'
  const email = process.env['EXECFLOW_AUTH_EMAIL'] ?? 'admin@execflow.local'
  const password =
    process.env['EXECFLOW_AUTH_PASSWORD'] ??
    process.env['EXECFLOW_SEED_AUTH_PASSWORD'] ??
    'ExecflowDevSmoke123!'

  const sql = postgres(dbUrl)

  try {
    const orgId = await resolveOrgId(sql)

    const suffix = randomUUID().slice(0, 8)
    const clientInternalRef = `HTTP-E2E-CLI-${suffix}`
    const caseInternalRef = `HTTP-E2E-CASE-${suffix}`
    const processNumber = `0000888-88.2099.8.26.08${suffix.slice(0, 2)}`

    console.info('[validate:http-engine] 1) Middleware: unauthenticated GET /api/v1/me → expect 401')
    const anonMe = await fetch(`${apiBase}/api/v1/me`, { headers: { Origin: trustedOrigin } })
    if (anonMe.status !== 401) {
      throw new Error(`Expected 401 without session, got ${anonMe.status}`)
    }

    console.info('[validate:http-engine] 2) POST /api/auth/sign-in/email')
    const signInRes = await fetch(`${apiBase}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
      },
      body: JSON.stringify({ email, password }),
    })

    if (!signInRes.ok) {
      const t = await signInRes.text()
      throw new Error(`Sign-in failed ${signInRes.status}: ${t}`)
    }

    let jar = cookieHeaderFrom(signInRes)
    if (jar === '') {
      throw new Error('Sign-in did not return Set-Cookie — cannot continue.')
    }

    console.info('[validate:http-engine] 3) Authenticated GET /api/v1/me without org header → expect 422')
    const meNoOrg = await fetch(`${apiBase}/api/v1/me`, {
      headers: { Origin: trustedOrigin, Cookie: jar },
    })
    if (meNoOrg.status !== 422) {
      throw new Error(`Expected 422 without org context, got ${meNoOrg.status}`)
    }

    console.info('[validate:http-engine] 4) Org isolation: random X-Organization-Id → expect 403')
    const bogusOrg = randomUUID()
    const isoBad = await fetch(`${apiBase}/api/v1/me`, {
      headers: {
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': bogusOrg,
      },
    })
    if (isoBad.status !== 403) {
      throw new Error(`Expected 403 for non-membership org, got ${isoBad.status}`)
    }

    console.info('[validate:http-engine] 5) PUT /api/v1/me/session/active-organization')
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
      throw new Error(`active-organization failed ${putOrg.status}: ${await putOrg.text()}`)
    }

    const extraCookies = cookieHeaderFrom(putOrg)
    if (extraCookies !== '') {
      jar = `${jar}; ${extraCookies}`
    }

    console.info('[validate:http-engine] 6) GET /api/v1/me with X-Organization-Id → expect 200')
    const meOk = await fetch(`${apiBase}/api/v1/me`, {
      headers: {
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
    })
    if (!meOk.ok) {
      throw new Error(`/api/v1/me failed ${meOk.status}: ${await meOk.text()}`)
    }
    const meJson = (await meOk.json()) as {
      user: { id: string }
      role: string
      organization: { id: string }
    }

    if (meJson.organization.id !== orgId) {
      throw new Error('Org mismatch in /api/v1/me response')
    }

    console.info('[validate:http-engine] 7) POST /api/v1/clients (assistant+ middleware)')
    const clientRes = await fetch(`${apiBase}/api/v1/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
      body: JSON.stringify({
        fullName: `HTTP Engine E2E ${suffix}`,
        internalRef: clientInternalRef,
      }),
    })
    if (!clientRes.ok) {
      throw new Error(`create client failed ${clientRes.status}: ${await clientRes.text()}`)
    }
    const clientBody = (await clientRes.json()) as { data: { id: string } }
    const clientId = clientBody.data.id

    const domainEventsBeforeCase = await countDomainEvents(sql, orgId)
    console.info('[validate:http-engine] DB: domain_events count before case =', domainEventsBeforeCase)

    console.info('[validate:http-engine] 8) POST /api/v1/cases (lawyer+ middleware)')
    const caseRes = await fetch(`${apiBase}/api/v1/cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
      body: JSON.stringify({
        clientId,
        internalRef: caseInternalRef,
        openedAt: '2024-06-01T12:00:00.000Z',
        executionProcessNumber: processNumber,
      }),
    })
    if (!caseRes.ok) {
      throw new Error(`create case failed ${caseRes.status}: ${await caseRes.text()}`)
    }
    const caseBody = (await caseRes.json()) as { data: { id: string } }
    const caseId = caseBody.data.id

    const domainEventsAfterCase = await countDomainEvents(sql, orgId)
    console.info('[validate:http-engine] DB: domain_events count after case =', domainEventsAfterCase)
    if (domainEventsAfterCase <= domainEventsBeforeCase) {
      throw new Error('Expected case creation to append at least one domain_events row.')
    }

    console.info('[validate:http-engine] 9) Snapshot lifecycle via HTTP (propose → confirm)')
    const playbookVersionId = await resolvePlaybookVersionId(sql)
    const snapshotEffectiveAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const sentenceProposeRes = await fetch(`${apiBase}/api/v1/cases/${caseId}/sentence-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
      body: JSON.stringify({
        effectiveAt: snapshotEffectiveAt,
        totalSentenceDays: 1000,
        servedDays: 200,
        confidenceLevel: 'high',
        playbookVersionId,
      }),
    })
    if (!sentenceProposeRes.ok) {
      throw new Error(
        `propose sentence snapshot failed ${sentenceProposeRes.status}: ${await sentenceProposeRes.text()}`
      )
    }
    const sentenceProposeBody = (await sentenceProposeRes.json()) as { data: { id: string } }
    const sentenceSnapshotId = sentenceProposeBody.data.id

    const sentenceConfirmRes = await fetch(
      `${apiBase}/api/v1/sentence-snapshots/${sentenceSnapshotId}/confirm`,
      {
        method: 'POST',
        headers: {
          Origin: trustedOrigin,
          Cookie: jar,
          'X-Organization-Id': orgId,
        },
      }
    )
    if (!sentenceConfirmRes.ok) {
      throw new Error(
        `confirm sentence snapshot failed ${sentenceConfirmRes.status}: ${await sentenceConfirmRes.text()}`
      )
    }

    const custodyProposeRes = await fetch(`${apiBase}/api/v1/cases/${caseId}/custody-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
      body: JSON.stringify({
        effectiveAt: snapshotEffectiveAt,
        regime: 'fechado',
        confidence: 'high',
      }),
    })
    if (!custodyProposeRes.ok) {
      throw new Error(
        `propose custody snapshot failed ${custodyProposeRes.status}: ${await custodyProposeRes.text()}`
      )
    }
    const custodyProposeBody = (await custodyProposeRes.json()) as { data: { id: string } }
    const custodySnapshotId = custodyProposeBody.data.id

    const custodyConfirmRes = await fetch(
      `${apiBase}/api/v1/custody-snapshots/${custodySnapshotId}/confirm`,
      {
        method: 'POST',
        headers: {
          Origin: trustedOrigin,
          Cookie: jar,
          'X-Organization-Id': orgId,
        },
      }
    )
    if (!custodyConfirmRes.ok) {
      throw new Error(
        `confirm custody snapshot failed ${custodyConfirmRes.status}: ${await custodyConfirmRes.text()}`
      )
    }

    console.info('[validate:http-engine] 10) RBAC: assistant-only evaluate not exercised (no membership provisioning API).')

    console.info('[validate:http-engine] 11) POST /api/v1/engine/evaluate')
    const domainEventsBeforeEval = await countDomainEvents(sql, orgId)

    const evalRes = await fetch(`${apiBase}/api/v1/engine/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
      body: JSON.stringify({ caseId, jurisdictionScope: 'BR-FED' }),
    })

    if (!evalRes.ok) {
      throw new Error(`evaluate failed ${evalRes.status}: ${await evalRes.text()}`)
    }

    const evalJson = (await evalRes.json()) as {
      data: { engineRunId: string; opportunitiesCreated: number }
    }
    const engineRunId = evalJson.data.engineRunId
    const opportunitiesCreated = evalJson.data.opportunitiesCreated ?? 0

    const domainEventsAfterEval = await countDomainEvents(sql, orgId)
    console.info('[validate:http-engine] DB: domain_events after evaluate =', domainEventsAfterEval)
    const minNewEvents = 1 + opportunitiesCreated
    const delta = domainEventsAfterEval - domainEventsBeforeEval
    if (delta < minNewEvents) {
      throw new Error(
        `Expected evaluate to append transactional outbox rows (engine.run.completed + opportunity.created per suggestion). before=${domainEventsBeforeEval}, after=${domainEventsAfterEval}, opportunities=${opportunitiesCreated}, minDelta=${minNewEvents}`
      )
    }

    console.info('[validate:http-engine] 12) GET /api/v1/engine/runs/:id/explanation')
    const explRes = await fetch(`${apiBase}/api/v1/engine/runs/${engineRunId}/explanation`, {
      headers: {
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
    })
    if (!explRes.ok) {
      throw new Error(`explanation route failed ${explRes.status}: ${await explRes.text()}`)
    }
    const expl = (await explRes.json()) as {
      data: { bundles: unknown[]; traces: unknown[] }
    }

    if (expl.data.traces.length === 0) {
      throw new Error('Expected rule traces via explanation aggregate.')
    }
    if (expl.data.bundles.length === 0) {
      throw new Error('Expected explanation bundles (opportunity proposals produce bundles).')
    }

    console.info('[validate:http-engine] 13) GET /api/v1/engine/runs/:id — actor attribution')
    const runRes = await fetch(`${apiBase}/api/v1/engine/runs/${engineRunId}`, {
      headers: {
        Origin: trustedOrigin,
        Cookie: jar,
        'X-Organization-Id': orgId,
      },
    })
    if (!runRes.ok) {
      throw new Error(`get run failed ${runRes.status}`)
    }
    const runJson = (await runRes.json()) as {
      data: { requestedByUserId: string | null }
    }
    if (runJson.data.requestedByUserId !== meJson.user.id) {
      throw new Error(
        `EngineRun.requestedByUserId mismatch: ${runJson.data.requestedByUserId} vs session user ${meJson.user.id}`
      )
    }

    console.info('[validate:http-engine] OK — full HTTP auth + domain create + evaluate path validated.')
    console.info('[validate:http-engine] Summary:', {
      email,
      role: meJson.role,
      organizationId: orgId,
      clientId,
      caseId,
      engineRunId,
      traceCount: expl.data.traces.length,
      bundleCount: expl.data.bundles.length,
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('[validate:http-engine] Fatal:', err)
  process.exit(1)
})
