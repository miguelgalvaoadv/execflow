import { randomUUID, createHash } from 'node:crypto'
import postgres from 'postgres'

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

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
  console.log('[validate-doc] Connecting to database and resolving org...')
  const orgId = await resolveOrgId(sql)

  console.log('[validate-doc] 1) Sign in...')
  const signInRes = await fetch(`${apiBase}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: trustedOrigin },
    body: JSON.stringify({ email, password }),
  })

  if (!signInRes.ok) {
    throw new Error(`Sign-in failed: ${await signInRes.text()}`)
  }

  let jar = cookieHeaderFrom(signInRes)

  console.log('[validate-doc] 2) Set active organization...')
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

  // A) GET A CASE ID
  const caseRows = await sql`select id::text as id from execution_cases where organization_id = ${orgId}::uuid limit 1`
  const caseId = caseRows[0]?.id
  if (!caseId) throw new Error('No cases found to bind document.')

  // B) PREPARE MOCK PDF FILE
  console.log('\n--- TEST A: PREPARE AND HASH MOCK FILE ---')
  const mockFileContent = Buffer.from('%PDF-1.4 Mock PDF Content for E2E validation ' + randomUUID())
  const checksumSha256 = sha256Hex(mockFileContent)
  const fileName = `e2e-val-doc-${randomUUID().slice(0, 8)}.pdf`
  const mimeType = 'application/pdf'
  const byteSize = mockFileContent.byteLength

  console.log(`[validate-doc] File Name: ${fileName}`)
  console.log(`[validate-doc] Byte Size: ${byteSize}`)
  console.log(`[validate-doc] SHA-256: ${checksumSha256}`)

  // C) REQUEST UPLOAD (POST /api/v1/uploads/request)
  console.log('\n--- TEST B: REQUEST UPLOAD ---')
  const reqUploadRes = await fetch(`${apiBase}/api/v1/uploads/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      fileName,
      mimeType,
      byteSize,
      checksumSha256,
      sourceChannel: 'intake_manual',
    }),
  })

  if (!reqUploadRes.ok) {
    throw new Error(`Request upload failed: ${await reqUploadRes.text()}`)
  }
  const reqUploadJson = await reqUploadRes.json() as any
  const { uploadUrl, uploadToken, storageKey } = reqUploadJson.data
  console.log(`[validate-doc] Request successful. Storage Key: ${storageKey}`)

  // D) PUT BLOB DIRECTLY TO LOCAL STORAGE (PUT /api/v1/uploads/blob)
  console.log('\n--- TEST C: PUT BLOB TO STORAGE ---')
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(byteSize),
      'X-Upload-Token': uploadToken,
    },
    body: mockFileContent,
  })

  if (!putRes.ok) {
    throw new Error(`Failed to PUT file to storage: ${await putRes.text()}`)
  }
  console.log('[validate-doc] Blob successfully stored in local storage.')

  // E) COMPLETE UPLOAD (POST /api/v1/uploads/complete)
  console.log('\n--- TEST D: COMPLETE UPLOAD AND ASSOCIATE TO CASE ---')
  const completeRes = await fetch(`${apiBase}/api/v1/uploads/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
    body: JSON.stringify({
      uploadToken,
      executionCaseId: caseId,
      documentClass: 'Sentença',
      sensitivityLevel: 'standard',
    }),
  })

  if (!completeRes.ok) {
    throw new Error(`Failed to complete upload: ${await completeRes.text()}`)
  }
  const completeJson = await completeRes.json() as any
  const documentId = completeJson.data.id
  console.log(`[validate-doc] Document registered successfully in DB. Document ID: ${documentId}`)

  // F) QUERY THE CASE DOCUMENTS (GET /api/v1/cases/:caseId/documents)
  console.log('\n--- TEST E: QUERY DOCUMENTS LIST FOR CASE ---')
  const listRes = await fetch(`${apiBase}/api/v1/cases/${caseId}/documents`, {
    headers: {
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
  })
  if (!listRes.ok) {
    throw new Error(`Failed to query case documents: ${await listRes.text()}`)
  }
  const listJson = await listRes.json() as any
  const foundDoc = listJson.data.find((d: any) => d.id === documentId)
  if (!foundDoc) throw new Error('Uploaded document was not returned in case documents list.')
  console.log(`[validate-doc] Found document in list: fileName="${foundDoc.fileName}", documentClass="${foundDoc.documentClass}", status="${foundDoc.status}"`)

  // G) DOWNLOAD AND VERIFY FILE CONTENTS (GET /api/v1/documents/:id/download)
  console.log('\n--- TEST F: SECURE DOWNLOAD / VIEW INLINE ---')
  const downloadRes = await fetch(`${apiBase}/api/v1/documents/${documentId}/download`, {
    headers: {
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
  })

  if (!downloadRes.ok) {
    throw new Error(`Failed to download document: ${await downloadRes.text()}`)
  }
  
  const contentType = downloadRes.headers.get('Content-Type')
  const contentDisposition = downloadRes.headers.get('Content-Disposition')
  const downloadBuffer = Buffer.from(await downloadRes.arrayBuffer())
  const downloadedHash = sha256Hex(downloadBuffer)

  console.log(`[validate-doc] Content-Type: ${contentType}`)
  console.log(`[validate-doc] Content-Disposition: ${contentDisposition}`)
  console.log(`[validate-doc] Downloaded Hash: ${downloadedHash}`)

  if (contentType !== mimeType) throw new Error(`Content-Type mismatch: ${contentType}`)
  if (!contentDisposition?.includes('inline')) throw new Error(`Content-Disposition must be inline: ${contentDisposition}`)
  if (downloadedHash !== checksumSha256) throw new Error('Downloaded file bytes checksum mismatch!')

  console.log('[validate-doc] File download matches uploaded contents exactly.')

  // H) DIRECT FILE DOWNLOAD ATTACHMENT (GET /api/v1/documents/:id/download?download=true)
  console.log('\n--- TEST G: SECURE DOWNLOAD AS ATTACHMENT ---')
  const downloadAttachmentRes = await fetch(`${apiBase}/api/v1/documents/${documentId}/download?download=true`, {
    headers: {
      Origin: trustedOrigin,
      Cookie: jar,
      'X-Organization-Id': orgId,
    },
  })
  if (!downloadAttachmentRes.ok) {
    throw new Error(`Failed to download document as attachment: ${await downloadAttachmentRes.text()}`)
  }
  const attachmentDisposition = downloadAttachmentRes.headers.get('Content-Disposition')
  console.log(`[validate-doc] Content-Disposition: ${attachmentDisposition}`)
  if (!attachmentDisposition?.includes('attachment')) throw new Error(`Content-Disposition must be attachment: ${attachmentDisposition}`)

  console.log('\n=========================================')
  console.log('ALL DOCUMENT WORKFLOW TESTS PASSED! 🚀')
  console.log('=========================================')

  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error('[validate-doc] Fatal error:', err)
  process.exit(1)
})
