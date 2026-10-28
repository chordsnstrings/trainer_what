# Marketing revamp: research and three concepts (26 October 2026)

Owner, 26 October 2026: "first understand what converts the most, research, and then let's revamp the marketing site which will have the best conversion along with a beautiful aesthetic design with smooth animation. give 3 different concepts, for all pages".

**Status (28 Oct 2026): phase 1 implemented and reviewed, in draft PR #105; not merged or deployed.**
- **The decision.** On 27 Oct the owner chose the recommendation: "Go with your recommendation".
  - That is concept A, "Live Brain", plus C's decision anatomy, Never list and source badges, plus B's pricing page and calculators.
  - The defaults in playbook section E and SHOWCASE_DESIGN.md §8 were accepted with it: no founder note and no card-processing rate yet, "14 AI specialists and 11 code steps" with "How we count", and the Recovery rule and Meal planner shown as "Not on yet".
- **Phase 1:** `/`, `/trainer-brain`, `/demo` and `/pricing`. It is built on `claude/repository-overview-osejlw` in PR #105, as its own PR, "checked and deployed".
  - The spec is `phase1/PLAN.md`.
  - What shipped is in `docs/features/marketing-site.md` ("Phase 1") and `docs/features/brain-showcase.md`.
  - Since the first build it went through two fix rounds, a final review (36 findings across honesty, engines, accessibility and performance) and a final fix pass, on 28 Oct. The docs were brought in line with that code the same day. The milestone verification (PLAN §4.6) was running when this was written; its result, and anything still open, is in `CLAUDE_HANDOFF.md`.
  - trainsyou.com changes only once PR #105 merges and deploys. `CLAUDE_HANDOFF.md` records the release.
- **Phase 2:** every other page. **Phase 3:** Arabic, tracking and A/B tests.
- **Before the decision.** Round 1 was the three concepts (26 Oct), and round 2 the multi-agent Brain showcase (27 Oct).

**Gallery** (private artifact; the owner can share it): https://claude.ai/artifact/Lcwi51DwtZdU35hirwprFF
- The gallery page summarises the research and links each concept.
- Each concept is a clickable 42-page prototype at `concept-a/`, `concept-b/` and `concept-c/`:
  - the 38 registered marketing pages;
  - `signup`, `login`, `coaches` and `404`.
- The full playbook is at `playbook.html`.

## What is here

| Path | What |
|---|---|
| `PLAYBOOK.md` | The revised playbook, the main reference:<br>A. 15 ranked conversion principles with sources and evidence labels<br>B. Funnel and events<br>C. The page-by-page blueprint shared by all concepts<br>D. The three concepts: tokens, motion and per-page treatment<br>E. Recommendation, test plan and the 19 owner decisions |
| `research/` | The four research reports (current-site audit, conversion evidence, competitor teardown, UAE trainer buyers) and the adversarial critique that the playbook answers |
| `showcase/` | Round 2: `SHOWCASE_DESIGN.md` (the Brain showcase spec), `agent-map.md` (the specialists, from code), `ai-showcase-patterns.md`, `critique.md` |
| `prototypes/` | The prototype generators |
| `phase1/` | Phase 1's implementation plan (`PLAN.md`, the spec the work followed), the review of that plan (`plan-review.md`) and the four maps it was built from (`maps/`: content, prototypes, renderer, tests) |

`prototypes/` holds, for each concept:
- `concept-*/src/`, which generates the static HTML;
- `concept-*/site/assets/`, the hand-written CSS and JS.

It also holds:
- `shared/brain/`, the shared Brain showcase engine (traces, scheduler, playground, anatomy) with its README and verification tools. Phase 1 ported it to `apps/web/components/marketing/brain/` (`docs/features/brain-showcase.md`), and that port is the one to maintain;
- `content.json`, the marketing content snapshot the generators read;
- `export-content.ts`, which re-exports it from `packages/contracts`;
- `thumbs.cjs`, which captures the gallery screenshots.

## The three concepts

**A. Live Brain (product-led).**
- The hero is a decision console: a subscriber message, the trainer's rule, a confidence reading, and the squat moving from 60 kg to 62.5 kg.
- Expected best converter.

**B. Beyond Your Hours (outcome-led).**
- The hero is the trainer's offer page at AED 199 beside a "Your price, our share" tile.
- Earnings figures stay behind a "Not on yet" chip until payments are live.

**C. The Method (trust-led editorial).**
- The hero is a rule card being confirmed, with margin notes.
- It adds a signed "Never" list, source badges on every market figure, and a founder letter.

**Recommendation (playbook E):** A, with B's pricing page and calculators and C's Never list, source badges and founder letter. The owner chose it on 27 Oct. Phase 1 ships it without the founder letter for now: the Never list is unsigned, by the owner's default.

**How the concepts were built and checked:**
- Every concept: a foundation agent, four page-group builders, a QA crawl of every page at 360, 390 and 1366 px with fixes, and an adversarial review with fixes.
- Every concept: no console errors, no sideways scroll, every internal link resolves, and calculator figures match the repo's calculator maths.
- Nothing loads except Google Fonts.

## Rebuild a prototype

```sh
# optional: refresh the content snapshot from packages/contracts
npx tsx docs/marketing-revamp-2026-10-26/prototypes/export-content.ts > docs/marketing-revamp-2026-10-26/prototypes/content.json
node docs/marketing-revamp-2026-10-26/prototypes/concept-a/src/build.mjs   # writes concept-a/site/*.html (git-ignored)
```

`export-content.ts` imports from absolute paths under `/home/user/trainer_what`; adjust them if the repo lives elsewhere.

## Facts every concept respects (from the audit; check again before implementing)

**What works today:**
- Registration is open.
- The primary conversion is a trainer account created at `/signup`.

**What does not, yet:**
- Publishing is blocked by the `payments` launch gate (`apps/api/src/onboarding.ts`). (Corrected 28 Oct: publishing waits for every go-live check there: approved legal documents, which in production is also the switch that opens sign-ups, card payments, and the coaching assistant. Payouts are asked at the first payout, not before launch. Phase 1's copy reads these as `PUBLISH_GATES`; see `docs/features/marketing-site.md`, "What is live: gates and flags".)
- Payments, payouts and the `frontier` flag are off, so subscriber payments and payouts are not live.
- The "frontier model" wording appears only behind its flag.

**Rules the copy follows:**
- No invented testimonials, counts, logos or results.
- "Layla Strength" is labelled sample data.
