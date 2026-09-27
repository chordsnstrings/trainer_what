CREATE TABLE acquisition_consents (
 visitor_id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, origin text NOT NULL,
 host_tenant_id uuid REFERENCES tenants(id), tenant_id uuid REFERENCES tenants(id), user_id uuid REFERENCES users(id),
 policy_version text NOT NULL, first_touch jsonb NOT NULL, last_touch jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '180 days',
 CHECK ((tenant_id IS NULL) = (user_id IS NULL))
);
CREATE INDEX acquisition_consent_account ON acquisition_consents(tenant_id,user_id);
ALTER TABLE acquisition_events DROP CONSTRAINT acquisition_events_name_check;
ALTER TABLE acquisition_events ADD CONSTRAINT acquisition_events_name_check CHECK(name IN ('landing','signup','enroll','publish','lead','first_paid','experiment_exposure'));
ALTER TABLE acquisition_events ADD COLUMN attribution jsonb NOT NULL DEFAULT '{}';
ALTER TABLE acquisition_events ADD COLUMN experiment_id uuid REFERENCES admin_experiments(id);
ALTER TABLE acquisition_events ADD COLUMN experiment_revision integer;
ALTER TABLE acquisition_events ADD COLUMN variant text CHECK(variant IN ('a','b'));
REVOKE ALL ON acquisition_consents FROM trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON acquisition_consents TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('029_acquisition_consent');
