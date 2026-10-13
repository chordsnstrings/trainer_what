-- Generic code-owned waiting clips only; never visitor audio or transcripts.
-- Claim before purchase, with a permanent tombstone for uncertain outcomes.
CREATE TABLE marketing_assistant_cues (
 key_hash text PRIMARY KEY CHECK(key_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('preparing','ready','failed')),
 audio jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(audio)='array' AND jsonb_array_length(audio)<=2),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE marketing_assistant_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_assistant_cues FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON marketing_assistant_cues USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON marketing_assistant_cues FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON marketing_assistant_cues TO trainer_service;
END IF; END $$;
