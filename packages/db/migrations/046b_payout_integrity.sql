-- Payout amount, destination and period are fixed once prepared; corrections
-- use a new revision or compensating journal. Status follows the domain
-- payoutTransitions graph, and evidence changes only with a transition.
CREATE FUNCTION payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'immutable payout; write a compensating entry';
 END IF;
 IF (NEW.id,NEW.tenant_id,NEW.period,NEW.revision,NEW.amount_minor,NEW.beneficiary_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.period,OLD.revision,OLD.amount_minor,OLD.beneficiary_id,OLD.created_at) THEN
  RAISE EXCEPTION 'payout amount, destination and period are immutable; prepare a new revision';
 END IF;
 IF OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
  RAISE EXCEPTION 'payout provider reference is already recorded; reconcile instead';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF (OLD.status,NEW.status) NOT IN (
   ('ready','held'),('ready','submitted'),('ready','canceled'),
   ('held','ready'),('held','canceled'),
   ('submitted','processing'),('submitted','unknown'),('submitted','failed'),
   ('processing','paid'),('processing','unknown'),('processing','failed'),
   ('unknown','processing'),('unknown','paid'),('unknown','failed'),
   ('paid','returned')) THEN
   RAISE EXCEPTION 'invalid payout transition % to %',OLD.status,NEW.status;
  END IF;
 ELSIF (NEW.bank_reference,NEW.failure_reason) IS DISTINCT FROM (OLD.bank_reference,OLD.failure_reason) THEN
  RAISE EXCEPTION 'payout evidence changes only with a status transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payouts_guarded BEFORE UPDATE OR DELETE ON payouts FOR EACH ROW EXECUTE FUNCTION payout_guard();

-- Subscriptions mirror provider state, but never move between people or workspaces.
CREATE FUNCTION subscription_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.user_id) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.user_id) THEN
  RAISE EXCEPTION 'subscription identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_identity BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION subscription_identity_guard();
REVOKE DELETE ON payouts,subscriptions FROM trainer_app;
INSERT INTO schema_migrations(version) VALUES ('046b_payout_integrity');
