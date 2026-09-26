-- Temporary support capabilities never replace a user's authenticated session.
CREATE TABLE support_preview_grants (
 id uuid PRIMARY KEY,
 operator_id uuid NOT NULL REFERENCES users(id),
 session_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 target_user_id uuid NOT NULL REFERENCES users(id),
 target_role text NOT NULL CHECK(target_role IN ('owner','staff','subscriber')),
 membership_version integer NOT NULL,
 case_id uuid NOT NULL,
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 3 AND scopes <@ ARRAY['account','access','connections']::text[]),
 mode text NOT NULL DEFAULT 'read_only' CHECK(mode='read_only'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 end_reason text,
 UNIQUE(operator_id,session_id,request_key),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes'),
 CHECK((status='active' AND ended_at IS NULL AND end_reason IS NULL) OR (status<>'active' AND ended_at IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE UNIQUE INDEX support_preview_active_session ON support_preview_grants(session_id) WHERE status='active';
CREATE INDEX support_preview_subject ON support_preview_grants(tenant_id,target_user_id,created_at DESC);
CREATE FUNCTION protect_support_preview_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','revision','ended_at','end_reason']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','revision','ended_at','end_reason']) THEN
  RAISE EXCEPTION 'Support preview identity, scope and expiry are immutable';
 END IF;
 IF OLD.status<>'active' OR NEW.status NOT IN ('revoked','expired') OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Support preview can only end once';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER support_preview_sealed BEFORE UPDATE ON support_preview_grants FOR EACH ROW EXECUTE FUNCTION protect_support_preview_grant();
REVOKE ALL ON support_preview_grants FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON support_preview_grants TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('031_support_preview');
