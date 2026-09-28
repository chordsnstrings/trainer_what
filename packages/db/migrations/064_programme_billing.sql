-- Trainer-set programme length, upfront programme payments and the premium
-- voice add-on (docs/features/programme.md).
--
-- 1. An upfront programme is one Stripe Checkout payment for the whole
--    programme. Its charge is posted as an immutable `stripe-programme:<intent>`
--    journal (commission like a membership charge), so a member's own charge
--    listings used for refund requests include it. Same signatures, grants and
--    definer attributes as migration 061; only the source filter widens.
CREATE OR REPLACE FUNCTION member_charges()
RETURNS TABLE(id uuid, data jsonb, created_at timestamptz, refunded_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT j.id,j.data,j.created_at,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM public.journals r
  WHERE r.tenant_id=j.tenant_id AND r.data->>'originalJournalId'=j.id::text),0)::bigint
 FROM public.journals j
 WHERE j.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND j.data->>'userId'=nullif(current_setting('app.user_id',true),'')
 AND (j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%')
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY j.created_at DESC LIMIT 100;
$$;
CREATE OR REPLACE FUNCTION member_charge(charge text)
RETURNS TABLE(id uuid, data jsonb, created_at timestamptz, refunded_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT j.id,j.data,j.created_at,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM public.journals r
  WHERE r.tenant_id=j.tenant_id AND r.data->>'originalJournalId'=j.id::text),0)::bigint
 FROM public.journals j
 WHERE j.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND j.data->>'userId'=nullif(current_setting('app.user_id',true),'') AND j.data->>'chargeId'=charge
 AND (j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%')
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber');
$$;
REVOKE ALL ON FUNCTION member_charges(), member_charge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_charges(), member_charge(text) TO trainer_app;

-- 2. Existing offers keep working. Every offer states its billing (monthly,
--    as before) and rolling programme length; an offer that sold premium voice
--    as part of its price keeps including it (`voiceIncluded`), so members on
--    it keep voice without buying the new add-on. New offers price voice as an
--    add-on (`voiceAddOnMinor`) instead of as a separate offer.
UPDATE records SET data=data||jsonb_build_object('billing','monthly')
 WHERE kind='product' AND NOT data ? 'billing';
UPDATE records SET data=data||jsonb_build_object('programmeDays',NULL)
 WHERE kind='product' AND NOT data ? 'programmeDays';
UPDATE records SET data=data||jsonb_build_object('voiceIncluded',true)
 WHERE kind='product' AND data->>'premiumVoice'='true' AND NOT data ? 'voiceIncluded';

-- 3. The worker's end-of-programme sweep reads upfront memberships by their
--    access end, and add-on reconciliation reads members with a voice add-on.
CREATE INDEX IF NOT EXISTS subscriptions_upfront_end ON subscriptions(tenant_id,period_end)
 WHERE data->>'billing'='upfront';
CREATE INDEX IF NOT EXISTS subscriptions_voice_addon ON subscriptions(tenant_id)
 WHERE data ? 'voiceAddOn';
CREATE INDEX IF NOT EXISTS journals_charge_id ON journals(tenant_id,(data->>'chargeId'))
 WHERE data ? 'chargeId';

INSERT INTO schema_migrations(version) VALUES('064_programme_billing');
