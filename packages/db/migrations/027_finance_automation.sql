CREATE UNIQUE INDEX one_finance_automation ON records(tenant_id) WHERE kind='finance_automation';
INSERT INTO schema_migrations(version) VALUES('027_finance_automation');
