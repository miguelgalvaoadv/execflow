-- =============================================================================
-- EXECFLOW — Post-Baseline Triggers
-- =============================================================================
-- Applies the set_updated_at() trigger function and all triggers for mutable tables.
-- These were part of the manual migrations 0001-0005 and are not generated
-- by Drizzle Kit (which manages only DDL for tables/columns/indexes/enums).
-- =============================================================================

-- Trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Phase 1: Foundation entities
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phase 3: Core domain entities
CREATE TRIGGER set_prison_units_updated_at
  BEFORE UPDATE ON prison_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_execution_cases_updated_at
  BEFORE UPDATE ON execution_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_intake_bundles_updated_at
  BEFORE UPDATE ON intake_bundles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phase 5: Deadlines and opportunities
CREATE TRIGGER deadlines_updated_at
  BEFORE UPDATE ON deadlines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phase 6: Queue and workflow entities
CREATE TRIGGER queue_projections_updated_at
  BEFORE UPDATE ON queue_projections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER workflow_tasks_updated_at
  BEFORE UPDATE ON workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Additional mutable tables that have updated_at columns
-- (from Phase 7 engine/playbook entities)
CREATE TRIGGER playbook_versions_updated_at
  BEFORE UPDATE ON playbook_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER org_playbook_configs_updated_at
  BEFORE UPDATE ON org_playbook_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER prison_units_updated_at
  BEFORE UPDATE ON prison_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
