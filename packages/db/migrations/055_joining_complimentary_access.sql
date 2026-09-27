-- Trainer-granted complimentary access. A grant never creates a provider
-- object, a subscription or a ledger entry; entitlement checks read it beside
-- paid subscriptions (apps/api/src/entitlements.ts). History is retained:
-- grants are closed, never deleted, and their terms never change.
CREATE TABLE complimentary_access (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES users(id),
 tier text NOT NULL CHECK (tier IN ('workout','workout_nutrition')),
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
 starts_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz,
 granted_by uuid NOT NULL REFERENCES users(id),
 closed_at timestamptz,
 closed_by uuid REFERENCES users(id),
 close_reason text CHECK (close_reason IN ('revoked','platform_revoked','superseded','expired','member_removed','workspace_closed')),
 close_note text CHECK (close_note IS NULL OR length(close_note) BETWEEN 1 AND 1000),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at IS NULL OR ends_at > starts_at),
 CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
 CHECK (closed_at IS NOT NULL OR (closed_by IS NULL AND close_note IS NULL)),
 UNIQUE (tenant_id,id)
);
-- At most one open grant per member and workspace.
CREATE UNIQUE INDEX complimentary_access_open ON complimentary_access(tenant_id,user_id) WHERE closed_at IS NULL;
CREATE INDEX complimentary_access_member ON complimentary_access(tenant_id,user_id,created_at DESC);
ALTER TABLE complimentary_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE complimentary_access FORCE ROW LEVEL SECURITY;
-- Members read only their own grants; only the owner role (the workspace
-- owner, or an operator acting through an owner-scoped transaction) writes.
CREATE POLICY complimentary_scope ON complimentary_access
 USING (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
  (current_setting('app.role',true)<>'subscriber' OR user_id=nullif(current_setting('app.user_id',true),'')::uuid)
 ) WITH CHECK (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
  current_setting('app.role',true)='owner'
 );
CREATE FUNCTION complimentary_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'complimentary access history is retained; close the grant instead';
 END IF;
 IF (NEW.id,NEW.tenant_id,NEW.user_id,NEW.tier,NEW.starts_at,NEW.ends_at,NEW.granted_by,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.user_id,OLD.tier,OLD.starts_at,OLD.ends_at,OLD.granted_by,OLD.created_at) THEN
  RAISE EXCEPTION 'complimentary access terms are immutable; close it and grant again';
 END IF;
 -- Free text leaves only through an erasure scrub to a fixed marker.
 IF NEW.reason IS DISTINCT FROM OLD.reason AND NOT (
    current_setting('app.privacy_erasure',true)='true' AND NEW.reason='[removed at erasure]') THEN
  RAISE EXCEPTION 'complimentary access reason is immutable';
 END IF;
 IF OLD.closed_at IS NOT NULL THEN
  IF (NEW.closed_at,NEW.closed_by,NEW.close_reason) IS DISTINCT FROM (OLD.closed_at,OLD.closed_by,OLD.close_reason) THEN
   RAISE EXCEPTION 'a closed complimentary grant is final';
  END IF;
  IF NEW.close_note IS DISTINCT FROM OLD.close_note AND NOT (
     current_setting('app.privacy_erasure',true)='true' AND NEW.close_note='[removed at erasure]') THEN
   RAISE EXCEPTION 'a closed complimentary grant is final';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER complimentary_access_guarded BEFORE UPDATE OR DELETE ON complimentary_access FOR EACH ROW EXECUTE FUNCTION complimentary_access_guard();
GRANT SELECT,INSERT,UPDATE ON complimentary_access TO trainer_app;
REVOKE DELETE ON complimentary_access FROM trainer_app;
INSERT INTO schema_migrations(version) VALUES('055_joining_complimentary_access');
