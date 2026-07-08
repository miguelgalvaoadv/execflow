/**
 * Stable TanStack Query key factory.
 *
 * Keys are hierarchical: invalidating a parent key invalidates all children.
 * All keys include organizationId as a scope segment so cross-org data
 * never leaks between org-switching sessions.
 *
 * Convention:
 *   ['resource', orgId]              — list (all items)
 *   ['resource', orgId, id]          — single item
 *   ['resource', orgId, filters]     — filtered list
 */

export const queryKeys = {
  // Session — not org-scoped (user identity)
  session: () => ['session'] as const,

  // Queue projections — the primary operational surface
  queueProjections: (orgId: string, filters?: {
    queueType?: string
    assigneeUserId?: string
    executionCaseId?: string
  }) =>
    filters !== undefined
      ? (['queue-projections', orgId, filters] as const)
      : (['queue-projections', orgId] as const),

  // Opportunities
  opportunities: (orgId: string, executionCaseId?: string) =>
    executionCaseId !== undefined
      ? (['opportunities', orgId, executionCaseId] as const)
      : (['opportunities', orgId] as const),
  opportunityReviews: (orgId: string, opportunityId: string) =>
    ['opportunity-reviews', orgId, opportunityId] as const,

  // Execution cases
  cases: (
    orgId: string,
    filters?: {
      status?: string
      courtJurisdiction?: string
      q?: string
    }
  ) =>
    filters !== undefined
      ? (['cases', orgId, filters] as const)
      : (['cases', orgId] as const),
  case: (orgId: string, caseId: string) => ['cases', orgId, caseId] as const,

  caseTimeline: (orgId: string, caseId: string) =>
    ['case-timeline', orgId, caseId] as const,
  caseDocuments: (orgId: string, caseId: string) =>
    ['case-documents', orgId, caseId] as const,
  caseOpportunities: (orgId: string, caseId: string) =>
    ['case-opportunities', orgId, caseId] as const,
  caseDeadlines: (orgId: string, caseId: string) =>
    ['case-deadlines', orgId, caseId] as const,
  caseNotes: (orgId: string, caseId: string) => ['cases', orgId, caseId, 'notes'] as const,

  // Clients
  clients: (
    orgId: string,
    filters?: {
      status?: string
      q?: string
    }
  ) =>
    filters !== undefined
      ? (['clients', orgId, filters] as const)
      : (['clients', orgId] as const),
  client: (orgId: string, clientId: string) => ['clients', orgId, clientId] as const,

  // Documents
  documents: (
    orgId: string,
    filters?: {
      status?: string
      documentClass?: string
      q?: string
    }
  ) =>
    filters !== undefined
      ? (['documents', orgId, filters] as const)
      : (['documents', orgId] as const),
  document: (orgId: string, documentId: string) => ['documents', orgId, documentId] as const,

  // Deadlines
  deadlines: (
    orgId: string,
    filters?: {
      status?: string
      deadlineClass?: string
      priority?: string
      q?: string
    }
  ) =>
    filters !== undefined
      ? (['deadlines', orgId, filters] as const)
      : (['deadlines', orgId] as const),
  deadline: (orgId: string, deadlineId: string) => ['deadlines', orgId, deadlineId] as const,

  // Opportunities — org-wide list (Oportunidades hub)
  opportunitiesList: (
    orgId: string,
    filters?: {
      status?: string
      opportunityType?: string
      q?: string
    }
  ) =>
    filters !== undefined
      ? (['opportunities-list', orgId, filters] as const)
      : (['opportunities-list', orgId] as const),
  deadlineHistory: (orgId: string, deadlineId: string) =>
    ['deadline-history', orgId, deadlineId] as const,

  // Engine runs
  engineRuns: (orgId: string, caseId?: string, limit?: number) =>
    caseId !== undefined
      ? (['engine-runs', orgId, caseId, limit ?? 20] as const)
      : (['engine-runs', orgId, 'org', limit ?? 20] as const),
  engineRun: (orgId: string, runId: string) =>
    ['engine-runs', orgId, runId] as const,
  engineRunExplanation: (orgId: string, runId: string) =>
    ['engine-runs', orgId, runId, 'explanation'] as const,

  caseSentenceSnapshots: (orgId: string, caseId: string) =>
    ['case-sentence-snapshots', orgId, caseId] as const,

  // Inventário por OAB
  inventoryProfiles: (orgId: string) => ['inventory-profiles', orgId] as const,
  inventoryItems: (
    orgId: string,
    filters?: {
      priority?: string
      reviewStatus?: string
      needsAutos?: string
      withoutClient?: string
      q?: string
    }
  ) =>
    filters !== undefined
      ? (['inventory-items', orgId, filters] as const)
      : (['inventory-items', orgId] as const),
} as const
