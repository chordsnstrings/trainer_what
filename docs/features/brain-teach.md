# Teach your Brain and Keep training (round 4, phase 3 backend)

Setup step 4 of the one-wizard setup ("Teach your Brain") and the "Keep training" area after launch.
Backend only; the wizard and the "My Brain" screens call these endpoints. Plain words used in
responses: "Waits for me" (supervised), "Sends automatically" (qualified automatic coaching),
"Practice quiz" (scenario lab), "full check" (evaluation of 20+ own cases).

Code: `apps/api/src/brain-teach.ts` (routes), `apps/api/src/brain-training-state.ts` (read model,
meter inputs), `packages/domain/src/brain-teach.ts` (platform safety questions, quiz checks, meter,
levels), `packages/providers/src/brain-quiz.ts` (quiz prompt `brain-quiz-v1`). Tests:
`tests/brain-teach.test.ts`.

Phase 6 adds "Check my Brain", background re-checks and rules suggested from corrected replies:
`docs/features/brain-check.md` (`GET /brain/teach` `suggestions.learned` counts them).

## Safety floor (unchanged)

- The Brain only drafts. A quiz round, a "Waits for me" launch or a Keep-training rule never sends
  anything to a member. New rules are drafts until the coach approves them.
- Flagged draft rules (medical advice, a red flag the directive does not stop for, links, contact
  details, approval claims, guarantees) are never part of "Approve all"; they stay one by one
  (`POST /brain/rules/:id/confirm` with `acknowledgeFlags`).
- Safety questions in the quiz are platform-owned (`PLATFORM_SAFETY_CASES`, 12 fixed questions,
  written by trainsyou, never by a model). Each hands over to the coach. A coach's "Change" answer
  to a safety question is kept as teaching wording only and never becomes a rule suggestion.
- "Sends automatically" still needs the full existing check: a passing evaluation of at least 20
  own cases of the current rules, published with `POST /brain/releases`, then the existing
  `POST /brain/coaching-activate` checks. A Brain launched on the quiz is refused automatic mode.
- Model-written quiz questions pass code checks before a coach sees them (`quizCaseIssues`): the
  rule reference must be one that was sent; a message the workspace safety screen catches must be
  routed to the coach; no medical/medicine/dose/diagnosis advice (`givesMedicalAdvice`), links,
  contact details, approval claims or guarantees; no number the rule or message does not state;
  a hand-over reply must say the coach will reply and stay short. Questions that repeat one of the
  coach's own held-out cases are dropped, so the held-out set stays independent.
- No model or vendor name appears in any text.

## Endpoints (all `/api/v1`)

| Method and path | Who | What |
|---|---|---|
| `GET /brain/teach` | owner, staff | Rule cards, `approveAll` list, quiz state, own-case counts, meter, levels, launch readiness, suggestion counts |
| `POST /brain/rules/approve-all` | owner | `{rules:[{id,version}]}` (the cards the coach saw). Returns `{approved:[ids], skipped:[{id,reason}]}`; reasons `flagged`, `changed`, `already_approved`, `not_a_draft`, `not_found` |
| `POST /brain/quiz/rounds` | owner | Starts a round (one model call) or returns the round already open. 409 `RULES_REQUIRED` without an approved rule; 409 `TEACHING_CHANGED` if rules changed during drafting; 502 `QUIZ_UNAVAILABLE` if fewer than 3 usable questions came back |
| `GET /brain/quiz/rounds/:id` | owner, staff | The round |
| `POST /brain/quiz/rounds/:id/answers` | owner | `{caseId, verdict:"yes"|"change", reply?}` (`reply` required for change). Each answer is saved as an `interview` record (`origin:"quiz"`). The round completes when every question is answered. 409 `ALREADY_ANSWERED`, `QUIZ_CLOSED` |
| `POST /brain/releases/supervised` | owner | Go live in "Waits for me": needs an approved rule (at most 38), no open conflicts, a completed quiz round and at least 3 own cases (`POST /brain/scenarios`, unchanged). Publishes a `brain_release` with `qualification:"quiz"`. 409 `TEACHING_REQUIRED` lists what is missing |
| `POST /brain/teach/chat` | owner | `{text}`: a rule in the coach's own words, saved as teaching (`origin:"keep_training_chat"`) and drafted through the existing rule compile (same response as `POST /brain/compile` plus `teachingId`). Client names or contact details are refused (400 `PERSONAL_DATA_REMAINS`) |
| `GET /brain/teach/suggestions` | owner, staff | Draft rules, teaching waiting to become rules (quiz "Change" answers to rule questions, chat teaching not yet compiled, converted reply corrections), and corrected real replies (`coaching_correction`; only the coach's own reply and explanation, never the client's message) |
| `POST /brain/teach/suggestions/compile` | owner | `{teachingIds?, correctionIds?}` (1-20 in all): turns them into draft rules through the existing compile. A corrected reply is first saved as the coach's own teaching (`origin:"reply_correction"`) |

`GET /brain/teach` `launch` has `live` (a published release matches the current approved rules),
`liveMode` (`waits_for_me` for a quiz release, `checked` for a full-check release), and
`supervised` / `automatic` with `ready` and plain `missing` lines.

Existing endpoints changed: `POST /brain/compile` behaviour is unchanged (its body is now the
shared `compileTeaching`); `POST /brain/releases` now stores `qualification:"full"`;
`POST /brain/coaching-activate` with `mode:"automatic"` is refused for a quiz release and, for a
full release, needs Brain level 2 or 3 and no more routine actions than the level allows. Releases
published before this change (no `qualification`) keep the existing checks only. Shadow mode is
not level-gated (it never sends). Onboarding: the `scenarios` step completes with 20 own cases or
with a completed quiz plus 3 own cases, and `readiness` accepts a current quiz release.

## Practice quiz

- 8-10 questions per round: 3-7 model-written questions from the approved rules (rules asked about
  least in earlier rounds go first; at most 12 rules per request, as short references R1, R2, ...),
  plus 3-5 platform safety questions (more when fewer model questions were usable), one after every
  two or three rule questions. Rounds rotate through the platform set.
- Stored as a `brain_quiz_round` record (`open` / `completed`) with the rules digest and the prompt
  version. No migration: records are generic.
- Model budget `brain_quiz`: 4000 output tokens, 30 s (90 s for Seed-family models).

## "Brain trained" meter (0-100)

`brainTrainingMeter()` in `packages/domain/src/brain-teach.ts`:

| Part | Points |
|---|---|
| Approved rules | 25 x min(rules, 8) / 8 |
| Completed quiz rounds | 20 x min(rounds, 3) / 3 |
| Own written cases (held out) | 15 x min(cases, 5) / 5 |
| Corrections (quiz "Change" answers, rule corrections, corrected real replies) | 10 x min(n, 10) / 10 |
| Checks | 30 for a passing full check (20+ cases) of the current rules, else 10 x passed/total of the latest check of them |

Levels:

| Level | Name | Needs | Automatic routine replies |
|---|---|---|---|
| 0 | Getting started | - | 0 |
| 1 | Waits for me | an approved rule, no open conflicts, a completed quiz, 3 own cases | 0 (every reply waits for the coach) |
| 2 | Routine replies | level 1 plus a passing full check of the current rules | up to 5 |
| 3 | Most replies | level 2 plus meter 80 and two completed quiz rounds | up to 30 (the existing cap) |

The meter also returns `parts` and plain `next` steps.

## Live model test (Seed 2.0 Pro, 30 September 2026)

`seed-2-0-pro-260328` through the app's own `generateQuizCases` and checks; eval script and results
outside the repository (session scratchpad `round4-evals/brain-teach/`). Four made-up coaches
(strength, weight loss, running, and an adversarial one with a rule telling clients to take a
medicine, a supplement rule and a knee-ache rule), two rounds each, 7 questions per round.

- Final prompt: 8 calls, 56 questions, 56 usable; route correct 56/56 (45 reply, 11 hand-over);
  medical advice 0; every reply grounded in its rule; the unsafe rule was skipped entirely.
  About 20-40 s per call, about 750 input and 1,500 output tokens per call.
- First version on the adversarial coach: 2 of 14 questions followed the unsafe rule (a medicine
  dose) and were dropped by the checks; one hand-over said "will follow up" and was dropped. The
  prompt now tells the model to write no question for a rule that asks for something forbidden, and
  the hand-over check accepts "follow up".
- Seen: the code safety floor does not catch "a tight feeling in my chest", a blood pressure
  medicine question, a supplement dose question or recent surgery on its own (the platform quiz
  questions route them to the coach anyway). Reported, not changed here.
