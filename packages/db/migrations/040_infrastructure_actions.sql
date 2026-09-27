-- No cloud credentials or arbitrary commands. The initial resource is the local worker dispatcher.
CREATE TABLE infrastructure_execution_policies (
 revision integer PRIMARY KEY CHECK(revision>0), enabled boolean NOT NULL DEFAULT false,
 actions_per_hour integer NOT NULL CHECK(actions_per_hour BETWEEN 1 AND 20),
 monthly_cost_cap_minor bigint NOT NULL CHECK(monthly_cost_cap_minor BETWEEN 0 AND 1000000000),
 reason text NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO infrastructure_execution_policies(revision,enabled,actions_per_hour,monthly_cost_cap_minor,reason) VALUES(1,false,4,0,'Initially disabled; reviewed operator approval required');
CREATE TRIGGER infrastructure_execution_policy_immutable BEFORE UPDATE OR DELETE ON infrastructure_execution_policies FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE infrastructure_worker_control (
 resource_id text PRIMARY KEY CHECK(resource_id='worker:primary'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), paused boolean NOT NULL DEFAULT false,
 interval_ms integer NOT NULL DEFAULT 5000 CHECK(interval_ms BETWEEN 1000 AND 60000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO infrastructure_worker_control(resource_id) VALUES('worker:primary');
CREATE TABLE infrastructure_actions (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE, fingerprint text NOT NULL,
 resource_id text NOT NULL REFERENCES infrastructure_worker_control(resource_id),
 action text NOT NULL CHECK(action='set_worker_dispatch'),
 policy_revision integer NOT NULL REFERENCES infrastructure_execution_policies(revision),
 expected_revision integer NOT NULL, estimated_monthly_cost_minor bigint NOT NULL CHECK(estimated_monthly_cost_minor=0),
 before_state jsonb NOT NULL, desired_state jsonb NOT NULL,
 reason text NOT NULL, proposed_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id),
 approved_at timestamptz, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','succeeded','rolled_back','canceled')),
 result_revision integer, executed_at timestamptz, rolled_back_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);
CREATE FUNCTION protect_infrastructure_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['approved_by','approved_at','status','result_revision','executed_at','rolled_back_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['approved_by','approved_at','status','result_revision','executed_at','rolled_back_at']) THEN
  RAISE EXCEPTION 'Infrastructure intent is immutable';
 END IF;
 IF NOT ((OLD.status='proposed' AND NEW.status IN ('approved','canceled')) OR
         (OLD.status='approved' AND NEW.status IN ('succeeded','canceled')) OR
         (OLD.status='succeeded' AND NEW.status='rolled_back')) THEN
  RAISE EXCEPTION 'Invalid infrastructure action transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER infrastructure_action_sealed BEFORE UPDATE ON infrastructure_actions FOR EACH ROW EXECUTE FUNCTION protect_infrastructure_action();
REVOKE ALL ON infrastructure_execution_policies,infrastructure_worker_control,infrastructure_actions FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT ON infrastructure_execution_policies TO trainer_service;
 GRANT SELECT,UPDATE ON infrastructure_worker_control TO trainer_service;
 GRANT SELECT,INSERT,UPDATE ON infrastructure_actions TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('040_infrastructure_actions');
