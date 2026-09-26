-- Forward-only completion for installations that already applied 028.
-- The immutable binding trigger validates the original draft; the UPDATE
-- policy must also admit the resulting bound row for PostgreSQL RLS.
ALTER POLICY chat_attachment_bind ON chat_attachments
 USING(uploaded_by=nullif(current_setting('app.user_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION seal_chat_attachment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (to_jsonb(NEW)-'message_id') IS DISTINCT FROM (to_jsonb(OLD)-'message_id') THEN
 RAISE EXCEPTION 'Attachment content and ownership are immutable'; END IF;
 IF OLD.message_id IS NOT NULL OR NEW.message_id IS NULL THEN
 RAISE EXCEPTION 'An attachment can bind to one message only'; END IF;
 IF OLD.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Draft attachment has expired'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.records r WHERE r.id=NEW.message_id AND r.tenant_id=NEW.tenant_id
 AND r.kind='message' AND r.status='sent' AND r.owner_user_id=NEW.subject_user_id
 AND r.data->>'authorUserId'=NEW.uploaded_by::text) THEN
 RAISE EXCEPTION 'Attachment must belong to its author and client conversation'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION export_personal_chat_media(subject uuid)
RETURNS TABLE(id uuid,message_id uuid,file_name text,mime_type text,byte_count integer,details jsonb,created_at timestamptz,content_base64 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('app.role',true) IS DISTINCT FROM 'owner' OR subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN
 RAISE EXCEPTION 'Personal attachment export is restricted to the requester' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.id,c.message_id,c.file_name,c.mime_type,c.byte_count,c.details,c.created_at,
 CASE WHEN c.message_id IS NOT NULL OR c.expires_at>now() THEN encode(c.media,'base64') ELSE NULL END
 FROM public.chat_attachments c WHERE c.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND (c.subject_user_id=subject OR c.uploaded_by=subject) ORDER BY c.created_at,c.id;
END $$;

CREATE OR REPLACE FUNCTION erase_personal_chat_media(subject uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_tenant uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; removed integer;
BEGIN
 IF current_setting('app.role',true) IS DISTINCT FROM 'owner' OR NOT (
 subject=nullif(current_setting('app.user_id',true),'')::uuid OR
 EXISTS(SELECT 1 FROM public.users u WHERE u.id=nullif(current_setting('app.user_id',true),'')::uuid AND u.platform_role='admin')) THEN
 RAISE EXCEPTION 'Personal attachment erasure requires the subject or privacy operator' USING ERRCODE='42501'; END IF;
 UPDATE public.records r SET version=r.version+1,updated_at=now(),data=jsonb_set(r.data,'{attachments}',coalesce((
 SELECT jsonb_agg(item) FROM jsonb_array_elements(coalesce(r.data->'attachments','[]'::jsonb)) AS item
 WHERE NOT EXISTS(SELECT 1 FROM public.chat_attachments c WHERE c.tenant_id=current_tenant AND c.id::text=item->>'id' AND (c.subject_user_id=subject OR c.uploaded_by=subject))), '[]'::jsonb))
 WHERE r.tenant_id=current_tenant AND r.kind='message' AND EXISTS(
 SELECT 1 FROM public.chat_attachments c WHERE c.tenant_id=current_tenant AND c.message_id=r.id AND (c.subject_user_id=subject OR c.uploaded_by=subject));
 DELETE FROM public.chat_attachments c WHERE c.tenant_id=current_tenant AND (c.subject_user_id=subject OR c.uploaded_by=subject);
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;

CREATE OR REPLACE FUNCTION expire_unattached_chat_media() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE removed integer;
BEGIN
 IF current_setting('app.role',true) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Attachment expiry requires worker scope' USING ERRCODE='42501'; END IF;
 DELETE FROM public.chat_attachments WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND message_id IS NULL AND expires_at<=now();
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;

CREATE OR REPLACE FUNCTION erase_workspace_chat_media() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE removed integer; current_tenant uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF current_setting('app.role',true) IS DISTINCT FROM 'owner' OR NOT EXISTS(
 SELECT 1 FROM public.users u WHERE u.id=nullif(current_setting('app.user_id',true),'')::uuid AND u.platform_role='admin') THEN
 RAISE EXCEPTION 'Workspace attachment erasure requires a privacy operator' USING ERRCODE='42501'; END IF;
 UPDATE public.records SET data=jsonb_set(data,'{attachments}','[]'::jsonb),version=version+1,updated_at=now()
 WHERE tenant_id=current_tenant AND kind='message' AND data ? 'attachments';
 DELETE FROM public.chat_attachments WHERE tenant_id=current_tenant;
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;

REVOKE ALL ON FUNCTION export_personal_chat_media(uuid),erase_personal_chat_media(uuid),expire_unattached_chat_media(),erase_workspace_chat_media() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_personal_chat_media(uuid),erase_personal_chat_media(uuid),expire_unattached_chat_media(),erase_workspace_chat_media() TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('030_chat_attachment_completion');
