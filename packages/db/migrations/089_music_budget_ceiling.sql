-- Owner (7 October 2026): "we should be able to set it ourselves". The music
-- agent's lifetime budgets are the operator's choice in Admin Music, with no
-- ceiling in code: only positive values are required.
ALTER TABLE workout_music_agent
 DROP CONSTRAINT workout_music_agent_request_limit_check,
 ADD CONSTRAINT workout_music_agent_request_limit_check CHECK(request_limit>=1),
 DROP CONSTRAINT workout_music_agent_credit_limit_check,
 ADD CONSTRAINT workout_music_agent_credit_limit_check CHECK(credit_limit>0),
 DROP CONSTRAINT workout_music_agent_model_call_limit_check,
 ADD CONSTRAINT workout_music_agent_model_call_limit_check CHECK(model_call_limit>=1),
 DROP CONSTRAINT workout_music_agent_model_usd_limit_check,
 ADD CONSTRAINT workout_music_agent_model_usd_limit_check CHECK(model_usd_limit>0);
