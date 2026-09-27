-- Operational aggregates only. No provider credentials, personal payloads or
-- infrastructure execution authority belong to this observe-only subsystem.
CREATE TABLE infrastructure_policies (
 revision integer PRIMARY KEY CHECK(revision>0),
 mode text NOT NULL DEFAULT 'observe_only' CHECK(mode='observe_only'),
 thresholds jsonb NOT NULL CHECK(jsonb_typeof(thresholds)='object'),
 reason_code text NOT NULL CHECK(reason_code IN ('initial_defaults','capacity_review','incident_review','baseline_tuning','release_review')),
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO infrastructure_policies(revision,thresholds,reason_code) VALUES(1,
 '{"freshnessSeconds":180,"minimumRequests":20,"apiP95Ms":1500,"apiErrorPercent":5,"processRssMb":512,"processCpuPercent":150,"databaseProbeMs":500,"databaseConnectionPercent":80,"queueReadyCount":100,"queueOldestReadySeconds":300,"queueFailedCount":0,"workerFailedCycles":0}',
 'initial_defaults');
CREATE TRIGGER infrastructure_policy_immutable BEFORE UPDATE OR DELETE ON infrastructure_policies FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE infrastructure_observations (
 id uuid PRIMARY KEY, service text NOT NULL CHECK(service IN ('api','worker')),
 collector_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
 window_started_at timestamptz NOT NULL, window_ended_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(), measurements jsonb NOT NULL CHECK(jsonb_typeof(measurements)='object'),
 content_hash text NOT NULL,
 UNIQUE(collector_id,sequence),
 CHECK(window_started_at<=window_ended_at),
 CHECK(window_ended_at<=recorded_at+interval '30 seconds')
);
CREATE INDEX infrastructure_latest_observation ON infrastructure_observations(service,window_ended_at DESC,recorded_at DESC);
CREATE TRIGGER infrastructure_observation_immutable BEFORE UPDATE OR DELETE ON infrastructure_observations FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE infrastructure_recommendations (
 id uuid PRIMARY KEY, service text NOT NULL CHECK(service IN ('api','worker')),
 rule text NOT NULL CHECK(rule IN ('stale','api_p95_ms','api_error_percent','process_rss_mb','process_cpu_percent','database_probe_ms','database_connection_percent','queue_ready_count','queue_oldest_ready_seconds','queue_failed_count','worker_failed_cycles')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 first_observation_id uuid NOT NULL REFERENCES infrastructure_observations(id),
 latest_observation_id uuid NOT NULL REFERENCES infrastructure_observations(id),
 recovery_observation_id uuid REFERENCES infrastructure_observations(id),
 policy_revision integer NOT NULL REFERENCES infrastructure_policies(revision),
 measured_value double precision NOT NULL, threshold_value double precision NOT NULL,
 acknowledged_at timestamptz, resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX infrastructure_active_recommendation ON infrastructure_recommendations(service,rule) WHERE status<>'resolved';
REVOKE ALL ON infrastructure_policies,infrastructure_observations,infrastructure_recommendations FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON infrastructure_policies,infrastructure_observations TO trainer_service;
 GRANT SELECT,INSERT,UPDATE ON infrastructure_recommendations TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('033_infrastructure_observer');
