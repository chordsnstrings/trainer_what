# Personal coaching memory and measured fidelity

Owner request, 13 October 2026: create a plan, audit and execute the applicable lessons from Apple's personal AI work. Base: `5d5aafe75f442ef5f08bec7f935005210e45972b`. Status: implemented, merged in PR #65 and live as `646b44d5c9ff0ff526ca5283c266690b608b3e6e`, independently verified at 18:50:23 UTC on 13 October 2026. Actual trainer-fidelity improvement remains unmeasured.

## Audit

- Trainer teaching already captures situations, recommendations, reasoning, alternatives, change conditions and escalation (`coaching-completion`, `brain-teach`). Published communication and rules are shared across channels. Rebuilding these would duplicate existing behavior.
- Subscriber chat supplies at most 12 sent messages within 14 days (`conversation-context`). A relevant older preference or discussion disappears even while its permitted source remains. The current query does not participate in selection.
- Per-member workout memory is separate, code-built and grounded in recorded logs. Keep it separate from historical conversation and from trainer teaching.
- Reviewed teaching retrieval already exists for the qualified action selector. It does not justify inventing personal facts or treating old prescriptions as current.
- The fidelity screen compares one supervised chat reply against an independent trainer reference. Its fictional context is only one to three recent exchanges; it cannot compare recent-only context with retrieval. It measures decision, wording and context but not reasoning or appropriate uncertainty/handover separately.
- Existing consent, member/tenant isolation, source deletion, in-flight context digests, immutable ratings, contaminated-case retirement and durable paid attempts are valuable boundaries to preserve.

## Research and decision

Apple's [PLUM paper](https://aclanthology.org/2025.l2m2-1.5/) learns conversations through generated Q&A and a small LoRA adapter. Its 100-conversation English recall experiment reported 81.5% for PLUM with its system prompt versus 86.5% for the best conversation-retrieval baseline. This is not trainer-fidelity evidence. [Workout Buddy](https://www.apple.com/ae/newsroom/2025/06/apple-intelligence-gets-even-more-powerful-with-new-capabilities-across-apple-devices/) grounds spoken encouragement in workout data. [Apple's current framework](https://developer.apple.com/foundation-models-framework/) supports context-preserving task configuration and evaluations. The former [adapter toolkit](https://developer.apple.com/apple-intelligence/foundation-models-adapter/) is OS-26-only; it is not a drop-in dependency for this web app.

Deliver a bounded memory improvement and a fair human comparison first. Do not buy/train an adapter, change providers or claim measured uplift without a rights-approved corpus and actual evaluations. Existing workout narration remains grounded in the prescribed session; this slice concerns written chat and the existing calls that use that chat service.

## Ordered plan

1. Add one pure versioned conversation selector. Preserve 12 recent whole messages/12,000 characters/14 days. Optionally recall a few relevant earlier whole exchanges from at most 200 permitted messages in 90 days, within a separate 4,000-character cap. Use deterministic English/Arabic lexical matching, no embedding or summary-model call. Empty/ambiguous queries may return no recall. Label recalled context as history; current facts, corrections and safety retain priority.
2. Use the selector in the existing member-scoped loader. Resolve the query from the actual current sent subscriber message. Preserve latest consent boundaries, allowed-use checks, explicit projection, and source IDs/digests. Recheck the same context at delivery. Never create another transcript or turn a customer's messages into trainer teaching.
3. Extend independent fictional fidelity cases with optional earlier exchanges. Offer current recall and recent-only comparison using the same model, Brain, safety policy, prompt and selector. Save one durable attempt per case/configuration/approach. Show results for matched, still-independent rated cases separately from aggregate ratings; do not claim statistical significance.
4. Add reasoning and appropriate uncertainty/handover ratings, retaining older ratings without fabricating missing scores. Keep reference replies out of prompts and sources hidden until rating. Preserve correction-to-teaching retirement.
5. Verify relevant recall, missing evidence, later corrections, whole-message caps, English/Arabic, consent/regrant/deletion and foreign/preview boundaries; verify model input, stale recall, matched comparisons, version pins, no duplicate paid attempts and browser flows at phone/desktop widths.
6. Run normal PR and exact-main release gates, merge, verify the serving SHA, and update this record and handoff with actual results.

## Acceptance and limits

- A relevant permitted older exchange reaches chat; unrelated, denied, other-member and pre-consent messages do not.
- Recent corrections remain available and authoritative; retrieval never executes a historical request or claims a remembered preference is a saved profile change.
- Recall is bounded and does not buy another model call. Deleting source messages removes the derived context; changing selected source context while a reply is in flight withholds that reply.
- A trainer can compare the same unfamiliar case with and without older context. Comparison summaries require both approaches on the same current configuration and independent case; missing new scores remain missing.
- Tests using fixture providers prove contracts and integration only. Real model quality, trainer fidelity, acoustic voice quality and an adapter's incremental value require separate observed evidence. No actual trainer's answers are invented for the evaluation.

## Verification and release

Completed the ordered implementation and release plan. Version pins are `subscriber-conversation-v2`, `trainer-fidelity-v2`, `coach-decision-v5` and `coach-action-selector-v7`. Existing qualification freshness checks require affected workspaces to requalify before automatic replies; this change never grants qualification. No database migration is needed.

- Root TypeScript and a fresh production build passed.
- 80 focused checks passed: conversation scope/recall, fidelity, supervised and qualified chat, and provider contracts. Six private trainer-preview checks also passed. Initial fixture failures were fixed by seeding historical append-only consent correctly and giving separate fictional signups separate socket addresses; production permissions and rate limits were unchanged.
- Added English, Arabic and mixed-language lexical cases, absent/unrelated recall, adjacent corrections, whole-turn/candidate caps, deleted-source delivery withholding, reference exclusion, matched configurations, new/legacy score handling, overlap screening and per-approach paid-call reuse.
- The expanded browser journey saves older fictional exchanges, rates both approaches across all five dimensions, inspects the paired summary, then retires the case through teaching. It retains 1280/390/320 px captures. Local launch was blocked: the Chromium CDN returned a 195-byte HTML response instead of a ZIP archive and no installed browser was available. This local attempt was not a browser pass; the completed CI journeys below provide the required browser evidence.
- No model endpoint, key or model name is configured in this checkout. Provider fixtures do not establish retrieval quality or trainer fidelity with the live model. No paid live evaluation was made.

[PR #65](https://github.com/chordsnstrings/trainer_what/pull/65) is merged. Its initial [conversation run](https://github.com/chordsnstrings/trainer_what/actions/runs/38438713192) passed 150 tests, the build and actual browser journeys. The [retained evidence](https://github.com/chordsnstrings/trainer_what/actions/runs/38438713192/artifacts/11835525155) reports no browser errors, horizontal overflow or unlabelled controls; desktop/390/320 px screenshots were inspected. A final audit corrected an overly strict history-overlap screen: ordinary trainer acknowledgements may repeat across independent subscriber situations, while copied subscriber situations still fail. One added regression brings the focused total to 80.

All eight final-head PR gates passed on `59c42dc5c61ff8314dd25a9bc201ecdfb1756ea5`: [application](https://github.com/chordsnstrings/trainer_what/actions/runs/38441350190) and [conversation](https://github.com/chordsnstrings/trainer_what/actions/runs/38441350664). Application: 1,874 passed / 0 failed / 5 skipped. PostgreSQL: 1,873 passed / 0 failed / 6 skipped. Conversation: 151 passed plus actual desktop/phone and voice journeys. The merged source tree is identical to the checked PR source.

All seven [exact-main release gates](https://github.com/chordsnstrings/trainer_what/actions/runs/38445199467) passed with the same application and PostgreSQL totals as the PR. [Serving verification](https://github.com/chordsnstrings/trainer_what/actions/runs/38448772113) confirmed HTTP 200 and exact release `646b44d5c9ff0ff526ca5283c266690b608b3e6e` at 18:48:34 UTC. A direct readiness request independently confirmed HTTP 200, `status: ready` and that exact release at 18:50:23 UTC; the homepage returned HTTP 200. Final-head [browser evidence](https://github.com/chordsnstrings/trainer_what/actions/runs/38441350664/artifacts/11837100456) is retained. All final-head and main gates passed on their first attempts; no failed gate was waived.

Implementation, merge, deployment and serving verification are complete. Affected workspace qualifications must still pass fresh checks under the new pins. Human ratings with the live model, cross-channel fidelity and any adapter experiment remain separate follow-ups. The documentation-only receipt follows ordinary automatic CI and changes no application behavior. Existing approval for ordinary deployment applies; no paid service purchase or production account mutation is part of this work.
