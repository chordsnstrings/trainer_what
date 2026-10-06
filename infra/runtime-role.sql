-- Run as migration administrator after migrations. Substitute the password
-- through the database administration secret flow, never commit it here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
    CREATE ROLE trainer_service LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
ALTER ROLE trainer_service LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE trainer TO trainer_service;
GRANT USAGE ON SCHEMA public TO trainer_service;
GRANT trainer_app TO trainer_service;
GRANT SELECT ON schema_migrations TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON users,tenants,memberships,sessions,one_time_tokens,user_security,provider_events,provider_objects,domain_mappings TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON platform_settings TO trainer_service;
GRANT SELECT,INSERT ON platform_settings_audit TO trainer_service;
-- Set trainer_service's password with the database console's password workflow.
-- The runtime must not own tables. Tenant transactions explicitly SET LOCAL ROLE.

GRANT SELECT,INSERT,UPDATE ON admin_documents,admin_experiments TO trainer_service;
GRANT SELECT,INSERT ON admin_operations_audit,acquisition_events TO trainer_service;
GRANT SELECT,INSERT ON platform_role_changes TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON support_preview_grants TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON support_preview_elevations TO trainer_service;
GRANT SELECT,INSERT ON infrastructure_observations,infrastructure_policies TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON infrastructure_recommendations TO trainer_service;
GRANT SELECT,INSERT ON infrastructure_execution_policies TO trainer_service;
GRANT SELECT,UPDATE ON infrastructure_worker_control TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON infrastructure_actions TO trainer_service;
-- Host operations (058): signed status reports, host action requests and
-- short-lived TLS issuance allowances. The host controller writes as the
-- migration administrator; the runtime never deletes these rows.
GRANT SELECT,INSERT,UPDATE ON host_status,host_action_requests,tls_issuance_allowances TO trainer_service;
GRANT SELECT,INSERT ON host_monitor_policies TO trainer_service;
-- Web addresses (066): previous slugs of renamed workspaces redirect for a
-- while; the runtime reclaims one by shortening its window, never deletes it.
GRANT SELECT,INSERT,UPDATE ON tenant_slug_redirects TO trainer_service;
GRANT DELETE ON acquisition_events TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON acquisition_consents TO trainer_service;

GRANT SELECT,INSERT ON privacy_erasure_registry TO trainer_service;
-- Keys and dates of complimentary grants for the operator list; the table is
-- written only by its definer trigger on complimentary_access.
GRANT SELECT ON complimentary_access_directory TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON workspace_lifecycle_requests TO trainer_service;

-- Governance history and operator alerts are platform records (no tenant actor
-- access). History rows are only lifted, never deleted; deliveries are append-only.
GRANT SELECT,INSERT,UPDATE ON workspace_suspensions,account_locks,platform_alerts TO trainer_service;
GRANT SELECT,INSERT ON platform_alert_deliveries TO trainer_service;

-- Account secrets and WebAuthn are system-only; tenant actors cannot read them.
GRANT SELECT,INSERT,DELETE ON mfa_recovery_codes TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_passkeys,auth_passkey_challenges TO trainer_service;
-- Linked sign-in identities, OIDC requests, email changes, operator recovery
-- grants and account notices are account-level and service-only as well.
GRANT SELECT,INSERT,UPDATE,DELETE ON account_identities,oidc_sign_in_requests,email_change_requests,account_recovery_grants,account_notices TO trainer_service;

-- Public-site lookups use the service role after host/visibility checks. All
-- writes still use scoped owner transactions. Do not grant table-wide writes.
GRANT SELECT ON brand_media,coach_galleries,coach_gallery_photos,coach_sites,coach_design_drafts TO trainer_service;
GRANT EXECUTE ON FUNCTION trainer_media_brand_reference(uuid,uuid) TO trainer_service;
-- trainer_brand_tenant(), notification-template, safety-policy, workspace-name
-- and membership proof helpers remain executable only by trainer_app, exactly
-- as their migrations specify.

-- Public discovery (059): directory reads use the service role after the
-- public_discovery_tenant() predicate; owners change their own listing in
-- scoped transactions. Member install icon keys are system-only.
GRANT SELECT ON coach_directory_profiles TO trainer_service;
GRANT SELECT,INSERT ON workspace_app_icons TO trainer_service;
GRANT EXECUTE ON FUNCTION public_discovery_tenant(uuid) TO trainer_service;

-- Early access (067): platform-scoped requests from the public site, written
-- by the public endpoint and listed, exported or erased by the Super admin.
GRANT SELECT,INSERT,UPDATE,DELETE ON early_access_requests TO trainer_service;
-- Domain pricing (071): registrar prices per ending, cached by trainer
-- searches, checkouts and the worker; refreshed in place, never deleted.
GRANT SELECT,INSERT,UPDATE ON registrar_prices TO trainer_service;

-- Platform finance (072, 073): reviewed monthly USD to AED rates and model
-- token prices are platform reference data, append-only history written and
-- read by the Super admin and platform finance screens only.
GRANT SELECT,INSERT ON exchange_rates,model_prices TO trainer_service;
-- Platform finance phase B (075): the monthly summary cache and the run log
-- of platform finance jobs, rebuilt and written by the worker and the
-- Super admin screens only.
GRANT SELECT,INSERT,UPDATE ON platform_finance_months,platform_finance_runs TO trainer_service;
-- Platform finance phase C (076): the platform's own cost ledger, provider
-- invoices and Stripe's fee per payment are append-only; recurring costs get
-- a last month set in place.
GRANT SELECT,INSERT ON platform_costs,provider_invoices,stripe_fees TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON platform_recurring_costs TO trainer_service;
-- Platform finance phase D (077): DigitalOcean invoices read once
-- (append-only) and the current month's estimate, recomputed daily.
GRANT SELECT,INSERT ON digitalocean_invoices TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON digitalocean_estimates TO trainer_service;
-- Open coach sign-up (078): hashed six-digit email codes (no workspace yet)
-- and "Report this coach" reports for the Super admin.
GRANT SELECT,INSERT,UPDATE,DELETE ON coach_signup_codes TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON coach_reports TO trainer_service;
-- Model profiles (080): saved model connections, switch checks and their
-- append-only audit; service only (Super admin and the worker).
GRANT SELECT,INSERT,UPDATE ON model_profiles,model_switch_checks TO trainer_service;
GRANT SELECT,INSERT ON model_profile_audit TO trainer_service;
-- Marketing assistant (082): daily counts and cost, and day-keyed visitor
-- counters deleted after two days; service only.
GRANT SELECT,INSERT,UPDATE ON marketing_assistant_days TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON marketing_assistant_counters TO trainer_service;
-- Shared workout music (085): service-only jobs/assets and append-only audit.
GRANT SELECT,INSERT,UPDATE ON workout_music_jobs,workout_music_tracks,workout_music_agent,workout_music_plans TO trainer_service;
GRANT SELECT,INSERT ON workout_music_audit TO trainer_service;

-- Tenant transactions SET ROLE trainer_app; it must never bypass RLS.
ALTER ROLE trainer_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Tenant scope entry (packages/db) sets app.tenant_id/app.user_id/app.role as
-- the service role before SET ROLE; trainer_app itself may not call set_config
-- once infra/tenant-scope.sql (or migration 061 on a fresh database) revokes
-- PUBLIC execute. The workspace-bound service tables (migration 061) need no
-- new grants: row security narrows the existing ones.
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO trainer_service;
-- Bearer-secret lookups for session-less follower requests (HealthKit device
-- token, wearable OAuth relay): definer functions the service role calls in a
-- workspace-bound service transaction instead of an elevated owner scope.
GRANT EXECUTE ON FUNCTION healthkit_device_for_token(text),integration_oauth_relay(text,text) TO trainer_service;
-- Voice-led sessions (065): voice_session_styles, voice_sessions and
-- voice_session_clips are tenant tables reached only through SET LOCAL ROLE
-- trainer_app (grants in the migration); the service role gets no direct grant.
-- Trainer voice clones (069): trainer_voice_clones, trainer_voice_samples and
-- voice_provider_deletions are owner-only tenant tables reached the same way;
-- trainer_app may not DELETE provider deletion rows (they outlive closure).
