-- Preserve the currently approved communication style in the live Brain.
-- Draft answers, unconfirmed samples and voice recordings are never copied.
-- Archived releases have no invented historical style; new releases retain
-- their own snapshot through the ordinary checked publication path.
-- NO FORCE permits only the table-owning migrator's atomic backfill; runtime
-- trainer_app remains subject to RLS throughout. FORCE is restored below.
ALTER TABLE records NO FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_session_styles NO FORCE ROW LEVEL SECURITY;

UPDATE records r SET data=r.data||jsonb_build_object('communication',
  jsonb_build_object(
    'tone', coalesce(s.style->'tone','"steady"'::jsonb),
    'intro', coalesce(s.style->'intro','[]'::jsonb),
    'warmup', coalesce(s.style->'warmup','[]'::jsonb),
    'encouragement', coalesce(s.style->'encouragement','[]'::jsonb),
    'formReminders', coalesce(s.style->'formReminders','[]'::jsonb),
    'cooldown', coalesce(s.style->'cooldown','[]'::jsonb),
    'finish', coalesce(s.style->'finish','[]'::jsonb),
    'oneOnOne', CASE WHEN jsonb_typeof(s.style->'oneOnOne'->'confirmed')='object'
      THEN jsonb_build_object('summary',s.style->'oneOnOne'->'confirmed'->'summary',
        'answers',s.style->'oneOnOne'->'confirmed'->'answers') ELSE 'null'::jsonb END
  ))
FROM voice_session_styles s
WHERE r.tenant_id=s.tenant_id AND r.kind='brain_release' AND r.status='published'
  AND NOT r.data ? 'communication';

ALTER TABLE voice_session_styles FORCE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
