CREATE TABLE nutrition_foods (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), supersedes_id uuid,
 name text NOT NULL, preparation text NOT NULL CHECK(preparation IN ('raw','cooked','ready_to_eat')),
 nutrients jsonb NOT NULL, allergens jsonb NOT NULL, ingredient_tags jsonb NOT NULL,
 allergen_review_complete boolean NOT NULL, estimated boolean NOT NULL, source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,supersedes_id) REFERENCES nutrition_foods(tenant_id,id)
);
CREATE TABLE nutrition_recipes (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), supersedes_id uuid,
 name text NOT NULL, description text NOT NULL, diet_tags jsonb NOT NULL, slots jsonb NOT NULL,
 budget text NOT NULL, yield_servings numeric(8,2) NOT NULL CHECK(yield_servings>0), source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,supersedes_id) REFERENCES nutrition_recipes(tenant_id,id)
);
CREATE TABLE nutrition_recipe_options (
 tenant_id uuid NOT NULL, recipe_id uuid NOT NULL, option_key text NOT NULL,
 name text NOT NULL, equipment jsonb NOT NULL, minutes integer NOT NULL CHECK(minutes>0), steps jsonb NOT NULL, storage_note text NOT NULL,
 PRIMARY KEY(tenant_id,recipe_id,option_key), FOREIGN KEY(tenant_id,recipe_id) REFERENCES nutrition_recipes(tenant_id,id)
);
CREATE TABLE nutrition_ingredients (
 tenant_id uuid NOT NULL, recipe_id uuid NOT NULL, option_key text NOT NULL, position integer NOT NULL,
 food_id uuid NOT NULL, grams numeric(12,2) NOT NULL CHECK(grams>0),
 PRIMARY KEY(tenant_id,recipe_id,option_key,position),
 FOREIGN KEY(tenant_id,recipe_id,option_key) REFERENCES nutrition_recipe_options(tenant_id,recipe_id,option_key),
 FOREIGN KEY(tenant_id,food_id) REFERENCES nutrition_foods(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['nutrition_foods','nutrition_recipes','nutrition_recipe_options','nutrition_ingredients'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY nutrition_scope ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true) IN (''owner'',''staff'')) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true)=''owner'')',t);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO trainer_app',t);
 EXECUTE format('CREATE TRIGGER nutrition_version_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_record()',t);
END LOOP; END $$;
CREATE UNIQUE INDEX nutrition_setup_unique ON records(tenant_id) WHERE kind='nutrition_setup';
CREATE UNIQUE INDEX nutrition_published_release ON records(tenant_id) WHERE kind='nutrition_release' AND status='published';
CREATE UNIQUE INDEX nutrition_request_unique ON records(tenant_id,owner_user_id,(data->>'requestKey')) WHERE kind='nutrition_request';
CREATE UNIQUE INDEX nutrition_log_unique ON records(tenant_id,owner_user_id,(data->>'eventKey')) WHERE kind IN ('nutrition_log','nutrition_checkin');
CREATE UNIQUE INDEX nutrition_log_correction_unique ON records(tenant_id,(data->>'correctsId')) WHERE kind='nutrition_log' AND data->>'correctsId' IS NOT NULL;
CREATE UNIQUE INDEX nutrition_current_week ON records(tenant_id,owner_user_id,(data->>'weekStart')) WHERE kind='nutrition_plan' AND status='delivered';
ALTER POLICY record_subscriber_scope ON records USING (
 current_setting('app.role',true)<>'subscriber' OR (kind='product' AND status='published') OR
 (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND
 kind IN ('intake','program','workout','message','refund','booking','support','settings','preferences','privacy_request','wearable','twin_snapshot','nutrition_profile','nutrition_plan','nutrition_log','nutrition_checkin','nutrition_twin','nutrition_pantry') AND
 (kind<>'message' OR status='sent'))
);
CREATE FUNCTION protect_nutrition_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind IN ('nutrition_plan','nutrition_log','nutrition_checkin','nutrition_profile','nutrition_twin') AND
 (NEW.kind<>OLD.kind OR NEW.tenant_id<>OLD.tenant_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR (NEW.data-'allowedUses') IS DISTINCT FROM (OLD.data-'allowedUses')) THEN
 RAISE EXCEPTION 'Nutrition snapshots are versioned; create a revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nutrition_snapshot_versioned BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION protect_nutrition_snapshot();
UPDATE records SET data=data||'{"tier":"workout","modules":["training"]}'::jsonb WHERE kind='product' AND NOT data ? 'tier';
INSERT INTO schema_migrations(version) VALUES('010_nutrition');
