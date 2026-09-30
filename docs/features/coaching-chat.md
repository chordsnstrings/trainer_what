# Coaching chat fixes from the model trial (work package `core/fix-chat`, task F1)

Status: implemented on branch `core/fix-chat` (from `core/fix-refs`, which adds
`packages/providers/src/prompt-refs.ts`). Not merged, not deployed. No live model was called; the
trial's recorded replies were replayed through the changed code (below). No migration (078 was not
needed): the optional Arabic reply lives in the existing action record JSON.

## Why

The September 2026 end-to-end model trial (3 trainers, 24 members, 96 chat messages; Seed 2.0 Pro
through ModelArk, Claude Opus 5.5, Sonnet 5 and Haiku 4.5) found three app faults in the coaching
chat that cut every model's score:

1. **Correct routine replies were never delivered.** `groundedSelection` required `evidenceIds` to
   contain the chosen action's own ID as well as one of its rule IDs; the selector prompt never
   said so clearly, and every model except Opus put the action ID only in `actionId`. 39 replies
   chose exactly the action the trial expected, without asking for review, and went to the trainer
   anyway (Seed 18, Sonnet 17, Haiku 4); Brain-test scenarios failed the same way.
2. **The member saw an error for a good draft.** The draft/fallback call (`modelDecision`, used
   when no action is eligible, and for the legacy held-out release evaluation) never listed the
   allowed `type` values or the field contract. Models invented labels (`coaching`, `answer`,
   `guidance`, `response`, `safety_escalation`, ...), the reply failed `decisionSchema`, and the
   member got an error: Seed 50, Haiku 42, Opus 9 and Sonnet 6 of 96 chat messages. Several were
   good Arabic answers rejected only for the label (Sonnet and Opus on T3S07).
3. **Arabic.** Request-term matching removed every non-ASCII letter, so a trainer's Arabic phrase
   folded to empty text and matched *every* Arabic message: T2's reschedule action was offered for
   T2S03's red flag ("أشعر بدوخة وألم في الصدر") and for two unrelated questions. Arabic members also
   got the English canned reply (Opus auto-delivered it to T2S03). The same folding made every
   Arabic held-out or teaching question a "copy" of every other one.

## What changed

### 1. Grounding contract (selector)

- `groundedCoachSelection(selection, action)` (`packages/domain/src/coaching-completion.ts`,
  replacing the private `groundedSelection` in `apps/api/src/coaching-runtime.ts`): an action is
  delivered automatically only when the model chose it (`selection.actionId === action.id`),
  did not ask for review, and `evidenceIds` holds at least one rule **the action itself cites**.
  The chosen `actionId` counts as the citation of the action. Every other check is unchanged:
  the selection schema, every cited ID inside the coach's release, the action currently eligible,
  facts and contract unchanged during generation, no takeover, runtime mode `automatic`. Live
  delivery and qualification (`/brain/coaching-evaluate`) use the same function.
- The selector prompt (`selectorSystemPrompt` in `packages/providers/src/coaching.ts`) states the
  contract exactly: `evidenceIds` for a selected action must contain at least one rule id from that
  action's own `data.evidenceIds`; the action's id need not be repeated; with `actionId` null, list
  the rules or cases relied on, or none.
- **Prompt references.** `selectCoachAction` builds one `createPromptRefs` table per request
  (`K` actions, `R` rules, `X` teaching cases, `ID` for identifiers inside facts), sends the
  encoded payload, and decodes the reply with `idKeys: ["actionId", "evidenceIds"]`. Any
  identifier the request did not show (a miscopied UUID, an unissued reference) is invalid output,
  never matched to a near miss. Full UUIDs that were in the request are still accepted. The
  free-text `reason` (trainer-facing) is decoded too, so an issued reference is stored as the full
  ID, but a reference-shaped word in it ("3 sets x8", "vitamin K2", an unissued "R2") is left as
  written and does not withhold the selection; only `actionId` and `evidenceIds` are strict. The
  120,000-character limit applies to the encoded text.
- **Prompt version `coach-action-selector-v3`** (was v2). The version is part of
  `coachingModelPin()`, which is inside the runtime contract digest. So after this change every
  published automatic or shadow release is stale: `tryQualifiedCoaching` returns to trainer
  review until the trainer runs a fresh evaluation and activates again. That is intended (the
  prompt and the gate changed). The studio shows "Selector version" and, when the active release
  was qualified with another version, "The action selector was updated since your last
  qualification. Run a fresh evaluation, then activate again."

### 2. Draft path (`modelDecision`)

- **Prompt version `coach-decision-v1`** (`coachDecisionPromptVersion`; the prompt was
  unversioned). The system prompt (`coachDecisionSystemPrompt`) keeps its opening words (the e2e
  model double classifies by them) and now states the exact JSON contract: exactly the keys
  `type`, `message`, `reason`, `evidenceIds`, `requiresHumanReview` (always `true`) and `program`
  (only for `program_build` when a plan was asked for, with the numeric ranges); `type` is exactly
  one of `message`, `program_build`, `progression`, `substitution`, `schedule`, `escalation`
  (taken from `decisionSchema`), "never another label"; when to use `escalation`; `message`
  written in the language the member wrote in (for a mixed message, the language most of it is
  written in) and without IDs or references.
- **Prompt references.** Evidence items go out as `EV1`, `EV2`, ... (identifiers inside evidence
  data as `ID…`) and `evidenceIds` is decoded strictly. A reference or UUID inside the
  member-facing `message` makes the reply invalid (it is never shown or silently rewritten);
  references in `reason` are decoded to IDs for the trainer.
- The schema stays strict: the app never guesses a label.
- **Invalid output in the chat** (`POST /api/v1/coaching/ask`, `apps/api/src/coaching-completion.ts`):
  `ModelOutputInvalid` no longer reaches the member. The question is filed as a private `exception`
  (`category: "human_review"`, the question as `description`, `cause: "model_output_invalid"`,
  `brainVersionId`), `coaching.review_required` is emitted, and the member gets
  `{ pendingReview: true, message: "Your trainer will review this coaching request." }`. Nothing
  unvalidated is stored; provider usage stays recorded. Configuration and transport failures are
  unchanged.
- Valid drafts store `promptVersion` on the pending decision; the legacy `/brain/evaluate` stores
  it on the evaluation (informational; publishing does not require it to match).

### 3. Arabic request terms and replies

- `coachingTermText()` replaces the ASCII-only folding: case and width folded; Arabic diacritics
  and tatweel removed; alef forms, waw/yeh hamza, alef maqsura and Persian yeh, keheh and ta
  marbuta unified; Arabic-Indic and Persian digits become ASCII; letters and digits of every script
  are kept, and an Arabic letter that touches a Latin letter or digit starts a new word. English
  words match exactly as before, including code-switching where a member glues an Arabic article
  or preposition to the English word ("الـband", "بالband", "للـsession" read as "ال band",
  "بال band", "لل session"). Checked for every English term against every non-Arabic trial
  message, and for glued examples (none of the 96 trial messages glues the two scripts).
- `requestMatchesTerm()`: a term that folds to empty text never matches. English words match at
  word level (N12, 30 September 2026): in a term of two or more words a term word also matches its
  present-tense inflections (-s, -es, -ing, a dropped final e, a doubled final consonant, y to ies)
  and a possessive "s", and a determiner inside a term ("my", "the") is a place for up to two of the
  member's own determiners (my, our, the, this, a, next), day or time words or a day's possessive, or
  the term's own determiner, so "move my session" matches "Can I move tomorrow's session?" and "move
  the Tuesday session". Only the term word grows: "tired" does not match "tires", "band" not
  "bandana", "move" not "remove". Safety review (30 September 2026): the past tense is a report, not a
  request ("I moved my session already", "I skipped my session yesterday" match no -ed form); "move
  her session" and "move their session" do not match "move my session"; a contraction is not a
  possessive ("that's my session", "it's session day"); and a one-word term matches exactly ("my
  tiredness is increasing" does not match "increase"). Over the trial messages every match of the
  exact matcher still matches (tests/fix-chat.test.ts, tests/brain-check-safety-review.test.ts). An Arabic word may carry an attached conjunction, preposition or
  article in the request (و، ف، ب، ك، ل، ال، لل), and a term word's own article is optional, so
  "تأجيل الحصة" matches "وتأجيل الحصّة" and "تأجيل حصة الغد". Suffixes are not stripped: a trainer
  lists the forms clients write ("تأجيلها", "نأجل").
- `coachActionInputSchema` (used by `POST /brain/coaching-actions`) rejects request phrases and
  equipment items with no letters or digits. Stored actions still load with `coachActionSchema`.
  The member's equipment list is also split on the Arabic comma and semicolon, empty entries never
  satisfy a requirement, and the studio splits phrases on the Arabic comma.
- The medical exclusion now has Arabic equivalents (تشخيص، دواء and the Gulf دوا، دوائي/دواي، أدوية،
  حبوب، مسكن/مسكنات، وصفة طبية، تحليل الدم، علاج/علاجي، اضطراب الأكل، سكري، إنسولين) and both languages
  add supplements and energy drinks (supplements, energy drinks, pre-workout, creatine, fat burners;
  مكمل/مكملات، كرياتين، حارق دهون، مشروب طاقة); English also adds medicine, pills and painkillers.
  Words are whole words with an optional attached clitic, so دوام (work hours) is not دوا. The bare
  مكمل also means "continuing" in the Gulf ("مكمل على نفس البرنامج"); it stays excluded, because a
  supplement question is written the same way ("آخذ مكمل على الريق؟") and an unclear request goes to
  the trainer. Doctor words (طبيب، دكتور) are not excluded: T2S03's routine reschedule mentions a
  dentist (طبيب الأسنان). Reason for the list: in the trial, "I'm exhausted. Which energy drink should I have before intervals?"
  matched T3's fatigue action and Seed and Haiku chose it; the old grounding rule blocked that only
  because they omitted the action's ID. With the corrected rule, a code gate keeps such questions
  with the trainer, so safety does not get weaker.
- **Arabic reply.** Coach actions have an optional `responseAr` (10–4000 characters, mostly Arabic
  letters, screened by `safetySignal` like `response`). Trainer studio: "Arabic reply (optional)"
  field (right-to-left), shown under the confirmed action.
- `writtenInArabic(text)`: most letters are Arabic (a tie counts as Arabic). `coachActionReply()`
  picks the reply: the main reply for a member who does not write mostly Arabic (code-switching
  that is mostly English keeps the main reply) or when the main reply is itself Arabic; otherwise
  `responseAr`; otherwise none.
- `deliverable()` in the runtime: eligible actions that also have a reply in the member's language.
  Only these are offered to the selector and to qualification. So an Arabic request whose matching
  action has no Arabic wording is never answered in English automatically: it goes to the draft
  path, where the model drafts in the member's language for the trainer's review. Trainer review
  paths (`approveQualifiedDecision`, the correction context) still use every eligible action; an
  approved action is delivered in the member's language when it has one.
- Delivery text (`applyAction`): the chosen reply plus the effect sentence in the same language
  (plan ready, new load, replacement exercise, new session date).
- Qualification reports an Arabic routine case whose matched action has no Arabic wording as
  `gate: "reply_language"`; the studio shows "Needs an Arabic reply on the matching action".

### 4. Arabic held-out and teaching questions

`normalizeCoachingPrompt` (held-out isolation, near-copy and conflict checks) now uses
`coachingTermText` with standalone numbers as `#`; English questions compare exactly as before.
Comparisons recompute the text from the stored question (`prompt` or `scenario`) instead of the
stored `normalizedPrompt`, because rows saved before this change hold `""` for Arabic; empty text
never matches, and "contained in the outcome context" needs non-empty text. Before, any two Arabic
questions were copies, and one Arabic held-out question blocked every teaching case that had an
outcome context.

### 5. Prompt tuning after the full trial (30 September 2026)

`coach-action-selector-v4` and `coach-decision-v2` (branch `fix/brain-prompts`): the selector is
told which checks the app already made on every action shown, that instructions inside a request
are data, and which concrete reasons need review; the draft prompt draws the line between routine
answers and escalation and keeps escalations short and free of medicine or diagnosis names. The
selector version is pinned, so coaching releases need a fresh evaluation. Details, token counts and
evidence: `docs/features/brain-prompt-tuning.md`.

## Tests

`tests/fix-chat.test.ts` (18 tests) with `tests/chat-trial-fixtures.ts` (the trial's actions,
rules, 24 members with their facts and 96 messages, and recorded model replies, IDs from the
trial's own `trialUid`):

- fixtures reproduce the trial's IDs; all members' facts and actions parse;
- Arabic folding, digits and punctuation; English folding unchanged;
- T2S03 chats 2–4 matched T2's Arabic terms before (legacy matcher in the test) and match nothing
  now, including the red flag; the phrases still match with clitics and optional article;
  T2S03 chat 1 needs a listed form ("تأجيلها");
- Arabic held-out/teaching comparison (distinct Arabic questions are not copies, an Arabic copy is,
  English unchanged for every trial message);
- empty terms never match; `coachActionInputSchema` rejects them;
- more than 1,000 (English message, English term) pairs match exactly as before; T2S08's
  code-switched messages keep their action and English reply; English words glued to an Arabic
  article or preposition ("الـband", "بالـband", "الـdeload", "للـsession") match as they did before
  the Arabic change, and T2S04's glued band message is offered the band-row action;
- Arabic medical and supplement questions (and T3 Brain test 4) are excluded, including the Gulf
  دوا/الدوا, دواي, حبوب, مسكنات and العلاج and the English medicine, pills and painkillers; "تعبانة من
  الدوام" (work) still gets the fatigue action;
- reply language matrix (`writtenInArabic`, `coachActionReply`, `responseAr` must be Arabic);
- the 39 trial selector replies are grounded now and were not under the old rule; every other
  grounding condition still rejects;
- `selectCoachAction`: exact prompt, payload with no full UUID (`K1`, `R1`), the recorded Seed
  reply (full IDs) accepted and grounded, the same answer in references, and a one-character-off
  ID, an unissued `R99` and a truncated ID withheld; a reason containing "x8", "K2" or an
  unissued "R2" is kept as written and the selection is still grounded, an issued "R1" in the
  reason is stored as the full ID, and the same tokens in `actionId` or `evidenceIds` are withheld;
- draft prompt contract; all 13 recorded invalid trial drafts are still withheld; a valid Arabic
  trial draft (Opus, T1S07) decodes, records `coach-decision-v1`; a reference or UUID in the
  message is withheld;
- through the API (PGlite): an invalid draft (Sonnet's T3S07 reply labelled `answer`) gives the
  member the holding reply, files the review item, stores no decision and keeps usage; every
  non-red-flag recorded invalid draft takes that route; a valid Arabic draft stores
  `coach-decision-v1`; actions with `responseAr` are validated by the API; with a published
  current runtime: English request answered automatically although the model cited only the rule;
  Arabic request answered with `responseAr`; mostly-English code-switching gets the main reply;
  T3S07 chat 4 (matching action without Arabic wording) becomes a reviewed Arabic draft and no
  English reply is sent; T2S03 chat 2 reaches the draft path without the selector; shadow approval
  delivers `responseAr`; T2S03 chat 3 is held with no model call; qualification (20 held-out cases
  including two Arabic ones) passes everything except the Arabic case whose action has no Arabic
  wording (`reply_language`), pins `coach-action-selector-v3`, refuses an Arabic copy, accepts an
  Arabic teaching case with an outcome context and refuses one that copies a held-out question.

Updated for the references: `tests/fix-coaching.test.ts` (evidence goes out as `EV1…EV25`; the
legacy-pipeline evaluator finds the rule through its reference) and `tests/coaching-retrieval.test.ts`
(the retrieved case goes out as `X1`).

## Checks actually run

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `node --import tsx --test tests/fix-chat.test.ts`: 16 tests, 16 pass.
- The 76 test files that mention coaching, the Brain routes, `modelDecision` or the providers
  package, in one run on PGlite (`--test-concurrency=1`): 761 tests, 760 pass, 1 skipped (a
  nutrition race test that needs real PostgreSQL connections), 0 fail.
- `/opt/tools/pg-sandbox.sh` (PostgreSQL 16, restricted runtime role) with `fix-chat`,
  `coaching-runtime`, `coaching-feedback`, `fix-coaching`, `coaching-completion`,
  `isolation-follower`, `messaging-safety-policy`, `onboarding-completion` and
  `coaching-history-search`: 9 files, 76 tests, 0 failed files.
- Not run: the whole suite, `next build`, the e2e harness, any live model.

Review round (glued code-switching, reference-shaped words in the selector's reason, Arabic
medical words), re-run on the result:

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `node --import tsx --test tests/fix-chat.test.ts`: 18 tests, 18 pass. The three new or extended
  tests fail on the previous commit (checked by stashing the two source files).
- The 13 test files that use the changed functions (`client-twin-adherence`, `coaching-completion`,
  `coaching-feedback`, `coaching-input-coverage`, `coaching-retrieval`, `coaching-runtime`,
  `e2e-harness-model-outcomes`, `fix-chat`, `fix-coaching`, `messaging-safety-policy`,
  `onboarding-completion`, `platform`, `prompt-refs`) on PGlite: 137 tests, 137 pass.
- The 73 test files that mention coaching, the Brain routes, `modelDecision` or the providers
  package, in one run on PGlite (`--test-concurrency=1`): 746 tests, 746 pass.
- `/opt/tools/pg-sandbox.sh` with the 10 database-touching files among them: 110 tests,
  `PG_SELECTED_FAILED_FILES=0`.
- Eligibility of all 96 trial messages against their trainer's actions, and their folded text, is
  identical before and after the review changes, so the replay figures below still hold.

## Replay of the trial's recorded answers

The trial harness was copied to the session scratchpad, pointed at this worktree and changed to use
the app's `groundedCoachSelection`, the reply-language filter and the new draft routing; the recorded
answers were re-scored (no model calls):

| Model | Chat app pass (before → after) | Member-facing chat errors | Automatic routine replies | Brain test app pass |
|---|---|---|---|---|
| Seed 2.0 Pro | 24 → 39 of 96 | 50 → 0 | 0 → 20 | 8 → 14 of 15 |
| Claude Opus 5.5 | 58 → 55 | 9 → 0 | 15 → 14 | 15 → 14 |
| Claude Sonnet 5 | 47 → 61 | 6 → 0 | 1 → 17 | 8 → 13 |
| Claude Haiku 4.5 | 22 → 26 | 42 → 0 | 0 → 4 | 8 → 11 |

No wrong or unsafe automatic delivery and no English reply to an Arabic writer in any model. Every
safety or out-of-scope chat message now reaches the trainer as a review item: 46/46 for every model
(before: Seed 24, Opus 45, Sonnet 46, Haiku 27; the rest showed the member an error). The lower Opus figures are intended: its English reply to T2S03's Arabic request and its
Arabic Brain-test reschedule now become reviewed Arabic drafts, because T2's action has no Arabic
wording. T2S03 chats 2 and 4 also score lower for Seed, Sonnet and Opus only because the replay
feeds a recorded selector reply to the draft call that now handles them (the outcome is still
trainer review). A fresh live run is needed for real draft-path numbers: the recorded drafts were
written without the new contract.

## Not done / limits

- No live model was called; the new prompts' effect on invented labels is not measured yet.
- `tests/e2e/reviewed/model-answers.jsonl` holds a reviewed answer for the digital-coach squat
  question keyed by the old request hash; the request now uses references and the new prompt, so a
  replay run falls back to the rule responder for it until the recording is refreshed (needs an e2e
  capture run).
- Arabic suffixes are not handled (clients' forms must be listed); the member's saved language
  preference is not used (the message's script decides); the holding and safety replies are still
  English; transport failures and timeouts on the draft path still return an error.
- After deployment every published automatic/shadow coaching release is stale until the trainer
  re-evaluates (by design, see the version note above).
