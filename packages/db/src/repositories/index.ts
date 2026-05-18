/**
 * Repository layer — Phase 1 foundation.
 *
 * This file defines the structural contracts that all future repositories must follow.
 * No concrete repository implementations exist yet — those are built in Phase 3
 * (Core case management API) when the full entity schema is in place.
 *
 * Architecture ref: IMPLEMENTATION_ORDER.md §3 (Phase 3 prerequisites),
 *                   ARCHITECTURE_RULES.md (layer discipline — repositories sit
 *                   between the service layer and the database client).
 *
 * REPOSITORY RULES (enforced in code review):
 * 1. Repositories accept a DbClient or DbTransaction as their first parameter.
 *    They never import a global database client singleton.
 * 2. Repositories return RepositoryResult<T> — they never throw.
 * 3. Repositories never implement business logic — only data access patterns.
 * 4. Repositories never skip the organization_id filter on org-scoped queries.
 * 5. Repositories for append-only tables expose NO update or delete methods.
 *    Any call site that needs to "update" an append-only entity must create
 *    a new record (with the appropriate supersedes/amends reference).
 * 6. Every write repository method that changes legal state must accept an
 *    auditEntry parameter and write it in the same transaction.
 *
 * FORBIDDEN REPOSITORY PATTERNS:
 * - `findAll()` with no pagination — all list methods accept PaginationParams.
 * - Cross-organization queries — every query includes organization_id.
 * - `delete()` or `hardDelete()` on legal history entities.
 * - `update()` on AuditLog, TimelineEvent, SentenceSnapshot, PieceVersion, Filing.
 * - Business logic in repository methods (role checks, state machine evaluation).
 */

export type {
  RepositoryResult,
  RepositoryError,
  PaginationParams,
  PaginatedResult,
} from '../types/index.ts'

/**
 * Base interface contract that all concrete repositories implement.
 * TSelect: the Drizzle $inferSelect type for the entity.
 * TInsert: the Drizzle $inferInsert type for the entity.
 *
 * Not all repositories implement all methods — append-only repositories
 * omit update/delete. This interface documents the common shape;
 * individual repository files document their specific methods.
 */
export interface BaseRepositoryContract<TSelect, TInsert> {
  /**
   * Find a single entity by its primary key, scoped to the organization.
   * Returns NOT_FOUND if the entity doesn't exist or belongs to a different org.
   */
  findById(
    organizationId: string,
    id: string
  ): Promise<import('../types/index.ts').RepositoryResult<TSelect>>

  /**
   * Insert a new entity record.
   * For mutable entities: also writes an AuditLog entry in the same transaction.
   * For append-only entities: the entity itself IS the audit record.
   */
  insert(
    data: TInsert
  ): Promise<import('../types/index.ts').RepositoryResult<TSelect>>
}

/**
 * Marker interface for append-only repositories.
 * Implementing this interface signals that the repository intentionally
 * has no update or delete methods. Used for:
 *   - AuditLogRepository
 *   - TimelineEventRepository (future)
 *   - SentenceSnapshotRepository (future)
 *   - PieceVersionRepository (future)
 *   - FilingRepository (future)
 *   - DomainEventRepository
 */
export interface AppendOnlyRepository<TSelect, TInsert> {
  /**
   * Append a new immutable record.
   * After this call, the record can never be modified or deleted.
   */
  append(
    data: TInsert
  ): Promise<import('../types/index.ts').RepositoryResult<TSelect>>

  /**
   * Query the append-only log.
   * Must always be scoped by organization_id.
   * Must always accept pagination parameters.
   */
  query(
    organizationId: string,
    params: import('../types/index.ts').PaginationParams
  ): Promise<import('../types/index.ts').RepositoryResult<
    import('../types/index.ts').PaginatedResult<TSelect>
  >>
}
