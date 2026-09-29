# Short identifier references in model requests (work package `core/fix-refs`, task F0)

Status: helper implemented on branch `core/fix-refs` (`packages/providers/src/prompt-refs.ts`,
re-exported from `@trainer/providers`). It is **not yet wired into any model call** on that branch:
the call-site tracks do that. No model, provider or live server was used.

Wired on branch `core/fix-chat` (task F1, `docs/features/coaching-chat.md`):

| Call | Kinds (prefix: identifiers) | `idKeys` | Prompt version |
| --- | --- | --- | --- |
| `selectCoachAction` | `K`: actions, `R`: rules, `X`: teaching cases; `ID` for identifiers inside facts | `actionId`, `evidenceIds` | `coach-action-selector-v3` |
| `modelDecision` | `EV`: evidence items; `ID` for identifiers inside evidence data | `evidenceIds` (a reference or UUID in the member-facing `message` is invalid output) | `coach-decision-v1` |

## Why

The September 2026 model trial (3 trainers, 24 subscribers, 13 AI workflows) sent full 36-character
UUIDs to the model and required them back. In the final Seed 2.0 Pro run, 22 of 224 replies
carried at least one miscopied identifier, so correct answers failed the app's checks:

- 19 replies had a malformed copy (a dropped, added or truncated character), rejected by the
  schemas' `uuid()` check: 8 `meal_week` replies (all eight T1 members, the same case ID in
  `caseIds`), 7 coaching chat replies (`evidenceIds`), 2 plans (T2S06, T3S03 `evidenceIds`), and
  T1's `nutrition_eval` (`caseIds`, `rationaleEvidence.caseId`) and `nutrition_policy`
  (`policy.sourceIds`). An earlier run also hit T1S07's plan adaptation.
- 3 replies cited a well-formed UUID one character away from the real one (T2S02 plan, T2S05 and
  T1S03 chat), rejected as evidence outside the release.
- Claude Opus 5.5's T1S07 plan also failed with `evidenceIds.3 Invalid UUID`.

A reference such as `R3` is short enough to copy exactly. The trial pairs (miscopy and the real
ID it stood for, with the output field) are the regression fixtures in
`tests/prompt-refs.test.ts`.

## What the helper does

`createPromptRefs(payload, options)` builds the table for **one** model request:

- It takes the payload's JSON form (what `JSON.stringify` sends: `toJSON`, dates, dropped
  `undefined`) and replaces every UUID with a reference: whole values, object keys and UUIDs
  inside text (`"see rule 2432edf0-…"` becomes `"see rule R1"`). One identifier gets one
  reference wherever it appears; letter case does not matter.
- Numbering is deterministic: identifiers listed in `options.kinds` first, in list order, then the
  rest in the order a depth-first walk meets them (keys in insertion order, each key before its
  value, arrays by index). Numbers count per prefix from 1. Only identifiers that occur in the
  payload get a reference, so the model cannot cite something it was not shown.
- The prefix comes from the listed kind, else `options.prefixAt(path, id)` (the path where the
  identifier was first met), else `options.defaultPrefix` (`"ID"`). Prefixes are one to four
  upper-case letters.
- A reference that already appears as text in the payload (a member writing "R1") is never
  issued: numbering skips it, and decoding leaves that text alone.
- Before returning, it decodes its own encoded payload and requires the original back with no
  issues. If that fails it throws `PROMPT_REFS_UNSAFE` (status 409) and nothing may be sent.

`refs.decode(output, { idKeys, inText })` maps the model's answer back:

- Issued references (any letter case) and the original full UUIDs (any letter case) become the
  original IDs: single strings, lists, nested objects, object keys and text inside strings.
- Fields named in `idKeys` (at any depth) are strict: the value is trimmed and must resolve; a list
  is resolved element by element; `null` stays `null`; anything else is an issue.
- Nothing is guessed. Every identifier the output names that this request did not show is
  reported in `issues` (with its path) and `unknown`, and left exactly as written, so the app's
  own schema and evidence checks reject it too. Reasons: `unknown_ref` (a known prefix, never
  issued), `unknown_uuid` (well-formed, not in the request: the one-character-off case),
  `malformed_uuid` (UUID-like but invalid: 24 to 40 hex digits in 4 to 6 dash-separated groups,
  including a letter), `not_a_reference` (an `idKeys` value that is neither), `duplicate_key`
  (two keys decode to one; the first is kept).
- `inText: false` leaves longer text exactly as written (for text shown to a subscriber) and only
  decodes strings that are one reference or UUID.
- Decoding builds new objects with own properties only (`__proto__` in model JSON cannot touch a
  prototype).

Other members: `refs.payload` (send this), `resolve(token)`, `resolveAll(tokens)`, `refOf(id)`,
`entries()` (ref, id, prefix in numbering order), `size`, and the exported sentence
`promptRefsInstruction` for system prompts.

## How a call site must use it

1. **One table per request, over everything the model sees.** Build it right before the call from
   the complete user payload (for example `{ task, request, facts, examples, rules, actions }`),
   send `JSON.stringify(refs.payload)`, and apply size limits to that string (it is shorter than
   the original). Never reuse a table across requests, and never store references: persist full
   IDs only. If a trace needs the mapping, store `refs.entries()` next to the request digest.
2. **Choose prefixes by kind.** List the identifiers the model may cite as `kinds` (clear numbering)
   or use `prefixAt` from the payload path. Prefer letters outside A–F, for example `R` rules,
   `S` teaching sources, `T` templates, `M` recipes, `K` coach actions, `X` teaching cases or
   examples; `ID` for everything else. A–F work, but a payload where such a reference would sit
   inside a long dash-separated hex run is refused as `PROMPT_REFS_UNSAFE`.
3. **Change the system prompt and its version.** Replace "UUID" wording with references ("cite the
   R… references of the rules you followed"), add `promptRefsInstruction`, and bump the prompt
   version (`coach-action-selector`, `brain-plan-v2`, `brain-plan-adapt-v1`,
   `nutrition-cases-v2`, rule compilation), because qualifications and evaluations pin the prompt
   version.
4. **Decode before validating, and reject on any issue.** Parse the reply, then
   `const decoded = refs.decode(parsed, { idKeys })`. If `!decoded.ok`, treat the reply as invalid
   model output (`ModelOutputInvalid`, or an `errors` entry such as
   `Model output: evidenceIds.2 malformed_uuid`) and route it to the trainer as today. Never drop
   the unknown entries and continue. Then run the existing schema and evidence checks, unchanged,
   on `decoded.value`.
5. **Name the identifier fields.** Current outputs:

   | Call | `idKeys` |
   | --- | --- |
   | `selectCoachAction` | `actionId`, `evidenceIds` |
   | `modelDecision` | `evidenceIds` |
   | `generateTrainingPlan`, `proposePlanAdaptation` | `evidenceIds` |
   | `compileTrainerRules` | `sourceIds` |
   | `nutritionModel` tasks | the identifier fields of the task's schema: `recipeId`, `recipeIds`, `foodId`, `caseIds`, `caseId`, `sourceIds`, `scenarioId`, `expectedCaseId` |

6. **Keep references away from subscribers.** Text a subscriber sees (for example
   `modelDecision`'s `message`) should be decoded with `inText: false` or not at all; each call
   site decides whether a reference in such text is rejected, removed or sent to review. Never
   show raw references or UUIDs to a subscriber.
7. **Fakes and mocks.** The e2e mock rules (`tests/e2e/mocks/model-rules.ts`) echo the `id` fields
   they are given, so they will answer in references and decode correctly. Recorded mock requests
   are normalised by UUID (`tests/e2e/mocks/model-normalize.ts`); once a call site encodes its
   payload, its canonical request changes and any recording for it must be refreshed.

## Tests

`tests/prompt-refs.test.ts` (21 tests):

- encoding of whole values, keys and text; glued text (`x2432…`) left alone; no full UUID left in
  realistic coaching, plan, nutrition and rule-compilation payloads, each shorter than before;
- deterministic numbering (kinds first, walk order, per prefix, `prefixAt` paths, listed IDs
  absent from the payload get no reference);
- decoding single refs, lists, nested objects, keys and text; case, whitespace and full UUIDs;
- unknown references, unknown and malformed UUIDs reported with paths and left unchanged;
  strict `idKeys`; `inText: false`; references already present as text;
- exact round trips of the realistic payloads (including Arabic text) and a seeded 400-payload
  property test: every payload round-trips exactly with non-hex prefixes, and with a hex prefix
  either round-trips or is refused (15 of 400 refused, all chains of dash-joined UUIDs);
- decoded replies parse with the app's own schemas: the coach selection schema and evidence and
  action checks, `decisionSchema`, `planDraftSchema` (citing only retrieved material),
  `nutritionWeekSchema` and `ruleSchema`;
- trial regressions: for each of 11 trial cases with a malformed copy (7 distinct copies) and 3
  with a one-character-off copy, the real ID is
  sent as a reference that decodes back (and the full ID is still accepted), while the trial's
  copy, in its original field, is reported (`malformed_uuid` or `unknown_uuid`) and never matched
  to the nearest real ID; a meal week whose `caseIds` held the trial copy fails
  `nutritionWeekSchema`, the reference version passes;
- invalid options, the `PROMPT_REFS_UNSAFE` refusal (including keys naming one UUID in two letter
  cases), prototype safety and duplicate keys, and the package re-export.

Mutation check: skipping the literal-reference rule, disabling malformed detection, making
reference lookup case-sensitive, removing the round-trip self-check, not flagging unknown
references, not trimming whitespace, or resolving an unknown UUID to a table entry (a guess) each
makes 2 or 3 of the 21 tests fail (then restored).

## Checks actually run

- `npx tsc --noEmit` (whole tree) and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass
  (run again after formatting the new files with Prettier).
- `node --import tsx --test tests/prompt-refs.test.ts`: 21 tests, 21 pass (after formatting).
- The 45 test files that import the providers package (whose index now re-exports the helper),
  `node --import tsx --test --test-concurrency=1`, on PGlite: 496 tests, 496 pass. This run
  started before the two new files were formatted; formatting changed layout only.
- Not run: the PostgreSQL sandbox (nothing that reaches the database changed), the whole suite,
  `next build`, the e2e harness. No model was called.

## Limits

- A UUID glued to a letter or digit (`x2432…`) is not treated as an identifier and is sent as is.
- References are exact apart from letter case and surrounding whitespace: `R01`, `R-1`, `[R1]`
  or non-ASCII digits are not accepted in `idKeys` fields.
- With `inText` on, a token in the model's prose that equals an issued reference (for example
  `M2` meaning something else) is replaced by that ID. Call sites decode prose only where that
  is acceptable (see step 6).
- Malformed-UUID detection is a heuristic (length, grouping, a hex letter); a damaged copy with
  fewer than four groups is not reported by the text scan, but an `idKeys` field still rejects it
  as `not_a_reference`.
