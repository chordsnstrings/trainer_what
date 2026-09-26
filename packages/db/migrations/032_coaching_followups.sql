-- Scheduled human text is private until it becomes a sent conversation message.
CREATE POLICY coaching_followup_scope ON records AS RESTRICTIVE
 USING(kind<>'coaching_followup' OR current_setting('app.role',true) IN ('owner','staff'))
 WITH CHECK(kind<>'coaching_followup' OR current_setting('app.role',true) IN ('owner','staff'));
CREATE UNIQUE INDEX coaching_followup_intent ON records
 (tenant_id,(data->>'creatorUserId'),(data->>'requestKey')) WHERE kind='coaching_followup';
CREATE UNIQUE INDEX coaching_followup_delivery ON records
 (tenant_id,(data->>'followupId')) WHERE kind='message' AND data ? 'followupId';
CREATE INDEX coaching_followup_due ON records(tenant_id,(data->>'dueAt'),id)
 WHERE kind='coaching_followup' AND status='scheduled';
INSERT INTO schema_migrations(version) VALUES('032_coaching_followups');
