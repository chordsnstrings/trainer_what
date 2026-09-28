-- Trainer analytics cohorts and the Superadmin subscriber list order and group
-- members by account creation time, but the tenant role could read only
-- users(id,name,email): both queries failed with "permission denied for table
-- users" for the restricted runtime role (found by the end-to-end harness).
-- Grant only that column; password, verification and platform role stay hidden.
GRANT SELECT(created_at) ON users TO trainer_app;
-- A follower's chat shows that the trainer handles the conversation personally
-- while a takeover is active. Takeover records are staff-only, so the follower
-- reads just this boolean about itself (app.user_id) in its own subscriber
-- scope, never a staff view. Migration 061_tenant_scope_isolation creates the
-- same function with the same body; it sorts first, so this file creates the
-- function only when that migration is not present.
DO $migration$
BEGIN
 IF to_regprocedure('public.member_takeover_active()') IS NULL THEN
  CREATE FUNCTION public.member_takeover_active() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
   SELECT EXISTS(SELECT 1 FROM public.records r WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND r.owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND r.kind='takeover' AND r.status='active'
    AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber'));
  $fn$;
 END IF;
END
$migration$;
REVOKE ALL ON FUNCTION member_takeover_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_takeover_active() TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('062_tenant_member_join_date');
