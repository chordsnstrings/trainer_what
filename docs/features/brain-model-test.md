# Trainer Brain model test (29 September 2026)

The owner asked which model is faster, better and handles edge cases better, including Claude, and excluded data location as a criterion. This records what was run and what it found. The harness lived in the session scratchpad and is not committed.

## Method

- **Real app code.** Each ModelArk model was called through the app's own `selectCoachAction` (live coaching chat: pick one trainer-approved action by ID, or `null` with human review; JSON output, 800-token cap, temperature 0) and `generateTrainingPlan` (structured programme; checked by `planDraftSchema` and `validatePlan`). Requests were exactly what the app sends.
- **Scenarios.** 12 coaching cases, each run twice: routine reschedule in English, Modern Standard Arabic and Gulf Arabic; chest tightness; mild knee discomfort covered by a trainer rule; sharp knee pain with swelling; pregnancy; hopelessness and not eating; a prompt injection with chest pain; a blood-pressure medication question; a beginner asking for more sessions than the rules allow; a nutrition fact with no supporting action. 3 plan cases, run once: a beginner with a knee injury, an Arabic speaker with dumbbells only, and a 6-day request against a 4-day limit.
- **Claude.** Opus 5.5 answered the same exported prompts once, blind to the answer key, as a separate agent. Its answers were scored by the same checks. Its speed could not be measured (no Anthropic API key in the environment) and it had no app time limit.
- **Code gates.** The app's `safetySignal` screen and action filter were bypassed, so every model saw all 8 actions.
- **Cost.** ModelArk costs use list prices (unverified for BytePlus). The test cost about USD 0.69.

## Results

| Model | Chat correct | Safety cases caught | Needless hand-offs | Broken or timed-out answers | Chat median / p90 | Plans passing all checks | Plan time | Cost per chat reply / per plan |
|---|---|---|---|---|---|---|---|---|
| Claude Opus 5.5 (1 run, blind) | 12/12 | 6/6 | 0 | 0 | not measured | 3/3 | not measured | ~$0.017 / ~$0.046 (answer tokens only; thinking not included) |
| Seed 2.0 Pro (`seed-2-0-pro-260328`) | 24/24 | 12/12 | 0 | 0 | 5.7 s / 8.8 s | 2/3 (the third cited a rule ID one character off; the checker holds it for the trainer) | ~42 s | $0.0036 / $0.013 |
| DeepSeek V4 Pro (`deepseek-v4-pro-ga-260813`) | 24/24 | 12/12 | 0 | 0 | 7.8 s / 11.9 s | 1/3 (2 hit the app's time limit) | ~81 s | $0.0079 / $0.032 |
| GLM-5.3-Flash (`glm-5-3-flash-260828`) | 23/24 | 12/12 | 0 | 1 timeout | 8.9 s / 17.4 s | 1/3 (2 hit the app's time limit) | ~80 s | $0.0011 / $0.0054 |
| DeepSeek V4.1 Flash (`deepseek-v4-1-flash-260910`) | 22/24 | 12/12 | 0 | 2 (reasoning used up the 800-token cap) | 3.3 s / 6.0 s | 2/3 (1 truncated) | ~44 s | $0.0018 / $0.009 |
| Seed 2.1 Turbo (`dola-seed-2-1-turbo-260628`) | 14/24 | 10/12 | 0 | 10 | 17.5 s / 30 s | 0/3 (all timed out) | — | $0.0043 / — |

The ModelArk models answered each chat case twice; the "Chat correct" and "Safety cases caught" columns count both runs. Seed 2.1 Turbo with thinking disabled was faster (4.3 s) but broke JSON on 8 of 24 calls. Every model escalated every safety case it answered validly, including the prompt injection. None sent an unsafe reply automatically.

## Findings for the app (whichever model is used)

1. **Grounding check.** `groundedSelection` (`apps/api/src/coaching-runtime.ts`) delivers an action automatically only when `evidenceIds` contains the chosen action's own ID and one of its rule IDs. Every model, Claude included, put the action ID only in `actionId`. As a result, none of the correct routine answers would be delivered automatically; they would all go to the trainer. The same check scores trainer scenario evaluations.
2. **Arabic.** The action filter matches English words only, so Arabic requests never reach the model for an automatic reply.

Findings 1 and 2 are addressed on branch `core/fix-chat` (not merged): the selector's chosen `actionId` now counts as citing the action and the prompt states the evidence contract (`coach-action-selector-v3`), and Arabic request terms, Arabic replies and Arabic held-out questions are supported. See `docs/features/coaching-chat.md`.
3. **Plan time limits.** The limits for these plans (about 69–87 s) are shorter than GLM-5.3-Flash and DeepSeek V4 Pro need (about 80 s). Seed 2.0 Pro (about 42 s) fits.
