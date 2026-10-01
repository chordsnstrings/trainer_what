-- Model profiles (docs/features/model-profiles.md): saved model connections in
-- Super admin, side by side, with one active and one fallback profile; switch
-- checks (a fixed de-identified test set through the app's own request path)
-- and an append-only audit of every change, test, check and switch.
-- Platform reference data: service role only, never a tenant record.
CREATE TABLE model_profiles (
 id uuid PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
 -- Admin-only name (may name the vendor); label is what coaches see.
 name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 80),
 label text NOT NULL CHECK(char_length(label) BETWEEN 2 AND 40),
 tier text NOT NULL CHECK(tier IN ('standard','frontier')),
 adapter text NOT NULL CHECK(adapter IN ('openai_compatible','anthropic')),
 role text CHECK(role IN ('active','fallback')),
 -- The migrated default: address, key, model ID, request style, effort,
 -- vision and prices are the AI model settings' own (unchanged requests,
 -- costs and qualification pins).
 inherit_settings boolean NOT NULL DEFAULT false,
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings)='object'),
 encrypted_secrets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(encrypted_secrets)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 last_test jsonb CHECK(last_test IS NULL OR jsonb_typeof(last_test)='object'),
 updated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT inherit_settings OR adapter='openai_compatible')
);
-- One active and one fallback profile at most.
CREATE UNIQUE INDEX model_profiles_one_per_role ON model_profiles(role) WHERE role IS NOT NULL;
CREATE TABLE model_switch_checks (
 id uuid PRIMARY KEY,
 profile_id uuid NOT NULL REFERENCES model_profiles(id),
 profile_revision integer NOT NULL CHECK(profile_revision > 0),
 status text NOT NULL CHECK(status IN ('queued','running','passed','failed','error')),
 report jsonb CHECK(report IS NULL OR jsonb_typeof(report)='object'),
 requested_by uuid NOT NULL,
 leased_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX model_switch_checks_recent ON model_switch_checks(profile_id,created_at DESC);
CREATE INDEX model_switch_checks_queued ON model_switch_checks(created_at) WHERE status IN ('queued','running');
CREATE TABLE model_profile_audit (
 id uuid PRIMARY KEY,
 profile_id uuid NOT NULL REFERENCES model_profiles(id),
 action text NOT NULL CHECK(action IN ('saved','key_saved','tested','check_requested','check_completed','activated','switched_back','fallback_set','fallback_cleared')),
 actor_id uuid NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_profile_audit_recent ON model_profile_audit(created_at DESC,id);
CREATE TRIGGER model_profile_audit_immutable BEFORE UPDATE OR DELETE ON model_profile_audit FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE model_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON model_profiles USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
ALTER TABLE model_switch_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_switch_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON model_switch_checks USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
ALTER TABLE model_profile_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_profile_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON model_profile_audit USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON model_profiles,model_switch_checks,model_profile_audit FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON model_profiles,model_switch_checks TO trainer_service;
 GRANT SELECT,INSERT ON model_profile_audit TO trainer_service;
END IF; END $$;

-- The current configuration becomes the active profile (it inherits the AI
-- model settings, so nothing sent or pinned changes), beside inactive
-- profiles without keys that the owner completes in Super admin. Labels are
-- coach-facing and never name a model or vendor.
INSERT INTO model_profiles(id,slug,name,label,tier,adapter,role,inherit_settings,settings) VALUES
 ('7c1e0000-0000-4000-8000-000000000001','current-settings','Current AI model settings','Standard model','standard','openai_compatible','active',true,'{}'::jsonb),
 ('7c1e0000-0000-4000-8000-000000000002','openai-chatgpt','OpenAI ChatGPT (gpt-5.5)','Frontier model','frontier','openai_compatible',NULL,false,
  '{"baseUrl":"https://api.openai.com/v1","model":"gpt-5.5","provider":"openai","requestStyle":"reasoning","reasoningEffort":"auto","sendTemperature":false,"jsonMode":true,"vision":true,"defaultMaxTokens":4000,"inputUsdPerMillion":5,"outputUsdPerMillion":30,"priceVersion":"openai-gpt-5.5-2026-09-29"}'::jsonb),
 ('7c1e0000-0000-4000-8000-000000000003','anthropic-sonnet','Anthropic Sonnet 5.5 (native Messages API)','Frontier model','frontier','anthropic',NULL,false,
  '{"baseUrl":"https://api.anthropic.com/v1","model":"claude-sonnet-5-5","provider":"anthropic","requestStyle":"reasoning","reasoningEffort":"low","sendTemperature":false,"jsonMode":true,"vision":true,"defaultMaxTokens":4096,"budgets":{"coach_selection":{"maxTokens":4000},"meal_photo":{"maxTokens":6000}},"inputUsdPerMillion":2,"outputUsdPerMillion":10,"cacheReadUsdPerMillion":0.2,"cacheWriteUsdPerMillion":2.5,"priceVersion":"anthropic-2026-09-25"}'::jsonb),
 ('7c1e0000-0000-4000-8000-000000000004','anthropic-opus','Anthropic Opus 5.5 (native Messages API)','Frontier model','frontier','anthropic',NULL,false,
  '{"baseUrl":"https://api.anthropic.com/v1","model":"claude-opus-5-5","provider":"anthropic","requestStyle":"reasoning","reasoningEffort":"low","sendTemperature":false,"jsonMode":true,"vision":true,"defaultMaxTokens":4096,"budgets":{"coach_selection":{"maxTokens":4000},"meal_photo":{"maxTokens":6000}},"inputUsdPerMillion":4,"outputUsdPerMillion":20,"cacheReadUsdPerMillion":0.2,"cacheWriteUsdPerMillion":5,"priceVersion":"anthropic-2026-09-25"}'::jsonb);
INSERT INTO schema_migrations(version) VALUES('080_model_profiles');
