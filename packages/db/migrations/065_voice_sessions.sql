-- Voice-led workout sessions (docs/features/voice-session.md).
--
-- voice_session_styles: the trainer's versioned voice-session style and
-- adjustment rules (Brain material). The coaching team reads and writes it; a
-- follower reads only the current style through voice_session_style().
CREATE TABLE voice_session_styles (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 style jsonb NOT NULL CHECK(jsonb_typeof(style)='object' AND octet_length(style::text)<=40000),
 updated_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- One prepared session per member, workout and script. The script holds only
-- code-validated lines built from the workout's plan.
CREATE TABLE voice_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 workout_id uuid NOT NULL,
 script_fingerprint text NOT NULL CHECK(script_fingerprint ~ '^[a-f0-9]{64}$'),
 mode text NOT NULL CHECK(mode IN ('voice','text')),
 status text NOT NULL CHECK(status IN ('ready','running','completed','stopped','revoked')),
 audio_status text NOT NULL CHECK(audio_status IN ('none','generating','ready','partial','capped','revoked')),
 script jsonb NOT NULL CHECK(jsonb_typeof(script)='object' AND octet_length(script::text)<=200000),
 script_version text NOT NULL CHECK(length(script_version) BETWEEN 1 AND 60),
 style_version integer NOT NULL DEFAULT 0 CHECK(style_version>=0),
 generator text NOT NULL CHECK(generator IN ('rules','brain_model')),
 voice_id uuid REFERENCES trainer_voices(id) ON DELETE SET NULL, voice_version integer,
 unavailable_reason text CHECK(unavailable_reason IS NULL OR unavailable_reason ~ '^[A-Z_]{2,60}$'),
 outcomes jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(outcomes)='object'),
 events jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(events)='array' AND octet_length(events::text)<=200000),
 version integer NOT NULL DEFAULT 1,
 started_at timestamptz, ended_at timestamptz,
 end_reason text CHECK(end_reason IS NULL OR end_reason IN ('completed','member_stopped','pain','hold','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,user_id,workout_id,script_fingerprint),
 FOREIGN KEY(tenant_id,workout_id) REFERENCES records(tenant_id,id) ON DELETE CASCADE,
 CHECK((status IN ('completed','stopped'))=(ended_at IS NOT NULL))
);
CREATE INDEX voice_sessions_member ON voice_sessions(tenant_id,user_id,created_at DESC);
-- Generated trainer-voice audio. A session clip (session_id and user_id set)
-- speaks one script line; a shared clip (both NULL) is a short reusable phrase
-- or number for the current voice version. Audio is kept only while ready.
CREATE TABLE voice_session_clips (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 session_id uuid, user_id uuid REFERENCES users(id),
 clip_key text NOT NULL CHECK(clip_key ~ '^[a-z0-9_:.-]{1,80}$'),
 text_content text NOT NULL CHECK(length(text_content) BETWEEN 1 AND 600),
 voice_id uuid NOT NULL REFERENCES trainer_voices(id) ON DELETE CASCADE, voice_version integer NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 priority smallint NOT NULL DEFAULT 1 CHECK(priority BETWEEN 0 AND 9),
 status text NOT NULL CHECK(status IN ('pending','reserved','unknown','ready','skipped','revoked')),
 audio bytea, usage_id uuid REFERENCES cost_events(id),
 data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,session_id) REFERENCES voice_sessions(tenant_id,id) ON DELETE CASCADE,
 CHECK((session_id IS NULL)=(user_id IS NULL)),
 CHECK(audio IS NULL OR octet_length(audio)<=2097152),
 CHECK((status='ready')=(audio IS NOT NULL))
);
CREATE UNIQUE INDEX voice_session_clip_line ON voice_session_clips(tenant_id,session_id,clip_key) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX voice_shared_clip ON voice_session_clips(tenant_id,voice_id,voice_version,clip_key) WHERE session_id IS NULL;
CREATE INDEX voice_clip_queue ON voice_session_clips(tenant_id,status,priority,created_at);
CREATE INDEX voice_clip_reuse ON voice_session_clips(tenant_id,user_id,fingerprint) WHERE status='ready';

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['voice_session_styles','voice_sessions','voice_session_clips'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
-- The style is coaching-team material.
CREATE POLICY voice_style_team ON voice_session_styles AS RESTRICTIVE
 USING(current_setting('app.role',true) IN ('owner','staff'))
 WITH CHECK(current_setting('app.role',true) IN ('owner','staff'));
-- A member reads and writes its own sessions; the coaching team reads them
-- (outcomes for Brain corrections); only the owner scope (the worker) writes
-- other members' sessions.
CREATE POLICY voice_session_read ON voice_sessions AS RESTRICTIVE FOR SELECT
 USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true) IN ('owner','staff'));
CREATE POLICY voice_session_insert ON voice_sessions AS RESTRICTIVE FOR INSERT
 WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner');
CREATE POLICY voice_session_update ON voice_sessions AS RESTRICTIVE FOR UPDATE
 USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner')
 WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner');
CREATE POLICY voice_session_delete ON voice_sessions AS RESTRICTIVE FOR DELETE
 USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner');
-- Clips: a member reads its own clips and, while it is a current member, the
-- workspace's shared clips; it writes only its own. Shared clips are written by
-- the owner scope (the worker) only.
CREATE POLICY voice_clip_read ON voice_session_clips AS RESTRICTIVE FOR SELECT
 USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid
  OR current_setting('app.role',true) IN ('owner','staff')
  OR (user_id IS NULL AND current_setting('app.role',true)='subscriber'
   AND EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid)));
CREATE POLICY voice_clip_insert ON voice_session_clips AS RESTRICTIVE FOR INSERT
 WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner');
CREATE POLICY voice_clip_update ON voice_session_clips AS RESTRICTIVE FOR UPDATE
 USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner')
 WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner');
CREATE POLICY voice_clip_delete ON voice_session_clips AS RESTRICTIVE FOR DELETE
 USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner');
GRANT SELECT,INSERT,UPDATE,DELETE ON voice_session_styles,voice_sessions,voice_session_clips TO trainer_app;

-- The trainer's current voice-session style for any current member of the
-- workspace (a follower cannot list coaching-team material).
CREATE FUNCTION voice_session_style() RETURNS TABLE(version integer, style jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT s.version,s.style FROM public.voice_session_styles s
 WHERE s.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND (current_setting('app.role',true) IN ('owner','staff','finance') OR (current_setting('app.role',true)='subscriber'
  AND EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid)));
$$;
REVOKE ALL ON FUNCTION voice_session_style() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_session_style() TO trainer_app;

-- One workspace voice budget: guided audio, voice-session clips and speech
-- transcription all count against VOICE_DAILY_USD_LIMIT. Same signature, so
-- the existing grants (trainer_app only) are kept.
CREATE OR REPLACE FUNCTION voice_guidance_spent_today() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(coalesce(c.cost_usd,(c.pricing->>'reservedCostUsd')::numeric)),0) FROM public.cost_events c
 WHERE c.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND c.task IN ('voice.guidance','voice.session','voice.transcription')
 AND c.created_at>=date_trunc('day',now())
 AND (current_setting('app.role',true) IN ('owner','staff','finance') OR (current_setting('app.role',true)='subscriber'
  AND EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid)));
$$;
-- The daily model-call limit counts model requests only. Voice audio and
-- transcription rows share cost_events but have their own USD budget above;
-- counting them here would let one prepared session (a hundred or more short
-- clips) exhaust the workspace's AI coaching allowance.
CREATE OR REPLACE FUNCTION model_usage_today(capped_tasks text[], member uuid)
RETURNS TABLE(n integer, subscribers integer, mine integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller_role text := current_setting('app.role',true);
BEGIN
 IF tid IS NULL OR caller_role IS NULL OR caller_role NOT IN ('owner','staff','finance','subscriber')
  OR (caller_role='subscriber' AND (member IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid
   OR NOT EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid))) THEN
  RAISE EXCEPTION 'Model usage counts are limited to the caller' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT count(*)::int,count(*) FILTER (WHERE c.task=ANY(capped_tasks))::int,
  count(*) FILTER (WHERE c.user_id=member AND c.task=ANY(capped_tasks))::int
 FROM public.cost_events c WHERE c.tenant_id=tid
 AND c.task NOT IN ('voice.guidance','voice.session','voice.transcription')
 AND c.created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai';
END $$;
INSERT INTO schema_migrations(version) VALUES('065_voice_sessions');
