CREATE UNIQUE INDEX one_published_brain ON records(tenant_id) WHERE kind='brain_release' AND status='published';
CREATE UNIQUE INDEX one_refund_request ON records(tenant_id,(data->>'chargeId')) WHERE kind='refund';
CREATE UNIQUE INDEX one_close_per_period ON records(tenant_id,(data->>'period')) WHERE kind='close';
CREATE TABLE booking_slots (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), trainer_id uuid NOT NULL REFERENCES users(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 50),
 title text NOT NULL, location text NOT NULL, status text NOT NULL DEFAULT 'open',
 CHECK(ends_at>starts_at), UNIQUE(tenant_id,id)
);
CREATE TABLE bookings (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, slot_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'confirmed', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,slot_id) REFERENCES booking_slots(tenant_id,id), UNIQUE(slot_id,user_id)
);
ALTER TABLE booking_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY slot_scope ON booking_slots USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true) IN ('owner','staff'));
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY booking_scope ON bookings USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY booking_person ON bookings AS RESTRICTIVE USING(current_setting('app.role',true)<>'subscriber' OR user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON booking_slots,bookings TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('004_operations');
