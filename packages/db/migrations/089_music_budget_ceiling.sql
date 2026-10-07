-- Owner request (7 October 2026): the music agent's lifetime budget can go
-- past 120 requests / 1,440 credits (the owner set 5,000). The table keeps a
-- hard ceiling; the owner still chooses the budget in Admin Music.
ALTER TABLE workout_music_agent
 DROP CONSTRAINT workout_music_agent_request_limit_check,
 ADD CONSTRAINT workout_music_agent_request_limit_check CHECK(request_limit BETWEEN 1 AND 1000),
 DROP CONSTRAINT workout_music_agent_credit_limit_check,
 ADD CONSTRAINT workout_music_agent_credit_limit_check CHECK(credit_limit>0 AND credit_limit<=20000);
