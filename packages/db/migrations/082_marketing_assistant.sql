-- Marketing assistant (docs/features/kamran-assistant.md): the home page voice
-- assistant keeps counts and cost only. No audio, transcript or reply text is
-- stored; visitor addresses and visit ids are kept only as a keyed hash that
-- changes every UAE day, and those rows are deleted after two days.
-- Platform data: service role only, never a tenant record.
CREATE TABLE marketing_assistant_days (
 -- The UAE calendar day (Asia/Dubai); the daily cap resets at midnight.
 day date PRIMARY KEY,
 turns integer NOT NULL DEFAULT 0 CHECK(turns >= 0),
 model_input_tokens bigint NOT NULL DEFAULT 0 CHECK(model_input_tokens >= 0),
 model_output_tokens bigint NOT NULL DEFAULT 0 CHECK(model_output_tokens >= 0),
 model_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK(model_usd >= 0),
 stt_seconds numeric(12,3) NOT NULL DEFAULT 0 CHECK(stt_seconds >= 0),
 stt_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK(stt_usd >= 0),
 tts_characters integer NOT NULL DEFAULT 0 CHECK(tts_characters >= 0),
 tts_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK(tts_usd >= 0),
 -- Everything above in dirhams at the settings' USD to AED rate.
 cost_aed numeric(12,4) NOT NULL DEFAULT 0 CHECK(cost_aed >= 0),
 -- Replies replaced by a code-owned line after a failed check, sign-up
 -- hand-offs, and turns refused at the cap or a visitor limit.
 screened integer NOT NULL DEFAULT 0 CHECK(screened >= 0),
 handoffs integer NOT NULL DEFAULT 0 CHECK(handoffs >= 0),
 refused integer NOT NULL DEFAULT 0 CHECK(refused >= 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE marketing_assistant_counters (
 day date NOT NULL,
 -- 'address' (the visitor's network address) or 'visit' (one panel visit).
 kind text NOT NULL CHECK(kind IN ('address','visit')),
 -- HMAC-SHA-256 of the day and the address or visit id: never the value itself.
 key_hash text NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
 turns integer NOT NULL DEFAULT 0 CHECK(turns >= 0),
 PRIMARY KEY(day, kind, key_hash)
);
ALTER TABLE marketing_assistant_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_assistant_days FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON marketing_assistant_days USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
ALTER TABLE marketing_assistant_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_assistant_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON marketing_assistant_counters USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON marketing_assistant_days,marketing_assistant_counters FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON marketing_assistant_days TO trainer_service;
 GRANT SELECT,INSERT,UPDATE,DELETE ON marketing_assistant_counters TO trainer_service;
END IF; END $$;
