-- Separation of duties for bank payouts: the preparer is recorded on the
-- instruction when it is inserted. Existing rows keep NULL; execution falls back
-- to the immutable payout.prepared event and fails closed when neither exists.
-- No existing payout row is updated here.
ALTER TABLE payouts ADD COLUMN prepared_by uuid REFERENCES users(id);
INSERT INTO schema_migrations(version) VALUES('049_payout_separation');
