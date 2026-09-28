-- One reviewed USD to AED rate per Asia/Dubai month (docs/features/platform-finance.md,
-- phase A). Business metrics, operator statements and provider cost
-- conversions read the month's current rate; a month without a reviewed rate
-- uses the "Default USD to AED rate" platform setting (3.6725, the dirham peg)
-- and says so. Usage statements must use the reviewed rate once one exists.
--
-- Platform reference data: written and read only by the service role (the
-- Super admin and platform finance screens). Tenant transactions never read it;
-- their callers pass the rate in. Revisions are append-only history: the
-- current rate of a month is its highest revision, and no row is ever changed
-- or deleted. Additive only: the previous release never reads this table.
CREATE TABLE exchange_rates (
 id uuid PRIMARY KEY,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revision integer NOT NULL CHECK(revision>=1),
 aed_per_usd numeric(12,6) NOT NULL CHECK(aed_per_usd>=1 AND aed_per_usd<=10),
 source text NOT NULL CHECK(char_length(source) BETWEEN 5 AND 500),
 -- The operator who reviewed the rate (no foreign key: history outlives accounts).
 reviewed_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(month,revision)
);
CREATE TRIGGER exchange_rate_history BEFORE UPDATE OR DELETE ON exchange_rates FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON exchange_rates USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON exchange_rates FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON exchange_rates TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('072_exchange_rates');
