-- Published website snapshots can contain unpublished/hidden page text. They
-- are private owner material, including from same-workspace staff queries.
CREATE POLICY site_revision_owner ON records AS RESTRICTIVE
USING (kind NOT IN ('site_revision','website_starter') OR current_setting('app.role',true) = 'owner')
WITH CHECK (kind NOT IN ('site_revision','website_starter') OR current_setting('app.role',true) = 'owner');

-- A restore copies a snapshot into coach_sites.draft. It never rewrites the
-- snapshot itself; bounded retention and reviewed erasure may delete it.
CREATE FUNCTION protect_site_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'site_revision' OR NEW.kind = 'site_revision' THEN
    RAISE EXCEPTION 'Published website versions cannot be edited';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_site_revision() FROM PUBLIC;
CREATE TRIGGER site_revision_immutable BEFORE UPDATE ON records
FOR EACH ROW EXECUTE FUNCTION protect_site_revision();

CREATE INDEX site_revision_history ON records(tenant_id,created_at DESC,id DESC)
WHERE kind='site_revision';
-- Stable request identity makes retries idempotent; only the owner's private
-- proposal cache is indexed, and published website data is never stored here.
CREATE UNIQUE INDEX website_starter_request ON records(tenant_id,(data->>'requestId'))
WHERE kind='website_starter';
CREATE INDEX website_starter_cache ON records(tenant_id,(data->>'cacheKey'),created_at DESC)
WHERE kind='website_starter' AND status IN ('completed','running');
INSERT INTO schema_migrations(version) VALUES('083_site_builder_history');
