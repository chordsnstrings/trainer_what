-- Platform finance phase D: DigitalOcean billing import
-- (docs/features/platform-finance.md).
--
-- The DigitalOcean token is team-wide and unrelated projects share the bill,
-- so only the invoice items of the configured project become platform costs
-- (platform_costs, source 'digitalocean', keyed by invoice and item).
-- 1. digitalocean_invoices: each final monthly invoice read, once, with how
--    many of its items belonged to the project and their total. An invoice
--    with none of the project's items is recorded too, so it is not read
--    again; its month then has no DigitalOcean cost for the platform.
-- 2. digitalocean_estimates: the current month's cost estimated from the
--    project's own resources (DigitalOcean splits by project only on final
--    invoices), recomputed daily; a month whose invoice was imported uses
--    the invoice instead (the estimate is kept as history).
--
-- Platform data: service role only. Additive: the previous release never
-- reads these tables.
CREATE TABLE digitalocean_invoices (
 invoice_uuid text PRIMARY KEY CHECK(invoice_uuid ~ '^[0-9A-Za-z-]{8,64}$'),
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 team_amount_usd numeric(14,2) NOT NULL,
 project_name text NOT NULL CHECK(char_length(project_name) BETWEEN 1 AND 175),
 project_items integer NOT NULL CHECK(project_items>=0),
 project_amount_usd numeric(14,2) NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX digitalocean_invoices_month ON digitalocean_invoices(month);
CREATE TRIGGER digitalocean_invoice_history BEFORE UPDATE OR DELETE ON digitalocean_invoices FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE digitalocean_estimates (
 month text PRIMARY KEY CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 project_name text NOT NULL CHECK(char_length(project_name) BETWEEN 1 AND 175),
 project_id text NOT NULL CHECK(char_length(project_id) BETWEEN 1 AND 64),
 amount_usd numeric(14,4) NOT NULL CHECK(amount_usd>=0),
 to_date_usd numeric(14,4) NOT NULL CHECK(to_date_usd>=0),
 resources jsonb NOT NULL CHECK(jsonb_typeof(resources)='array'),
 computed_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['digitalocean_invoices','digitalocean_estimates'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY service_only ON %I USING (current_user<>''trainer_app'') WITH CHECK (current_user<>''trainer_app'')',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,trainer_app',t);
 END LOOP;
END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON digitalocean_invoices TO trainer_service;
 GRANT SELECT,INSERT,UPDATE ON digitalocean_estimates TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('077_digitalocean_billing');
