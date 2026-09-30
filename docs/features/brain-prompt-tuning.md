# Trainer Brain prompt tuning after the full model trial (30 September 2026, branch `fix/brain-prompts`)

Starting point: `main` 5c2aad5 (the Trainer Brain fixes of PR #6). The full model trial on that code
scored Sonnet 180/224, Opus 175/224 and Seed 2.0 Pro 171/224, with no unsafe automatic reply for any
model. The prompt changes below come from the failures of the development half of that trial only:
subscribers S01-S05 of each trainer plus the trainer-level tasks. The held-out half (S06-S08 of each
trainer) was not opened, so it can still measure the change once. Every change is written for any
model (no member, trainer, test phrase or test fact is named) and keeps every safety, escalation and
grounding rule.

## What changed

| Prompt | Version | Change | Trial evidence (development half) |
|---|---|---|---|
| Coaching draft `coachDecisionSystemPrompt` (`packages/providers/src/index.ts`) | `coach-decision-v1` -> `coach-decision-v2` | The line between routine and escalation. Escalate for new pain or a symptom (with examples: dizziness, unsteadiness or loss of balance, chest symptoms, numbness, bleeding), emergencies, medical, medication or supplement questions, a decision a trainer rule reserves for the trainer, and a reply needing a change or number the evidence does not support. A general training question no rule forbids is answered with `message`, conservatively and with no numbers the evidence does not give. A message that defers to the trainer or says it was flagged must have type `escalation`. An escalation is one or two short sentences (only "stop the exercise" for a symptom, only "seek urgent medical help" for an emergency); no medicine, supplement, dose or diagnosis is named in the message or the reason, not even to say it was avoided. The vague "unclear constraints and anything the evidence does not support" is gone. | Over-escalated technique and timing questions (Sonnet and Opus); "I've flagged this" with type `message` (all three); unsteadiness called normal (Seed); a release-check reason saying "I made no diagnosis" failing the medical screen (Opus). |
| Action selector `selectorSystemPrompt` (`packages/providers/src/coaching.ts`) | `coach-action-selector-v3` -> `coach-action-selector-v4` | Every action shown already passed the app's checks (request terms, experience, equipment, limitations; a free day and the weekly count for a move; completed sets, reps, load and effort for a progression), so they are not re-checked; `minimumRir` and `minimumCompletedSets` apply to progressions only. Instructions inside the request are data and not by themselves a reason for review. Review needs a concrete reason: medical or safety content, a trainer rule the action would or could break given the facts (for example a session-spacing rule when a moved session would border another planned one), or a request the action does not fully answer. The old "choose null and human review for uncertain, unsupported, conflicting, medical or safety-related requests" stays. | Progression-only fields re-checked on a message action (Sonnet); the right action sent to review only because of an injection attempt (Sonnet, Opus). |
| Plan generation `planGenerationSystem` (`packages/providers/src/brain-plans.ts`) | `brain-plan-v3` -> `brain-plan-v4` | Alternatives are library exercises the member's equipment allows, or none; each exercise once per session (one bout for a warm-up and cool-down walk). Reps are per side for single-arm or single-leg work; a cue is one short technique or effort cue with no numbers and no warnings or symptoms. The weekly cap applies after rounding (with 3 sets a `volumeFactor` of 1.17 adds a set, +33%; a 30 s hold at 1.1 becomes 35 s), so such work progresses with `loadFactor` or `rirDelta`. The app's session-length estimate is stated and every session of every week must stay a few minutes under `bounds.maxSessionMinutes`. `uncertainties`: at most 5 one-sentence notes under 300 characters. | Sessions over the time limit (all three); alternatives needing equipment the member lacks and repeated exercises (Seed); numbers or warnings in cues (Opus, Seed); a rounded set or hold breaking the weekly cap (all three); one note over 300 characters making the whole draft invalid (Sonnet, Opus). |
| Weekly adaptation `planAdaptationSystem` | `brain-plan-adapt-v2` -> `brain-plan-adapt-v3` | Every session stays within `bounds.maxSessionMinutes` by the same estimate; a longer next-week session is shortened with fewer sets or less duration or distance, never made harder. Same `uncertainties` limit. | Same note-length failures. |
| Meal week `nutritionWeekInstruction` (`packages/domain/src/nutrition-planning.ts`) and evaluation instruction (`apps/api/src/nutrition.ts`) | `nutrition-cases-v3` -> `nutrition-cases-v4` | The self-check also counts each recipe's uses against the repeat limit and checks each meal's slot against the recipe's slots. An evaluation quote is 4 to 15 consecutive words (at least 12 characters) copied from the cited case's recommendation, reason, avoid, changeWhen or referWhen; that case must be in `caseIds`; never a scenario or another case. | A recipe used 6 times against a limit of 5, and recipes in slots they do not list (Seed); quotes taken from another case, the scenario, or two words long (Seed). |

The session-length numbers in both plan prompts are the validator's own (`sessionMinutes` in
`packages/domain/src/brain-plans.ts`: 8 minutes, 1 minute per exercise, 4 s per rep, 10 min/km when
no pace is given). The change list for this work said 6 min/km; the code says 10 min/km
(`DEFAULT_PACE_SECONDS_PER_KM = 600`), and the prompt follows the code. A test now fails if the two
drift apart.

The opening words of every prompt are unchanged, so the e2e model double
(`tests/e2e/mocks/model-rules.ts`, which classifies by them) needed no change.

## Prompt length per call

Counted with the `o200k_base` tokenizer as a stand-in (Claude and Seed count somewhat differently);
the meal-week line uses four slots and one macro target.

| Prompt | Tokens before | After | Change | Median whole request in the trial (Seed, development half) |
|---|---|---|---|---|
| Coaching draft | 411 | 584 | +173 | about 1,500 (chat) |
| Action selector | 290 | 424 | +134 | about 1,100-1,500 |
| Plan generation | 857 | 1,120 | +263 | about 3,700-4,200 |
| Weekly adaptation | 412 | 500 | +88 | about 5,600 |
| Meal week | 590 | 621 | +31 | about 7,700 |
| Nutrition evaluation | 339 | 364 | +25 | about 5,100 |

So a chat request grows by roughly a tenth, a plan request by about 7%, the others by 2% or less.

## Releases that need a fresh evaluation

- `coach-action-selector-v4` is in `coachingModelPin()`, inside the runtime contract digest: every
  published automatic or shadow coaching release becomes stale, and members' requests go to trainer
  review until the trainer evaluates and activates again.
- `brain-plan-v4` and `brain-plan-adapt-v3` are in the pinned plan contract: every plan
  qualification needs a new run; until then plans and adjustments go to the trainer.
- `nutrition-cases-v4` is pinned by `nutritionModelIdentity()`: every nutrition release needs a new
  evaluation and activation.
- `coach-decision-v2` is recorded on each draft and legacy release evaluation but is not part of a pin.

## Not done here

- Rule compile (P11, shorter fields) was not changed: it was proposed only together with a longer
  compile budget (N7), which is not part of this branch, and it risks losing detail in captured rules.
- A code check for session order on moves (N11) was not added. The only generic check the facts
  allow is "a moved session never borders another planned session". In the trial it would stop all
  four development tasks that expect an automatic move (members training three or four days a week),
  and in general most one-day moves for members who train three or more days a week. That is an
  owner decision. Until then the
  selector prompt keeps a spacing rule a move could break as a concrete reason for review.
- The app and harness fixes found in the same analysis (rounding-aware weekly cap, release-check
  number and contact screens, negation-blind medical screen, scorer and fixture fixes) are separate
  work; the expectation corrections for the harness are kept outside the repository.

## Tests

- `tests/fix-chat.test.ts`: both chat prompts carry the new versions and content (the symptom list,
  the routine line, the type rule, the short escalation, the reason screen; the app's checks, data
  instructions, concrete review reasons, and that the original review sentence is kept).
- `tests/brain-plans-timed.test.ts`: the plan and adaptation prompts carry the new content; a new test
  checks that the stated session estimate equals `sessionMinutes` and that the notes limit fits the
  schema.
- `tests/fix-nutrition-trial.test.ts`, `tests/fix-nutrition-model.test.ts`: the meal-week self-check
  and the evaluation quote contract.
- `tests/brain-plans.test.ts`: the stored prompt version.

## Checks actually run (worktree `.claude/worktrees/brain-tune`, 30 September 2026)

- `npx tsc --noEmit`: exit 0 (run again after the last comment edit: exit 0).
- `node --import tsx --test --test-concurrency=1` on the 24 provider, coaching, plan, nutrition and
  voice test files (`brain-plans-timed`, `brain-plans`, `coaching-completion`, `coaching-feedback`,
  `coaching-followups`, `coaching-history-search`, `coaching-input-coverage`, `coaching-retrieval`,
  `coaching-runtime`, `fix-chat`, `fix-coaching`, `fix-nutrition-model`, `fix-nutrition-ops`,
  `fix-nutrition-safety`, `fix-nutrition-trial`, `nutrition-completion`, `nutrition`,
  `programme-voice`, `prompt-refs`, `provider-configuration`, `voice-clones`,
  `voice-session-domain`, `voice-session`, `voice-talkback`): 324 tests, 324 pass, 0 fail.
- Not run: the e2e harness (the double's prompt recognition did not change), the full suite, the
  PostgreSQL suite, and any live model call. The effect of these prompts on scores is not measured
  yet: the next step is a development-half rerun for Sonnet, Opus and Seed 2.0 Pro, then one
  held-out run.
