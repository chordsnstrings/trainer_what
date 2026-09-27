-- Preserve the existing self-owned subscriber scope, adding voluntary context.
ALTER POLICY record_subscriber_scope ON records USING (
 current_setting('app.role',true)<>'subscriber' OR (kind='product' AND status='published') OR
 (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND
 kind IN ('intake','program','workout','message','refund','booking','support','settings','preferences','privacy_request','wearable','twin_snapshot','nutrition_profile','nutrition_plan','nutrition_log','nutrition_checkin','nutrition_twin','nutrition_pantry','training_hold','planned_session','workout_correction','workout_substitution','client_context') AND
 (kind<>'message' OR status='sent'))
);
CREATE UNIQUE INDEX client_context_owner ON records(tenant_id,owner_user_id)
 WHERE kind='client_context';
INSERT INTO schema_migrations(version) VALUES('038_client_context');
