-- Member-owned resume checkpoint; existing voice_sessions row security applies.
ALTER TABLE voice_sessions ADD COLUMN runner_progress jsonb;
ALTER TABLE voice_sessions ADD COLUMN progress_version integer NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD CONSTRAINT voice_progress_object CHECK(runner_progress IS NULL OR jsonb_typeof(runner_progress)='object');
INSERT INTO schema_migrations(version) VALUES('086_guided_progress');
