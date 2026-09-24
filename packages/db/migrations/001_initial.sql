CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='trainer_app') THEN CREATE ROLE trainer_app NOLOGIN NOBYPASSRLS; END IF; END $$;
CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, email_verified boolean NOT NULL DEFAULT false, platform_role text NOT NULL DEFAULT 'none' CHECK(platform_role IN ('none','admin','finance','support','safety')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tenants (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, published boolean NOT NULL DEFAULT false, theme jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (tenant_id uuid REFERENCES tenants(id), user_id uuid REFERENCES users(id), role text NOT NULL CHECK(role IN ('owner','staff','subscriber','finance')), PRIMARY KEY(tenant_id,user_id));
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), tenant_id uuid NOT NULL REFERENCES tenants(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE one_time_tokens (token_hash text PRIMARY KEY, purpose text NOT NULL, user_id uuid REFERENCES users(id), tenant_id uuid REFERENCES tenants(id), payload jsonb NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE TABLE records (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL, owner_user_id uuid REFERENCES users(id), status text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id));
CREATE INDEX records_scope ON records(tenant_id,kind,updated_at DESC);
CREATE INDEX records_owner ON records(tenant_id,owner_user_id,kind);
CREATE TABLE events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid, name text NOT NULL, subject_id text, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX events_timeline ON events(tenant_id,created_at DESC);
CREATE TABLE jobs (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL, intent_key text NOT NULL UNIQUE, data jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE provider_events (provider text NOT NULL, external_id text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'received', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,external_id));
CREATE TABLE subscriptions (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), provider_id text UNIQUE, status text NOT NULL, cancel_at_period_end boolean NOT NULL DEFAULT false, period_end timestamptz, price_minor bigint NOT NULL DEFAULT 0 CHECK(price_minor>=0), data jsonb NOT NULL DEFAULT '{}', UNIQUE(tenant_id,user_id));
CREATE TABLE journals (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), source_key text NOT NULL, description text NOT NULL, currency text NOT NULL DEFAULT 'AED' CHECK(currency='AED'), data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,source_key), UNIQUE(tenant_id,id));
CREATE TABLE journal_lines (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, journal_id uuid NOT NULL, account text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor<>0), FOREIGN KEY(tenant_id,journal_id) REFERENCES journals(tenant_id,id));
CREATE INDEX journal_account ON journal_lines(tenant_id,account);
CREATE TABLE payouts (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), period text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), beneficiary_id text NOT NULL, status text NOT NULL DEFAULT 'ready', provider_id text, bank_reference text, failure_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,period));
CREATE TABLE workout_events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), workout_id uuid NOT NULL, event_key text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,user_id,event_key));
CREATE TABLE cost_events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid, task text NOT NULL, provider text NOT NULL, model text, input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0, cost_usd numeric(18,8), price_version text, trace_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE consent_records (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), document_type text NOT NULL, document_version text NOT NULL, granted boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE domain_mappings (hostname text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), verified_at timestamptz, active boolean NOT NULL DEFAULT false);

CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable record; write a compensating entry'; END $$;
CREATE TRIGGER journals_immutable BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER lines_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER consents_immutable BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE total bigint; n bigint; BEGIN SELECT coalesce(sum(amount_minor),0),count(*) INTO total,n FROM journal_lines WHERE journal_id=NEW.id AND tenant_id=NEW.tenant_id; IF total<>0 OR n<2 THEN RAISE EXCEPTION 'journal must contain balanced lines'; END IF; RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER journal_balance AFTER INSERT ON journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balanced_journal();

DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['records','events','jobs','subscriptions','journals','journal_lines','payouts','workout_events','cost_events','consent_records'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
END LOOP; END $$;
CREATE POLICY record_subscriber_scope ON records AS RESTRICTIVE USING (current_setting('app.role',true)<>'subscriber' OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid OR (kind='product' AND status='published')) WITH CHECK (current_setting('app.role',true)<>'subscriber' OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['subscriptions','workout_events','consent_records'] LOOP
 EXECUTE format('CREATE POLICY own_scope ON %I AS RESTRICTIVE USING (current_setting(''app.role'',true)<>''subscriber'' OR user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.role'',true)<>''subscriber'' OR user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',t);
END LOOP; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['journals','journal_lines','payouts','events','jobs','cost_events'] LOOP
 EXECUTE format('CREATE POLICY staff_scope ON %I AS RESTRICTIVE USING (current_setting(''app.role'',true) IN (''owner'',''staff'',''finance''))',t);
END LOOP; END $$;
GRANT USAGE ON SCHEMA public TO trainer_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO trainer_app;
REVOKE UPDATE,DELETE ON journals,journal_lines,events,consent_records FROM trainer_app;
INSERT INTO schema_migrations(version) VALUES('001_initial');

ALTER POLICY staff_scope ON events WITH CHECK (true);
ALTER POLICY staff_scope ON jobs WITH CHECK (true);
ALTER POLICY staff_scope ON cost_events WITH CHECK (true);
