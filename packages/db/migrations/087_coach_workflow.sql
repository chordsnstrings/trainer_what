-- Narrow member preflight: never expose private rules, examples or exercises.
CREATE FUNCTION member_training_readiness() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object(
  'brain',EXISTS(SELECT 1 FROM public.records r WHERE r.tenant_id=m.tenant_id AND r.kind='brain_release' AND r.status='published'),
  'exercises',(SELECT count(*)::int FROM public.records r WHERE r.tenant_id=m.tenant_id AND
    ((r.kind='exercise' AND r.status='active') OR (r.kind='program' AND r.status='template' AND jsonb_array_length(coalesce(r.data->'exercises','[]'::jsonb))>0))),
  'mode',coalesce((SELECT r.data->'settings'->>'mode' FROM public.records r WHERE r.tenant_id=m.tenant_id AND r.kind='plan_brain_settings' ORDER BY r.created_at DESC,r.id DESC LIMIT 1),'automatic'))
 FROM public.memberships m
 WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid
  AND m.role=current_setting('app.role',true)
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION member_training_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_training_readiness() TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('087_coach_workflow');
