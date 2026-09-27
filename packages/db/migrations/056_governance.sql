-- Super admin governance: workspace suspension, account locks and operator alerts.

-- A suspended workspace is neither active nor closed. Every existing
-- lifecycle_state='active' check (public pages, joins, invitations, checkout,
-- scoped helper functions, worker schedulers) therefore treats it as offline.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%lifecycle_state%' LOOP
  EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_state_check CHECK(lifecycle_state IN ('active','suspended','closed'));

CREATE TABLE workspace_suspensions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','lifted')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 notice text NOT NULL DEFAULT '' CHECK(length(notice)<=500),
 suspended_by uuid NOT NULL REFERENCES users(id), suspended_at timestamptz NOT NULL DEFAULT now(),
 held_payouts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(held_payouts)='array'),
 finance_followup_id uuid,
 lifted_by uuid REFERENCES users(id), lifted_at timestamptz,
 lift_reason text CHECK(lift_reason IS NULL OR length(lift_reason) BETWEEN 10 AND 1000),
 released_payouts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(released_payouts)='array'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK((status='active' AND lifted_at IS NULL AND lifted_by IS NULL AND lift_reason IS NULL)
  OR (status='lifted' AND lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND lift_reason IS NOT NULL))
);
CREATE UNIQUE INDEX workspace_suspension_active ON workspace_suspensions(tenant_id) WHERE status='active';
CREATE INDEX workspace_suspension_history ON workspace_suspensions(tenant_id,suspended_at DESC);

CREATE TABLE account_locks (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','lifted')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 locked_by uuid NOT NULL REFERENCES users(id), locked_at timestamptz NOT NULL DEFAULT now(),
 sessions_revoked integer NOT NULL DEFAULT 0 CHECK(sessions_revoked>=0),
 lifted_by uuid REFERENCES users(id), lifted_at timestamptz,
 lift_reason text CHECK(lift_reason IS NULL OR length(lift_reason) BETWEEN 10 AND 1000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK(user_id<>locked_by),
 CHECK((status='active' AND lifted_at IS NULL AND lifted_by IS NULL AND lift_reason IS NULL)
  OR (status='lifted' AND lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND lift_reason IS NOT NULL))
);
CREATE UNIQUE INDEX account_lock_active ON account_locks(user_id) WHERE status='active';
CREATE INDEX account_lock_history ON account_locks(user_id,locked_at DESC);

-- Governance history is retained: a record can only move from active to lifted.
CREATE FUNCTION governance_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'governance history is retained'; END IF;
 IF OLD.status<>'active' OR NEW.status<>'lifted' OR NEW.revision<>OLD.revision+1
  OR (to_jsonb(NEW)-ARRAY['status','lifted_by','lifted_at','lift_reason','released_payouts','revision'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','lifted_by','lifted_at','lift_reason','released_payouts','revision']) THEN
  RAISE EXCEPTION 'only an active governance record can be lifted; its other fields are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workspace_suspensions_guarded BEFORE UPDATE OR DELETE ON workspace_suspensions FOR EACH ROW EXECUTE FUNCTION governance_history_guard();
CREATE TRIGGER account_locks_guarded BEFORE UPDATE OR DELETE ON account_locks FOR EACH ROW EXECUTE FUNCTION governance_history_guard();

-- Backstop for every sign-in path, including future ones: a locked account
-- cannot receive a session. The application checks first for a clear message.
CREATE FUNCTION session_account_unlocked() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.account_locks l WHERE l.user_id=NEW.user_id AND l.status='active') THEN
  RAISE EXCEPTION 'This account is locked' USING ERRCODE='TBLCK';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sessions_account_unlocked BEFORE INSERT OR UPDATE OF user_id ON sessions FOR EACH ROW EXECUTE FUNCTION session_account_unlocked();

-- Operator alerts are platform records, never tenant data. A dedupe key has at
-- most one unresolved alert; the fingerprint identifies the observed condition.
CREATE TABLE platform_alerts (
 id uuid PRIMARY KEY,
 rule text NOT NULL CHECK(rule ~ '^[a-z][a-z0-9_.-]{1,63}$'),
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 3 AND 300),
 fingerprint text NOT NULL CHECK(length(fingerprint) BETWEEN 1 AND 128),
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 scope text[] NOT NULL CHECK(cardinality(scope)>0 AND scope <@ ARRAY['admin','finance','support','safety']::text[]),
 tenant_id uuid REFERENCES tenants(id),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
 detail text NOT NULL CHECK(length(detail) BETWEEN 1 AND 2000),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
 occurrences integer NOT NULL DEFAULT 1 CHECK(occurrences>0),
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 acknowledged_by uuid REFERENCES users(id), acknowledged_at timestamptz,
 acknowledgement_note text CHECK(acknowledgement_note IS NULL OR length(acknowledgement_note)<=1000),
 resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
 resolution text CHECK(resolution IN ('condition_cleared','operator')),
 resolution_note text CHECK(resolution_note IS NULL OR length(resolution_note)<=1000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='resolved')=(resolved_at IS NOT NULL AND resolution IS NOT NULL)),
 CHECK(status<>'acknowledged' OR acknowledged_at IS NOT NULL)
);
CREATE UNIQUE INDEX platform_alert_active ON platform_alerts(dedupe_key) WHERE status<>'resolved';
CREATE INDEX platform_alert_inbox ON platform_alerts(status,last_seen_at DESC);
CREATE INDEX platform_alert_history ON platform_alerts(dedupe_key,resolved_at DESC);
CREATE TABLE platform_alert_deliveries (
 id uuid PRIMARY KEY, alert_id uuid NOT NULL REFERENCES platform_alerts(id),
 user_id uuid NOT NULL REFERENCES users(id), tenant_id uuid REFERENCES tenants(id),
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 status text NOT NULL CHECK(status IN ('delivered','no_workspace')),
 notification_id uuid, channels text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(alert_id,user_id,severity)
);
CREATE TRIGGER platform_alert_deliveries_immutable BEFORE UPDATE OR DELETE ON platform_alert_deliveries FOR EACH ROW EXECUTE FUNCTION immutable_record();

-- Tenant-scoped code may ask only whether its own workspace is active. It
-- cannot read tenant settings or any other workspace.
CREATE FUNCTION current_workspace_state() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT t.lifecycle_state FROM public.tenants t WHERE t.id=nullif(current_setting('app.tenant_id',true),'')::uuid
$$;
REVOKE ALL ON FUNCTION current_workspace_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_workspace_state() TO trainer_app;

REVOKE ALL ON workspace_suspensions,account_locks,platform_alerts,platform_alert_deliveries FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON workspace_suspensions,account_locks,platform_alerts TO trainer_service;
 GRANT SELECT,INSERT ON platform_alert_deliveries TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('056_governance');
