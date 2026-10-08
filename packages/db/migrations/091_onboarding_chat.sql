-- Private onboarding conversations stay with the signed-in person, even when
-- another team role can read ordinary coaching records in the same workspace.
CREATE POLICY onboarding_chat_personal ON records AS RESTRICTIVE USING (
  kind NOT IN ('onboarding_chat','onboarding_chat_archive','onboarding_chat_request')
  OR (current_setting('app.privacy_erasure',true)='true' AND current_setting('app.role',true)='owner')
  OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid
) WITH CHECK (
  kind NOT IN ('onboarding_chat','onboarding_chat_archive','onboarding_chat_request')
  OR (current_setting('app.privacy_erasure',true)='true' AND current_setting('app.role',true)='owner')
  OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid
);
-- Extend the current member-read policy without dropping any later restrictions
-- on other kinds. Writes still use its existing self-owned WITH CHECK policy.
DO $
DECLARE prior text;
BEGIN
  SELECT pg_get_expr(polqual,polrelid) INTO STRICT prior
  FROM pg_policy WHERE polrelid='records'::regclass AND polname='record_subscriber_scope';
  EXECUTE format('ALTER POLICY record_subscriber_scope ON records USING ((%s) OR (current_setting(''app.role'',true)=''subscriber'' AND owner_user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid AND kind IN (''onboarding_chat'',''onboarding_chat_archive'',''onboarding_chat_request'')))', prior);
END $;
CREATE UNIQUE INDEX one_onboarding_chat_per_person ON records(tenant_id,owner_user_id)
  WHERE kind='onboarding_chat';
INSERT INTO schema_migrations(version) VALUES('091_onboarding_chat');
