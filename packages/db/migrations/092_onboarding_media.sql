-- Uploads, call consent and paid-call receipts are personal to this conversation.
CREATE POLICY onboarding_media_personal ON records AS RESTRICTIVE USING (
  kind NOT IN ('onboarding_attachment','onboarding_call','onboarding_voice_request')
  OR (current_setting('app.privacy_erasure',true)='true' AND current_setting('app.role',true)='owner')
  OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid
) WITH CHECK (
  kind NOT IN ('onboarding_attachment','onboarding_call','onboarding_voice_request')
  OR (current_setting('app.privacy_erasure',true)='true' AND current_setting('app.role',true)='owner')
  OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid
);
DO $media_policy$
DECLARE prior text;
BEGIN
  SELECT pg_get_expr(polqual,polrelid) INTO STRICT prior
  FROM pg_policy WHERE polrelid='records'::regclass AND polname='record_subscriber_scope';
  EXECUTE format('ALTER POLICY record_subscriber_scope ON records USING ((%s) OR (current_setting(''app.role'',true)=''subscriber'' AND owner_user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid AND kind IN (''onboarding_attachment'',''onboarding_call'',''onboarding_voice_request'')))', prior);
END $media_policy$;
CREATE INDEX onboarding_media_owner ON records(tenant_id,owner_user_id,created_at)
  WHERE kind IN ('onboarding_attachment','onboarding_call','onboarding_voice_request');
INSERT INTO schema_migrations(version) VALUES('092_onboarding_media');
