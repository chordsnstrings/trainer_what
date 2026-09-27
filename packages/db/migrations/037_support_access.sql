-- Support capabilities stay separate from customer sessions and normal APIs.
ALTER TABLE support_preview_grants DROP CONSTRAINT support_preview_grants_scopes_check;
ALTER TABLE support_preview_grants ADD CONSTRAINT support_preview_grants_scopes_check
 CHECK(cardinality(scopes) BETWEEN 1 AND 6 AND scopes <@ ARRAY['account','access','connections','notification_settings','training_schedule','nutrition_schedule']::text[]);

CREATE TABLE support_preview_elevations (
 id uuid PRIMARY KEY,
 grant_id uuid NOT NULL REFERENCES support_preview_grants(id),
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 action text NOT NULL CHECK(action='notification_preferences'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 expected_version integer NOT NULL CHECK(expected_version>=0),
 changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='object' AND changes<>'{}'::jsonb AND changes-ARRAY['bookings','workouts','quietStart','quietEnd','timezone']='{}'::jsonb),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','applied','revoked','expired')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 end_reason text,
 result_version integer,
 UNIQUE(grant_id,request_key),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
 CHECK((status='active' AND ended_at IS NULL AND end_reason IS NULL) OR (status<>'active' AND ended_at IS NOT NULL AND end_reason IS NOT NULL)),
 CHECK((status='applied' AND result_version IS NOT NULL AND result_version=expected_version+1) OR (status<>'applied' AND result_version IS NULL))
);
CREATE UNIQUE INDEX support_preview_active_elevation ON support_preview_elevations(grant_id) WHERE status='active';
CREATE FUNCTION protect_support_preview_elevation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','revision','ended_at','end_reason','result_version']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','revision','ended_at','end_reason','result_version']) THEN
  RAISE EXCEPTION 'Support correction intent and expiry are immutable';
 END IF;
 IF OLD.status<>'active' OR NEW.status NOT IN ('applied','revoked','expired') OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Support correction can only end once';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER support_preview_elevation_sealed BEFORE UPDATE ON support_preview_elevations FOR EACH ROW EXECUTE FUNCTION protect_support_preview_elevation();
REVOKE ALL ON support_preview_elevations FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON support_preview_elevations TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('037_support_access');
