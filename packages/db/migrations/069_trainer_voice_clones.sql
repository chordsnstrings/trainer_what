-- Trainer voice clones made in the app through the voice provider (Cartesia),
-- attached to the workspace owner who recorded them
-- (docs/features/trainer-voice.md).
--
-- trainer_voice_clones: one row per clone the trainer starts: Quick (instant)
-- or Pro (fine-tuned). Owner-only, like trainer_voices: a follower never reads
-- a clone, a recording or a provider id. Members hear the active voice only
-- through guided_voice(), which activation fills in trainer_voices.
-- trainer_voice_samples: the trainer's recordings, sealed with the server key
-- (AES-256-GCM, bound to the workspace and the sample) and kept only until the
-- provider holds them; then only their size, length and hash remain.
-- voice_provider_deletions: what must still be deleted at the provider. It
-- holds provider references only (no audio, no person) and outlives the clone,
-- the trainer's erasure and a closed workspace until the worker confirms each
-- deletion; the app role cannot delete its rows.
CREATE TABLE trainer_voice_clones (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 provider text NOT NULL CHECK(provider IN ('cartesia')),
 kind text NOT NULL CHECK(kind IN ('instant','pro')),
 status text NOT NULL CHECK(status IN ('draft','processing','ready','active','failed','deleted')),
 -- The next provider step while processing (the worker's state machine).
 step text CHECK(step IS NULL OR step IN ('clone','clone_unknown','dataset','upload','fine_tune','training','voices')),
 version integer NOT NULL DEFAULT 1,
 language text NOT NULL CHECK(language ~ '^[a-z]{2}$'),
 -- The name every provider resource of this clone carries, for reconciliation.
 provider_name text NOT NULL CHECK(provider_name ~ '^trainsyou-[a-f0-9-]{36}$'),
 provider_voice_id text CHECK(provider_voice_id IS NULL OR provider_voice_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 provider_job jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(provider_job)='object' AND octet_length(provider_job::text)<=4000),
 model text CHECK(model IS NULL OR model ~ '^[A-Za-z0-9._-]{1,80}$'),
 consent_version text NOT NULL CHECK(length(consent_version) BETWEEN 1 AND 200),
 evidence jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=8000),
 error jsonb CHECK(error IS NULL OR (jsonb_typeof(error)='object' AND octet_length(error::text)<=2000)),
 preview_audio bytea CHECK(preview_audio IS NULL OR octet_length(preview_audio)<=2097152),
 previewed_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz, lease_token uuid, lease_until timestamptz,
 submitted_at timestamptz, ready_at timestamptz, activated_at timestamptz, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 CHECK(status NOT IN ('ready','active') OR provider_voice_id IS NOT NULL),
 CHECK((status='processing')=(step IS NOT NULL)),
 CHECK(status<>'deleted' OR (deleted_at IS NOT NULL AND provider_voice_id IS NULL AND preview_audio IS NULL))
);
-- One clone of each kind in progress, one active voice per workspace, and a
-- provider voice attached to one clone only (never shared between workspaces).
CREATE UNIQUE INDEX trainer_voice_clone_open ON trainer_voice_clones(tenant_id,kind) WHERE status IN ('draft','processing');
CREATE UNIQUE INDEX trainer_voice_clone_active ON trainer_voice_clones(tenant_id) WHERE status='active';
CREATE UNIQUE INDEX trainer_voice_clone_provider_voice ON trainer_voice_clones(provider,provider_voice_id) WHERE provider_voice_id IS NOT NULL;
CREATE INDEX trainer_voice_clone_due ON trainer_voice_clones(tenant_id,next_attempt_at) WHERE status='processing';

CREATE TABLE trainer_voice_samples (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), clone_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 content_type text NOT NULL CHECK(content_type IN ('audio/mpeg','audio/wav','audio/flac','audio/ogg','audio/webm')),
 byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 10485760),
 seconds numeric(8,2) NOT NULL CHECK(seconds>0 AND seconds<=3600),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 sealed bytea CHECK(sealed IS NULL OR octet_length(sealed)<=10485824),
 -- stored: sealed here; uploading: sent, answer not yet confirmed (kept for a
 -- retry); uploaded: the provider holds it and nothing is kept here.
 status text NOT NULL CHECK(status IN ('stored','uploading','uploaded')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,clone_id) REFERENCES trainer_voice_clones(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(clone_id,sha256),
 CHECK((status='uploaded')=(sealed IS NULL))
);
CREATE INDEX trainer_voice_samples_clone ON trainer_voice_samples(tenant_id,clone_id,created_at);

CREATE TABLE voice_provider_deletions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 provider text NOT NULL CHECK(provider IN ('cartesia')),
 -- named: every voice, fine-tune and dataset carrying a clone's provider name
 -- (a request whose answer was lost may have created one).
 kind text NOT NULL CHECK(kind IN ('voice','fine_tune','dataset','named')),
 reference text NOT NULL CHECK(reference ~ '^[A-Za-z0-9_-]{1,100}$'),
 reason text NOT NULL CHECK(reason ~ '^[a-z_]{1,40}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','attention')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text CHECK(last_error IS NULL OR length(last_error)<=300),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(tenant_id,provider,kind,reference),
 CHECK((status='done')=(completed_at IS NOT NULL))
);
CREATE INDEX voice_provider_deletions_due ON voice_provider_deletions(tenant_id,next_attempt_at) WHERE status='pending';

-- The workspace voice now records which provider holds it, the clone it came
-- from (NULL for a linked ElevenLabs voice), and the model and language it is
-- spoken with (a Pro clone needs the dated model it was trained for).
ALTER TABLE trainer_voices
 ADD COLUMN provider text NOT NULL DEFAULT 'elevenlabs' CHECK(provider IN ('elevenlabs','cartesia')),
 ADD COLUMN clone_id uuid,
 ADD COLUMN model text CHECK(model IS NULL OR model ~ '^[A-Za-z0-9._-]{1,80}$'),
 ADD COLUMN language text CHECK(language IS NULL OR language ~ '^[a-z]{2}$'),
 ADD FOREIGN KEY(tenant_id,clone_id) REFERENCES trainer_voice_clones(tenant_id,id) ON DELETE SET NULL (clone_id);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['trainer_voice_clones','trainer_voice_samples','voice_provider_deletions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE POLICY voice_clone_owner ON %I AS RESTRICTIVE USING(current_setting(''app.role'',true)=''owner'') WITH CHECK(current_setting(''app.role'',true)=''owner'')',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON trainer_voice_clones,trainer_voice_samples TO trainer_app;
GRANT SELECT,INSERT,UPDATE ON voice_provider_deletions TO trainer_app;

-- Members hear the workspace voice only while it is verified, the trainer's
-- latest voice consent is granted and that trainer still owns the workspace
-- (an ownership transfer never hands the previous owner's voice to members).
-- The provider, model and language go with it so a voice is never sent to a
-- provider that does not hold it. The returned columns change, so the
-- function is dropped and created again with the same grants.
DROP FUNCTION guided_voice();
CREATE FUNCTION guided_voice()
RETURNS TABLE(id uuid, version integer, provider_voice_id text, consented boolean, provider text, model text, language text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT v.id,v.version,v.provider_voice_id,coalesce((SELECT c.granted FROM public.consent_records c
  WHERE c.tenant_id=v.tenant_id AND c.user_id=v.user_id AND c.document_type='voice'
  ORDER BY c.created_at DESC,c.id DESC LIMIT 1),false),v.provider,v.model,v.language
 FROM public.trainer_voices v
 WHERE v.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND v.status='verified'
 AND EXISTS(SELECT 1 FROM public.memberships o WHERE o.tenant_id=v.tenant_id AND o.user_id=v.user_id AND o.role='owner')
 AND (current_setting('app.role',true) IN ('owner','staff','finance') OR (current_setting('app.role',true)='subscriber'
  AND EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid)));
$$;
REVOKE ALL ON FUNCTION guided_voice() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guided_voice() TO trainer_app;

-- Pro clone slots are counted for the whole provider account: a number only,
-- for the owner scope that is about to start one (and the worker). Deleted Pro
-- clones hold their slot until the provider confirms the deletion.
CREATE FUNCTION voice_pro_clones_in_use() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN current_setting('app.role',true)='owner'
  AND nullif(current_setting('app.tenant_id',true),'') IS NOT NULL THEN
  (SELECT count(*)::int FROM public.trainer_voice_clones c WHERE c.kind='pro' AND c.status IN ('processing','ready','active'))
  + (SELECT count(*)::int FROM public.voice_provider_deletions d WHERE d.kind='fine_tune' AND d.status<>'done')
 END;
$$;
REVOKE ALL ON FUNCTION voice_pro_clones_in_use() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_pro_clones_in_use() TO trainer_app;

-- Operators: provider deletions not yet confirmed, across every workspace
-- (closed ones too), those needing attention first. Only a platform
-- administrator's owner scope reads it; provider references are not returned.
CREATE FUNCTION voice_provider_deletions_outstanding(max_rows integer)
RETURNS TABLE(id uuid, tenant_id uuid, kind text, reason text, status text, attempts integer, last_error text, next_attempt_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('app.role',true) IS DISTINCT FROM 'owner' OR NOT EXISTS(SELECT 1 FROM public.users u
  WHERE u.id=nullif(current_setting('app.user_id',true),'')::uuid AND u.platform_role='admin') THEN
  RAISE EXCEPTION 'Voice provider deletions are listed for platform administrators only' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT d.id,d.tenant_id,d.kind,d.reason,d.status,d.attempts,d.last_error,d.next_attempt_at,d.created_at
 FROM public.voice_provider_deletions d WHERE d.status<>'done'
 ORDER BY (d.status='attention') DESC,d.created_at,d.id LIMIT least(greatest(coalesce(max_rows,100),1),500);
END $$;
REVOKE ALL ON FUNCTION voice_provider_deletions_outstanding(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_provider_deletions_outstanding(integer) TO trainer_app;

-- The settings guard: how many clones and unconfirmed deletions still depend
-- on the voice provider account (counts only), for a platform administrator.
-- Switching the provider away or clearing its key is refused while any remain.
CREATE FUNCTION voice_provider_work_outstanding()
RETURNS TABLE(clones integer, deletions integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('app.role',true) IS DISTINCT FROM 'owner' OR NOT EXISTS(SELECT 1 FROM public.users u
  WHERE u.id=nullif(current_setting('app.user_id',true),'')::uuid AND u.platform_role='admin') THEN
  RAISE EXCEPTION 'Voice provider work is counted for platform administrators only' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT
  (SELECT count(*)::int FROM public.trainer_voice_clones c WHERE c.status<>'deleted' AND c.submitted_at IS NOT NULL),
  (SELECT count(*)::int FROM public.voice_provider_deletions d WHERE d.status<>'done');
END $$;
REVOKE ALL ON FUNCTION voice_provider_work_outstanding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_provider_work_outstanding() TO trainer_app;

-- Previews and clones share the workspace voice budget (VOICE_DAILY_USD_LIMIT)
-- and stay out of the daily model-call count. Same signatures and grants.
CREATE OR REPLACE FUNCTION voice_guidance_spent_today() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(coalesce(c.cost_usd,(c.pricing->>'reservedCostUsd')::numeric)),0) FROM public.cost_events c
 WHERE c.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND c.task IN ('voice.guidance','voice.session','voice.transcription','voice.preview','voice.clone')
 AND c.created_at>=date_trunc('day',now())
 AND (current_setting('app.role',true) IN ('owner','staff','finance') OR (current_setting('app.role',true)='subscriber'
  AND EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid)));
$$;
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
 AND c.task NOT IN ('voice.guidance','voice.session','voice.transcription','voice.preview','voice.clone')
 AND c.created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai';
END $$;
INSERT INTO schema_migrations(version) VALUES('069_trainer_voice_clones');
