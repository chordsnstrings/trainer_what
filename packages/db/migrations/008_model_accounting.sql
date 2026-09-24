ALTER TABLE cost_events ALTER COLUMN input_tokens DROP NOT NULL;
ALTER TABLE cost_events ALTER COLUMN input_tokens DROP DEFAULT;
ALTER TABLE cost_events ALTER COLUMN output_tokens DROP NOT NULL;
ALTER TABLE cost_events ALTER COLUMN output_tokens DROP DEFAULT;
ALTER TABLE cost_events ADD COLUMN status text NOT NULL DEFAULT 'recorded' CHECK(status IN ('reserved','unknown','recorded','reconciled'));
ALTER TABLE cost_events ADD COLUMN pricing jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cost_events ADD COLUMN reconciliation jsonb;
UPDATE cost_events SET status='unknown' WHERE cost_usd IS NULL;
ALTER TABLE cost_events ADD CHECK(cost_usd IS NULL OR cost_usd>=0);
ALTER TABLE cost_events ADD CHECK(input_tokens IS NULL OR input_tokens>=0);
ALTER TABLE cost_events ADD CHECK(output_tokens IS NULL OR output_tokens>=0);
ALTER TABLE cost_events ADD CHECK((status IN ('recorded','reconciled'))=(cost_usd IS NOT NULL));
CREATE INDEX cost_events_tenant_time ON cost_events(tenant_id,created_at);
CREATE FUNCTION protect_model_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Usage history cannot be deleted'; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.user_id,NEW.task,NEW.provider,NEW.model,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.user_id,OLD.task,OLD.provider,OLD.model,OLD.created_at) THEN
  RAISE EXCEPTION 'Usage identity cannot be changed';
 END IF;
 IF OLD.status IN ('recorded','reconciled') THEN RAISE EXCEPTION 'Finalized usage cannot be changed'; END IF;
 IF NOT ((OLD.status='reserved' AND NEW.status IN ('unknown','recorded','reconciled')) OR (OLD.status='unknown' AND NEW.status='reconciled')) THEN RAISE EXCEPTION 'Invalid usage transition'; END IF;
 IF NEW.status IN ('recorded','reconciled') AND NEW.cost_usd IS NULL THEN RAISE EXCEPTION 'Known usage requires an explicit cost'; END IF;
 IF NEW.status='reconciled' AND NEW.reconciliation IS NULL THEN RAISE EXCEPTION 'Usage reconciliation requires evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cost_history BEFORE UPDATE OR DELETE ON cost_events FOR EACH ROW EXECUTE FUNCTION protect_model_usage();
REVOKE DELETE ON cost_events FROM trainer_app;
INSERT INTO schema_migrations(version) VALUES('008_model_accounting');
