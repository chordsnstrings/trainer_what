-- Platform finance phase B: the monthly summary behind the Super admin's
-- Platform finance screen (docs/features/platform-finance.md).
--
-- 1. platform_finance_months: one row per trainer workspace and Asia/Dubai
--    month with that workspace's figures for the month (income by product,
--    AI Coach Service Fee, Stripe fees recovered, refunds and disputes,
--    domains per currency, AI and voice cost by feature and provider,
--    payouts), rebuilt from the ledger and cost rows by the worker and on
--    request. It is a cache of figures computed from immutable records: a
--    rebuild replaces a row's figures, never a ledger entry. The screen reads
--    it instead of every workspace per request.
-- 2. platform_finance_runs: one row per run of a platform finance job
--    (summary rebuild, Stripe fee sweep, recurring platform costs,
--    DigitalOcean billing import, registrar balance check), with its result
--    or error. Daily jobs read it to run once a day however many workers run,
--    and the alert engine reads failures from it. The kinds of phases C and D
--    are listed now so no later migration has to change the check.
--
-- Platform data: service role only (the Super admin and platform finance
-- screens and the worker), no tenant actor access, like exchange_rates.
-- Additive: the previous release never reads these tables.
CREATE TABLE platform_finance_months (
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 tenant_id uuid NOT NULL,
 figures jsonb NOT NULL CHECK(jsonb_typeof(figures)='object'),
 computed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(month,tenant_id)
);
ALTER TABLE platform_finance_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_finance_months FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON platform_finance_months USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON platform_finance_months FROM PUBLIC,trainer_app;

CREATE TABLE platform_finance_runs (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('summary','stripe_fees','recurring_costs','digitalocean','registrar_balance','invoice_import')),
 status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
 -- The operator who asked for the run; NULL for the worker.
 actor_id uuid,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 result jsonb NOT NULL DEFAULT '{}'::jsonb,
 error text CHECK(error IS NULL OR char_length(error)<=1000),
 CHECK((status='running')=(finished_at IS NULL))
);
CREATE INDEX platform_finance_runs_kind ON platform_finance_runs(kind,started_at DESC);
ALTER TABLE platform_finance_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_finance_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON platform_finance_runs USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON platform_finance_runs FROM PUBLIC,trainer_app;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON platform_finance_months,platform_finance_runs TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('075_platform_finance_summary');
