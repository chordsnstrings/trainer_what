-- Trainer Brain plan generation (docs/features/brain-plans.md). Plans, reviews,
-- learning examples, held-out plan scenarios and qualifications are records
-- (staff-only kinds: record_subscriber_scope does not list them).
CREATE UNIQUE INDEX plan_brain_settings_unique ON records(tenant_id) WHERE kind='plan_brain_settings';
-- One generation per worker job, so a retried job never pays the model twice.
CREATE UNIQUE INDEX plan_generation_job ON records(tenant_id,(data->>'jobId'))
 WHERE kind='plan_generation' AND data->>'jobId' IS NOT NULL;
CREATE INDEX plan_generation_queue ON records(tenant_id,status,created_at) WHERE kind='plan_generation';
-- One learning example per reviewed generation.
CREATE UNIQUE INDEX plan_learning_generation ON records(tenant_id,(data->>'generationId')) WHERE kind='plan_learning';
-- A follower learns only the state of its own latest plan generation (never the
-- draft, the confidence breakdown or the trainer's review), in its own scope.
CREATE FUNCTION member_plan_status()
RETURNS TABLE(state text, plan_type text, created_at timestamptz, updated_at timestamptz, program_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN r.status IN ('generating','not_sent') THEN 'preparing'
  WHEN r.status='pending_review' THEN 'in_review'
  WHEN r.status='delivered' THEN 'delivered'
  ELSE 'with_trainer' END,
  r.data->>'type', r.created_at, r.updated_at, r.data->'outcome'->>'programId'
 FROM public.records r
 WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid
  AND r.kind='plan_generation' AND r.data->>'type'='programme'
  AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION member_plan_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_plan_status() TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('063_brain_plans');
