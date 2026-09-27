-- Tenant scope isolation (docs/features/isolation.md).
--
-- 1. Tenant transactions (trainer_app) may not call set_config: no statement in
--    a tenant scope can change role, app.tenant_id, app.user_id, app.role or
--    any other setting (UPDATE pg_settings calls set_config too). The service
--    role keeps it for scope entry. Releases before this one called set_config
--    after SET ROLE, so a database that already has workspaces keeps PUBLIC
--    execute here; infra/tenant-scope.sql revokes it once the release that runs
--    the deployment is scope-compatible (controller runtime-role step), and CI
--    applies it to its fresh databases.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants) THEN
    REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
    GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO trainer_service;
  END IF;
END $$;

-- 2. Narrow definer helpers that replace in-transaction elevation. Each reads
--    the fixed scope (app.tenant_id/app.user_id/app.role, unchangeable by the
--    tenant role after step 1), validates its arguments, returns only the
--    columns its caller needs and is executable by trainer_app only.

-- Notifications: a sender addresses a member of its own workspace. A follower
-- may address themselves, or its coaching team (owner/staff) with a safety or
-- coaching notice; team roles may address any member.
CREATE FUNCTION notification_recipient(recipient uuid, notice_category text, push_key text)
RETURNS TABLE(permitted boolean, email text, name text, role text, preferences jsonb, marketing boolean, devices uuid[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller uuid := nullif(current_setting('app.user_id',true),'')::uuid;
 caller_role text := current_setting('app.role',true);
 target record;
BEGIN
 IF tid IS NULL OR caller_role IS NULL OR caller_role NOT IN ('owner','staff','finance','subscriber') THEN
  RAISE EXCEPTION 'Notification scope required' USING ERRCODE='42501'; END IF;
 SELECT u.email,u.name,m.role INTO target FROM public.memberships m JOIN public.users u ON u.id=m.user_id
  WHERE m.tenant_id=tid AND m.user_id=recipient;
 IF NOT FOUND THEN RETURN; END IF;
 IF caller_role='subscriber' AND recipient IS DISTINCT FROM caller
  AND NOT (notice_category IN ('safety','coaching') AND target.role IN ('owner','staff')) THEN
  RETURN QUERY SELECT false,NULL::text,NULL::text,NULL::text,NULL::jsonb,NULL::boolean,NULL::uuid[];
  RETURN;
 END IF;
 RETURN QUERY SELECT true,target.email,target.name,target.role,
  (SELECT p.data FROM public.notification_preferences p WHERE p.tenant_id=tid AND p.user_id=recipient),
  coalesce((SELECT c.granted FROM public.consent_records c WHERE c.tenant_id=tid AND c.user_id=recipient
   AND c.document_type='marketing' ORDER BY c.created_at DESC,c.id DESC LIMIT 1),false),
  CASE WHEN push_key IS NULL THEN ARRAY[]::uuid[] ELSE coalesce((SELECT array_agg(d.id ORDER BY d.created_at,d.id) FROM (
   SELECT s.id,s.created_at FROM public.push_subscriptions s WHERE s.tenant_id=tid AND s.user_id=recipient
   AND s.expires_at>clock_timestamp() AND s.vapid_key_id=push_key ORDER BY s.created_at LIMIT 8) d),ARRAY[]::uuid[]) END;
END $$;
-- Inserts one notification under the same addressing rule; null on a dedupe hit.
CREATE FUNCTION enqueue_notification(notice_id uuid, recipient uuid, notice_category text, notice_dedupe text,
 notice_title text, notice_body text, notice_href text, notice_email_status text, notice_data jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller uuid := nullif(current_setting('app.user_id',true),'')::uuid;
 caller_role text := current_setting('app.role',true);
 target_role text;
 inserted uuid;
BEGIN
 IF tid IS NULL OR caller_role IS NULL OR caller_role NOT IN ('owner','staff','finance','subscriber') THEN
  RAISE EXCEPTION 'Notification scope required' USING ERRCODE='42501'; END IF;
 IF notice_email_status IS NULL OR notice_email_status NOT IN ('pending','suppressed') THEN
  RAISE EXCEPTION 'Invalid notification email status' USING ERRCODE='22023'; END IF;
 SELECT m.role INTO target_role FROM public.memberships m WHERE m.tenant_id=tid AND m.user_id=recipient;
 IF target_role IS NULL THEN RETURN NULL; END IF;
 IF caller_role='subscriber' AND recipient IS DISTINCT FROM caller
  AND NOT (notice_category IN ('safety','coaching') AND target_role IN ('owner','staff')) THEN
  RAISE EXCEPTION 'A safety alert must go to your trainer' USING ERRCODE='42501'; END IF;
 INSERT INTO public.notifications(id,tenant_id,user_id,category,dedupe_key,title,body,href,email_status,data)
 VALUES(notice_id,tid,recipient,notice_category,notice_dedupe,notice_title,notice_body,coalesce(notice_href,''),
  notice_email_status,coalesce(notice_data,'{}'::jsonb))
 ON CONFLICT DO NOTHING RETURNING id INTO inserted;
 RETURN inserted;
END $$;
-- The coaching team's user ids (owner and staff) of the current workspace only.
CREATE FUNCTION notification_team() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT m.user_id FROM public.memberships m
 WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND m.role IN ('owner','staff')
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY m.user_id;
$$;

-- Membership exit: the counts that block an exit, for the follower themselves
-- or the workspace owner. No row data leaves the function.
CREATE FUNCTION membership_exit_blockers(follower uuid)
RETURNS TABLE(renewal integer, checkout integer, payment integer, booking integer, open_privacy integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller uuid := nullif(current_setting('app.user_id',true),'')::uuid;
 caller_role text := current_setting('app.role',true);
BEGIN
 IF tid IS NULL OR follower IS NULL OR NOT coalesce(caller_role='owner' OR (caller_role='subscriber' AND caller=follower),false) THEN
  RAISE EXCEPTION 'Exit checks are limited to the follower and the workspace owner' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT
  (SELECT count(*)::int FROM public.records r WHERE r.tenant_id=tid AND r.kind='subscription_transition'
   AND r.owner_user_id=follower AND r.status IN ('submitting','unknown')),
  (SELECT count(*)::int FROM public.records r WHERE r.tenant_id=tid AND r.kind IN ('checkout','booking_payment')
   AND r.owner_user_id=follower AND r.status IN ('creating','open','unknown')),
  (SELECT count(*)::int FROM public.records r WHERE r.tenant_id=tid AND (r.owner_user_id=follower OR r.data->>'userId'=follower::text)
   AND ((r.kind IN ('refund','booking_refund') AND r.status IN ('submitting','unknown','refund_submitting','refund_unknown','refunding'))
    OR (r.kind IN ('financial_intent','finance_intent','billing_intent','subscription_intent') AND r.status IN ('creating','submitting','unknown')))),
  (SELECT count(*)::int FROM public.bookings b JOIN public.booking_slots s ON s.tenant_id=b.tenant_id AND s.id=b.slot_id
   WHERE b.tenant_id=tid AND b.user_id=follower AND b.status IN ('confirmed','payment_pending') AND s.ends_at>now()),
  (SELECT count(*)::int FROM public.records r WHERE r.tenant_id=tid AND r.kind='privacy_request'
   AND r.owner_user_id=follower AND r.status='pending_review');
END $$;
-- A follower records its own departure and reads its own exit history (the
-- rejoin check); team roles keep the existing tenant_scope policy.
CREATE POLICY membership_exit_self_insert ON membership_exits FOR INSERT WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='subscriber'
 AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND actor_id=user_id AND kind='left');
CREATE POLICY membership_exit_self_read ON membership_exits FOR SELECT USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='subscriber'
 AND user_id=nullif(current_setting('app.user_id',true),'')::uuid);

-- Bookings: a follower reserving a session needs the slot's taken seats (all
-- members' active bookings) as a number, and the effective booking fee; it
-- never reads other members' bookings or the finance policy record.
CREATE FUNCTION booking_slot_taken(slot uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT count(*)::int FROM public.bookings b
 WHERE b.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND b.slot_id=slot
 AND (b.status='confirmed' OR (b.status='payment_pending' AND b.hold_expires_at>now()))
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber');
$$;
CREATE FUNCTION booking_fee_policy() RETURNS TABLE(policy_id text, booking_fee_bps integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.id::text,coalesce((r.data->>'bookingFeeBps')::int,0) FROM public.records r
 WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND r.kind='finance_policy'
 AND r.status='published' AND (r.data->>'effectiveAt')::timestamptz<=now()
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY (r.data->>'effectiveAt')::timestamptz DESC,r.created_at DESC LIMIT 1;
$$;

-- Checkout: the coupon of one published, unexpired code for one offer. The
-- buyer's scope never lists the workspace's promotions.
CREATE FUNCTION checkout_promotion(promotion_code text, product uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.data->>'couponId' FROM public.records r
 WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND r.kind='promotion' AND r.status='published'
 AND r.data->>'code'=promotion_code AND r.data->>'productId'=product::text AND (r.data->>'expiresAt')::timestamptz>now()
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
$$;

-- Billing self-service: the calling member's own charge journals with their
-- refunded sums. Journals stay finance-scoped for everything else.
CREATE FUNCTION member_charges()
RETURNS TABLE(id uuid, data jsonb, created_at timestamptz, refunded_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT j.id,j.data,j.created_at,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM public.journals r
  WHERE r.tenant_id=j.tenant_id AND r.data->>'originalJournalId'=j.id::text),0)::bigint
 FROM public.journals j
 WHERE j.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND j.data->>'userId'=nullif(current_setting('app.user_id',true),'') AND j.source_key LIKE 'stripe-invoice:%'
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY j.created_at DESC LIMIT 100;
$$;
CREATE FUNCTION member_charge(charge text)
RETURNS TABLE(id uuid, data jsonb, created_at timestamptz, refunded_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT j.id,j.data,j.created_at,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM public.journals r
  WHERE r.tenant_id=j.tenant_id AND r.data->>'originalJournalId'=j.id::text),0)::bigint
 FROM public.journals j
 WHERE j.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND j.data->>'userId'=nullif(current_setting('app.user_id',true),'') AND j.data->>'chargeId'=charge
 AND j.source_key LIKE 'stripe-invoice:%'
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber');
$$;

-- Model and voice budgets: workspace-wide counts as numbers only. A follower
-- may ask only about its own personal count.
CREATE FUNCTION model_usage_today(capped_tasks text[], member uuid)
RETURNS TABLE(n integer, subscribers integer, mine integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller_role text := current_setting('app.role',true);
BEGIN
 IF tid IS NULL OR caller_role IS NULL OR caller_role NOT IN ('owner','staff','finance','subscriber')
  OR (caller_role='subscriber' AND member IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid) THEN
  RAISE EXCEPTION 'Model usage counts are limited to the caller' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT count(*)::int,count(*) FILTER (WHERE c.task=ANY(capped_tasks))::int,
  count(*) FILTER (WHERE c.user_id=member AND c.task=ANY(capped_tasks))::int
 FROM public.cost_events c WHERE c.tenant_id=tid
 AND c.created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai';
END $$;
CREATE FUNCTION voice_guidance_spent_today() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(coalesce(c.cost_usd,(c.pricing->>'reservedCostUsd')::numeric)),0) FROM public.cost_events c
 WHERE c.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND c.task='voice.guidance'
 AND c.created_at>=date_trunc('day',now())
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber');
$$;
-- Guided sessions: the verified trainer voice's playback facts (never the
-- sample) and whether the trainer's latest voice consent is granted.
CREATE FUNCTION guided_voice()
RETURNS TABLE(id uuid, version integer, provider_voice_id text, consented boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT v.id,v.version,v.provider_voice_id,coalesce((SELECT c.granted FROM public.consent_records c
  WHERE c.tenant_id=v.tenant_id AND c.user_id=v.user_id AND c.document_type='voice'
  ORDER BY c.created_at DESC,c.id DESC LIMIT 1),false)
 FROM public.trainer_voices v
 WHERE v.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND v.status='verified'
 AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber');
$$;
-- The coach's saved wearable policy value, for any member of the workspace.
CREATE FUNCTION coach_wearable_policy() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN r.status='saved' THEN r.data->'values'->>'policy' END FROM public.records r
 WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND r.kind='onboarding_step'
 AND r.data->>'step'='wearables' AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber')
 ORDER BY r.updated_at DESC,r.id DESC LIMIT 1;
$$;

-- Joining: the member who accepted an invitation withdraws that invitation's
-- unsent emails (outbox jobs stay staff-scoped otherwise).
CREATE FUNCTION withdraw_accepted_invitation_emails(invitation uuid, reason text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller uuid := nullif(current_setting('app.user_id',true),'')::uuid;
 changed integer;
BEGIN
 IF tid IS NULL OR caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.one_time_tokens t WHERE t.id=invitation
  AND t.tenant_id=tid AND t.purpose='invite' AND t.payload->>'acceptedUserId'=caller::text) THEN
  RAISE EXCEPTION 'Only the accepting member can withdraw its invitation emails' USING ERRCODE='42501'; END IF;
 UPDATE public.jobs SET status='completed',leased_until=NULL,last_error=left(coalesce(reason,''),200),data=data-'text'
 WHERE tenant_id=tid AND kind='email' AND intent_key LIKE 'invite-email:'||invitation::text||':%' AND status='pending';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END $$;

-- Privacy: a member's own export reads rows its scope omits (internal
-- decisions derived from its data, scheduled follow-ups, usage and audit
-- references), strictly about the requesting member.
CREATE FUNCTION personal_export_records(subject uuid, private_kinds text[])
RETURNS TABLE(id uuid, kind text, status text, version integer, data jsonb, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF tid IS NULL OR subject IS NULL OR subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN
  RAISE EXCEPTION 'A personal export covers only the requesting member' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.id,r.kind,r.status,r.version,r.data,r.created_at,r.updated_at FROM public.records r
 WHERE r.tenant_id=tid AND (r.owner_user_id=subject OR (r.kind=ANY(private_kinds) AND (r.data->>'userId'=subject::text
  OR r.data->>'subscriberId'=subject::text OR r.data->>'clientId'=subject::text)))
 ORDER BY r.created_at,r.id;
END $$;
CREATE FUNCTION personal_export_followups(subject uuid) RETURNS SETOF public.records
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF tid IS NULL OR subject IS NULL OR subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN
  RAISE EXCEPTION 'A personal export covers only the requesting member' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.* FROM public.records r WHERE r.tenant_id=tid AND r.kind='coaching_followup'
 AND (r.owner_user_id=subject OR r.data->>'creatorUserId'=subject::text OR r.data->>'authorUserId'=subject::text
  OR r.data->'authorUserIds' ? subject::text) ORDER BY r.created_at,r.id;
END $$;
CREATE FUNCTION personal_export_usage(subject uuid)
RETURNS TABLE(id uuid, task text, provider text, model text, input_tokens integer, output_tokens integer, cost_usd numeric, price_version text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF tid IS NULL OR subject IS NULL OR subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN
  RAISE EXCEPTION 'A personal export covers only the requesting member' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.id,c.task,c.provider,c.model,c.input_tokens,c.output_tokens,c.cost_usd,c.price_version,c.created_at
 FROM public.cost_events c WHERE c.tenant_id=tid AND c.user_id=subject ORDER BY c.created_at;
END $$;
CREATE FUNCTION personal_export_audit(subject uuid)
RETURNS TABLE(id uuid, name text, subject_id text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF tid IS NULL OR subject IS NULL OR subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN
  RAISE EXCEPTION 'A personal export covers only the requesting member' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.name,e.subject_id,e.created_at FROM public.events e
 WHERE e.tenant_id=tid AND e.actor_id=subject ORDER BY e.created_at;
END $$;
-- The requester's own chat media export is no longer tied to the owner role:
-- a follower exports its own uploads and conversation attachments.
CREATE OR REPLACE FUNCTION export_personal_chat_media(subject uuid)
RETURNS TABLE(id uuid,message_id uuid,file_name text,mime_type text,byte_count integer,details jsonb,created_at timestamptz,content_base64 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF coalesce(current_setting('app.role',true),'') NOT IN ('owner','staff','finance','subscriber')
  OR subject IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN
 RAISE EXCEPTION 'Personal attachment export is restricted to the requester' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.id,c.message_id,c.file_name,c.mime_type,c.byte_count,c.details,c.created_at,
 CASE WHEN c.message_id IS NOT NULL OR c.expires_at>now() THEN encode(c.media,'base64') ELSE NULL END
 FROM public.chat_attachments c WHERE c.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND (c.subject_user_id=subject OR c.uploaded_by=subject) ORDER BY c.created_at,c.id;
END $$;
-- Erasure of a member's brand photos clears only those addresses from the
-- current workspace's theme; the erasure scope never leaves the tenant role.
CREATE FUNCTION erase_brand_theme_media(media_urls text[]) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 current_theme jsonb;
 design jsonb;
 changed boolean := false;
 k text;
BEGIN
 IF tid IS NULL OR coalesce(current_setting('app.role',true),'')<>'owner' OR coalesce(current_setting('app.privacy_erasure',true),'')<>'true' THEN
  RAISE EXCEPTION 'Brand theme erasure needs a privacy erasure scope' USING ERRCODE='42501'; END IF;
 SELECT t.theme INTO current_theme FROM public.tenants t WHERE t.id=tid FOR UPDATE;
 design := current_theme->'design';
 IF design IS NULL OR jsonb_typeof(design)<>'object' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['logoUrl','photoUrl','coverUrl'] LOOP
  IF design->>k = ANY(media_urls) THEN design := jsonb_set(design,ARRAY[k],'""'::jsonb); changed := true; END IF;
 END LOOP;
 IF NOT changed THEN RETURN false; END IF;
 UPDATE public.tenants SET theme=jsonb_set(current_theme,'{design}',design)
  ||jsonb_build_object('brandVersion',coalesce((current_theme->>'brandVersion')::int,0)+1) WHERE id=tid;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION notification_recipient(uuid,text,text),enqueue_notification(uuid,uuid,text,text,text,text,text,text,jsonb),
 notification_team(),membership_exit_blockers(uuid),booking_slot_taken(uuid),booking_fee_policy(),
 checkout_promotion(text,uuid),member_charges(),member_charge(text),model_usage_today(text[],uuid),voice_guidance_spent_today(),
 guided_voice(),coach_wearable_policy(),withdraw_accepted_invitation_emails(uuid,text),personal_export_records(uuid,text[]),
 personal_export_followups(uuid),personal_export_usage(uuid),personal_export_audit(uuid),export_personal_chat_media(uuid),
 erase_brand_theme_media(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_recipient(uuid,text,text),enqueue_notification(uuid,uuid,text,text,text,text,text,text,jsonb),
 notification_team(),membership_exit_blockers(uuid),booking_slot_taken(uuid),booking_fee_policy(),
 checkout_promotion(text,uuid),member_charges(),member_charge(text),model_usage_today(text[],uuid),voice_guidance_spent_today(),
 guided_voice(),coach_wearable_policy(),withdraw_accepted_invitation_emails(uuid,text),personal_export_records(uuid,text[]),
 personal_export_followups(uuid),personal_export_usage(uuid),personal_export_audit(uuid),export_personal_chat_media(uuid),
 erase_brand_theme_media(text[]) TO trainer_app;

-- A deferred constraint trigger fires at COMMIT as the role that queued it
-- (trainer_app), after the db package has left the scope and cleared its
-- settings. The ledger balance check therefore reads the journal's lines by
-- itself instead of through the caller's row security. Trigger functions are
-- not callable directly, and it only raises or passes.
CREATE OR REPLACE FUNCTION balanced_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE total bigint; n bigint;
BEGIN
 SELECT coalesce(sum(l.amount_minor),0),count(*) INTO total,n FROM public.journal_lines l
 WHERE l.journal_id=NEW.id AND l.tenant_id=NEW.tenant_id;
 IF total<>0 OR n<2 THEN RAISE EXCEPTION 'journal must contain balanced lines'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION balanced_journal() FROM PUBLIC;

-- 3. Dedicated follower (subscriber) policies, so follower requests run in
--    their own scope instead of an owner or staff scope.
--
-- records: a follower reads its own rows of the kinds its own requests create
-- (its billing intents and invoices, guided sessions and nutrition requests,
-- favourites, leftovers, targets and open nutrition exceptions, which its
-- nutrition view shows), and the workspace material that its bookings and
-- nutrition plans are served from: published products and the product of its
-- own subscription, the booking policy, and the confirmed nutrition setup,
-- policy, cases, sources, releases and active purchase conversions (no
-- follower listing returns nutrition_* material). Internal coaching reviews
-- (decisions, exceptions, takeovers), the coaching Brain (releases, actions,
-- teaching, program templates), held-out scenarios, drafts and other members'
-- rows stay invisible; follower coaching requests use the member_* helpers
-- below instead.
ALTER POLICY record_subscriber_scope ON records USING (
 current_setting('app.role',true)<>'subscriber' OR
 (kind='product' AND status='published') OR
 (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND
  kind IN ('intake','program','workout','message','refund','booking','support','settings','preferences','privacy_request','wearable',
   'twin_snapshot','nutrition_profile','nutrition_plan','nutrition_log','nutrition_checkin','nutrition_twin','nutrition_pantry',
   'training_hold','planned_session','workout_correction','workout_substitution','client_context',
   'subscription_transition','billing_invoice','booking_payment','checkout',
   'nutrition_request','nutrition_exception','nutrition_favorite','nutrition_leftover','nutrition_target','nutrition_recovery',
   'nutrition_plan_edit','guided_session') AND
  (kind<>'message' OR status='sent')) OR
 kind IN ('booking_policy','nutrition_setup') OR
 (kind IN ('nutrition_policy','nutrition_case','nutrition_source') AND status='confirmed') OR
 (kind='nutrition_release' AND status IN ('published','paused','needs_recheck')) OR
 (kind='nutrition_purchase_spec' AND status='active') OR
 (kind='product' AND EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.tenant_id=records.tenant_id
  AND s.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND s.data->>'productId'=records.id::text))
);
-- A provider callback's finance scope settles checkout intents.
ALTER POLICY finance_record_scope ON records USING (current_setting('app.role',true)<>'finance' OR kind IN ('product','beneficiary','refund','statement','reconciliation','close','billing_invoice','subscription_transition','finance_policy','finance_automation','cost_allocation','booking_payment','promotion','checkout') OR (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND kind IN ('preferences','settings','privacy_request')));
-- The nutrition catalog tables stay invisible to a follower. Its diary,
-- capture, leftover and plan requests read only the coach's current foods and
-- recipes (never superseded or archived versions) through these helpers.
CREATE FUNCTION member_nutrition_foods() RETURNS SETOF public.nutrition_foods
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.* FROM public.nutrition_foods f
 WHERE f.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='subscriber'
 AND NOT EXISTS(SELECT 1 FROM public.nutrition_foods n WHERE n.tenant_id=f.tenant_id AND n.supersedes_id=f.id)
 AND NOT EXISTS(SELECT 1 FROM public.records a WHERE a.tenant_id=f.tenant_id AND a.kind='nutrition_catalog_archive'
  AND a.status='active' AND a.data->>'entityId'=f.id::text)
 ORDER BY f.id;
$$;
CREATE FUNCTION member_nutrition_recipes() RETURNS SETOF public.nutrition_recipes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.* FROM public.nutrition_recipes r
 WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='subscriber'
 AND NOT EXISTS(SELECT 1 FROM public.nutrition_recipes n WHERE n.tenant_id=r.tenant_id AND n.supersedes_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM public.records a WHERE a.tenant_id=r.tenant_id AND a.kind='nutrition_catalog_archive'
  AND a.status='active' AND a.data->>'entityId'=r.id::text)
 ORDER BY r.id;
$$;
CREATE FUNCTION member_nutrition_recipe_options() RETURNS SETOF public.nutrition_recipe_options
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT o.* FROM public.nutrition_recipe_options o WHERE o.recipe_id IN (SELECT r.id FROM member_nutrition_recipes() r)
 AND o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid ORDER BY o.recipe_id,o.option_key;
$$;
CREATE FUNCTION member_nutrition_ingredients() RETURNS SETOF public.nutrition_ingredients
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT i.* FROM public.nutrition_ingredients i WHERE i.recipe_id IN (SELECT r.id FROM member_nutrition_recipes() r)
 AND i.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid ORDER BY i.recipe_id,i.option_key,i.position;
$$;
-- Coaching: a follower's own coaching request reads the published Brain
-- material it is answered from by name, never through a listing, and learns
-- only whether a takeover is active. It writes its review items without
-- reading them back (record_subscriber_scope WITH CHECK allows its own rows);
-- a repeated question joins its open personal review here.
CREATE FUNCTION member_material(material text) RETURNS SETOF public.records
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF tid IS NULL OR coalesce(current_setting('app.role',true),'') NOT IN ('owner','staff','finance','subscriber') THEN
  RAISE EXCEPTION 'Workspace material needs a member scope' USING ERRCODE='42501'; END IF;
 IF material IN ('brain_release','coaching_runtime_release') THEN
  RETURN QUERY SELECT r.* FROM public.records r WHERE r.tenant_id=tid AND r.kind=material AND r.status='published'
   ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
 ELSIF material='coaching_action' THEN
  RETURN QUERY SELECT r.* FROM public.records r WHERE r.tenant_id=tid AND r.kind=material AND r.status='confirmed' ORDER BY r.id LIMIT 31;
 ELSIF material='coaching_teaching' THEN
  RETURN QUERY SELECT r.* FROM public.records r WHERE r.tenant_id=tid AND r.kind=material AND r.status='confirmed' ORDER BY r.id LIMIT 101;
 ELSIF material='program_template' THEN
  -- Only templates a confirmed coaching action applies.
  RETURN QUERY SELECT r.* FROM public.records r WHERE r.tenant_id=tid AND r.kind='program' AND r.status='template'
   AND r.id::text IN (SELECT c.data->>'templateId' FROM public.records c WHERE c.tenant_id=tid AND c.kind='coaching_action' AND c.status='confirmed')
   ORDER BY r.id;
 ELSE
  RAISE EXCEPTION 'Unknown workspace material' USING ERRCODE='22023';
 END IF;
END $$;
-- A member's current role in the current, active workspace. The outbox worker
-- (a team-role scope with the system user) rechecks a recipient this way; a
-- follower may ask only about itself.
CREATE FUNCTION workspace_member_role(member uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT m.role FROM public.memberships m JOIN public.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND m.user_id=member
 AND coalesce(to_jsonb(t)->>'lifecycle_state','active')='active'
 AND (current_setting('app.role',true) IN ('owner','staff','finance')
  OR member=nullif(current_setting('app.user_id',true),'')::uuid);
$$;
CREATE FUNCTION member_takeover_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.records r WHERE r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND r.kind='takeover' AND r.status='active'
  AND current_setting('app.role',true) IN ('owner','staff','finance','subscriber'));
$$;
-- Adds one follow-up to the caller's open personal (policy) review and returns
-- its id, or NULL when none is open. Keeps the last `keep` follow-ups and the
-- union of review categories in first-seen order.
CREATE FUNCTION member_policy_review_append(follow_up jsonb, categories jsonb, keep integer) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tid uuid := nullif(current_setting('app.tenant_id',true),'')::uuid;
 caller uuid := nullif(current_setting('app.user_id',true),'')::uuid;
 review record;
 items jsonb;
 merged jsonb;
BEGIN
 IF tid IS NULL OR caller IS NULL OR coalesce(current_setting('app.role',true),'') NOT IN ('owner','staff','finance','subscriber')
  OR jsonb_typeof(follow_up) IS DISTINCT FROM 'object' OR jsonb_typeof(categories) IS DISTINCT FROM 'array'
  OR keep IS NULL OR keep<1 OR keep>100 THEN
  RAISE EXCEPTION 'A personal review follow-up needs the member scope' USING ERRCODE='42501'; END IF;
 SELECT r.id,r.data INTO review FROM public.records r WHERE r.tenant_id=tid AND r.kind='exception' AND r.status='open'
  AND r.owner_user_id=caller AND r.data->>'category'='policy_review' ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 items := CASE WHEN jsonb_typeof(review.data->'followUps')='array' THEN review.data->'followUps' ELSE '[]'::jsonb END
  || jsonb_build_array(follow_up);
 SELECT coalesce(jsonb_agg(e ORDER BY n),'[]'::jsonb) INTO items FROM jsonb_array_elements(items) WITH ORDINALITY t(e,n)
  WHERE n>jsonb_array_length(items)-keep;
 SELECT coalesce(jsonb_agg(c ORDER BY o),'[]'::jsonb) INTO merged FROM (
  SELECT c,min(o) AS o FROM (
   SELECT e AS c,n AS o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(review.data->'screening'->'reviewCategories')='array'
    THEN review.data->'screening'->'reviewCategories' ELSE '[]'::jsonb END) WITH ORDINALITY t(e,n)
   UNION ALL SELECT e,1000000+n FROM jsonb_array_elements(categories) WITH ORDINALITY t(e,n)) u GROUP BY c) v;
 UPDATE public.records SET data=data||jsonb_build_object('followUps',items,
   'questionCount',(CASE WHEN jsonb_typeof(data->'questionCount')='number' AND (data->>'questionCount')::numeric<>0
    THEN (data->>'questionCount')::numeric ELSE 1 END)+1,
   'screening',CASE WHEN jsonb_typeof(data->'screening')='object' THEN data->'screening' ELSE '{}'::jsonb END
    ||jsonb_build_object('reviewCategories',merged)),
  version=version+1,updated_at=now() WHERE id=review.id;
 RETURN review.id;
END $$;
REVOKE ALL ON FUNCTION member_nutrition_foods(),member_nutrition_recipes(),member_nutrition_recipe_options(),
 member_nutrition_ingredients(),member_material(text),member_takeover_active(),workspace_member_role(uuid),
 member_policy_review_append(jsonb,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_nutrition_foods(),member_nutrition_recipes(),member_nutrition_recipe_options(),
 member_nutrition_ingredients(),member_material(text),member_takeover_active(),workspace_member_role(uuid),
 member_policy_review_append(jsonb,jsonb,integer) TO trainer_app;
-- Outbox jobs stay staff-scoped, except a follower's own weekly nutrition job.
ALTER POLICY staff_scope ON jobs USING (current_setting('app.role',true) IN ('owner','staff','finance') OR
 (current_setting('app.role',true)='subscriber' AND kind='nutrition_week' AND data->>'userId'=nullif(current_setting('app.user_id',true),'')));
-- Usage rows: finance and the owner see all; every member sees and finalizes
-- only its own reservations.
ALTER POLICY staff_scope ON cost_events USING (current_setting('app.role',true) IN ('owner','finance') OR
 user_id=nullif(current_setting('app.user_id',true),'')::uuid);
-- A follower never creates a subscription row and changes only the renewal
-- flag of its own (provider callbacks mirror everything else).
CREATE POLICY subscription_member_insert ON subscriptions AS RESTRICTIVE FOR INSERT
 WITH CHECK (current_setting('app.role',true)<>'subscriber');
CREATE FUNCTION subscription_member_update_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user='trainer_app' AND current_setting('app.role',true)='subscriber' AND
  (to_jsonb(NEW)-'cancel_at_period_end') IS DISTINCT FROM (to_jsonb(OLD)-'cancel_at_period_end') THEN
  RAISE EXCEPTION 'A member may change only its own renewal setting' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_member_update BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION subscription_member_update_guard();
-- Shared material is readable, never removable, by a follower: a follower may
-- delete only its own rows (updates are already limited by WITH CHECK).
CREATE POLICY record_subscriber_delete ON records AS RESTRICTIVE FOR DELETE USING (
 current_setting('app.role',true)<>'subscriber' OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid);
-- The tenant role has no use for the migration ledger.
REVOKE ALL ON schema_migrations FROM trainer_app;

-- 4. Service (global) tables that carry a workspace. The tenant role has no
--    grant on any of them; row security now also denies it every row, so an
--    accidental grant exposes nothing. A service transaction bound to one
--    workspace (db.system(fn, { tenantId }) sets app.service_tenant_id) sees
--    and writes only that workspace's rows; unbound service transactions (a
--    session lookup by token hash, a provider object by external id) are an
--    explicit, reviewed choice. Migrations run as the owner and are exempt.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sessions','one_time_tokens','provider_objects','acquisition_consents','acquisition_events',
  'auth_passkey_challenges','complimentary_access_directory','email_change_requests','oidc_sign_in_requests',
  'privacy_erasure_registry','support_preview_grants','tls_issuance_allowances','workspace_lifecycle_requests',
  'workspace_suspensions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY service_workspace_scope ON %I USING (current_user<>''trainer_app'' AND (nullif(current_setting(''app.service_tenant_id'',true),'''') IS NULL OR tenant_id=nullif(current_setting(''app.service_tenant_id'',true),'''')::uuid)) WITH CHECK (current_user<>''trainer_app'' AND (nullif(current_setting(''app.service_tenant_id'',true),'''') IS NULL OR tenant_id=nullif(current_setting(''app.service_tenant_id'',true),'''')::uuid))',t);
 END LOOP;
END $$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY service_workspace_scope ON tenants
 USING (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR id=nullif(current_setting('app.service_tenant_id',true),'')::uuid))
 WITH CHECK (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR id=nullif(current_setting('app.service_tenant_id',true),'')::uuid));
ALTER POLICY membership_scope ON memberships USING (
 (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR
  tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid)) OR
 (current_user='trainer_app' AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
  (current_setting('app.role',true)<>'subscriber' OR user_id=nullif(current_setting('app.user_id',true),'')::uuid))
);
ALTER POLICY domain_mapping_scope ON domain_mappings
 USING ((current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR
  tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid)) OR
  (current_user='trainer_app' AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid))
 WITH CHECK ((current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR
  tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid)) OR
  (current_user='trainer_app' AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND NOT active));

INSERT INTO schema_migrations(version) VALUES('061_tenant_scope_isolation');
