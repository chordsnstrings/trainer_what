CREATE FUNCTION immutable_finance_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind IN ('finance_policy','cost_allocation') THEN RAISE EXCEPTION 'financial policy and allocation history is immutable; create a prospective revision or compensating entry'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER finance_policy_history BEFORE UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION immutable_finance_policy();
CREATE UNIQUE INDEX finance_policy_effective_identity ON records(tenant_id,(data->>'effectiveAt')) WHERE kind='finance_policy';
CREATE UNIQUE INDEX finance_allocation_intent ON records(tenant_id,(data->>'intent')) WHERE kind='cost_allocation';
CREATE UNIQUE INDEX finance_promotion_code ON records(tenant_id,(data->>'code')) WHERE kind='promotion';
INSERT INTO schema_migrations(version) VALUES('025_finance_policy_history');
