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
CREATE UNIQUE INDEX one_onboarding_chat_per_person ON records(tenant_id,owner_user_id)
  WHERE kind='onboarding_chat';
INSERT INTO schema_migrations(version) VALUES('091_onboarding_chat');
