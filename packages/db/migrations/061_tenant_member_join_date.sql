-- Trainer analytics cohorts and the Superadmin subscriber list order and group
-- members by account creation time, but the tenant role could read only
-- users(id,name,email): both queries failed with "permission denied for table
-- users" for the restricted runtime role (found by the end-to-end harness).
-- Grant only that column; password, verification and platform role stay hidden.
GRANT SELECT(created_at) ON users TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('061_tenant_member_join_date');
