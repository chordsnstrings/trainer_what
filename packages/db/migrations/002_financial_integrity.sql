CREATE TABLE provider_objects (provider text NOT NULL, external_id text NOT NULL, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid REFERENCES users(id), kind text NOT NULL, PRIMARY KEY(provider,external_id));
GRANT SELECT,INSERT ON provider_objects TO trainer_app;
ALTER TABLE journals ADD COLUMN created_xid bigint NOT NULL DEFAULT txid_current();
CREATE FUNCTION same_journal_transaction() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original_xid bigint; BEGIN SELECT created_xid INTO original_xid FROM journals WHERE id=NEW.journal_id AND tenant_id=NEW.tenant_id; IF original_xid IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'a committed journal cannot receive additional lines'; END IF; RETURN NEW; END $$;
CREATE TRIGGER sealed_journal BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION same_journal_transaction();
CREATE UNIQUE INDEX event_provider_once ON events(tenant_id,name,(data->>'providerEventId')) WHERE data ? 'providerEventId';
REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM trainer_app;
INSERT INTO schema_migrations(version) VALUES('002_financial_integrity');
