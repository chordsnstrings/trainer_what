ALTER TABLE tenants ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','closed'));
ALTER TABLE tenants ADD COLUMN closed_at timestamptz;

CREATE TABLE privacy_followups (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), request_id uuid NOT NULL,
 user_id uuid REFERENCES users(id), scope text NOT NULL CHECK(scope IN ('provider','backup','retention','source')),
 subject text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','retained')),
 due_at timestamptz NOT NULL, evidence_reference text, completed_at timestamptz, completed_by uuid REFERENCES users(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id,scope,subject)
);
ALTER TABLE privacy_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_followups FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_followup_scope ON privacy_followups USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 (current_setting('app.role',true)='owner' OR user_id=nullif(current_setting('app.user_id',true),'')::uuid)
) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='owner');
GRANT SELECT,INSERT,UPDATE ON privacy_followups TO trainer_app;

-- System-only records. Minimal subject IDs let a restore replay erasure before
-- opening traffic; a backup deadline alone never declares an erasure complete.
CREATE TABLE privacy_erasure_registry (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid REFERENCES users(id),
 request_id uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('member','workspace')),
 retention_policy_version text NOT NULL, evidence_reference text NOT NULL, erased_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id)
);
CREATE TRIGGER privacy_erasure_registry_immutable BEFORE UPDATE OR DELETE ON privacy_erasure_registry FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE workspace_lifecycle_requests (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 kind text NOT NULL CHECK(kind IN ('closure','ownership_transfer')),
 requested_by uuid NOT NULL REFERENCES users(id), target_user_id uuid REFERENCES users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','canceled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), data jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX one_pending_workspace_lifecycle ON workspace_lifecycle_requests(tenant_id) WHERE status='pending';
REVOKE ALL ON privacy_erasure_registry,workspace_lifecycle_requests FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON privacy_erasure_registry TO trainer_service;
 GRANT SELECT,INSERT,UPDATE ON workspace_lifecycle_requests TO trainer_service;
END IF; END $$;

-- Brain rule history is personal teaching material during whole-workspace
-- erasure. Financial statements and closes remain immutable under all roles.
CREATE OR REPLACE FUNCTION immutable_financial_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind IN ('close','statement') OR
 (OLD.kind='rule_revision' AND NOT (TG_OP='DELETE' AND current_setting('app.privacy_erasure',true)='true')) THEN
 RAISE EXCEPTION 'historical records cannot be changed'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
GRANT DELETE ON bookings,booking_slots,nutrition_ingredients,nutrition_recipe_options,nutrition_recipes,nutrition_foods TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('020_privacy_completion');
