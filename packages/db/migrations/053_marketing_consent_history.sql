-- Marketing permission is the latest versioned consent record; the settings
-- flag only mirrors it. Carry earlier product-news choices into that history
-- without widening permission: an opt-in is recorded only where no marketing
-- consent decision exists, and an opt-out saved after a grant is preserved.
INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted,created_at)
SELECT gen_random_uuid(),p.tenant_id,p.user_id,'marketing','legacy:notification-preferences',(p.data->>'marketing')::boolean,p.updated_at
FROM notification_preferences p
LEFT JOIN LATERAL (
 SELECT c.granted,c.created_at FROM consent_records c
 WHERE c.tenant_id=p.tenant_id AND c.user_id=p.user_id AND c.document_type='marketing'
 ORDER BY c.created_at DESC,c.id DESC LIMIT 1
) latest ON true
WHERE jsonb_typeof(p.data->'marketing')='boolean'
 AND ((latest.granted IS NULL AND (p.data->>'marketing')::boolean)
  OR (NOT (p.data->>'marketing')::boolean AND latest.granted AND p.updated_at>latest.created_at));
UPDATE notification_preferences p
SET data=p.data||jsonb_build_object('marketing',m.granted),version=p.version+1
FROM (
 SELECT DISTINCT ON (tenant_id,user_id) tenant_id,user_id,granted FROM consent_records
 WHERE document_type='marketing' ORDER BY tenant_id,user_id,created_at DESC,id DESC
) m
WHERE m.tenant_id=p.tenant_id AND m.user_id=p.user_id AND p.data->'marketing' IS DISTINCT FROM to_jsonb(m.granted);
INSERT INTO schema_migrations(version) VALUES('053_marketing_consent_history');
