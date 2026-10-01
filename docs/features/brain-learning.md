# A Brain that learns: the remaining self-learning (round 5)

Builds on round 4's teaching loop (`docs/features/brain-check.md`, `docs/features/brain-teach.md`)
and closes the gaps listed in section 2 of the round 5 plan. Learning is data in the database,
never model weights, so it survives any model switch. Backend plus one coach-only panel.

Code: `packages/domain/src/member-memory.ts` and `apps/api/src/member-memory.ts` (member memory),
`apps/api/src/brain-plans.ts` (learning snapshots), `packages/domain/src/brain-edits.ts`,
`packages/providers/src/brain-edits.ts` and `apps/api/src/brain-edits.ts` (weekly edits, retention,
privacy hooks, weekly sweep), `apps/api/src/brain-progress.ts` and
`apps/web/components/brain-progress.tsx` ("Getting better"). Tests: `tests/brain-learning-loop.test.ts`.

## Safety floor (unchanged)

- Validators, bounds, the medical-advice blocks, the safety policy and the automatic-sending checks
  are unchanged. Learning never changes bounds, validator, confidence or prompt versions, tool
  authority or data-use rights (a test compares `planModelPin()` and the bounds before and after).
- Nothing new reaches members without the coach: suggestions are never rules until the coach
  confirms them, and new plan learning goes live only through a passing background check.
- Learned and model-written text is data in its own JSON field; prompts say it is never
  instructions. No model or vendor name appears in coach, member or public text.

## Per-member memory (code only, no model tokens)

`buildMemberMemory()` (version `member-memory-v1`) summarises the member's own records: planned and
completed sessions by weekday (8 weeks), usual working loads (median top set per day, 90 days, at
least 2 days), exercises often skipped (planned in a completed session, nothing logged, 2+ times)
or swapped (2+ times), the stated days per week and equipment items.

- Only names the coach prescribed (planned sessions, the assigned programme and their
  alternatives) are kept; a member-typed exercise name is dropped. No free text the member wrote
  (notes, substitution reasons, limitations) is ever copied, so health stays with the coach.
- Built only while the latest intake allows model use: withdrawing coaching consent removes it at
  once. Nothing is stored, so erasing the member's records erases it (the copy in a plan
  generation's inputs is the member's own record and is erased with them).
- Used in plan generation (`brain-plan-v5`) and weekly adjustments (`brain-plan-adapt-v4`) as the
  `memberMemory` field, and in chat drafts inside the intake evidence (`memberMemory`); chat drafts
  always wait for the coach. The automatic routine-reply selector does not use it.
- `GET /api/v1/brain/members/:id/memory` (owner, staff): `{memory}` (null when there is none or
  consent was withdrawn); 404 for a member of another workspace.

## Plan learning goes live only after a check (learning snapshots)

Before: reviewed plan examples (`plan_learning`) reached automatically delivered plans without any
evaluation, because the plan contract did not include them.

- A `plan_learning_snapshot` record lists the reviewed examples (id and version) a plan
  qualification was run with. Statuses: `candidate`, `published`, `check_failed`, `archived`,
  `privacy_archived`.
- The plan contract digest now includes the published snapshot's id (`learning`); a workspace with
  no snapshot keeps its earlier digest, so existing qualifications stay valid.
- Which examples a plan uses (`learningInUse`): with a passing qualification, only the published
  snapshot's examples (before any snapshot: the examples that existed when the qualification
  passed); while every plan waits for the coach, all confirmed examples. Each generation stores
  `learning {mode: checked|legacy|all, snapshotId, count}`.
- A plan is delivered automatically only when it was prepared under exactly the qualified contract
  (`gen.contractDigest === qualification.contractDigest`); otherwise it goes to the coach with the
  reason "prepared with Brain material ... that has not passed its check yet".
- Every qualification without a candidate Brain release (`POST /brain/plans/qualify`, the background
  re-qualification) cuts a candidate snapshot of today's examples; it is published only when the
  qualification passes, else marked `check_failed` and the last passing snapshot stays live.
- Weekly: the worker's learning sweep asks for a background check when plans are qualified,
  examples are waiting and no snapshot was cut in the last 7 days; `runBrainCheck` then qualifies
  plans with the new snapshot (area `plans`, `promoted.learningSnapshotId`). It also asks for a
  check when a passing qualification lapsed (a privacy removal, a new prompt version).
- Held-out separation: an example whose member profile repeats a held-out plan scenario (same
  experience and days; goal, equipment and limitations 90% the same words) never joins a snapshot.
- Chat: round 4 already pins routine replies to their checked snapshot (`liveRuntimeMaterial`);
  plan examples and member memory are not used on the automatic chat path, so its digest is
  unchanged.

## Privacy and retention

- Member erasure (`privacy-hooks.ts` `eraseAdditional`, before the member's own records go): deletes
  the `plan_learning` rows from the member's plans, takes them out of every snapshot (a published
  or candidate one becomes `privacy_archived`, as teaching copies are), deletes every edit
  suggestion citing the member (`data.memberIds`), and asks for a background check.
- Withdrawn coaching consent: the member's examples stop being used at once (every learning query
  requires the plan's member to allow model use); the weekly sweep marks them `permission_revoked`,
  takes them out of snapshots and deletes pending edit suggestions citing the member. Examples
  whose plan no longer exists (members erased before this change) are deleted by the sweep.
- Retention (weekly sweep): pending suggestions expire after 90 days (status `expired`, example
  and evidence text removed); dismissed ones are deleted after 30 days; withheld and
  nothing-to-learn records after 90 days.

## "Suggested from your edits" (weekly)

Once a week per workspace (`brain_learning` job, `data.kind` `weekly_edits`, one per ISO week),
one model call (prompt `brain-edits-v3`, budget `brain_edits`: 3000 output tokens, 45 s, 90 s for
Seed-family models) groups the coach's edits since the last run (at most 30, at least 2):

- edited or rejected Brain plans and weekly adjustments (`plan_learning` with the diff and note),
  and amended or archived meal weeks (`nutrition_plan_edit` reason), only from members whose data
  allows model use;
- left out before the call: notes the safety screen holds or that carry contact details, and plans
  whose member profile repeats a held-out plan scenario; client names become `[client]`.

At most 3 suggestions come back, each citing its edits (E1, E2, ...). Code checks
(`editSuggestionIssues`) withhold one when: a cited edit is unknown; a pattern rests on one edit
without a note; plan and meal-week edits are mixed or the category does not fit; it or a cited
note is about health (pain, aches, injury, medicine, pregnancy ...); or any check of round 4's
corrected-reply suggestions fails (medical or dose advice, red flags, links, contact details,
approval claims, guarantees, a number not in the cited edits' values, notes or segment, "always"
conditions, naming the software, other clients, deciding how replies are sent).

Shown suggestions use the existing endpoints: `GET /api/v1/brain/suggestions` now returns
`source: "edits"`, `target` (`rule` or `nutrition`) and `evidence` (`{ref, kind, source, id,
memberId, generationId | planId, href}`). `POST /brain/suggestions/:id/confirm` re-checks the
(optionally edited) text against the cited edits; a rule target creates an approved rule
(`origin: "edit_pattern"`), a nutrition target a nutrition case (refused with 409
`HELD_OUT_DUPLICATE` when it repeats a held-out nutrition question). Both ask for a background
check. Each run stores a `brain_edit_run` record.

## "Getting better" (coach only)

`GET /api/v1/brain/progress` (owner, staff; 403 for members; workspace-scoped): 8 weeks of
`approvedWithoutEdits` (plans and reply drafts), `handOffRate` (plans sent to the coach, reply
drafts that hand over), `medianEditSize` (plan fields changed, share of reply words changed),
`heldOutPassRate`; `checks` (pass rate per check and version); `learning` (live snapshot, examples
waiting); `visibility: "coach_only"`. Shown in Brain > checks (`BrainProgress`). Never used in
marketing.

## Live model test (Seed 2.0 Pro, 1 October 2026)

`seed-2-0-pro-260328` through the app's own functions and checks; scripts, batches and results
outside the repository (session scratchpad `round5-evals/learning/`). Total spend about USD 0.28.

- **Weekly grouping**, 22 realistic batches (substitution and number patterns, unrelated noise,
  one-off client facts, wording fixes, health edits, injected instructions with and without
  contact details, meal-week patterns, absences, conflicting edits, supplement notes, Arabic notes,
  other clients and promises):
  - v1 (22 calls): 12/22. Numbers from the plans' segment ("3 days per week") were flagged as new
    (now grounded in the segment); one holiday archive was generalised; a knee-ache rule was
    proposed.
  - v2 (44 calls): 36/44; every expected pattern found where the reply parsed; 4 replies wrote
    `evidence` as one string (now parsed; v3 asks for a list).
  - v3 (44 calls, final): 43/44 by the run's own checks. The one failure was serious: once, the
    coach's own "take 5 g creatine daily" notes became a shown rule (round 4's shared checks miss
    supplement doses). The health check now covers supplements, medicines and doses; re-applying
    the final checks to the same 44 replies (no new calls): 44/44, 32/32 expected patterns found,
    every shown suggestion cites only the edits it comes from, medical or supplement advice shown
    0, forbidden text (client names, contact details, replaced numbers, holidays) shown 0. The
    injected "send plans automatically" note never became a rule.
  - About 2-17 s per call, about 950 input and 440 output tokens per call.
- **Memory-carrying prompts**:
  - plans (`brain-plan-v5`, 4 trainers' material): 4/4 valid drafts, 3/4 validator-clean (one had an
    alternative needing unavailable equipment and a timed-work rise, both caught by the validator
    as before); 4/4 scheduled on the member's fully kept weekdays and avoided the never-kept one;
    4/4 left out the often-skipped exercise; no memory quoted in member text; medical 0.
  - weekly adjustments: the first version (shared instruction) let memory alone drive swaps the
    validator refused (start loads). With `memberMemoryAdaptationInstruction` (memory is context,
    never by itself a reason to swap or raise): 2/2 valid and validator-clean; one still swapped to
    the member's usual alternative (allowed, within bounds).
  - chat drafts (memory inside the intake evidence): 6/6 valid; pain and an injection attempt went
    to the coach; the Arabic message was answered in Arabic; memory never quoted; medical 0.

## Not done here

- The Client Twin's training summary still carries member-typed exercise names into plan prompts
  (seen while testing: a logged "exercise" with an instruction in it); member memory filters them,
  the twin does not.
- `givesMedicalAdvice` (shared) misses supplement doses such as "5 g creatine"; the edit checks
  cover it, round 4's corrected-reply suggestions rely on the model and the red-flag screen.
- Held-out plan scenarios carry no member memory, so qualification does not exercise it.
- Arabic wording polish of the panel and suggestion texts.
