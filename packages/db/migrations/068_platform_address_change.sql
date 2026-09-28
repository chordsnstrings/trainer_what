-- Platform address change from the Super admin host page (docs/features/infra-ops.md,
-- "Changing the platform's own address"). Two allowlisted host actions:
--  * change_platform_address carries its signed parameters (the new PUBLIC_APP_URL
--    origin and an optional PLATFORM_ROOT_DOMAIN) as canonical JSON text;
--  * clear_address_redirects removes the permanent redirects the edge keeps for
--    former platform names.
-- Parameters are intent: the existing trigger keeps every column other than the
-- status and result columns immutable, so they cannot change after signing.
-- Additive only: releases that predate this migration insert requests without
-- parameters and still satisfy every check.

ALTER TABLE host_action_requests
 ADD COLUMN parameters text CHECK(parameters IS NULL OR octet_length(parameters) BETWEEN 2 AND 2048);
ALTER TABLE host_action_requests DROP CONSTRAINT host_action_requests_action_check;
ALTER TABLE host_action_requests ADD CONSTRAINT host_action_requests_action_check CHECK(action IN
 ('restart_service','rollback_release','restore_release','reapply_release','pause_deploys','resume_deploys',
  'backup_now','verify_backup','change_platform_address','clear_address_redirects'));
ALTER TABLE host_action_requests ADD CONSTRAINT host_action_requests_parameters_action
 CHECK((action='change_platform_address')=(parameters IS NOT NULL));

INSERT INTO schema_migrations(version) VALUES('068_platform_address_change');
