-- Expose only the coach's published workout-reduction policy to current members.
CREATE FUNCTION whoop_training_policy() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',r.id,'version',r.version,'values',r.data)
 FROM public.records r
 WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND r.kind='whoop_training_policy' AND r.status='published'
 AND current_setting('app.role',true) IN ('owner','staff','subscriber')
 AND public.training_actor_is_current(r.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,current_setting('app.role',true))
 ORDER BY r.updated_at DESC,r.id DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION whoop_training_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whoop_training_policy() TO trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT EXECUTE ON FUNCTION whoop_training_policy() TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('099_whoop_training');
