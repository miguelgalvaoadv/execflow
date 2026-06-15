# EXECFLOW: Current State

## MVP E2E Achieved
The ExecFlow system has reached its **Marco 1: MVP ExecFlow**.
The pipeline is fully connected and operational, proving the core value proposition:
**OCR → Snapshot → LegalFactProcessor → Evaluator → Persisted Opportunity → Dashboard**.

### What Works
1. **Frontend**: Next.js App Router workspace is active. The Case Dashboard accurately renders case metadata, timelines, and engine-generated Opportunities.
2. **Backend**: tRPC APIs and Drizzle ORM securely expose `opportunities`, `deadlines`, and `sentence-snapshots`.
3. **Engine Run Pipeline**: 
   - A direct E2E motor orchestrator (`engine-run-mvp.ts`) loads legal facts from the database and runs the `ProgressionEvaluator`.
   - The evaluator parses mock logic (1/6 progression fraction) and calculates a window for the Hero case.
   - The `OpportunityBuilder` writes the resulting `BenefitEvaluation` to the `opportunities` table natively.
4. **Worker / Queue**: The pg-boss workers (`engine-events.ts`) intercept recalculation events and fire the engine, persisting data asynchronously.
5. **Database**: PostgreSQL schema is stable with isolation (organizationId).

### What is Mocked (For the MVP)
- **Legal Fact Processor (LFP)**: Currently injects a fallback "Mock Sentence" of 1825 dias (5 anos) if database parsing yields empty results, ensuring the evaluator has data to process.
- **Rule Engine**: The Playbook currently uses a hardcoded `V1_MOCK` playbook instead of dynamically parsing the massive `playbook_versions` JSON.

## Next Phase Readiness
The system is ready for **Marco 2 (Benefícios Principais)**. The infrastructure is proven. The focus shifts entirely to Domain Logic (Progression, Parole, Remission rules) and removing the mocks inside LFP and Evaluators.
