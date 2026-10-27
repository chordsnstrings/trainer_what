I mapped all four pages and checked the calculators and the Brain traces against the code. Nothing in the repo changed: I only read files, and building concept B wrote git-ignored `concept-b/site/*.html`.

## 0. Main findings

- **Calculators:** the prototype ports give exactly the same numbers as the repo, so there is no need to port `calc.js`. I compared the B, A and C ports with `packages/domain/src/marketing-calculators.ts` on 20,000 random inputs, including NaN, negative, Infinity and 1e9. Follower results, earnings results, levers (1,000 runs), the model, defaults and limits all matched exactly. Only the formatting differs (section 3).
- **Brain traces:** the checker passes on this checkout. `node --import tsx docs/marketing-revamp-2026-10-26/prototypes/shared/brain/tools/verify.mts` gives `{"checks":4418,"planCombos":480,"whoopCombos":77,"fails":0}`. Plain `node` fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on the domain code it imports.
- **Three hidden links break if the approved copy is pasted in as it is:**
  1. `apps/web/components/marketing/journey.tsx:53-66` (`SUBSCRIBER_LINES`) reads two things: the home FAQ "How do my Instagram followers become subscribers?" (sentence 1) and `/pricing` section `how` (bullet 0). The new home FAQ list and B's pricing page both drop them. `registryLine()` then throws "Unresolved" while rendering the journey band on home and `/how-it-works`.
  2. `AVAILABILITY_LINES` (`packages/contracts/src/marketing-content.ts:681-713`) depends on two things. The frontier bullet goes into `/trainer-brain` section id `learns`, so keep that id. The frontier FAQ matches on `TRAINED_FAQ.q` (line 693), so rename the shared constant rather than copying it per page.
  3. The home introduction (`HOME_INTRO`, lines 728-729) is shown only as the answer to home FAQ 1, "How does {APP_NAME} work?". The approved six FAQs drop that question. The intro would then stay in llms-full and the assistant facts but disappear from the page. `tests/brand.test.ts:200-201` still requires that intro text.
- **Prototype builds:** A and C fail inside the repo because the root `package.json:55` sets `"type": "module"`.
  - A fails with `calc.estimateFollowers is not a function` at `concept-a/src/pages-core.mjs:187`.
  - C fails with `Cannot set properties of undefined (setting 'tyCalc')` at `concept-c/site/assets/calc.js:302`.
  - Both build from a copy outside the repo: `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/proto`. B builds in place.

## 1. Contract changes per page

Unless noted, line numbers are in `packages/contracts/src/marketing-content.ts`.

### "/" (entry 732-792; rendered by `Home` and `HomeSection` in `apps/web/components/marketing/site.tsx:1441-1541` and `1216-1284`)

- **eyebrow (747):** "FOR PERSONAL TRAINERS" → "FOR UAE PERSONAL TRAINERS" (A `pages-core.mjs:32`).
  - This breaks `brand.test.ts:199`, which checks the eyebrow equals `BRAND_COPY.audience.toUpperCase()`.
  - Keep `BRAND_COPY.audience` itself, since llms.txt uses it (`marketing.ts:696-704`).
- **h1 (745) and h1Highlight "trains" (746):** unchanged.
- **lede (750):** → "Specialists inside your AI handle every message. Code checks every step. You decide what goes out." (A :36, 16 words).
- **intro (751):** keep `HOME_INTRO` (pinned by `brand.test.ts:200-201`). It needs a visible place on the page (decision 1 in section 5).
- **title and description (737, 743):** unchanged, as A kept them.
- **sections (753-779):** replace the four current ones with A's bands. All fit the header-page limits.
  - **`resort`:** "Change a setting. Watch it re-sort." Body: "Your settings apply to every moment at once. Make it stricter and more waits for you. Safety rules never switch off." (A :51)
  - **`how`:** "How it works", with three steps (A :58-62):
    - You teach: "Rules, cases and an 8-answer quiz shape your AI (we call it your Trainer Brain)."
    - It coaches: "A dated plan daily, guided workouts, adjusted as they train."
    - You decide: "Your approved reply fits → sent on its own. Anything else waits for you. Pain → paused."
    - The 8-step walkthrough refers to the `/how-it-works` `steps` section (806-818) rather than copying it.
  - **`subscribers`:** heading → "What subscribers get, under your name".
    - Five bullets (A :84-90): "A daily plan, your way", "Guided workouts, offline too", "Progress they can see", "Nutrition: meals, groceries, food diary", "Sessions led in your voice".
    - Note: "Once your page is live."
    - The line "your-name.trainsyou.com" must stay in the component and use `coachAddressTemplate`. Tests forbid that literal domain in component files.
  - **`control`:** body → "“Waits for me” mode: replies wait for you until automatic sending is on. That needs 20 cases and passing checks." (A :146)
    - Bullets: the shared "Never" list, taken from C's `NEVER_ITEMS` (`concept-c/src/lib/components.mjs:264-269`).
  - **`economics`:** body → "We earn only when your subscribers pay."
    - Three facts: "Free to join", "You set the AED price", "Our share falls as you grow".
    - The bands come from `bandPills()`. The "Tools it replaces" row comes from `REPLACES` (`marketing-features.ts:205-213`) with an availability gate added.
    - A drops "Card processing is itemised.", which test :586 checks. Keep that line, without a rate.
  - **`followers`:** body → "A best case for an engaged, growing audience, from published benchmarks. An estimate, not a promise."
  - **`proof` (new):** "Proof you can check". Body: "We publish no testimonials, logos, ratings or counts we can’t show. Check these instead:" followed by four links (A :225-240). The founder note is dropped, per the owner.
- **faqs (780-787)**, in this order:
  - "Will my AI replace me?" (rename `REPLACE_FAQ.q`, 653-656).
  - `SAFETY_FAQ`.
  - `FREE_FAQ`.
  - "Will my followers pay?" Move it from `/faq` (2190-2193) into a shared constant.
  - New: "Can subscribers pay me today?" Answer: "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can join, set up your page and app, and teach and test your AI." Add a payments-on line in `AVAILABILITY_LINES`.
  - `TECH_FAQ`.
  - Dropped: "How does {APP_NAME} work?" and `INSTAGRAM_FAQ`.
- **Copy held in components:**
  - Micro line (`site.tsx:1478`) → "Free to join · Nothing to pay upfront · Nothing goes live until you publish". When sign-ups are closed: "Free to join · We’ll tell you here when sign-ups reopen".
  - Hero secondary link (`HOW_IT_WORKS`, `site.tsx:308`) and the closing-panel link (`closingLink`, 310-315) → "Try the demo".
  - Bump `lastUpdated` (789).

### /trainer-brain (862-970)

- **title (867):** → "Trainer Brain: an AI trainer built from your judgment". The C0 rule keeps "AI trainer" in the title.
- **description (868):** → C's text, 161 characters (`concept-c/src/pages-product.mjs:483`): "Teach an AI trainer your coaching rules, cases and examples. It plans and adapts training for each subscriber, learns from your corrections and asks when unsure."
- **h1 (870):** → "Your AI, built from your judgment".
- **lede (872):** → "Built from your rules and corrections. Routine replies use your approved words. Anything else waits for you." (A `pages-product.mjs:649`)
- **intro (873):** change "tested on held-out scenarios" to "checked against your test cases", and reword "acts alone only when confident". Keep it at 35-65 words.
- **sections**, in this order:
  - **`what`:** heading → "Not a generic workout generator". Body: "Every change traces back to something you taught. Every version can be rolled back."
  - **`inside` (new):** "Who’s inside your Brain".
    - Body: the lede from A `brain-a.mjs:57`.
    - Three crew cards (from 38-42). Titles must be four words or fewer ("Coach", "Teach", "Guard"), with the subtitle as the card label.
    - The section note is `labels.howWeCount`. At 44 words it has to be a note, not a body paragraph.
  - **`decides`:** heading → "Anatomy of one decision". Body: C's lede (`c-anatomy.js:13`).
    - Replace the Confident / Not sure / Safety cards with the three lanes: "Sent on its own", "Waits for you", "Training paused".
    - A's card bodies (`brain-a.mjs:73-85`) need trimming to 18 words. That trimmed text is new copy.
  - **`play` (new):** "Throw a moment at your Brain". Body: the playground lede (`brain-play.js:11`). Note: `labels.long`.
  - **`teach`:** turn the bullets into A's five cards (A :529-535).
  - **`learns`:** keep the id. Heading → "How it gets better", with A's bullets (:567-572). The "Compare my replies" bullet is 13 words; the limit is 12.
  - **`never`:** C's list. Note: "Pain and red flags pause the workout and come to you. Enforced in code, outside the AI."
  - **`yours` (new):** "Your method stays yours", with A's bullets (:618-624).
  - **`control` (942-951):** neither concept has it. Tests :656 and :713 require it, so either keep it or update the tests.
- **faqs (953-964):** rename the questions as in A :639-644 ("my AI" instead of "the Brain"). In the answers, "your scenarios" becomes "your test cases".
  - Renaming the shared `TRAINED_FAQ` and `REPLACE_FAQ` also changes `/how-it-works`, `/features` and `/faq`, plus the frontier answer (692-697).
- **cta (969):** remove "Start teaching your Brain" so the default applies. Secondary link: "Try the demo".

### /demo (972-1033)

- **h1 (979):** → "Throw a moment at your Brain".
- **lede:** new, "Pick something a member might say. Watch each check and specialist work. Then change a setting and run it again."
  - Adding a lede turns on the "In short" block (`site.tsx:1194`) and breaks test :695-700.
- **description (977):** must change, because it describes "four scripted examples". The approved copy has none, so new text is needed.
- **intro (981):** rewrite for the 12 sample moments, keeping the no-AI-model honesty line.
- **sections:**
  - Remove `scenarios` (985-1011). It is rendered by `DemoScenarios` (`site.tsx:1147`, `islands.tsx:884-936`).
  - Add `next`: "What happens in your account" with three steps (A :1641-1661). Its "6 minutes" should come from `SETUP_STEPS` (`coach-setup.ts:11`).
  - Add a text section for the moments. Without it the page falls under the 350-word minimum in test :396.
- **faqs (1013-1027):** use A's four (:1683-1688).
  - The fourth reuses `SAFETY_FAQ.q` with a different answer. Use one answer everywhere to avoid conflicting FAQPage data.
  - "Medical questions wait for your personal review" needs checking: the review categories are opt-in (`packages/domain/src/safety-policy.ts:30-31`).
- **cta (1032):** remove "Build my Brain". Secondary link: "See how it works".

### /pricing (1829-1921)

- **h1 (1837):** → "Free to join. You set the price." with `h1Highlight` "price".
- **lede (1839):** → "Nothing to pay upfront. We earn only when your subscribers pay, and our share falls as you grow."
- **title and description:** keep. The intro (1840) needs the C0 vocabulary change ("marginal bands" → "our share for each group of subscribers").
- **sections:**
  - **`how`:** keep and render it, because the journey band reads its first bullet.
  - **`glance` (new):** "What’s free, what we take", with Free / What we take / Optional cards (A :311-313).
    - Write "{APP_NAME} address", not "trainsyou".
    - Card processing is "itemised" with no rate.
  - **`bands`:** heading → "How our share falls". Columns → "Paying subscribers", "Our share in that band".
  - **`example` (new):** "What you keep, in AED". Its figures are computed.
    - Test :1005 still needs the line "An arithmetic example, not a forecast or promise."
  - **`hours`:** text unchanged. B shows two price anchors, not three, so test :653 (which expects "AED 200–700+") needs updating.
  - **`statement`, `billing`, `payouts`:** unchanged. In the sample statement, "[rate]" becomes "Itemised".
  - **`status` (new):** "Live today, and not on yet".
- **faqs (1904-1915):** use B's six (B `pages-core.mjs:240-247`). They include new answers for the data/portability question and "Can subscribers pay me today?".
- **cta (1920):** "Estimate my earnings" becomes the secondary link; the primary uses the default.

### What these fields feed

| Field | Consumers |
|---|---|
| `h1` | The `<h1>`; Open Graph alt text (`marketing.ts:534`); the generated share card (`apps/web/app/og/route.tsx:43-125`, not used for "/"); JSON-LD `WebPage.name` (616); the llms-full heading (790) |
| `title`, `description` | Metadata (521-560); llms.txt links; the uniqueness and 70-175 character test |
| `intro` | llms-full; assistant facts (845) |
| `sections` | Page; llms-full (749-776); assistant facts (848-861) for "/", `/trainer-brain` and `/pricing`. `/demo` is not in `ASSISTANT_FACT_PAGES` (823-834) |
| `faqs` | FAQPage JSON-LD (673-683); assistant facts, de-duplicated by question (862) |

- The assistant only speaks numbers that appear in these facts (`packages/domain/src/marketing-assistant.ts:247-301`). New copy therefore changes what it can say, for example "14" and "11".

### Tests and scripts that need deliberate updates

- `tests/marketing-site.test.ts`:
  - 131-169: registry integrity.
  - 396-404: minimum word count.
  - 482-622: home test. It pins the micro line (497), the relay (504-532), the tiles (543), the band pills (576), "Card processing is itemised." (586), the list of H2s (590), six FAQs with the intro first (602-609) and the calculator block (615-618).
  - 624-669: copy limits.
  - 674-707: lede and "In short".
  - 708-719: trainer-brain teach / never / control bullets.
  - 1005, 1072-1093, 1105-1127: other page checks.
- `tests/marketing-frontier.test.ts:76-107`.
- `tests/brand.test.ts`:
  - 199-201: home eyebrow and intro.
  - 207, 264, 293: "Start coaching".
  - 251-252: closing-panel links.
- `tests/marketing-journey.test.ts:220-232`.
- `scripts/brand-check.mjs:548-618`.
- `scripts/browser-check.mjs:80-89`: the old `/demo` tabs.

## 2. Where the copy should live

The repo's rule is that every page word lives in the registry, so the page, JSON-LD, llms-full and assistant facts always agree (`site.tsx:1-3`, `docs/features/marketing-site.md:40-66`). There are established exceptions:
- Sample illustration microcopy sits in components, such as `ControlFlow` (1352-1400) and `PriceAnchors` (1038-1055).
- Structured data shared across pages sits in contracts modules: `marketing-features.ts` and `SETUP_CHECKLIST` (460-472).
- Calculated figures are computed in components from `packages/domain`, as `WorkedExample` does (432-464).
- `journey.tsx` refers to registry lines instead of copying them.

Recommendation:
- **Registry (`marketing-content.ts`):** all page claims listed in section 1. Shared constants for the Never list, the two new FAQs and the renamed `REPLACE_FAQ` and `TRAINED_FAQ`. Text that depends on a flag goes in `AVAILABILITY_LINES`.
- **A contracts module like `marketing-features.ts`:** the "Live today / Not on yet" items, gated by availability key. "Publish" is on only when payments and payouts are both on (`apps/api/src/onboarding.ts:520-524, 556-559`). `REPLACES` gains an `availability` field.
  - Optionally add `secondaryCta` to `MarketingPage` (`marketing.ts:101-155`) to replace the path switches in `site.tsx:88-92` and `310-315`.
- **Brain showcase data (`traces.json`):** keep it next to the engine, not in the registry, so sample member names and messages never reach llms-full or JSON-LD.
  - The few page-level claims (the "How we count" note, the playground lede, the honesty banner) also appear as registry text. A test should check they match.
- **Showcase microcopy** (the playground `COPY` and C's `COPY`/`NOTES`) stays in the component, and its facts are tested.
- **Calculator labels** stay in the islands. Numbers come only from `packages/domain`.

## 3. Calculator maths: repo vs prototype ports

- **Repo:**
  - `packages/domain/src/marketing-calculators.ts`: follower model 107-176, follower maths 524-840, levers 860-903, earnings 940-1057, `aedWhole` 1059-1065.
  - `BANDS` and `commission` in `packages/domain/src/index.ts:2-34`.
  - Islands in `apps/web/components/marketing/islands.tsx`: the earnings calculator at 686 (compact mode at 700-704); the follower calculator at 148/205, which uses `platform.followerModel`.
  - `CITED_ASSUMPTIONS` in `marketing.ts:279-306`, kept equal by `tests/marketing-follower-model.test.ts:512`.
- **Ports:**
  - B `concept-b/site/assets/calc.js`: `commission` 17, model 26, follower 142, levers 169, earnings 192, `aed` 222, `pct1` 224, `compactEarnings` 227, `bandFills` 231, `ratePos` 233.
  - A `concept-a/site/assets/calc.js`: 15, 144, 181, 221.
  - C `concept-c/site/assets/calc.js`: 17, 164, 236, 277.
- **The maths is identical** (differential script: `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/calc-diff.mts`).
- **Differences that are not maths:**
  - The repo formats money with a no-break space ("AED 22,885") and negatives as "-AED x". B matches for values of zero or more. A and C use a plain space.
  - B shows the blended rate to one decimal; the repo island shows two (48-49).
  - The repo's `commission` uses BigInt and validates its input; A and C use floating point without validation. Results are the same for valid inputs.
  - B's DOM renderer (`calc.js:292`) and A's follower function ignore a model edited by the operator.
  - B's take-home slider runs from AED 199 to 999 (`concept-b/src/components.mjs:322`); the repo allows 0 to 10,000. Take the 199 from `MEMBERSHIP_MINIMUMS.training` (`packages/contracts/src/membership-pricing.ts:3-7`) instead of typing it.
- **The approved figures all match the repo maths:**
  - Home calculator (7,000 followers, AED 199, 8 Stories): strong case AED 23,084, typical AED 2,985, cautious AED 398.
  - Blended share: 100 subscribers 25%, 300 subscribers 21.67%, 1,000 subscribers 17%, 1,500 subscribers 14.67%.
  - Worked example, 150 at AED 199: AED 29,850, commission AED 4,975 + 1,990 = 6,965, keep AED 22,885, about 92 sessions.
  - Earnings defaults: average AED 229, subscriptions AED 13,740, commission AED 3,435, keep AED 10,305, about 41 sessions.
- **Gaps:**
  - The band table and every "25%, 20%, 15% and 10%" string are typed by hand (1866-1879, 657-660). No test ties them to `BANDS`.
  - The `/earnings-calculator` example (120 subscribers: AED 23,880 / 5,771 / 24.17% / 18,109 / 72 sessions) is typed and untested. It is correct today.
  - The earnings calculator's default voice add-on is AED 49 (lines 1044-1056). That conflicts with the AED 299 minimum for a voice offer (`membership-pricing.ts:15-25`).

## 4. Facts the Brain traces depend on

- **Imports in `verify.mts:5-9`:**
  - `red-flags.ts`: `redFlagCategories` (836).
  - `brain-plans.ts`: `planSettingsSchema` (297), `caseCoverage` (1663), `planConfidence` (1689), `planRoute` (1754).
  - `voice-session.ts`: `VOICE_SAFETY_LINE` (30), `formatLoad` (284), `reducedLoad` (705).
  - `whoop-training.ts`: `reduceWhoopWorkout` (115).
  - `brain-teach.ts`: `BRAIN_LEVELS` (212-237).
- **Exact-text checks against code:**
  - `apps/web/components/brain-plans.tsx:721`.
  - `apps/api/src/brain-check.ts:45`.
  - `apps/api/src/coaching-completion.ts` and `apps/api/src/coaching-runtime.ts` (including line 500).
  - `apps/web/components/trainer-today.tsx:215`.
  - `apps/web/components/workspace-live.ts`.
  - `packages/domain/src/voice-runner.ts:1157-1183`.
- **Claims on the approved pages that the checker does not cover:**
  - "Nine kinds" of safety rule: `RED_FLAG_CATEGORIES` length 9 (`red-flags.ts:41-51`).
  - "Last 28 days" of memory: `apps/api/src/client-twin.ts:27,35`.
  - "4.2%, inside your 5% cap": the checker only tests the 3% case.
  - "Seven coaching specialists": the count of the coach group.
  - The "Compare my replies" rating dimensions: `apps/web/components/brain-fidelity.tsx:6-10`.
  - "3 cases to start" and "20 cases": `brain-teach.ts:26,28`.
  - "Approve all" skips flagged rules: `apps/web/components/setup-brain.tsx:88,146`.
  - "About 6 minutes": `coach-setup.ts:11`.
  - Each specialist's `code` reference should point to a file that exists and contains the named function. Line numbers in those references drift.
  - The `labels.subscribers` line and the "Try it on yourself" statuses are only true while payments are off.
- **Proposed test:** `tests/marketing-brain-traces.test.ts`, run by `npm test`. It ports `verify.mts` checks 1-8 against an in-repo `traces.json` and adds the checks above. Open data questions remain on traces t6, t7 (two) and t9.

## 5. Decisions to settle in the plan

1. **Home intro:** keep "How does {APP_NAME} work?" as a seventh FAQ, or show the intro somewhere else.
2. **Journey references:** keep the `/pricing` `how` section and the Instagram FAQ somewhere, or point `journey.tsx:58-65` at other text.
3. **Pricing data FAQ:** B has a placeholder ("[Portability wording: owner to confirm.]", B :245) and A hedges (A :485). A version grounded in the product could use "Export and deletion" (`marketing-features.ts:200`).
4. **"Teach your AI — free" applies to every page:**
   - It replaces `START_COACHING` (`frame.tsx:24-29`).
   - The assistant's hand-off label must follow: `apps/api/src/marketing-assistant.ts:346` and `packages/domain/src/marketing-assistant.ts:347`.
   - `BRAND_COPY.primaryAction` (`brand.ts:22`) is the natural source.
5. **"Not on yet" chip:** replacing "Available soon" (`chip.tsx:13-22`) also changes `/features` and its tests.
6. **Home nutrition item:** A always shows "Optional tier". The repo should gate it on nutrition availability.
7. **C's Never sheet:** it has a founder-signature placeholder (`lib/components.mjs:281`). Use it unsigned.
8. **Home word budget:** `scripts/brand-check.mjs:574` allows 400 words. A's home has 1,628 words in `main`, about 908 outside the calculator and showcases. The budget needs re-scoping.