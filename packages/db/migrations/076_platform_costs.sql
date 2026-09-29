-- Platform finance phase C: costs not recorded before
-- (docs/features/platform-finance.md).
--
-- 1. platform_costs: the platform's own cost ledger, for what belongs to no
--    trainer: servers, the email plan, provider plans and invoice charges not
--    attributed to calls, registrar top-ups (prepayments, not profit and loss
--    costs), payout bank fees and the like. Append-only: a mistaken entry is
--    corrected by a reversal entry (negative amount, reverses_id), never
--    changed or deleted. external_key makes every automatic or retried entry
--    idempotent (a recurring cost's month, an invoice import, a payout's bank
--    fee, a DigitalOcean invoice item in phase D).
-- 2. platform_recurring_costs: monthly costs the worker enters once a month
--    from their first month (servers, plans), until an end month is set.
-- 3. provider_invoices: provider invoices imported from CSV or JSON, kept as
--    evidence with their normalised lines and what the import did. Posted
--    usage statements are never rewritten: corrections for months already
--    charged are new "usage-adjustment:" journals in the trainer's ledger.
-- 4. stripe_fees: Stripe's actual fee of each charge, refund and dispute,
--    from its balance transaction (webhook and a reconcile sweep), in the
--    balance transaction's (settlement) currency, with the workspace and
--    product it belongs to. Trainers see their own month's total through
--    the API; the table itself is platform data.
--
-- Platform data: service role only, like exchange_rates. Additive: the
-- previous release never reads these tables.
CREATE TABLE platform_costs (
 id uuid PRIMARY KEY,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 category text NOT NULL CHECK(category IN ('server','email','provider_plan','provider_invoice','registrar_topup','payout_fee','app_store','domain','other')),
 description text NOT NULL CHECK(char_length(description) BETWEEN 3 AND 500),
 vendor text CHECK(vendor IS NULL OR char_length(vendor) BETWEEN 1 AND 100),
 amount_minor bigint NOT NULL CHECK(amount_minor<>0 AND abs(amount_minor)<=100000000000),
 currency text NOT NULL CHECK(currency IN ('AED','USD')),
 receipt_reference text NOT NULL CHECK(char_length(receipt_reference) BETWEEN 3 AND 300),
 source text NOT NULL CHECK(source IN ('manual','recurring','invoice_import','digitalocean','payout_fee','reversal')),
 external_key text UNIQUE CHECK(external_key IS NULL OR char_length(external_key) BETWEEN 3 AND 300),
 recurring_id uuid,
 tenant_id uuid,
 payout_id uuid,
 reverses_id uuid UNIQUE REFERENCES platform_costs(id),
 estimated boolean NOT NULL DEFAULT false,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 -- Only a reversal, or a DigitalOcean invoice credit (phase D), is negative.
 CHECK(amount_minor>0 OR reverses_id IS NOT NULL OR source='digitalocean'),
 CHECK(reverses_id IS NULL OR amount_minor<0),
 CHECK((source='reversal')=(reverses_id IS NOT NULL)),
 CHECK(category<>'payout_fee' OR (payout_id IS NOT NULL AND tenant_id IS NOT NULL) OR reverses_id IS NOT NULL)
);
CREATE INDEX platform_costs_month ON platform_costs(month);
CREATE TRIGGER platform_cost_history BEFORE UPDATE OR DELETE ON platform_costs FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE platform_recurring_costs (
 id uuid PRIMARY KEY,
 category text NOT NULL CHECK(category IN ('server','email','provider_plan','app_store','domain','other')),
 description text NOT NULL CHECK(char_length(description) BETWEEN 3 AND 500),
 vendor text CHECK(vendor IS NULL OR char_length(vendor) BETWEEN 1 AND 100),
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=100000000000),
 currency text NOT NULL CHECK(currency IN ('AED','USD')),
 receipt_reference text NOT NULL CHECK(char_length(receipt_reference) BETWEEN 3 AND 300),
 starts_month text NOT NULL CHECK(starts_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 ends_month text CHECK(ends_month IS NULL OR ends_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_month IS NULL OR ends_month>=starts_month)
);

CREATE TABLE provider_invoices (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 reference text NOT NULL CHECK(char_length(reference) BETWEEN 3 AND 200),
 format text NOT NULL CHECK(format IN ('csv','json')),
 total_usd numeric(18,8) NOT NULL CHECK(total_usd>=0),
 usage_usd numeric(18,8) NOT NULL CHECK(usage_usd>=0),
 plan_usd numeric(18,8) NOT NULL CHECK(plan_usd>=0),
 line_count integer NOT NULL CHECK(line_count>=0),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),
 evidence_reference text NOT NULL CHECK(char_length(evidence_reference) BETWEEN 10 AND 500),
 result jsonb NOT NULL DEFAULT '{}'::jsonb,
 uploaded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,reference)
);
CREATE TRIGGER provider_invoice_history BEFORE UPDATE OR DELETE ON provider_invoices FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE stripe_fees (
 balance_transaction_id text PRIMARY KEY CHECK(balance_transaction_id ~ '^txn_[A-Za-z0-9_]{1,200}$'),
 tenant_id uuid,
 source_type text NOT NULL CHECK(source_type IN ('charge','refund','dispute')),
 source_id text NOT NULL CHECK(char_length(source_id) BETWEEN 3 AND 200),
 charge_id text,
 product text NOT NULL CHECK(product IN ('membership','programme','voice_addon','booking','domain','other')),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor bigint NOT NULL,
 fee_minor bigint NOT NULL,
 net_minor bigint NOT NULL,
 fee_details jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(fee_details)='array'),
 exchange_rate numeric(18,8),
 occurred_at timestamptz NOT NULL,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stripe_fees_month ON stripe_fees(month,tenant_id);
CREATE INDEX stripe_fees_source ON stripe_fees(source_id);
CREATE TRIGGER stripe_fee_history BEFORE UPDATE OR DELETE ON stripe_fees FOR EACH ROW EXECUTE FUNCTION immutable_record();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_costs','platform_recurring_costs','provider_invoices','stripe_fees'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY service_only ON %I USING (current_user<>''trainer_app'') WITH CHECK (current_user<>''trainer_app'')',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,trainer_app',t);
 END LOOP;
END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON platform_costs,provider_invoices,stripe_fees TO trainer_service;
 GRANT SELECT,INSERT,UPDATE ON platform_recurring_costs TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('076_platform_costs');
