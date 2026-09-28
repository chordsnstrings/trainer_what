-- Cost accounting for the Super admin's cost and profit view
-- (docs/features/platform-finance.md, phase A).
--
-- 1. cost_events carries what each provider call was for: the member it
--    served (member_id), the product that member bought (product), whether the
--    member had complimentary access at the time (complimentary) and the
--    estimate the call was priced from (estimated_cost_usd). The provider
--    column now holds the real provider name for model calls too (rows written
--    before this migration keep 'configured-model').
-- 2. A new 'estimated' status: the call is priced at its stored estimate (voice
--    speech, transcription, previews and clones at the time of the call, or an
--    ambiguous call an operator or the approved month-close automation chose to
--    estimate). Estimated rows count as priced, so they no longer block the
--    monthly usage charge, month close or automatic payouts. A provider invoice
--    can still correct them later ('estimated' -> 'reconciled', with evidence).
-- 3. model_prices: reviewed per-provider, per-model token prices, effective from
--    a date. Model calls use the latest price in effect for their provider and
--    model, and fall back to the AI model settings' price when none exists.
-- 4. Date-range indexes for provider and unpriced queries.
-- 5. The workspace voice budget resets on the Asia/Dubai day, like the AI
--    request limit (it used the database's day).
--
-- Additive for the previous release, which keeps serving between migrate and
-- restart: it writes none of the new columns (they default), it still makes
-- only the transitions allowed below, and it never sees 'estimated' except as
-- a priced row (cost_usd is set).

ALTER TABLE cost_events
 ADD COLUMN member_id uuid,
 ADD COLUMN product text CHECK(product IS NULL OR product IN ('membership','programme','nutrition','voice_addon','trainer_setup')),
 ADD COLUMN complimentary boolean NOT NULL DEFAULT false,
 ADD COLUMN estimated_cost_usd numeric(18,8) CHECK(estimated_cost_usd IS NULL OR estimated_cost_usd>=0);

-- The status list and the "priced rows carry a cost" rule gain 'estimated'.
-- The original unnamed checks (migration 008) are found by their definition.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint
  WHERE conrelid='public.cost_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%reconciled%'
 LOOP
  EXECUTE format('ALTER TABLE public.cost_events DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE cost_events ADD CONSTRAINT cost_events_status_known CHECK(status IN ('reserved','unknown','estimated','recorded','reconciled'));
ALTER TABLE cost_events ADD CONSTRAINT cost_events_priced_cost CHECK((status IN ('estimated','recorded','reconciled'))=(cost_usd IS NOT NULL));
ALTER TABLE cost_events ADD CONSTRAINT cost_events_estimate_priced CHECK(status<>'estimated' OR (estimated_cost_usd IS NOT NULL AND cost_usd=estimated_cost_usd));

-- Existing rows keep their history: the estimate is what they were reserved
-- at (voice), or their price-sheet cost (model calls priced when recorded).
ALTER TABLE cost_events DISABLE TRIGGER cost_history;
UPDATE cost_events SET estimated_cost_usd=CASE
  WHEN pricing ? 'reservedCostUsd' AND (pricing->>'reservedCostUsd') ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
   THEN round((pricing->>'reservedCostUsd')::numeric,8)
  WHEN status='recorded' THEN cost_usd END
 WHERE estimated_cost_usd IS NULL;
UPDATE cost_events SET product=CASE
  WHEN task IN ('voice.clone','voice.preview') THEN 'trainer_setup'
  WHEN task LIKE 'voice.%' THEN 'voice_addon'
  WHEN task IN ('nutrition_week','meal_photo_estimate') THEN 'nutrition'
  WHEN task IN ('brain_plan','brain_plan_adaptation','coaching') THEN 'membership'
  ELSE 'trainer_setup' END
 WHERE product IS NULL;
ALTER TABLE cost_events ENABLE TRIGGER cost_history;

CREATE OR REPLACE FUNCTION protect_model_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Usage history cannot be deleted'; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.user_id,NEW.task,NEW.provider,NEW.model,NEW.created_at,NEW.member_id,NEW.product,NEW.complimentary)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.user_id,OLD.task,OLD.provider,OLD.model,OLD.created_at,OLD.member_id,OLD.product,OLD.complimentary) THEN
  RAISE EXCEPTION 'Usage identity cannot be changed';
 END IF;
 IF OLD.status IN ('recorded','reconciled') THEN RAISE EXCEPTION 'Finalized usage cannot be changed'; END IF;
 IF NOT ((OLD.status='reserved' AND NEW.status IN ('unknown','estimated','recorded','reconciled'))
      OR (OLD.status='unknown' AND NEW.status IN ('estimated','reconciled'))
      OR (OLD.status='estimated' AND NEW.status='reconciled')) THEN
  RAISE EXCEPTION 'Invalid usage transition';
 END IF;
 -- The estimate a call was priced from is kept once known, so an invoice
 -- correction always shows what it corrected.
 IF OLD.estimated_cost_usd IS NOT NULL AND NEW.estimated_cost_usd IS DISTINCT FROM OLD.estimated_cost_usd THEN
  RAISE EXCEPTION 'The stored usage estimate cannot be changed';
 END IF;
 IF NEW.status IN ('estimated','recorded','reconciled') AND NEW.cost_usd IS NULL THEN RAISE EXCEPTION 'Known usage requires an explicit cost'; END IF;
 IF NEW.status='reconciled' AND NEW.reconciliation IS NULL THEN RAISE EXCEPTION 'Usage reconciliation requires evidence'; END IF;
 RETURN NEW;
END $$;

CREATE INDEX cost_events_provider_time ON cost_events(tenant_id,provider,created_at);
CREATE INDEX cost_events_unpriced ON cost_events(tenant_id,created_at) WHERE cost_usd IS NULL;

-- Reviewed token prices per provider and model. Platform reference data:
-- service role only, append-only (a new price is a new row effective from its
-- date; history is never changed).
CREATE TABLE model_prices (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
 model text NOT NULL CHECK(model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$'),
 input_usd_per_million numeric(18,8) NOT NULL CHECK(input_usd_per_million>=0 AND input_usd_per_million<=100000),
 output_usd_per_million numeric(18,8) NOT NULL CHECK(output_usd_per_million>=0 AND output_usd_per_million<=100000),
 price_version text NOT NULL CHECK(char_length(price_version) BETWEEN 1 AND 100),
 effective_from timestamptz NOT NULL,
 source text NOT NULL CHECK(char_length(source) BETWEEN 5 AND 500),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,model,effective_from)
);
CREATE TRIGGER model_price_history BEFORE UPDATE OR DELETE ON model_prices FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE model_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON model_prices USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON model_prices FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON model_prices TO trainer_service;
END IF; END $$;

-- The voice budget day follows Asia/Dubai, like model_usage_today(). Same
-- signature, owner and grants as migration 069.
CREATE OR REPLACE FUNCTION voice_guidance_spent_today() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(coalesce(c.cost_usd,(c.pricing->>'reservedCostUsd')::numeric)),0) FROM public.cost_events c
 WHERE c.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND c.task IN ('voice.guidance','voice.session','voice.transcription','voice.preview','voice.clone')
 AND c.created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'
 AND (current_setting('app.role',true) IN ('owner','staff','finance') OR (current_setting('app.role',true)='subscriber'
  AND EXISTS(SELECT 1 FROM public.memberships sm WHERE sm.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND sm.user_id=nullif(current_setting('app.user_id',true),'')::uuid)));
$$;
INSERT INTO schema_migrations(version) VALUES('073_cost_accounting');
