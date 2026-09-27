-- Aggregate provider evidence only: never consumer identifiers or health targeting.
CREATE TABLE affiliate_contracts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 provider text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 enabled boolean NOT NULL DEFAULT false, terms_reference text NOT NULL,
 disclosure text NOT NULL, trainer_share_bps integer NOT NULL CHECK(trainer_share_bps BETWEEN 0 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,provider), UNIQUE(tenant_id,id)
);
CREATE TABLE affiliate_receipts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 contract_id uuid NOT NULL, request_id uuid NOT NULL, fingerprint text NOT NULL,
 provider_reference text NOT NULL, period text NOT NULL CHECK(period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 amount_minor bigint NOT NULL CHECK(amount_minor<>0 AND abs(amount_minor)<=1000000000),
 trainer_minor bigint NOT NULL, contract_snapshot jsonb NOT NULL,
 evidence_reference text NOT NULL, reversal_of uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES affiliate_contracts(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_id), UNIQUE(tenant_id,contract_id,provider_reference),
 UNIQUE(tenant_id,reversal_of),
 FOREIGN KEY(tenant_id,reversal_of) REFERENCES affiliate_receipts(tenant_id,id),
 CHECK((reversal_of IS NULL AND amount_minor>0 AND trainer_minor BETWEEN 0 AND amount_minor) OR
       (reversal_of IS NOT NULL AND amount_minor<0 AND trainer_minor BETWEEN amount_minor AND 0))
);
CREATE TABLE affiliate_statements (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL,
 period text NOT NULL, amount_minor bigint NOT NULL, trainer_minor bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,contract_id,period),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES affiliate_contracts(tenant_id,id)
);
CREATE TABLE affiliate_statement_receipts (
 tenant_id uuid NOT NULL, statement_id uuid NOT NULL, receipt_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,receipt_id),
 FOREIGN KEY(tenant_id,statement_id) REFERENCES affiliate_statements(tenant_id,id),
 FOREIGN KEY(tenant_id,receipt_id) REFERENCES affiliate_receipts(tenant_id,id)
);
CREATE TABLE affiliate_settlements (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, statement_id uuid NOT NULL,
 bank_reference text NOT NULL, evidence_reference text NOT NULL, journal_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,statement_id), UNIQUE(tenant_id,bank_reference),
 FOREIGN KEY(tenant_id,statement_id) REFERENCES affiliate_statements(tenant_id,id),
 FOREIGN KEY(journal_id) REFERENCES journals(id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['affiliate_contracts','affiliate_receipts','affiliate_statements','affiliate_statement_receipts','affiliate_settlements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY affiliate_scope ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true) IN (''owner'',''finance'')) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true)=''finance'')',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO trainer_app',t);
  IF t<>'affiliate_contracts' THEN
   EXECUTE format('CREATE TRIGGER affiliate_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_record()',t);
  END IF;
 END LOOP;
END $$;
GRANT UPDATE ON affiliate_contracts TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('039_affiliates');
