CREATE TABLE admin_documents (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('legal','notification','support_macro','safety')),
 key text NOT NULL, version integer NOT NULL CHECK(version>0), revision integer NOT NULL DEFAULT 1,
 title text NOT NULL, content text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 effective_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), published_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 UNIQUE(kind,key,version), CHECK(status='draft' OR (effective_at IS NOT NULL AND published_at IS NOT NULL))
);
CREATE FUNCTION protect_published_admin_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status='published' THEN RAISE EXCEPTION 'Published documents are immutable; create another version'; END IF;
IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER admin_document_immutable BEFORE UPDATE OR DELETE ON admin_documents FOR EACH ROW EXECUTE FUNCTION protect_published_admin_document();
CREATE TABLE admin_operations_audit (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
 tenant_id uuid REFERENCES tenants(id), subject_id text, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER admin_operations_audit_immutable BEFORE UPDATE OR DELETE ON admin_operations_audit FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE acquisition_events (
 id uuid PRIMARY KEY, event_key text NOT NULL UNIQUE, name text NOT NULL CHECK(name IN ('landing','signup','publish','lead')),
 tenant_id uuid REFERENCES tenants(id), user_id uuid REFERENCES users(id), visitor_id uuid NOT NULL,
 source text NOT NULL, campaign text NOT NULL DEFAULT '', medium text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acquisition_funnel ON acquisition_events(created_at,name,source);
CREATE FUNCTION protect_acquisition_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP='DELETE' AND current_user<>'trainer_app' AND current_setting('app.privacy_erasure',true)='true' THEN RETURN OLD; END IF;
RAISE EXCEPTION 'Acquisition events are immutable except approved erasure'; END $$;
CREATE TRIGGER acquisition_events_immutable BEFORE UPDATE OR DELETE ON acquisition_events FOR EACH ROW EXECUTE FUNCTION protect_acquisition_event();
CREATE TABLE admin_experiments (
 id uuid PRIMARY KEY, key text NOT NULL UNIQUE, title text NOT NULL, surface text NOT NULL CHECK(surface IN ('landing','onboarding')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','stopped','completed')),
 revision integer NOT NULL DEFAULT 1, allocation integer NOT NULL CHECK(allocation BETWEEN 1 AND 50),
 variant_a text NOT NULL, variant_b text NOT NULL, metric text NOT NULL CHECK(metric IN ('signup','publish')),
 guardrail text NOT NULL, result text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON admin_documents,admin_operations_audit,acquisition_events,admin_experiments FROM trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON admin_documents,admin_experiments TO trainer_service;
 GRANT SELECT,INSERT ON admin_operations_audit,acquisition_events TO trainer_service;
 GRANT DELETE ON acquisition_events TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('016_admin_completion');
