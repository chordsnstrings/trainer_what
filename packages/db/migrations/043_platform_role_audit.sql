-- Every platform authority change is recorded, whichever path made it. Host
-- operator commands also state who made it and why through transaction-local
-- settings (app.operator_id, app.operator_reason, app.operator_source).
CREATE TABLE platform_role_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 from_role text, to_role text NOT NULL, actor_id uuid, reason text,
 source text NOT NULL, database_role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_role_changes_user ON platform_role_changes(user_id,created_at);
CREATE TRIGGER platform_role_changes_immutable BEFORE UPDATE OR DELETE ON platform_role_changes FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION record_platform_role_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO platform_role_changes(user_id,from_role,to_role,actor_id,reason,source,database_role)
 VALUES(NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.platform_role END,NEW.platform_role,
  nullif(current_setting('app.operator_id',true),'')::uuid,
  nullif(current_setting('app.operator_reason',true),''),
  coalesce(nullif(current_setting('app.operator_source',true),''),'database'),
  session_user);
 RETURN NEW;
END $$;
CREATE TRIGGER users_platform_role_granted AFTER INSERT ON users FOR EACH ROW WHEN (NEW.platform_role<>'none') EXECUTE FUNCTION record_platform_role_change();
CREATE TRIGGER users_platform_role_changed AFTER UPDATE OF platform_role ON users FOR EACH ROW WHEN (OLD.platform_role IS DISTINCT FROM NEW.platform_role) EXECUTE FUNCTION record_platform_role_change();
REVOKE ALL ON platform_role_changes FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON platform_role_changes TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('043_platform_role_audit');
