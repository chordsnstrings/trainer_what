-- JavaScript database drivers represent timestamps at millisecond precision.
-- Keep lease compare-and-set tokens lossless when returned and rebound by workers.
ALTER TABLE jobs ALTER COLUMN leased_until TYPE timestamptz(3);
INSERT INTO schema_migrations(version) VALUES ('041_job_lease_precision');
