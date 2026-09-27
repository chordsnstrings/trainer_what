CREATE INDEX nutrition_food_successors ON nutrition_foods(tenant_id,supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX nutrition_recipe_successors ON nutrition_recipes(tenant_id,supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX nutrition_catalog_active_archive ON records(tenant_id,(data->>'entityId')) WHERE kind='nutrition_catalog_archive' AND status='active';
INSERT INTO schema_migrations(version) VALUES('014_nutrition_completion');
