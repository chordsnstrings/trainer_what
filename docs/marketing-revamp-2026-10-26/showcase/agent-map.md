# Trainer Brain: map of the multi-agent system (from the code, 27 Oct 2026)

Basis: the app code in this checkout is the same as `origin/main` `3d6b9bd` (`git diff origin/main HEAD -- apps packages` is empty), and #103 records that release as live. All file:line references below point at that code.

## 0. Findings that change the showcase

1. **The Brain is a pipeline that code runs.** It has 14 single-purpose model specialists inside the trainer's Brain, plus about 11 code specialists. A live event uses at most one model call. Code checks run before that call (safety floor, policy screen, rule finder) and after it (validators, grounding check, lane gate). Models never call each other or check each other's output. This is the honest version of "multiple agents sandwiched into a single agent".
2. **Only plans and weekly plan changes have a numeric confidence.** It is a score from 0 to 1 built from five weighted signals, and the trainer's threshold defaults to 0.80 (`packages/domain/src/brain-plans.ts:1682-1745`, `:297-305`). Chat replies have no confidence number. Their gate is a grounding check (the reply must cite a rule the approved action cites), a release that passed its check, and the Brain level. The "86%" chip on a chat decision in round one is not accurate.
3. **Automatic chat replies only ever use the trainer's own approved words.** The text is the trainer's approved action reply, plus one sentence written by code ("Your next Back Squat prescription is 62.5 kg."), from `coaching-runtime.ts:435-525`. Every reply the model writes waits for the trainer.
4. **The safety floor is code and runs first on every channel.** A trainer's policy can only make it stricter (`packages/domain/src/safety-policy.ts:259`).
5. **No real subscriber can reach any of this yet.** Publishing is blocked by the `payments` launch gate (`apps/api/src/onboarding.ts:714`; `docs/PROJECT_MEMORY.md:34`). Trainers can run the whole Brain today as a private subscriber through "Try my AI" (`docs/features/trainer-preview.md`), where routine replies that pass the checks are sent automatically.
6. **Public copy must not name a model or vendor.** Product copy says "frontier model" (`docs/PROJECT_MEMORY.md:22`). The live model is Seed 2.0 Pro (`CLAUDE_HANDOFF.md:197`), and that name must not appear on the site.

## 1. The specialists

### 1a. Model specialists inside the Trainer Brain

Token and time limits come from `packages/providers/src/model-request.ts:771-796`. Seed-family models get longer timeouts (`:816`).

| # | Plain name | Internal task / code | Trigger | Inputs | Output | Status |
|---|---|---|---|---|---|---|
| 1 | Interviewer | `onboarding_reply` (4096 tok / 30 s). `packages/providers/src/onboarding-chat.ts:11`; `apps/api/src/onboarding-chat.ts:353` | Trainer setup, the Brain-teaching interview, subscriber intake chat | Six recent turns, saved facts with quotes, attachments | The next question and extracted facts. Code validates them; "Show my profile" uses no model | Live (PR #57, `docs/features/onboarding-chat.md:7`) |
| 2 | Rule writer | `rule_compilation` (5000 / 30 s). `compileTrainerRules` `packages/providers/src/index.ts:479-480`; called at `apps/api/src/app.ts:1420` | Uploads, interview, "Keep training" chat, quiz "Change" answers | The trainer's teaching text | Draft rules (title, category, condition, directive). Flagged drafts (medical, a red flag the rule doesn't stop for, links, guarantees) are left out of "Approve all" | Live (trainer side) |
| 3 | Quiz master | `brain_quiz` (4000 / 30 s). `packages/providers/src/brain-quiz.ts:43`; `apps/api/src/brain-teach.ts:279` | Trainer starts a practice round | Up to 12 approved rules, sent as R1…R12 | 3–7 client questions with the Brain's answers. Code adds 3–5 fixed platform safety questions written by trainsyou | Live |
| 4 | Decision maker | `coach_selection` (800 / 30 s, temperature 0). `selectCoachAction` `packages/providers/src/coaching.ts:56-169`; prompt at `:30` | Subscriber chat, when a checked release is live and at least one approved action is eligible | Request, facts, conversation excerpt, eligible actions (K…), all published rules (R…), up to 6 teaching cases (X…) | `{actionId or null, requiresHumanReview, reason, evidenceIds}`. It only picks; it never writes the reply | Code shipped. Sending on its own needs Brain level 2 or 3 |
| 5 | Reply drafter | `coach_decision` (2500 / 30 s). `modelDecision` `packages/providers/src/index.ts:267-309`; `apps/api/src/coaching-completion.ts:925` | Chat with no eligible action. Also used by "Check my Brain" and "Compare my replies" | Client Twin, intake plus member memory, published rules, conversation | `type` (message, program_build, progression, substitution, schedule or escalation), a message in the member's language, a reason, evidence, `requiresHumanReview: true` | Live. Always waits for the trainer |
| 6 | Plan writer | Plan generation, with its own budget `planGenerationBudget` (`packages/providers/src/brain-plans.ts:249`, `generateTrainingPlan` `:443`); `apps/api/src/brain-plans.ts:1092` | Worker `brain_plan` job: the first plan, or a block ending within 3 days | Profile, up to 38 rules, 6 cases, 6 reviewed examples, 3 templates, up to 300 library exercises, member memory, starting-load references (`packages/providers/src/brain-plans.ts:36-44`) | Session templates plus weekly factors, `selfConfidence`, uncertainties | Code shipped |
| 7 | Plan adapter | `plan_adaptation` (3000 / 60 s). `proposePlanAdaptation` `packages/providers/src/brain-plans.ts:506`; `apps/api/src/brain-plans.ts:1546` | End of each programme week | Adherence, logged loads and reps in reserve, skips, check-ins, the held week, member memory | Changes for next week plus `selfConfidence` | Code shipped |
| 8 | Meal planner | `nutrition_week`, plus `nutrition_policy`, `nutrition_recipe` and `nutrition_evaluation` (own budget). `packages/providers/src/nutrition.ts:31-41,133`; `apps/api/src/nutrition.ts:558` | Weekly meal-week job | Calorie target and tolerance, the trainer's recipes, foods and policy, preferences | A week of meals citing recipes | Behind `NUTRITION_ENABLED` and `NUTRITION_SCOPE_APPROVED` (`entitlements.ts:45`, `nutrition.ts:441`), plus the trainer's reviewed sample week |
| 9 | Nutrition eye | `meal_photo` (2500 / 30 s, temperature 0.1, low-detail image). `estimateMealPhoto` `packages/providers/src/food.ts:213-279`; route `apps/api/src/meal-capture.ts:388-430` | Member uploads a meal photo | JPEG and notes | Up to 12 items (portion, kcal / protein / carbs / fat or null, uncertainty), up to 8 questions, notes. The member must confirm before anything is saved | Switched on live 21 Oct (`CLAUDE_HANDOFF.md:205-207`). Needs a workout + nutrition membership and three consents |
| 10 | Voice narrator | `voice_narration` (1500 / 20 s). `generateNarration` `packages/providers/src/voice-narration.ts:48`; `apps/api/src/voice-narration.ts:205` | Once per voice session, while it is prepared | Confirmed one-on-one style, first name, sessions in the last 7 days, today's prescription, last numbers per exercise (14 days) | Opening, lead, rest, last-set, struggle and closing lines. Each is at most 12 words, with numbers only from the plan or last time; a failing line is dropped | Code shipped. Subscribers need the paid voice add-on |
| 11 | Style drafter | `voice_style` (2000 / 30 s). `draftOneOnOneStyle` `packages/providers/src/voice-narration.ts:80`; `apps/api/src/voice-narration.ts:265` | Trainer clicks "Draft my style" (needs 3 or more answers) | The trainer's one-on-one answers | Style summary and a sample session | Live (trainer) |
| 12 | Wording suggester | `voice_suggestions` (no token cap / 30 s). `apps/api/src/voice-session.ts:620` | Trainer asks for spoken lines | Tone, the trainer's phrases, communication rules | Pending lines, never spoken until the trainer saves them | Live (trainer) |
| 13 | Learner (one correction) | `brain_correction` (1500 / 30 s). `packages/providers/src/brain-learning.ts:53`; `apps/api/src/brain-learning.ts:55,187` | Trainer edits or rejects a Brain draft | Draft, the coach's reply and note. The client's name becomes `[client]`; the client's message is never sent | At most one narrow suggested rule, or nothing | Live |
| 14 | Learner (weekly edits) | `brain_edits` (3000 / 45 s). `packages/providers/src/brain-edits.ts:51`; `apps/api/src/brain-edits.ts:330-368` | Weekly sweep | The coach's plan, weekly-adjustment and meal-week edits | "Suggested from your edits" | Live |

### 1b. Code specialists (no model)

- **Safety floor.** 9 categories: pain, urgent, pregnancy, self_harm, blood_pressure, blood_sugar, pregnancy_warning, joint_injury, eating_disorder (`packages/domain/src/red-flags.ts:41,836`). Reads English, Modern Standard Arabic and Gulf Arabic.
  - Applied in chat, support, set notes and plan inputs through `screenForSafety` (`apps/api/src/safety-policy.ts:55`). Meal weeks use the eating-related subset (`nutritionRedFlags`).
  - Voice replies are screened twice: on the device (`parseVoiceCommand`) and on the server (`apps/api/src/voice-session.ts:764-806`).
  - A trainer must review a hold within 24 h (`packages/domain/src/safety-policy.ts:17-28`). Live.
- **Policy screen.** Optional personal-review topics: medication, supplements, eating_disorder, chronic_condition, surgery_recovery, possible_minor (`packages/domain/src/safety-policy.ts:31-149`). These go to the trainer personally, with a 72 h review deadline. Live.
- **Rule finder.** `eligibleCoachAction` (`packages/domain/src/coaching-completion.ts:513-596`) checks:
  - medical and supplement questions are excluded;
  - the trainer's request phrases, in English or Arabic;
  - experience level;
  - limitations reported as none;
  - equipment;
  - a free day and the weekly session count (for a move);
  - sets, reps, load, reps in reserve and the maximum % increase (for a progression).

  It also filters by reply language (`coaching-runtime.ts:422`) and retrieves up to 6 teaching cases (`packages/providers/src/coaching-retrieval.ts:9-16`). Live.
- **Client memory.**
  - Client Twin (`apps/api/src/client-twin.ts`): intake, holds, 28 days of workouts and sets, wearables, corrections.
  - Member memory (`member-memory-v1`): used for plans and drafts only, never for automatic chat.
  - Conversation excerpt: at most 12 messages, 14 days, 12,000 characters (`docs/features/shared-trainer-brain.md`).

  Live.
- **Grounding check and validators.**
  - `groundedCoachSelection` (`packages/domain/src/coaching-completion.ts:419-433`): the reply must cite a rule the chosen action itself cites.
  - Prompt references: an ID the model was not shown means the answer is withheld.
  - Plan bounds (`packages/domain/src/brain-plans.ts:270-282`): weekly volume +10%, load jump 10%, sessions up to 75 min, rest 30–240 s.
  - Voice `brainLineIssues` and the meal-photo schema.
  - Digest rechecks: if the facts, conversation or release changed during generation, the answer is withheld (`coaching-runtime.ts:1395-1450`).
- **Confidence scorer and lane router.** `planConfidence` and `planRoute` (`packages/domain/src/brain-plans.ts:1689-1810`).
  - Weights: rule coverage 0.25, similar reviewed cases 0.30, validation 0.20, library tags 0.10, the model's own estimate 0.15. For a weekly change, the score is multiplied by (0.7 + 0.3 × logged-training evidence).
  - Settings: mode automatic or supervised; threshold 0.8 (range 0.5–0.99); while fewer than 20 plans have been reviewed, 25% of automatic sends are flagged for a spot check.
  - Sets that went harder than planned hold progression back (`:1367-1384`). Live.
- **Recovery reader (WHOOP).**
  - Bands: below 34 is low, below 67 is moderate (`packages/domain/src/whoop-training.ts:89`).
  - Trainer rules: low = load −10%, volume −25%; moderate = 0% / −10%. These are the starting values and stay off until the trainer enables them. Caps are load ≤30% and volume ≤50% (`:11-17`).
  - The adjustment is frozen at workout start with a before/after receipt (`apps/api/src/whoop-training.ts:160-188`).
  - Code only. Raw WHOOP readings never reach a model.
- **Voice runner.** `packages/domain/src/voice-runner.ts` counts reps, logs sets, makes one "too heavy" reduction within the trainer's percentage (`reducedLoad`), and stops from any point when the member says "pain".
- **Examiner ("Check my Brain").** `apps/api/src/brain-check.ts:79,111,141`.
  - Runs after any teaching edit, with edits within 60 s checked together.
  - Re-runs held-out cases per area (replies, actions, plans, nutrition) and scores them in code.
  - A new version goes live only when it passes; until then the last passing version stays live.
- **Level gate.** Levels 0, 1, 2 and 3 allow 0, 0, 5 and 30 automatic actions (`packages/domain/src/brain-teach.ts:212-236`; `coaching-runtime.ts:759`).
- **Inbox and Today router.** Urgency: safety 0, reply_draft 1, question / chat / support / inquiry 2, plan_draft / followup 3, booking 4 (`apps/api/src/trainer-inbox.ts:61-71`). The "What your Brain did" wording is in `apps/web/components/workspace-live.ts:147-176`.

### 1c. Not part of the Trainer Brain (don't show them as Brain specialists)

- **Kamran:** the marketing-site voice call and onboarding call guide (`apps/api/src/marketing-assistant.ts`, `MARKETING_ASSISTANT_ENABLED` at `:124`).
- **Setup assistant:** `setup_assistant`, the trainer's setup-wizard chat.
- **Music agent:** a platform-wide instrumental library of 240 tracks, already complete (`apps/api/src/music-agent.ts:183`).
- **Trainer photo studio.**

## 2. Orchestration

```
 TEACH (trainer, any time)
 interview/uploads/chat ─► Rule writer ─► draft rules ─► trainer approves
 Quiz master ─► practice quiz ─► trainer answers   own held-out cases ─┐
 Style drafter / Wording suggester ─► confirmed voice style            │
        └──────────────► Examiner "Check my Brain" ◄───────────────────┘
                         passes ─► published Brain (rules + style + actions)
                         fails  ─► last passing version stays live
───────────────────────────────────────────────────────────────────────────
 EVENT: chat msg │ week ends │ plan due │ workout start │ voice reply │ meal photo
   │
 [1] SAFETY FLOOR (code) ──hit──► PAUSED: training hold, fixed notice, no model
   │ clear
 [2] POLICY SCREEN + takeover + consent (code) ──► WAITS (personal review)
   │
 [3] CLIENT MEMORY (code): Twin · member memory · chat excerpt · WHOOP band
   │
 [4] RULE FINDER (code): eligible approved actions · ≤6 cases · rules
   │
 [5] ONE MODEL SPECIALIST: Decision maker | Reply drafter | Plan writer |
     Plan adapter | Meal planner | Nutrition eye | Voice narrator
   │
 [6] VALIDATORS (code): shown IDs only · numbers grounded · bounds ·
     medical/red-flag/never-say screens · inputs unchanged (digests)
   │
 [7] LANE GATE (code) ─► SENDS ON ITS OWN │ WAITS FOR YOU │ PAUSED
   │
 [8] TRAINER TODAY / INBOX (safety first) ─► approve · edit & send · reject
   │ edits/rejections
 [9] LEARNER (brain_correction now, brain_edits weekly) ─► "Make this a rule?"
     ─► trainer confirms ─► background Check my Brain ─► live only if it passes
```

**Chat order** (`apps/api/src/coaching-completion.ts`):
1. `screenForSafety` (:793). A hit opens a hold (:820) and sends the paused notice (:846).
2. Personal review (:823-824), which sends "Your trainer will answer this question personally…" (:848).
3. An active takeover goes to the trainer.
4. Consent, release and intake checks.
5. `memberChatAction` (:904): profile, training and progress reads, with no model call.
6. `tryQualifiedCoaching` (:906), which calls the Decision maker.
7. Otherwise `modelDecision` (:925), the Reply drafter.

It is strictly one step after another, with one model call at most, and it never runs both the Decision maker and the Reply drafter on the same message. The model is called outside the database transaction, and the inputs are rechecked before anything is stored.

**What runs in parallel:**
- Separate events: many members' chats, meal photos, workout starts and voice replies are handled at the same time by the API.
- Background jobs in the worker: `brain_plan`, `nutrition_week`, `brain_check`, `brain_learning`, the weekly edits sweep, voice audio and integration sync (`apps/worker/src/index.ts`, `dispatch.ts`).
- Within one event, the code checks are independent and all must pass, but they run one after another.
- Accurate visuals: many lanes moving at once, and within one decision a quick run of checks lighting up in turn.

**Lane rules:**

| Lane | Product wording | Chat | Plans and weekly changes | Workout (voice, WHOOP) |
|---|---|---|---|---|
| Paused | Member: "Training is paused for your trainer's review. Seek urgent local medical help…". Inbox: "Training paused: a safety report", with "· red flags: …" (`apps/web/components/safety-review-due.tsx:75`) | A floor or policy red-flag hit, or an active hold | A hold skips the plan (`apps/api/src/brain-plans.ts:835-838`). Pain or a limitation skips the model and sends the held week to the trainer (:1506) | "pain" or a red flag stops the session and opens a hold |
| Waits for you | Feed: "Drafted a reply · Waits for you" / "Wrote a plan · Waits for you". Member: "Your trainer will review this coaching request." | Review topic, takeover, no eligible action (draft), selector asks for review, invalid output, fallback model, shadow mode, level 1 | Supervised mode, not qualified, contract changed, untagged equipment, validator errors, confidence below threshold (reason "Confidence X is below your threshold Y") | — |
| Sends on its own | Feed: "Answered … · Sent on its own, within your rules" / "Sent a plan · Delivered on its own" / "Adjusted a plan · From how the week went" | Grounded selection, automatic mode, checked release, no takeover, level 2 or more (`coaching-runtime.ts:1458-1461`) | Automatic, qualified, confident, no safety reasons. A 25% spot check while the Brain is young ("Check a plan your Brain sent") | Bounded code changes within the trainer's rule |

**The learning loop:**
- An edit or rejection queues a `brain_learning` job, which calls `brain_correction`.
- Code checks the suggestion: no new numbers, not too broad, no medical advice, no naming of the software.
- Today shows "Make this a rule?" (`apps/web/components/trainer-today.tsx:215`). Confirming creates an approved rule (origin `reply_correction`) and starts a background check.
- The feed then shows "Learned a rule from you · It uses it from now on".
- Corrections add up to 10 points to the Brain meter.
- "Getting better" (`apps/api/src/brain-progress.ts`) shows the share of drafts approved without edits each week.

## 3. Example traces (all must be labelled Sample · scripted)

**T1. Progression: sends on its own.**
- Basis: trial trainer T1 "Karim", member T1S02 (`tests/chat-trial-fixtures.ts:118-142, 561-588, 1236-1241`).
- Trigger: "All four of my back squat sets were at RIR 2 last session. Can I go up in weight?" (Plan: back squat 3×8 at 60 kg, reps in reserve 2.)
- Safety floor: clear. Policy screen: no topic.
- Rule finder: action "Back squat +2.5 kg" is eligible. The member is intermediate, logged 4 sets at 8 reps × 60 kg with reps in reserve 2 (minimum 2), and 2.5/60 is a 4.2% increase (cap 5%).
- Decision maker (recorded trial reply): "Intermediate lifter completed all 4 back squat working sets at RIR 2, meeting the approved barbell load progression criteria."
- Rule cited: "Barbell load progression".
- Confidence: no number. Shown as "Grounded ✓ · cites your rule".
- Lane: sends on its own. This needs level 2: a passing full check of 20 or more cases.
- Subscriber sees: "Great work. Add 2.5 kg to your back squat next session and keep the same sets and reps. Your next Back Squat prescription is 62.5 kg."
- Trainer sees: Today "Answered [client] · Sent on its own, within your rules". The decision keeps the reason and the cited rule.

**T2. Red flag: paused.**
- Basis: T3S04, a missed trial red flag now held (`docs/features/safety-floor.md` table; `tests/chat-trial-fixtures.ts:1098`).
- Trigger: "I heard a pop in my knee, now it's swollen and it gives way."
- Safety floor: `joint_injury` (a pop with swelling, and "gives way" with a joint named). The hold is stored as `trigger: code_floor`. No model is called.
- Rule cited: the platform safety floor. It cannot be turned off.
- Confidence: none. Lane: paused.
- Subscriber sees: "Training is paused for your trainer's review. Seek urgent local medical help for severe or urgent symptoms."
- Trainer sees: the top of the queue, "Training paused: a safety report · red flags: joint injury", due within 24 h. Plans and voice sessions stay blocked until the trainer resolves the hold. Meal planning continues, because a knee report alone does not stop it.

**T3. Poor WHOOP recovery.**
- Basis: `tests/whoop-training-domain.test.ts:31-42, 198-247`.
- Trigger: the member starts today's workout with recovery 25% (low), HRV 44.1 ms, resting heart rate 61, 8 h of sleep. The reading is fresh, scored and not calibrating.
- Recovery reader (code): the trainer's rule "Low recovery · 0–33%: load −10%, volume −25%" is applied.
  - Squat 3×10 at 40 kg becomes 3×8 at 36 kg; the goblet alternative goes from 20 to 18 kg.
  - Plank 60 s becomes 45 s; the walk goes from 500 m to 380 m.
  - Sets, rests, warm-up and cool-down stay the same.
- Rule cited: the trainer's recovery rule.
- Confidence: none, it is a rule. Lane: applied (the member opted in with "Use recovery for my workouts").
- Subscriber sees: an "Adjusted for your recovery" card showing before → after. The guided session uses the frozen workout.
- Trainer sees: "[client] started a workout · Training with your AI". The weekly adjustment reads the actual, reduced prescription.
- Must be labelled "your rule, applied by code" and "not a medical threshold".

**T4. Meal photo estimate.**
- Basis: the real Seed test on 21 Oct (`CLAUDE_HANDOFF.md:199-203`).
- Trigger: a photo of penne in a creamy sauce with sun-dried tomatoes, black olives and herbs.
- Nutrition eye returned 4 items: penne in a creamy herb sauce ~380 g / ~620 kcal, sun-dried tomatoes, black olives, herb garnish.
  - All items are marked uncertain.
  - There were 4 follow-up questions. Their wording was not recorded, so any example question must be labelled illustrative (the prompt asks about sauces, oils and hidden ingredients).
  - The note says to review before saving. Olive protein was left as null, so totals show as unknown until the member fills it in.
- The run took 26.9 s.
- Rule cited: none. The member can match an item to the coach's ingredient facts (`apps/api/src/meal-capture.ts:493-560`).
- Lane: the member confirms. Nothing enters the diary without that.
- Trainer sees: no inbox card. The confirmed diary feeds the nutrition work. Notes with an eating-related red flag open a nutrition SCOPE_REVIEW.

**T5. Voice-guided moment.**
- Basis: `tests/voice-narration-domain.test.ts:35-53`, `tests/voice-session-domain.test.ts:199-203`, `VOICE_SAFETY_LINE` at `packages/domain/src/voice-session.ts:30`.
- Before the session, the Voice narrator writes all its lines once.
- Code opens with the safety line: "If anything hurts, or you feel dizzy or unwell, say pain or tap Stop…".
- Code: "Exercise 1 of 2: Back squat. 3 sets of 8 reps at 60 kilograms."
- Trainer's cue: "Brace, then sit between your heels."
- Voice narrator: "Last week you squatted 55 kilograms for 8."
- After set 1, Sara says "too heavy". The voice runner applies the trainer's 10% rule: "Next set. 8 reps 54 kilograms." Voice narrator, once per session: "Breathe, reset, we take it step by step."
- Before the last set, the Voice narrator says "Last one, nice and smooth."
- Lane: within the trainer's rule. The reduction rule is off by default.
- Trainer sees: "Sara started a workout"; "Your AI right now" shows sets logged out of sets planned; "Sara finished a workout · Coached by your AI".

**T6. Unsure case: waits for the trainer.**
- Basis: T1S02, chat 4 (`tests/chat-trial-fixtures.ts:587`). The floor keeps it routine (`tests/safety-floor.test.ts:111`). No recorded model reply exists, so the decision step is illustrative and follows the selector contract.
- Trigger: "The plan says deload this week but I feel great. Can I skip the deload and add 5 kg to my squat instead?"
- Rule finder: only "Fatigue: take an easier week" matches ("deload").
- Decision maker: requiresHumanReview = true. The request conflicts with "Deload every fourth week" and the action doesn't answer it.
- Lane: waits for you.
- Subscriber sees: "Your trainer will review this coaching request."
- Trainer sees: "Your Brain drafted a reply", with the member's question, the draft and the reason, and Approve / Edit & send / Reject.

**T7. A correction becomes a new rule.**
- Basis: `tests/brain-check.test.ts:636-660`.
- The Brain's draft said "Add 5 kg next time." The trainer edited it to "Add 2.5 kg to the bench next session." with the note "Upper body goes up 2.5 kg at a time."
- Learner suggests "Upper body increments": when a client completes every set of an upper-body lift, add 2.5 kg to upper-body lifts.
- Code checks pass: no new number (a "5 kg" version would be refused), not too broad, no medical advice.
- Today shows "Make this a rule?". When the trainer confirms, the feed shows "Learned a rule from you · It uses it from now on", "Check my Brain" re-runs, and the new version goes live only if it passes.

**T8. Weekly plan change below the threshold.**
- Basis: illustrative numbers computed with `planConfidence` (weights from `packages/domain/src/brain-plans.ts:1682`).
- Trigger: the week ends. The Plan adapter proposes back squat 60 → 62.5 kg (bound: 10% maximum load jump).
- Signals and score:
  - rule coverage 0.8 (no equipment rule);
  - similar reviewed cases 0.667 (2 approved, 0 edited, 0 rejected);
  - validation 0.8 (one warning);
  - library 1.0;
  - model 0.8;
  - logged evidence 1.0.

  Score: 0.200 + 0.200 + 0.160 + 0.100 + 0.120 = **0.78**, against a threshold of **0.80**.
- Lane: waits for you.
- Reasons shown:
  - "Confidence 0.78 is below your threshold 0.80"
  - "Your confirmed rules and cases do not yet cover: equipment"
  - "Few reviewed plans for similar clients (2 approved, 0 edited, 0 rejected)"
- Trainer sees: "Your Brain suggests a plan change".
- Variant: with 3 approved similar cases and no warning, the score is 0.94, so it is sent on its own and the feed shows "Adjusted a plan · From how the week went".

## 4. Honest status, with evidence

| Piece | Status | Evidence |
|---|---|---|
| Safety floor, policy screen, rule finder, validators, Client Twin, level gate, Check my Brain, learners, Inbox/Today | **Live** (shipped, used by trainers today, including "Try my AI") | Code in `3d6b9bd`; Today `docs/features/trainer-workspace.md:98`; `brain-check.ts:141`; `brain-learning.ts:55` |
| Interviewer, Rule writer, Quiz master, Style drafter, Wording suggester, "Compare my replies" | **Live** (trainer side) | `docs/features/onboarding-chat.md:7`; `app.ts:1420`; `brain-teach.ts:279`; `docs/features/brain-fidelity.md:5` |
| Live AI model | **Live** (Seed 2.0 Pro; public wording "frontier model") | `CLAUDE_HANDOFF.md:197,209`; `onboarding.ts:278,722` |
| Decision maker (sending on its own), Reply drafter, Plan writer, Plan adapter | **Shipped. Not on yet for real subscribers** (publishing blocked by the payments gate). Sending on its own also needs level 2+ or a qualified plan | `onboarding.ts:588,714,1022`; `docs/PROJECT_MEMORY.md:34`; `coaching-runtime.ts:759,1458` |
| Nutrition eye | **Switched on 21 Oct.** Subscribers not yet: needs a workout + nutrition membership and consents | `CLAUDE_HANDOFF.md:205-212`; `meal-capture.ts:373-378,407` |
| Meal planner | **Behind a flag** (`NUTRITION_ENABLED`, `NUTRITION_SCOPE_APPROVED`; repo has no record of their live value) and the trainer's sample week | `entitlements.ts:45`; `nutrition.ts:441` |
| Recovery reader (WHOOP) | **Shipped (PR #71). Behind `WHOOP_TRAINING_APPROVED`** (live value not recorded), the trainer's rule (off by default) and member opt-in | `whoop-training.ts:33`; `packages/domain/src/whoop-training.ts:13`; `docs/WHOOP_TRAINING_2026-10-17.md:33` |
| Voice narrator and runner in the trainer's voice | **Shipped. Not on yet for subscribers** (paid voice add-on and a verified trainer voice) | `docs/features/voice-session.md:117-121`; `onboarding.ts:626` |
| Not on yet / gaps | Subscriber payments and publishing; voice "Trainer mix" music; opening a hold when a nutrition check-in is saved; nutrition exceptions are not in the unified Inbox (`trainer-inbox.ts` has no `nutrition_exception`); no measured fidelity percentage (`docs/features/brain-fidelity.md:27`) | as cited |

**Rules for the showcase:**
- Use the product's own lane words: "Sent on its own, within your rules", "Waits for you", "Training paused".
- Show numeric confidence only on plans and weekly changes. Show chat as "grounded in rule R…".
- Show one model call per decision, with code checks before and after.
- Label WHOOP and the voice runner as code following the trainer's rules, not AI.
- Never name the model or vendor.
- Put "Not on yet" on anything that needs subscriber payments.