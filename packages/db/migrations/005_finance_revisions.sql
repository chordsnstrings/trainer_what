ALTER TABLE payouts DROP CONSTRAINT payouts_tenant_id_period_key;
ALTER TABLE payouts ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE payouts ADD CONSTRAINT payout_period_revision UNIQUE(tenant_id,period,revision);
CREATE FUNCTION immutable_financial_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind IN ('close','statement','rule_revision') THEN RAISE EXCEPTION 'historical records cannot be changed'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER financial_records_history BEFORE UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION immutable_financial_record();
INSERT INTO schema_migrations(version) VALUES('005_finance_revisions');
