-- Trainer domain prices in USD and cached registrar prices
-- (docs/features/web-addresses.md, "Prices in USD and suggestions"; owner
-- decision of 28 September 2026). Additive: the previous release keeps
-- serving between migrate and restart (it journals AED only, which stays
-- valid, and never reads the new table).

-- 1. Journals carry their currency (the column exists since 001 with
-- CHECK(currency='AED'), and every existing journal is AED). A trainer's own
-- web address payments, refunds, disputes and the registrar cost of an order
-- priced in USD are journaled in USD. A journal is in one currency, so it
-- still balances by itself; only web address journals may use another
-- currency than AED.
ALTER TABLE journals DROP CONSTRAINT journals_currency_check;
ALTER TABLE journals ADD CONSTRAINT journals_currency_check
 CHECK(currency ~ '^[A-Z]{3}$' AND (currency='AED' OR source_key LIKE 'web-address-%'));

-- The deferred balance check (061) also keeps journals in another currency
-- off every account but the web address and registrar accounts, so a USD
-- amount can never reach the trainer's payable balance, commission, the
-- Stripe receivable, the bank or a reserve.
CREATE OR REPLACE FUNCTION balanced_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE total bigint; n bigint; other text;
BEGIN
 SELECT coalesce(sum(l.amount_minor),0),count(*) INTO total,n FROM public.journal_lines l
 WHERE l.journal_id=NEW.id AND l.tenant_id=NEW.tenant_id;
 IF total<>0 OR n<2 THEN RAISE EXCEPTION 'journal must contain balanced lines'; END IF;
 IF NEW.currency<>'AED' THEN
  SELECT l.account INTO other FROM public.journal_lines l
  WHERE l.journal_id=NEW.id AND l.tenant_id=NEW.tenant_id
   AND l.account NOT IN ('web_address_receivable','web_address_revenue','web_address_refund_liability',
    'web_address_dispute_loss','registrar_cost','registrar_prepaid')
  LIMIT 1;
  IF other IS NOT NULL THEN
   RAISE EXCEPTION 'a % journal cannot post to %', NEW.currency, other;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION balanced_journal() FROM PUBLIC;

-- 2. Registrar prices per ending (one-year USD registration and renewal cost,
-- the ICANN fee included), cached for trainer searches for 24 hours and
-- refreshed for the chosen name at checkout and by the worker. An ending the
-- registrar does not sell through its API (unsupported, or it needs
-- registrant documents) is cached as not offered, with the operator-facing
-- reason. Platform-level: no workspace, no tenant actor access; trainers only
-- ever see the marked-up price computed from it.
CREATE TABLE registrar_prices (
 registrar text NOT NULL CHECK(registrar IN ('namecheap','generic','101domain')),
 sandbox boolean NOT NULL,
 tld text NOT NULL CHECK(tld ~ '^[a-z]{2,63}(\.[a-z]{2,63})?$'),
 register_usd numeric(12,4) CHECK(register_usd>0),
 renew_usd numeric(12,4) CHECK(renew_usd>0),
 not_offered text CHECK(not_offered IS NULL OR length(not_offered) BETWEEN 1 AND 300),
 fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(registrar,sandbox,tld),
 CHECK((not_offered IS NULL AND register_usd IS NOT NULL AND renew_usd IS NOT NULL)
  OR (not_offered IS NOT NULL AND register_usd IS NULL AND renew_usd IS NULL))
);
ALTER TABLE registrar_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrar_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON registrar_prices USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON registrar_prices FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON registrar_prices TO trainer_service;
END IF; END $$;

INSERT INTO schema_migrations(version) VALUES('071_domain_pricing_usd');
