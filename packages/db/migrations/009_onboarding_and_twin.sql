CREATE UNIQUE INDEX onboarding_step_unique ON records(tenant_id,(data->>'step')) WHERE kind='onboarding_step';
CREATE UNIQUE INDEX twin_snapshot_unique ON records(tenant_id,owner_user_id,(data->>'digest')) WHERE kind='twin_snapshot';
ALTER POLICY record_subscriber_scope ON records USING (
 current_setting('app.role',true)<>'subscriber' OR
 (kind='product' AND status='published') OR
 (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND
 kind IN ('intake','program','workout','message','refund','booking','support','settings','preferences','privacy_request','wearable','twin_snapshot') AND
 (kind<>'message' OR status='sent'))
);
CREATE FUNCTION protect_twin_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind='twin_snapshot' AND (NEW.kind<>OLD.kind OR NEW.tenant_id<>OLD.tenant_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR (NEW.data-'allowedUses') IS DISTINCT FROM (OLD.data-'allowedUses')) THEN
  RAISE EXCEPTION 'Twin snapshots are versioned; create a new snapshot';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER twin_snapshot_versioned BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION protect_twin_snapshot();
INSERT INTO schema_migrations(version) VALUES('009_onboarding_and_twin');
