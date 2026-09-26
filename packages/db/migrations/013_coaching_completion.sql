-- A training hold belongs to the subscriber, not just one workout. A new
-- workout must never bypass an unresolved safety interruption.
INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data)
SELECT gen_random_uuid(),tenant_id,'training_hold',owner_user_id,'active',
 jsonb_build_object('reason','Existing workout safety hold requires trainer review',
 'workoutIds',jsonb_agg(id),'migrated',true,'openedAt',now())
FROM records WHERE kind='workout' AND status='safety_hold'
GROUP BY tenant_id,owner_user_id;
CREATE UNIQUE INDEX one_active_training_hold
 ON records(tenant_id,owner_user_id) WHERE kind='training_hold' AND status='active';
CREATE INDEX training_scheduled_date ON records(tenant_id,owner_user_id,(data->>'date'))
 WHERE kind='planned_session';
ALTER POLICY record_subscriber_scope ON records USING (
 current_setting('app.role',true)<>'subscriber' OR (kind='product' AND status='published') OR
 (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND
 kind IN ('intake','program','workout','message','refund','booking','support','settings','preferences','privacy_request','wearable','twin_snapshot','nutrition_profile','nutrition_plan','nutrition_log','nutrition_checkin','nutrition_twin','nutrition_pantry','training_hold','planned_session','workout_correction','workout_substitution') AND
 (kind<>'message' OR status='sent'))
);
INSERT INTO schema_migrations(version) VALUES('013_coaching_completion');
