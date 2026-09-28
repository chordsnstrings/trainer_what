-- Web addresses (docs/features/web-addresses.md): automatic subdomains with a
-- redirect after a slug change, and autonomous yearly domain registration.
-- The previous release keeps serving between migrate and restart: every change
-- here only adds columns with defaults, widens a status list and adds tables,
-- so its manual domain flow keeps working unchanged.

-- 1. Automatic domain orders are rows of domain_orders with mode='automatic'.
ALTER TABLE domain_orders
 ADD COLUMN mode text NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','automatic')),
 ADD COLUMN registrar text CHECK(registrar IS NULL OR registrar IN ('namecheap','generic')),
 ADD COLUMN checkout_session_id text,
 ADD COLUMN stripe_subscription_id text,
 ADD COLUMN stripe_customer_id text,
 ADD COLUMN first_invoice_id text,
 ADD COLUMN billing_status text CHECK(billing_status IS NULL OR char_length(billing_status)<=40),
 ADD COLUMN billing_aligned_at timestamptz,
 ADD COLUMN renewal_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN renewal_status text CHECK(renewal_status IS NULL OR renewal_status IN ('paid','renewing','renewed','failed')),
 ADD COLUMN renewal_invoice_id text,
 ADD COLUMN attention text CHECK(attention IS NULL OR char_length(attention) BETWEEN 3 AND 500),
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN lease_until timestamptz,
 -- The run holding the lease; only that run releases it.
 ADD COLUMN lease_token uuid,
 ADD COLUMN progress jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(progress)='array'),
 ADD COLUMN notices jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(notices)='object'),
 ADD COLUMN live_at timestamptz;
ALTER TABLE domain_orders DROP CONSTRAINT IF EXISTS domain_orders_status_check;
ALTER TABLE domain_orders ADD CONSTRAINT domain_orders_status_check CHECK(
 (mode='manual' AND status IN ('requested','quoted','approved','owned','verified','active','expired','cancelled')) OR
 (mode='automatic' AND status IN ('checkout','paid','purchasing','owned','dns','active','expired','cancelled','failed')));
ALTER TABLE domain_orders ADD CONSTRAINT domain_orders_automatic_shape CHECK(
 mode='manual' OR (registrar IS NOT NULL AND quote IS NOT NULL));
CREATE UNIQUE INDEX domain_order_checkout ON domain_orders(checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX domain_order_subscription ON domain_orders(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX domain_order_due ON domain_orders(next_attempt_at) WHERE mode='automatic' AND next_attempt_at IS NOT NULL;
-- A failed automatic purchase frees the name for another attempt.
DROP INDEX domain_order_open_host;
CREATE UNIQUE INDEX domain_order_open_host ON domain_orders(hostname) WHERE status NOT IN ('cancelled','expired','failed');

-- Automatic orders move only along the reviewed state graph; their identity,
-- quote and billing links never change once set, and they are never deleted
-- (payments and registrar costs refer to them).
CREATE FUNCTION domain_order_automatic_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    (OLD.status='owned' AND NEW.status IN ('dns','expired')) OR
    (OLD.status='dns' AND NEW.status IN ('owned','active','expired')) OR
    (OLD.status='active' AND NEW.status IN ('expired','dns')) OR
    -- A renewal paid late, inside the registrar's grace period, provisions
    -- again from the DNS records (the registrar may have parked the name).
    (OLD.status='expired' AND NEW.status IN ('owned','dns'))) THEN
  RAISE EXCEPTION 'automatic domain order cannot move from % to %', OLD.status, NEW.status;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER domain_order_automatic_guard BEFORE UPDATE OR DELETE ON domain_orders
 FOR EACH ROW EXECUTE FUNCTION domain_order_automatic_guard();

-- 2. Registrar calls. Each purchase, renewal or DNS write is recorded before
-- the request is sent, under a stable intent key. Namecheap has no idempotency
-- key, so a purchase or renewal whose outcome is not a confirmed success
-- (sent, failed or unknown) must be reconciled with the registrar before the
-- same order may start another attempt of that kind.
CREATE TABLE registrar_operations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 order_id uuid NOT NULL REFERENCES domain_orders(id),
 kind text NOT NULL CHECK(kind IN ('register','renew','set_hosts')),
 intent_key text NOT NULL UNIQUE CHECK(char_length(intent_key) BETWEEN 8 AND 200),
 registrar text NOT NULL CHECK(registrar IN ('namecheap','generic')),
 hostname text NOT NULL CHECK(char_length(hostname) BETWEEN 4 AND 253),
 request jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(request)='object'),
 status text NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','succeeded','failed','unknown','confirmed','absent')),
 outcome jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(outcome)='object'),
 cost_usd numeric(12,4) CHECK(cost_usd IS NULL OR cost_usd>=0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 CHECK((status IN ('sent','unknown','failed')) OR finished_at IS NOT NULL)
);
CREATE INDEX registrar_operation_order ON registrar_operations(tenant_id,order_id,created_at);
CREATE FUNCTION registrar_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'registrar operations are immutable evidence'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'sent' THEN RAISE EXCEPTION 'a registrar operation starts as sent'; END IF;
  IF NEW.kind IN ('register','renew') AND EXISTS(
     SELECT 1 FROM registrar_operations o WHERE o.order_id=NEW.order_id AND o.kind=NEW.kind
     AND o.status IN ('sent','failed','unknown')) THEN
   RAISE EXCEPTION 'reconcile the earlier registrar % attempt before another', NEW.kind
    USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.order_id<>OLD.order_id OR NEW.kind<>OLD.kind
    OR NEW.intent_key<>OLD.intent_key OR NEW.registrar<>OLD.registrar OR NEW.hostname<>OLD.hostname
    OR NEW.request<>OLD.request OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'registrar operation intent is immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT (
    (OLD.status='sent' AND NEW.status IN ('succeeded','failed','unknown','confirmed','absent')) OR
    (OLD.status IN ('failed','unknown') AND NEW.status IN ('confirmed','absent'))) THEN
  RAISE EXCEPTION 'registrar operation cannot move from % to %', OLD.status, NEW.status;
 END IF;
 IF NEW.status=OLD.status AND OLD.status IN ('succeeded','confirmed','absent') THEN
  RAISE EXCEPTION 'a finished registrar operation is sealed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registrar_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON registrar_operations
 FOR EACH ROW EXECUTE FUNCTION registrar_operation_guard();
ALTER TABLE registrar_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrar_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON registrar_operations
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY registrar_operation_owner ON registrar_operations AS RESTRICTIVE
 USING(current_setting('app.role',true)='owner') WITH CHECK(current_setting('app.role',true)='owner');
REVOKE ALL ON registrar_operations FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON registrar_operations TO trainer_app;

-- 3. A renamed workspace keeps its previous slug for a while: the old
-- subdomain and /coach/<old> redirect to the new name and nobody else may
-- take it. Service-only (like tenants); bound service transactions see one
-- workspace.
CREATE TABLE tenant_slug_redirects (
 slug text PRIMARY KEY CHECK(slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 redirect_until timestamptz NOT NULL,
 changed_by uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_slug_redirect_tenant ON tenant_slug_redirects(tenant_id,created_at);
ALTER TABLE tenant_slug_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_slug_redirects FORCE ROW LEVEL SECURITY;
CREATE POLICY service_workspace_scope ON tenant_slug_redirects
 USING (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid))
 WITH CHECK (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid));
REVOKE ALL ON tenant_slug_redirects FROM PUBLIC;
REVOKE ALL ON tenant_slug_redirects FROM trainer_app;

INSERT INTO schema_migrations(version) VALUES('066_web_addresses');
