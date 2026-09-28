-- Messaging and safety policy readers for tenant transactions.
-- admin_documents and tenants stay unreadable by trainer_app; these scoped
-- definer helpers return only the published coaching safety policy and the
-- current transaction's own workspace name.
CREATE FUNCTION published_safety_policy() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('key',key,'version',version,'content',content,'effectiveAt',effective_at)
 FROM public.admin_documents WHERE kind='safety' AND key='coaching-safety-policy' AND status='published' AND effective_at<=now()
 ORDER BY effective_at DESC,version DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION published_safety_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION published_safety_policy() TO trainer_app;
CREATE FUNCTION notification_workspace_name() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT name FROM public.tenants
 WHERE id=nullif(current_setting('app.tenant_id',true),'')::uuid AND lifecycle_state='active';
$$;
REVOKE ALL ON FUNCTION notification_workspace_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_workspace_name() TO trainer_app;
-- Overdue safety reviews are found per workspace by the worker.
CREATE INDEX records_open_exceptions ON records(tenant_id,created_at) WHERE kind='exception' AND status='open';
INSERT INTO schema_migrations(version) VALUES('057_messaging_policy');
