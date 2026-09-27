CREATE TABLE notification_preferences (
 tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES users(id),data jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE notifications (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES users(id),
 category text NOT NULL CHECK(category IN ('safety','account','booking','workout','coaching','marketing')),
 dedupe_key text NOT NULL,title text NOT NULL,body text NOT NULL,href text NOT NULL DEFAULT '',data jsonb NOT NULL DEFAULT '{}',
 read_at timestamptz,email_status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,dedupe_key)
);
INSERT INTO notification_preferences(tenant_id,user_id,data)
SELECT tenant_id,owner_user_id,jsonb_build_object('email',coalesce((data->>'emailNotifications')::boolean,true),'workouts',coalesce((data->>'workoutReminders')::boolean,true),'marketing',coalesce((data->>'marketing')::boolean,false))
FROM (SELECT DISTINCT ON (tenant_id,owner_user_id) tenant_id,owner_user_id,data FROM records WHERE kind='preferences' AND owner_user_id IS NOT NULL ORDER BY tenant_id,owner_user_id,created_at DESC,id DESC) latest
ON CONFLICT DO NOTHING;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['notification_preferences','notifications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY notification_scope ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid OR current_setting(''app.role'',true)=''owner'')) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid OR current_setting(''app.role'',true)=''owner''))',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO trainer_app',t);
END LOOP;END $$;
CREATE FUNCTION published_notification_template(template_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('title',title,'body',content,'version',version,'key',key)
 FROM public.admin_documents WHERE kind='notification' AND key=template_key AND status='published' AND effective_at<=now()
 ORDER BY effective_at DESC,version DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION published_notification_template(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION published_notification_template(text) TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('023_notifications');
