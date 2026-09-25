-- Platform credentials are global operator configuration, never tenant records.
CREATE TABLE platform_settings (
 integration_id text PRIMARY KEY,
 revision integer NOT NULL CHECK(revision > 0),
 enabled boolean NOT NULL DEFAULT false,
 settings_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings_values)='object'),
 encrypted_secrets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(encrypted_secrets)='object'),
 last_test jsonb CHECK(last_test IS NULL OR jsonb_typeof(last_test)='object'),
 test_run_id uuid,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_settings_audit (
 id uuid PRIMARY KEY,
 integration_id text NOT NULL,
 revision integer NOT NULL CHECK(revision > 0),
 action text NOT NULL CHECK(action IN ('saved','tested','disconnected')),
 actor_id uuid NOT NULL,
 changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(changed_fields)='array'),
 result text CHECK(result IN ('verified','validated','unavailable','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_settings_audit_recent ON platform_settings_audit(created_at DESC,id);
CREATE TRIGGER platform_settings_audit_immutable BEFORE UPDATE OR DELETE ON platform_settings_audit FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON platform_settings,platform_settings_audit FROM PUBLIC,trainer_app;
-- Existing installations may already have the non-owner system runtime role.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON platform_settings TO trainer_service;
 GRANT SELECT,INSERT ON platform_settings_audit TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('011_platform_settings');
