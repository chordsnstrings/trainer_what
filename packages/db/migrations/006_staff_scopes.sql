ALTER POLICY staff_scope ON journals USING(current_setting('app.role',true) IN ('owner','finance'));
ALTER POLICY staff_scope ON journal_lines USING(current_setting('app.role',true) IN ('owner','finance'));
ALTER POLICY staff_scope ON payouts USING(current_setting('app.role',true) IN ('owner','finance'));
ALTER POLICY staff_scope ON cost_events USING(current_setting('app.role',true) IN ('owner','finance'));
CREATE POLICY coach_financial_scope ON records AS RESTRICTIVE USING (
 current_setting('app.role',true)<>'staff' OR kind NOT IN ('beneficiary','refund','close','statement','checkout','reconciliation')
);
CREATE POLICY event_role_scope ON events AS RESTRICTIVE USING (
 current_setting('app.role',true)<>'staff' OR split_part(name,'.',1) NOT IN ('payout','ledger','invoice','refund','dispute','finance','beneficiary')
) WITH CHECK(true);
CREATE POLICY finance_workout_scope ON workout_events AS RESTRICTIVE USING(current_setting('app.role',true)<>'finance');
CREATE POLICY finance_consent_scope ON consent_records AS RESTRICTIVE USING(current_setting('app.role',true)<>'finance' OR user_id=nullif(current_setting('app.user_id',true),'')::uuid);
ALTER POLICY finance_record_scope ON records USING (current_setting('app.role',true)<>'finance' OR kind IN ('product','beneficiary','refund','statement','reconciliation','close') OR (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND kind IN ('preferences','settings','privacy_request')));
INSERT INTO schema_migrations(version) VALUES('006_staff_scopes');
