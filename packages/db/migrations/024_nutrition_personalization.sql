CREATE UNIQUE INDEX nutrition_active_target ON records(tenant_id,owner_user_id) WHERE kind='nutrition_target' AND status='active';
CREATE FUNCTION protect_nutrition_completion_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind IN ('nutrition_target','nutrition_plan_edit','nutrition_recovery') AND
 (NEW.kind<>OLD.kind OR NEW.tenant_id<>OLD.tenant_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR (NEW.data-'allowedUses') IS DISTINCT FROM (OLD.data-'allowedUses')) THEN
 RAISE EXCEPTION 'Nutrition decisions are versioned; create a revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nutrition_completion_snapshot_versioned BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION protect_nutrition_completion_snapshot();
INSERT INTO schema_migrations(version) VALUES('024_nutrition_personalization');
