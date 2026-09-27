-- Host operations for the single-server deployment. The host controller writes
-- through the migration administrator (docker compose exec psql); the API reads
-- and writes through the runtime role. No cloud credentials, no personal data
-- and no arbitrary commands are stored here: only allowlisted action names.

-- Latest status per reporter. Controller reports are HMAC-signed with a key
-- derived from INTERNAL_PROXY_SECRET; the API verifies them before display.
CREATE TABLE host_status (
 source text PRIMARY KEY CHECK(source IN ('controller','api')),
 payload text NOT NULL CHECK(octet_length(payload) BETWEEN 2 AND 262144),
 signature text CHECK(signature IS NULL OR signature ~ '^[a-f0-9]{64}$'),
 reported_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source<>'controller' OR signature IS NOT NULL)
);

-- Revisioned, immutable monitoring thresholds for host metrics and backups.
CREATE TABLE host_monitor_policies (
 revision integer PRIMARY KEY CHECK(revision>0),
 thresholds jsonb NOT NULL CHECK(jsonb_typeof(thresholds)='object'),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 500),
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO host_monitor_policies(revision,thresholds,reason) VALUES(1,
 '{"reportFreshnessSeconds":900,"diskWarnPercent":80,"diskCriticalPercent":90,"memoryAvailableWarnPercent":15,"memoryAvailableCriticalPercent":7,"loadPerCpuWarn":1.5,"loadPerCpuCritical":3,"backupWarnAgeHours":26,"backupCriticalAgeHours":50}',
 'Initial defaults');
CREATE TRIGGER host_monitor_policy_immutable BEFORE UPDATE OR DELETE ON host_monitor_policies FOR EACH ROW EXECUTE FUNCTION immutable_record();

-- Super admin requests for allowlisted host actions. The intent is signed by the
-- API and verified by the controller before execution; the controller signs the
-- result it reports back. Intent columns never change after insertion.
CREATE TABLE host_action_requests (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 action text NOT NULL CHECK(action IN ('restart_service','rollback_release','restore_release','reapply_release','pause_deploys','resume_deploys','backup_now','verify_backup')),
 target text CHECK(target IS NULL OR target IN ('api','web','worker')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 500),
 requested_by uuid NOT NULL REFERENCES users(id),
 issued_at_ms bigint NOT NULL CHECK(issued_at_ms>0),
 expires_at_ms bigint NOT NULL,
 signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','rejected','expired','canceled')),
 result text CHECK(result IS NULL OR octet_length(result)<=16384),
 result_signature text CHECK(result_signature IS NULL OR result_signature ~ '^[a-f0-9]{64}$'),
 picked_up_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((action='restart_service')=(target IS NOT NULL)),
 CHECK(expires_at_ms>issued_at_ms AND expires_at_ms<=issued_at_ms+3600000)
);
-- One open request per action and target at a time.
CREATE UNIQUE INDEX host_action_open ON host_action_requests(action,coalesce(target,'-')) WHERE status IN ('pending','running');
CREATE INDEX host_action_recent ON host_action_requests(created_at DESC);
CREATE FUNCTION protect_host_action_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Host action requests are retained'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','result','result_signature','picked_up_at','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','result','result_signature','picked_up_at','finished_at']) THEN
  RAISE EXCEPTION 'Host action intent is immutable';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT ((OLD.status='pending' AND NEW.status IN ('running','rejected','expired','canceled')) OR
          (OLD.status='running' AND NEW.status IN ('succeeded','failed'))) THEN
   RAISE EXCEPTION 'Invalid host action transition';
  END IF;
 ELSIF OLD.status NOT IN ('pending','running') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  RAISE EXCEPTION 'A finished host action is sealed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER host_action_request_sealed BEFORE UPDATE OR DELETE ON host_action_requests FOR EACH ROW EXECUTE FUNCTION protect_host_action_request();

-- Coach-domain activation checks HTTPS before the mapping becomes active. An
-- operator's activation attempt creates this short-lived allowance so the edge
-- may obtain that one certificate; active mappings need no allowance.
CREATE TABLE tls_issuance_allowances (
 hostname text PRIMARY KEY CHECK(hostname=lower(hostname) AND char_length(hostname) BETWEEN 3 AND 253),
 tenant_id uuid NOT NULL REFERENCES tenants(id), domain_order_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);

REVOKE ALL ON host_status,host_monitor_policies,host_action_requests,tls_issuance_allowances FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON host_status,host_action_requests,tls_issuance_allowances TO trainer_service;
 GRANT SELECT,INSERT ON host_monitor_policies TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('058_host_operations');
