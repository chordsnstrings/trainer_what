-- DNS hosting and forwarding for bought trainer domains
-- (docs/features/web-addresses.md, "DNS hosting" and "Forwarding").
-- Additive only, like 066: the previous release keeps serving between migrate
-- and restart. It never writes the new statuses; an order it finds in one of
-- them is paused by its default branch and re-queued by the new worker.

-- 1. Orders remember which DNS host serves their domain (chosen when the
-- domain is registered) and whether the domain shows the site or forwards to
-- the workspace subdomain. Two new automatic statuses: 'zone' (the DNS host
-- holds the zone and its records, read back through its API) and
-- 'delegating' (the registrar was asked to delegate the domain to the DNS
-- host's nameservers; waiting until public DNS shows it).
ALTER TABLE domain_orders
 ADD COLUMN dns_provider text CHECK(dns_provider IS NULL OR dns_provider IN ('registrar','digitalocean')),
 ADD COLUMN serve_mode text NOT NULL DEFAULT 'site' CHECK(serve_mode IN ('site','forward'));
ALTER TABLE domain_orders DROP CONSTRAINT domain_orders_status_check;
ALTER TABLE domain_orders ADD CONSTRAINT domain_orders_status_check CHECK(
 (mode='manual' AND status IN ('requested','quoted','approved','owned','verified','active','expired','cancelled')) OR
 (mode='automatic' AND status IN ('checkout','paid','purchasing','owned','zone','delegating','dns','active','expired','cancelled','failed')));
-- 101domain joins Namecheap and the generic registrar API.
ALTER TABLE domain_orders DROP CONSTRAINT domain_orders_registrar_check;
ALTER TABLE domain_orders ADD CONSTRAINT domain_orders_registrar_check
 CHECK(registrar IS NULL OR registrar IN ('namecheap','generic','101domain'));

-- The reviewed state graph, widened for the DNS host steps. A domain moves
-- back to 'owned' when its DNS is set up again (a late renewal, an operator's
-- re-run, a fallback to the registrar's DNS).
CREATE OR REPLACE FUNCTION domain_order_automatic_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.mode='automatic' THEN RAISE EXCEPTION 'automatic domain orders are kept for their payment history'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.mode<>NEW.mode THEN RAISE EXCEPTION 'domain order mode cannot change'; END IF;
 IF NEW.mode<>'automatic' THEN RETURN NEW; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.hostname<>OLD.hostname OR NEW.registrar IS DISTINCT FROM OLD.registrar
    OR NEW.quote IS DISTINCT FROM OLD.quote OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'automatic domain order identity and quote are immutable';
 END IF;
 IF (OLD.checkout_session_id IS NOT NULL AND NEW.checkout_session_id IS DISTINCT FROM OLD.checkout_session_id)
    OR (OLD.stripe_subscription_id IS NOT NULL AND NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id)
    OR (OLD.stripe_customer_id IS NOT NULL AND NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id)
    OR (OLD.first_invoice_id IS NOT NULL AND NEW.first_invoice_id IS DISTINCT FROM OLD.first_invoice_id) THEN
  RAISE EXCEPTION 'automatic domain order billing links are immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT (
    (OLD.status='checkout' AND NEW.status IN ('paid','cancelled','failed')) OR
    (OLD.status='paid' AND NEW.status IN ('purchasing','failed')) OR
    (OLD.status='purchasing' AND NEW.status IN ('owned','failed')) OR
    (OLD.status='owned' AND NEW.status IN ('zone','dns','expired')) OR
    (OLD.status='zone' AND NEW.status IN ('delegating','owned','expired')) OR
    (OLD.status='delegating' AND NEW.status IN ('dns','zone','owned','expired')) OR
    (OLD.status='dns' AND NEW.status IN ('owned','active','expired')) OR
    (OLD.status='active' AND NEW.status IN ('expired','dns','owned')) OR
    -- A renewal paid late, inside the registrar's grace period, provisions
    -- again (the registrar may have parked the name or reset its nameservers).
    (OLD.status='expired' AND NEW.status IN ('owned','dns'))) THEN
  RAISE EXCEPTION 'automatic domain order cannot move from % to %', OLD.status, NEW.status;
 END IF;
 RETURN NEW;
END $$;

-- 2. Every call to the DNS host (zone, records, release) and every nameserver
-- change at the registrar is recorded before it is sent, like registrations.
-- These calls converge to a stated result, so a later attempt reads the
-- result back instead of waiting on the earlier one: only registrations and
-- renewals keep the reconcile-before-retry block of 066.
ALTER TABLE registrar_operations DROP CONSTRAINT registrar_operations_kind_check;
ALTER TABLE registrar_operations ADD CONSTRAINT registrar_operations_kind_check
 CHECK(kind IN ('register','renew','set_hosts','create_zone','set_records','set_nameservers','delete_zone'));
ALTER TABLE registrar_operations DROP CONSTRAINT registrar_operations_registrar_check;
ALTER TABLE registrar_operations ADD CONSTRAINT registrar_operations_registrar_check
 CHECK(registrar IN ('namecheap','generic','101domain','digitalocean'));

-- 3. Forwarding. Host routing reads how a mapped name is served: NULL shows
-- the site, 'apex' redirects www.<domain> to the domain, 'subdomain'
-- redirects to the workspace's current <slug>.<root>. Tenant actors keep
-- only SELECT and UPDATE(active) (046): they cannot set this column; the
-- owner's choice is applied by the service through the web address routes.
ALTER TABLE domain_mappings
 ADD COLUMN redirect text CHECK(redirect IS NULL OR redirect IN ('apex','subdomain'));
-- www.<domain> of a bought domain always goes to the domain, including for
-- domains that went live before this release.
UPDATE domain_mappings m SET redirect='apex'
 FROM domain_orders o
 WHERE o.mode='automatic' AND m.hostname='www.'||o.hostname AND m.tenant_id=o.tenant_id
 AND m.redirect IS NULL;

-- 4. A lapsed domain's zone is released (or its records cleared) only while
-- no other open order, in any workspace, uses the same name (a re-bought
-- name adopts the existing zone). Orders are workspace-scoped, so the worker
-- asks through this narrow helper: only the worker, only for its own order,
-- and only the newer order's zoneWrittenAt (no row: no other open order).
CREATE FUNCTION domain_name_other_order(p_order uuid) RETURNS TABLE(zone_written_at text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(o.evidence->>'zoneWrittenAt','') FROM public.domain_orders mine
 JOIN public.domain_orders o ON o.hostname=mine.hostname AND o.id<>mine.id
 WHERE mine.id=p_order
 AND mine.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND current_setting('app.elevation',true)='worker'
 AND current_setting('app.role',true)='owner'
 AND o.mode='automatic' AND o.status NOT IN ('cancelled','failed','expired')
 ORDER BY o.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION domain_name_other_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION domain_name_other_order(uuid) TO trainer_app;

INSERT INTO schema_migrations(version) VALUES('070_dns_hosting');
