CREATE TABLE usage_statements (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), period text NOT NULL,
 total_cost_usd numeric(18,8) NOT NULL, fx_aed_per_usd numeric(18,8) NOT NULL CHECK(fx_aed_per_usd>0),
 charge_minor bigint NOT NULL CHECK(charge_minor>=0), cost_event_count integer NOT NULL CHECK(cost_event_count>0),
 fee_schedule_version text NOT NULL, evidence_reference text NOT NULL, journal_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,period),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES journals(tenant_id,id)
);
ALTER TABLE usage_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_statement_scope ON usage_statements USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true) IN ('owner','finance')
);
GRANT SELECT,INSERT ON usage_statements TO trainer_app;
CREATE TRIGGER usage_statement_immutable BEFORE UPDATE OR DELETE ON usage_statements FOR EACH ROW EXECUTE FUNCTION immutable_record();
INSERT INTO schema_migrations(version) VALUES('007_usage_statements');
