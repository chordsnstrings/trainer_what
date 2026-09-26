-- Index existing records; there is no second personal-data store to erase.
-- Do not include context snapshots, teaching/held-out scenarios or model input.
CREATE INDEX coaching_correction_history ON records(tenant_id,created_at DESC,id DESC)
 WHERE kind='coaching_correction';
CREATE INDEX coaching_correction_search ON records USING gin (
 to_tsvector('simple',
  coalesce(data->>'request','') || ' ' ||
  coalesce(data->'preferred'->>'message','') || ' ' ||
  coalesce(data->'rejected'->>'message','') || ' ' ||
  coalesce(data->>'explanation',''))
) WHERE kind='coaching_correction';
CREATE INDEX coaching_outcome_correction ON records(tenant_id,(data->>'correctionId'),owner_user_id,created_at DESC,id DESC)
 WHERE kind='coaching_feedback_outcome';
CREATE INDEX coaching_outcome_search ON records USING gin (
 to_tsvector('simple',coalesce(data->>'note',''))
) WHERE kind='coaching_feedback_outcome';
INSERT INTO schema_migrations(version) VALUES('034_coaching_history_search');
