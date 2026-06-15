# Upload + Storage Layer — Implementation Report

**Date:** 2026-05-27  
**Scope:** Physical file → storage → document metadata. No OCR, extraction, upload UI, or AI.

---

## Architecture

```
Client                    API                         Storage
  │                         │                              │
  ├─ POST /uploads/request ─► issue token + presigned URL  │
  │                         │                              │
  ├─ PUT uploadUrl ─────────┼──────────────────────────────► blob (immutable key)
  │   + X-Upload-Token      │                              │
  │                         │                              │
  ├─ POST /uploads/complete ► verify checksum ────────────► head/read + sha256
  │                         ├─ registerDocument()          │
  │                         └─ document.registered         │
```

**Package split:**

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Provider abstraction | `packages/storage` | Presigned URLs, checksum verification |
| Upload orchestration | `apps/api/src/services/upload.ts` | Token, audit, document registration |
| HTTP | `apps/api/src/routes/uploads.ts` | RBAC, validation, local PUT handler |

---

## Provider abstraction

**Interface:** `StorageProvider` (`packages/storage/src/types.ts`)

| Method | Purpose |
|--------|---------|
| `createPresignedUpload` | Issue client-direct upload URL + headers |
| `verifyObject` | Confirm object exists, size + SHA-256 match |
| `putObject` | Local provider only — dev/test PUT handler |

**Implementations:**

| ID | Use case | Upload target |
|----|----------|---------------|
| `local` | Dev + integration tests | `PUT /api/v1/uploads/blob` (token header) |
| `s3` | Production R2 / AWS S3 / MinIO | Presigned S3 PUT URL |

**Configuration:** `STORAGE_PROVIDER=local|s3` — see `apps/api/.env.example`.

Storage keys are immutable and org-scoped:

```
{organizationId}/{year}/{month}/{uploadId}.{ext}
```

---

## Endpoints

| Method | Path | Auth | Action |
|--------|------|------|--------|
| POST | `/api/v1/uploads/request` | assistant+ | Presigned URL + upload token |
| POST | `/api/v1/uploads/complete` | assistant+ | Checksum verify + register document |
| PUT | `/api/v1/uploads/blob` | `X-Upload-Token` | Local provider blob write only |

### Request body (`/request`)

- `fileName`, `mimeType`, `byteSize`, `checksumSha256` (client-computed, verified on complete)
- `sourceChannel` (intake enum)

### Complete body (`/complete`)

- `uploadToken`
- Optional: `clientId`, `executionCaseId`, `intakeBundleId`, `documentClass`, `sensitivityLevel`

---

## Validations

| Check | Where |
|-------|-------|
| Max file size (50 MiB default) | `requestUpload` |
| MIME allowlist (PDF, images, DOCX…) | `requestUpload` |
| SHA-256 format | `requestUpload` + `verifyObject` |
| Org scope on token vs `X-Organization-Id` | `completeUpload` |
| Storage key prefix = org id | `assertStorageKeyBelongsToOrg` |
| Byte size + checksum vs stored blob | `StorageProvider.verifyObject` |
| Duplicate storage key | `completeUpload` |
| RBAC assistant+ | Route middleware |

---

## Audit + events

| Step | AuditLog | DomainEvent |
|------|----------|-------------|
| Request | `upload_requested` / entity `Upload` | — |
| Complete | `upload_completed` / entity `Upload` | `document.registered` (via `registerDocument`) |

Blobs remain **append-only / immutable** — no overwrite of existing keys; registration is idempotent per `storageKey`.

---

## Tests

**Run:** `MIGRATION_TEST_DATABASE_URL=... pnpm --filter @execflow/api test:uploads`

| Test | Coverage |
|------|----------|
| Upload request | Presigned response + audit log |
| Valid complete | Document row + `document.registered` |
| Checksum mismatch | Validation error |
| Cross-org complete | Forbidden |
| Disallowed MIME | Validation error |
| Duplicate complete | Single document row |

---

## Residual risks

1. **Client-side checksum trust** — server verifies stored bytes vs declared hash; client could lie at request time but cannot pass complete with wrong bytes.
2. **Local PUT endpoint** — enabled only for `STORAGE_PROVIDER=local`; must not be exposed in production S3 mode.
3. **Register-with-case at upload** — optional associations on complete; documents without case stay `pending_association` (no extraction queue until associate).
4. **S3/R2 production** — requires env credentials; large files stream through API on verify (acceptable for MVP; future: S3 checksum headers).
5. **Token replay** — same token can complete once; duplicate blocked by storage key uniqueness.

---

## Future OCR integration

When extraction is implemented:

1. OCR worker reads blob via `storageKey` (read-only signed URL — future `StorageProvider.createPresignedDownload`).
2. Pipeline transitions `pending_extraction` → `extraction_running` → `extraction_review`.
3. Field confirmation emits `document.confirmed` (consumer already wired).
4. No changes to upload flow — OCR consumes immutable blob referenced by registered document.

---

## Files created / modified

**New package:** `packages/storage/`  
**API:** `services/upload.ts`, `routes/uploads.ts`, `lib/upload-token.ts`, `lib/storage.ts`  
**Tests:** `apps/api/src/__tests__/upload-storage.test.ts`  
**Config:** `apps/api/.env.example`, `apps/api/package.json`, `apps/api/src/app.ts`
