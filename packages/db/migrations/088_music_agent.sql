-- Shared platform music automation. No tenant or subscriber inputs.
CREATE TABLE workout_music_agent (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false,
 auto_publish boolean NOT NULL DEFAULT true,
 recovery_confirmed boolean NOT NULL DEFAULT false,
 request_limit integer NOT NULL DEFAULT 120 CHECK(request_limit BETWEEN 1 AND 120),
 credit_limit numeric NOT NULL DEFAULT 1440 CHECK(credit_limit>0 AND credit_limit<=1440),
 external_requests integer NOT NULL DEFAULT 0 CHECK(external_requests>=0),
 external_credits numeric NOT NULL DEFAULT 0 CHECK(external_credits>=0),
 model_call_limit integer NOT NULL DEFAULT 32 CHECK(model_call_limit BETWEEN 1 AND 32),
 model_usd_limit numeric NOT NULL DEFAULT 1 CHECK(model_usd_limit>0 AND model_usd_limit<=5),
 requested_by uuid REFERENCES users(id),
 status text NOT NULL DEFAULT 'paused',
 message text,
 checked_at timestamptz,
 next_check_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workout_music_agent(id) VALUES(true);
CREATE TABLE workout_music_plans (
 id uuid PRIMARY KEY,
 playlist text NOT NULL,
 slots jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('planning','ready','failed','unknown')),
 prompt_version text NOT NULL,
 model text NOT NULL,
 reserved_usd numeric NOT NULL CHECK(reserved_usd>0),
 usage jsonb,
 briefs jsonb,
 error text,
 leased_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workout_music_plans_status ON workout_music_plans(status,created_at);
ALTER TABLE workout_music_jobs ADD COLUMN reconciled_at timestamptz;
ALTER TABLE workout_music_jobs ADD COLUMN brief jsonb;
ALTER TABLE workout_music_jobs ADD COLUMN plan_id uuid REFERENCES workout_music_plans(id);
ALTER TABLE workout_music_jobs ADD COLUMN auto_publish boolean NOT NULL DEFAULT false;
ALTER TABLE workout_music_tracks ADD COLUMN publication_source text NOT NULL DEFAULT 'manual' CHECK(publication_source IN ('manual','automatic'));
ALTER TABLE workout_music_tracks ADD COLUMN audio_check jsonb;
ALTER TABLE workout_music_tracks ADD COLUMN check_leased_until timestamptz;
ALTER TABLE workout_music_tracks ADD COLUMN check_token uuid;
ALTER TABLE workout_music_agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_music_agent FORCE ROW LEVEL SECURITY;
ALTER TABLE workout_music_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_music_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON workout_music_agent USING(current_user<>'trainer_app') WITH CHECK(current_user<>'trainer_app');
CREATE POLICY service_only ON workout_music_plans USING(current_user<>'trainer_app') WITH CHECK(current_user<>'trainer_app');
REVOKE ALL ON workout_music_agent,workout_music_plans FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON workout_music_agent,workout_music_plans TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('088_music_agent');
