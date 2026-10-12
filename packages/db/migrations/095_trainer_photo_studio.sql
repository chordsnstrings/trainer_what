-- Owner-only generated drafts. Public media is created only after likeness review.
CREATE TABLE trainer_photo_jobs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_user_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL, input_hash text NOT NULL, input jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('running','ready','kept','failed','unknown','deleted')),
 cost_event_id uuid NOT NULL REFERENCES cost_events(id),
 media bytea CHECK(media IS NULL OR octet_length(media)<=8388608), width integer, height integer,
 kept_media_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id), FOREIGN KEY(tenant_id,kept_media_id) REFERENCES brand_media(tenant_id,id) ON DELETE SET NULL (kept_media_id)
);
CREATE INDEX trainer_photo_recent ON trainer_photo_jobs(tenant_id,created_at DESC);
CREATE INDEX trainer_photo_intent ON trainer_photo_jobs(tenant_id,input_hash) WHERE status IN ('running','unknown');
ALTER TABLE trainer_photo_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_photo_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY photo_owner ON trainer_photo_jobs USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='owner'
) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='owner');
CREATE POLICY photo_service ON trainer_photo_jobs USING (current_user<>'trainer_app' AND
 (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid));
REVOKE ALL ON trainer_photo_jobs FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON trainer_photo_jobs TO trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,UPDATE ON trainer_photo_jobs TO trainer_service;
END IF; END $$;
ALTER TABLE brand_media ADD COLUMN generated boolean NOT NULL DEFAULT false;
-- The requester may export their own draft metadata after an ownership transfer.
CREATE FUNCTION export_personal_photo_drafts(subject uuid)
RETURNS TABLE(id uuid,status text,input jsonb,width integer,height integer,kept_media_id uuid,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid
 OR nullif(current_setting('app.tenant_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Personal photo export is restricted to the requester' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT p.id,p.status,p.input,p.width,p.height,p.kept_media_id,p.created_at FROM public.trainer_photo_jobs p
 WHERE p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND p.owner_user_id=subject ORDER BY p.created_at,p.id;
END $$;
REVOKE ALL ON FUNCTION export_personal_photo_drafts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_personal_photo_drafts(uuid) TO trainer_app;
-- Service completion can settle only the exact reserved image request in its bound workspace.
-- It cannot edit any other usage row or choose an arbitrary cost.
CREATE FUNCTION finish_trainer_photo_cost(job uuid,outcome text,trace text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid uuid := nullif(current_setting('app.service_tenant_id',true),'')::uuid;
BEGIN
 IF tid IS NULL OR outcome IS NULL OR outcome NOT IN ('generated','rejected','unknown') THEN
  RAISE EXCEPTION 'A bound photo completion is required' USING ERRCODE='42501'; END IF;
 UPDATE public.cost_events c SET
  status=CASE outcome WHEN 'generated' THEN 'estimated' WHEN 'rejected' THEN 'recorded' ELSE 'unknown' END,
  cost_usd=CASE outcome WHEN 'generated' THEN c.estimated_cost_usd WHEN 'rejected' THEN 0 ELSE NULL END,
  trace_id=left(trace,200)
 FROM public.trainer_photo_jobs p WHERE p.id=job AND p.tenant_id=tid AND c.id=p.cost_event_id
 AND c.tenant_id=tid AND c.task='trainer_photo' AND c.provider='modelark' AND c.status='reserved';
END $$;
REVOKE ALL ON FUNCTION finish_trainer_photo_cost(uuid,text,text) FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT EXECUTE ON FUNCTION finish_trainer_photo_cost(uuid,text,text) TO trainer_service;
END IF; END $$;
CREATE FUNCTION protect_trainer_photo_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.owner_user_id,NEW.request_id,NEW.input_hash,NEW.cost_event_id,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.owner_user_id,OLD.request_id,OLD.input_hash,OLD.cost_event_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Photo request identity cannot be changed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer_photo_receipt BEFORE UPDATE ON trainer_photo_jobs FOR EACH ROW EXECUTE FUNCTION protect_trainer_photo_receipt();
INSERT INTO schema_migrations(version) VALUES('095_trainer_photo_studio');
