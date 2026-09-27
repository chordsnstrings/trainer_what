ALTER TABLE memberships ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE FUNCTION membership_role_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.role IS DISTINCT FROM NEW.role THEN NEW.version=OLD.version+1; END IF; RETURN NEW; END $$;
CREATE TRIGGER membership_role_revision BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION membership_role_revision();
ALTER TABLE one_time_tokens ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX one_time_token_id ON one_time_tokens(id);
ALTER TABLE one_time_tokens ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
INSERT INTO schema_migrations(version) VALUES('022_team_completion');
