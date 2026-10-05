-- Platform-owned instrumentals, never tenant/personal coaching data.
CREATE TABLE workout_music_jobs (
 id uuid PRIMARY KEY,
 playlist text NOT NULL CHECK(playlist IN ('flow','edm','rock','rnb','hiphop','afrolatin','synthwave','recovery')),
 slot integer NOT NULL CHECK(slot BETWEEN 0 AND 59),
 status text NOT NULL CHECK(status IN ('queued','submitting','pending','complete','failed','unknown','cancelled')),
 task_id text UNIQUE,
 credit_limit numeric NOT NULL CHECK(credit_limit >= 0),
 imported boolean NOT NULL DEFAULT false,
 submitted_at timestamptz,
 poll_after timestamptz,
 credits_before numeric,
 credits_after numeric,
 requested_by uuid NOT NULL REFERENCES users(id),
 error text,
 leased_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(playlist,slot)
);
CREATE INDEX workout_music_jobs_pending ON workout_music_jobs(status,created_at);
CREATE TABLE workout_music_tracks (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES workout_music_jobs(id),
 provider_id text NOT NULL UNIQUE,
 playlist text NOT NULL,
 title text NOT NULL,
 duration numeric NOT NULL CHECK(duration BETWEEN 150 AND 360),
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','approved','rejected')),
 sha256 text NOT NULL UNIQUE,
 audio bytea NOT NULL CHECK(octet_length(audio) BETWEEN 1024 AND 20971520),
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workout_music_tracks_catalogue ON workout_music_tracks(playlist,status);
CREATE TABLE workout_music_audit (
 id uuid PRIMARY KEY,
 actor_id uuid,
 subject_id uuid,
 action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER workout_music_audit_immutable BEFORE UPDATE OR DELETE ON workout_music_audit FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE workout_music_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_music_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE workout_music_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_music_tracks FORCE ROW LEVEL SECURITY;
ALTER TABLE workout_music_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_music_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON workout_music_jobs USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
CREATE POLICY service_only ON workout_music_tracks USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
CREATE POLICY service_only ON workout_music_audit USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON workout_music_jobs,workout_music_tracks,workout_music_audit FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON workout_music_jobs,workout_music_tracks TO trainer_service;
 GRANT SELECT,INSERT ON workout_music_audit TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('085_workout_music');
