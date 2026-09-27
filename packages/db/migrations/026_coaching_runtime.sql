-- Only answer whether the current request's own membership still exists in an
-- active workspace. This grants no access to tenant configuration or other users.
CREATE FUNCTION training_actor_is_current(p_tenant uuid,p_user uuid,p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND p_user=nullif(current_setting('app.user_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM public.memberships m JOIN public.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.role=p_role
 AND coalesce(to_jsonb(t)->>'lifecycle_state','active')='active')
$$;
REVOKE ALL ON FUNCTION training_actor_is_current(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION training_actor_is_current(uuid,uuid,text) TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('026_coaching_runtime');
