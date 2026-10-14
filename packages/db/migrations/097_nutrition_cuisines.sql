-- Optional reviewed recipe metadata. Existing recipe versions and tenant RLS
-- remain immutable; adding the column also extends the SETOF member helper.
ALTER TABLE nutrition_recipes ADD COLUMN cuisines jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(cuisines)='array' AND jsonb_array_length(cuisines)<=40);
INSERT INTO schema_migrations(version) VALUES('097_nutrition_cuisines');
