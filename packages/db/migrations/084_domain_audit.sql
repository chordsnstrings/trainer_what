-- Unverified requests are challenges, not global ownership claims.
ALTER TABLE domain_orders ADD COLUMN reservation_expires_at timestamptz;
UPDATE domain_orders SET reservation_expires_at=created_at+interval '7 days'
 WHERE mode='manual' AND (status IN ('requested','quoted') OR
 (status IN ('owned','verified') AND evidence->>'alreadyOwned'='true'));
DROP INDEX domain_order_open_host;
CREATE UNIQUE INDEX domain_order_open_host ON domain_orders(hostname)
 WHERE status NOT IN ('cancelled','expired','failed') AND NOT
 (mode='manual' AND verified_at IS NULL AND (status IN ('requested','quoted') OR
 (status='owned' AND coalesce(evidence->>'alreadyOwned','false')='true')));
CREATE UNIQUE INDEX domain_order_pending_host_per_tenant ON domain_orders(tenant_id,hostname)
 WHERE mode='manual' AND verified_at IS NULL AND (status IN ('requested','quoted') OR
 (status='owned' AND coalesce(evidence->>'alreadyOwned','false')='true'));
CREATE UNIQUE INDEX web_address_health_host ON records(tenant_id,(data->>'hostname')) WHERE kind='web_address_health';
INSERT INTO schema_migrations(version) VALUES('084_domain_audit');
