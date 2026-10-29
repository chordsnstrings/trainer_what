# Brain showcase design, round 2 (27 Oct 2026)

**How the three fit.** A, B and C are alternative concepts. We recommend this mix:
- **A** is the home hero. Tapping any moment zooms into C's plates.
- **C**, the full pinned anatomy, sits on `/trainer-brain` §3.
- **B** sits on `/how-it-works` only.
- Home keeps exactly one pinned scene: today's journey band.

## 0. Why the first round fell short (for the owner reply)

1. **We did not map the product first.** Our brief said "an AI coach", and we designed from the brief without reading the code. So every hero showed one decision. The code has 14 AI specialists and 11 code steps around them (how we count is in §1.2). None of that reached the first round. That miss is ours.
2. **The playbook was tuned for conversion speed.** Its evidence was conversion studies plus 12 fitness competitors. It treated motion as a cost (principles 3 and 4) and obeyed the house rules in `docs/features/marketing-motion.md`: "short and plays once; nothing is infinite" and "no metrics, counts". The result was one 1.5-second change that plays once.
3. **The sites we reviewed point the same way.** On 27 Oct we looked at Decagon, Sierra, Harvey, Fin and CrewAI. None of them shows its agents working together, so copying them would not have produced the "oomph". The few we reviewed that do show it (n8n, ElevenLabs, Cursor, Lindy) share three things: many visible threads at once, a guardrail "stop", and cause and effect you can trigger. This is our reading of those pages, not a measured result. Attach the site notes from the agent study to the reply.
4. **There were accuracy slips.** The Concept A hero shows "86%" and "Applied automatically" on a chat reply. Chat replies have no confidence score in the product, and the product's wording is "Sent on its own, within your rules".

## 1. Shared system

### 1.1 The honest story (it drives every visual)

```
CHECKS FIRST (code · your rules)   Safety rules → Your topics → Memory → Rule finder
CODE PICKS ONE SPECIALIST          from the kind of moment: one AI specialist, a code rule for workouts, or none
                                   chat: Reply picker (an approved reply fits) or Draft writer (none fits)
CHECKS AFTER (code · your rules)   Checker → Confidence (plans only) → Lane gate
LANE                               Sent on its own, within your rules │ Waits for you (Your Today) │ Training paused │ The member confirms
YOU                                Your Today (safety first) → your edit → Privacy (code: name → [client]) → Learner
                                   → you confirm → Examiner (your AI answers your test cases; code marks them) → live only if it passes
```

**Voice sessions.** The session opens with your safety line (code). Every spoken reply is screened for pain, in English and Arabic, before the Set logger acts.

**Rules for every visual:**
- **Code picks the specialist. No AI chooses which AI runs.** Dots and lights never "scan" the specialists. A dot goes straight from the bus to the one node code picked.
- **Never show several AI specialists working on one message.** Several nodes may be lit at once only when each is lit by a different member's dot.
- **Parallel** means many members' moments at once, plus background jobs. Inside one moment, the checks run in a fast sequence. Visually, the parallelism comes from three things:
  - 1–2 narrated foreground moments;
  - unlabelled ghost dots on the true paths;
  - C's ghost stacks.
- **One Brain with many inside.** Every showcase draws one bounded shell titled "Your Brain", with the trainer's monogram, around the specialists. The before and after bands each carry a "Your rules" bracket.
  - The rulebook ("Your method · 24 rules", sample) is a visible source.
  - A thin Pace line lights from it to whichever node cites it: Rule finder (finds the rule), Checker ("cites your rule") or Lane gate (your level and your bar).

### 1.2 Roster: 25 public names

| Crew | AI specialists (pill node) | Code, no AI (square node) |
|---|---|---|
| Teach (works with you) | Interviewer, Rule writer, Quiz master, Style drafter, Wording helper, Learner, Weekly learner | Examiner ("Check my Brain": your AI answers your test cases; code marks them) |
| Coach (one per moment) | Reply picker, Draft writer, Plan writer, Week reviewer, Meal planner, Meal photo reader, Voice lines | — |
| Guard | — | Safety rules, Your topics, Memory, Rule finder, Checker, Confidence, Lane gate, Recovery rule, Set logger, Today list |

**Renames and kinds:**
- **Rep counter → Set logger:** "Logs the reps they say or type. Follows your too-heavy rule. 'Pain' stops the session." (`voice-runner.ts:24-30`)
- **Sure score → Confidence:** plans only, shown in %.
- **Examiner:** a square node with a small pill badge, "uses your AI". It is the only code step that calls AI.
- **Memory and Today list** are code steps, not checks. The legend reads "AI specialist" / "Code, no AI".

**The headline count.** "14 AI specialists and 11 code steps" appears only with a "How we count" note one tap away (`labels.howWeCount`); otherwise skip the number. The 14 is a curated grouping: the Meal planner groups 4 model tasks.

**"Not on yet" shelf.** Meal planner and Recovery rule sit in a separate dashed shelf outside the live shell, so the live grid looks whole. (Corrected 28 Oct: in phase 1 every status follows the platform's flags, so the field's shelf holds only what is not on yet of the two. The Meal planner joins the shell once nutrition is on; the Recovery rule stays off. The anatomy's (f) has no shelf: the Meal planner is one of its seven pills, dashed while off. See `docs/features/brain-showcase.md`, "Moments that are not on yet".)

**Status chips and tooltips:**

| Status | Who | Tooltip |
|---|---|---|
| Live | Trainer tools, and every code step except Set logger | — |
| Try it on yourself | Reply picker, Draft writer | "Runs today in Try my AI, with you as the subscriber. Real subscribers: not on yet." |
| | Plan writer | "Runs in Try my AI after your test profile's intake; there it is approved for your private test. Real subscribers: not on yet." Checked: `ensurePreviewWorkout` → `generateMemberPlan`, `apps/api/src/trainer-preview.ts:122-136`. |
| | Week reviewer | "Runs in Try my AI once a programme week ends. Real subscribers: not on yet." |
| | Meal photo reader | "Needs nutrition access, even in Try my AI. Real subscribers: not on yet." |
| | Voice lines | "Needs voice access and your verified voice, even in Try my AI. Real subscribers: not on yet." |
| | Set logger | "Runs in Try my AI during a guided workout. Real subscribers: not on yet." |
| Not on yet | Meal planner (`NUTRITION_ENABLED && NUTRITION_SCOPE_APPROVED`), Recovery rule (`WHOOP_TRAINING_APPROVED`) | "Built and tested. Not switched on yet." |

**Recovery rule.** Off by default everywhere:
- t3 is left out of A's playlist and B's track;
- the playground shows it as a dashed card;
- t3 turns on only through the flag, once the owner confirms the live value. Its caption then adds: "Only when you turn on your recovery rule and the member opts in."

### 1.3 Visual language

**Icons.** Unchanged: lucide, 16 px, stroke 1.75. Set logger keeps `dumbbell` and Confidence keeps `gauge`.

**Kind is shown by shape, never by colour alone:**
- AI specialist: a pill (radius 999) with a 3×3 matrix of round dots.
- Code step: a square (radius 4) with square dots.
- Examiner: a square with the "uses your AI" pill badge.

**Activity matrix** (3 px dots on a 5 px pitch, in a 16×16 slot):

| State | Look |
|---|---|
| Idle | All dots at alpha 0.18↔0.32, sine, 2.8 s, phase offset by node index × 230 ms |
| AI working | 3–5 seeded random dots on, changing every 90 ms |
| Code working | Column sweep, 80 ms per column |
| Pass | All dots on |
| Hit | All dots in `#F08A80`, flashing twice |
| Skipped | All dots at 0.12, plus the tag "Not reached" |

**Ink stage.** Every `[data-showcase]` band uses an ink stage: A's field and its zoom, C's anatomy stage, B's stage and the playground stage. Copy outside the stage stays on paper. The stage uses only existing tokens: the `appearance.css` dark set plus Pace. Contrast was computed this session:

```
--sc-stage:#171917 (dark-paper)  --sc-node:#202320 (dark-white)  --sc-tint:#272B27 (dark-tint, lane bins)
--sc-text:#F3F4F0   16:1 stage · 14.4 node · 13.0 tint
--sc-muted:#A9AEA6  7.8 · 7.0 · 6.4
--sc-line:#3A3F39   decorative edges and grid only
--sc-control:#8A8F87  interactive borders (5.4:1 stage · 4.8 node)
--sc-ai-on:#D5F24A  lit AI node fill; icon and text #171917 on it (14:1)
--sc-check-on: 1.5px inset #F3F4F0 ring
--sc-pulse:#D5F24A core; halo Pace at 25% (no halos on lite)
--sc-ghost: #F3F4F0 at 35%
--lane-sent:#7FCB9F  --lane-waits:#E0B25C  --lane-paused:#F08A80   (the app's dark status tokens)
  chips: filled with the lane colour, #171917 text (9.2 / 9.0 / 7.3:1)
  bins: --sc-tint with a 2px top rule in the lane colour
  stop route stroke and Hit dots: #F08A80 (7.3:1 on the stage)
--sc-grid: rgb(243 244 240 / 5%) 24px dot grid
Not on yet: 1px dashed #8A8F87 (dash 3 3), icon at 40%, "Not on yet" chip in #A9AEA6. Pulses and ghosts never visit it.
```

**Product surfaces inside the stage** (the member phone, the receipt sheet, Today cards) keep the product's light tokens. So the provenance highlights look as they do in the app:
- your words: a Pace highlighter behind ink;
- numbers from your rule: a 2 px ink underline;
- AI words: a 1 px dotted underline;
- platform text: plain.

**Type per concept:**
- A: JetBrains Mono for trace lines, bubbles and the subtitle (12–13 px).
- B: Archivo for the clock and figures (wdth 75, weight 700, tabular).
- C: Newsreader italic for figure titles and margin titles, Inter for the rest.
- All showcase fonts are subset, loaded after first paint and never preloaded.

### 1.4 Shared trace data

**File:** `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/showcase/brain-traces.json`
- Format `trainsyou-brain-trace@2`: 25 specialists and 12 traces. The JSON parses.
- Size: 38 KB minified, 9.8 KB gzipped with `code` and `basis.refs` stripped (the client copy).
- The round-1 copy is kept beside it as `brain-traces.r1.json`.
- The fixes can be re-run with `patch-r2.cjs` and `patch-r2b.cjs` in the same folder.

**Shape changes from round 1:**

```ts
type Specialist={id;name;kind:Kind;crew;icon;line;signsOff;status:Status;statusTip?:string;usesAi?:true;flag?:string;code};
type Step={ sp:string /* specialist id | "any_ai" | "you" | "member" | "code" */; label?:string /* name for sp "code", e.g. "Privacy" */;
  ...as round 1...; verbatimRef?:string };
type Trace={ ...as round 1...; weight:number /* playlist weight */; subtitle:string /* A's live subtitle; quotes are exact substrings of trigger.text */;
  defaultOff?:true; tileTag?:string; verify?:string[]; sure:{...;display:"78% · your bar 80%"}|null };
labels += eyebrow, picks, noChatScore, howWeCount, totals{recoveryOn,recoveryOff}, levels{1,2,3,note,verbatimFrom},
          planSetting{label,min,max}, spotCheck, supplements, recoveryCaption; kind.check = "Code, no AI"
settingsDefault: supplementsTopic true (the sample trainer's choice), recovery.on false (onWhenFlag WHOOP_TRAINING_APPROVED)
```

**Traces:**

| id | Member | Path | Lane | Basis | Weight |
|---|---|---|---|---|---|
| t1 Squats felt easy | Omar | checks → Reply picker → Checker cites your rule | Sent on its own | Recorded | 4 |
| t2 My knee popped | Noura | Safety rules hit `joint_injury` (matched: pop, knee, swollen, gives way), no AI | Training paused | Computed | 1 |
| t3 Low recovery | Hamdan | Recovery rule (code) | Within your rule | Tests; **off by default** | 2 |
| t4 Meal photo | Priya | Meal photo reader: 4 items, all unsure | Member confirms | Real run, 21 Oct | 3 |
| t5 Voice session | Sara | Voice lines (written before) → Checker → **safety line** → "too heavy" → **screened for pain, in English and Arabic** → Set logger: 10% rule → 54 kg | Within your rule | Tests + computed | 2 |
| t6 Skip my deload? | Yousef | Reply picker asks for review | Waits for you | Illustrative | 3 |
| t7 You edit a reply | **Zayed** 21:05 | Rule finder: none for upper body → Draft writer "Add 5 kg next time." → Your Today → you edit 5 kg → 2.5 kg → **Privacy (code)** → Learner "Upper body increments" → Checker → "Make this a rule?" → you confirm → Examiner, about a minute later | New rule | Tests; Zayed's message illustrative; status Try it on yourself | 1 |
| t8 Week is over | Aisha | Week reviewer → Confidence 78% · your bar 80% | Waits for you | Computed | 3 |
| t9 Creatine question | Khalid | Your topics: supplements (your choice; off by default), no AI | Waits for you (personal, 72 h) | Floor test | 2 |
| t10 First plan | Fatima | Plan writer → 86% · your bar 80% | Sent, tile tagged "Spot check", plus a Today card "Check a plan your Brain sent" | Computed | 3 |
| t11 22 weeks pregnant | Mariam | Safety rules `pregnancy` | Training paused | Computed | 1 |
| t12 Chest pain (Arabic) | Hana | Safety rules: pain (يعورني), urgent (بدوخة) | Training paused | Computed | 1 |

**Sample totals (all 12):** "4 within your rules · 1 member check · 3 waited · 3 paused · 1 new rule". With the recovery flag off (the default), it reads "3 within your rules". Both strings are in `labels.totals`.

**Checked this session (round 2):**
- Level summaries: `packages/domain/src/brain-teach.ts:212-236`. "At least 20 own cases": line 207.
- Plan setting label "How sure it must be to send alone (%)", range 50–99: `brain-plans.tsx:721`. The app shows confidence in %: line 441.
- The reason string "Confidence 0.78 is below your threshold 0.80": `packages/domain/src/brain-plans.ts:1799`.
- Spot check: `spotCheckRate` defaults to 0.25 (`packages/domain/src/brain-plans.ts:301`). It applies only while fewer plans are reviewed than `youngBrainReviews` (`apps/api/src/brain-plans.ts:1243-1244`).
- Examiner: it runs model calls (`brain-check.ts:42`), and `RECHECK_DELAY_SECONDS` is 60 (`brain-check.ts:45`).
- `VOICE_SAFETY_LINE`: `packages/domain/src/voice-session.ts:30`. Spoken replies are screened in both languages: `apps/api/src/voice-session.ts:752-806`.
- Matched words, from running `redFlagCategories` on sub-phrases:
  - "I heard a pop in my knee", "my knee is swollen", "a pop and now it's swollen" and "my knee gives way" each give `joint_injury`;
  - "يعورني" gives `pain`;
  - "بدوخة" gives `urgent`.
- The playground totals were recounted from the 12 lanes.

**Kept from round 1:**
- The earlier checks: `redFlagCategories` on all 12 triggers, the `planConfidence` values (0.78, 0.83, 0.88, 0.663, 0.862), `reduceWhoopWorkout`, `reducedLoad` and the lane strings.
- The agent-map correction (its T8 variant computes to 0.92, not 0.94).

**`decide(trace, settings)`.** Still pure and shared; it reruns the lane on every settings change.
- `chat_action`: sent at level 2 or 3 only while `settings.lastCheckPassing` is true (default true, shown as "Last check: passed (sample)"). Otherwise it waits. The rule-finder eligibility test is unchanged.
- `topic`: `supplementsTopic` defaults to true. Turning it off swaps in the Draft writer; it still waits.
- `plan`: the formula is unchanged. The UI shows `round(score × 100)%`. The slider is in % (50–99, step 1) and compares the raw 3-decimal score with bar/100. So a bar of 86% passes 0.862 and a bar of 87% does not.
- `recovery`: `settings.recovery.on` defaults to false. While it is false, t3 is not played.
- `floor`, `voice`, `meal` and `learn`: unchanged.

**Keeping it honest at build time:**
1. **Code steps come from the real code** (as before). The highlight words are also verified: each one must sit inside a sub-phrase that triggers the category on its own.
2. **Browser maths matches the domain functions** (as before), now including the % rounding.
3. **The verbatim test** also covers the level summaries, the slider label, the reason strings and `VOICE_SAFETY_LINE` (through `verbatimRef`).
4. **To confirm before building** (tagged `verify` in the JSON):
   - t6's card: does a picker review with no action produce "Your Brain drafted a reply"?
   - t9's card: "Waiting for your reply" for a personal-review topic.
   - t7: does an edit to a Try my AI draft reach the Learner? `docs/features/trainer-preview.md` says routine private approvals do not teach the Brain. If it doesn't, start the loop from a quiz "Change" answer instead, which is live today.
   - t7: the chat-correction source has no member message. The test's source holds only the draft, your reply and your note; confirm that nothing in `apps/api` adds the member's message.

### 1.5 Honesty labels (exact strings)

- **Inside every showcase stage, always visible:**
  - "Sample · scripted · no AI model called";
  - the status strip: "Subscribers can't join yet: subscriber payments are not on. You can run all of this on yourself with Try my AI. (Was "…on yourself today…"; "today" is untrue while sign-ups are closed, changed 28 Oct.)" It sits inside the stage, not below it. (Corrected 28 Oct: it now reads "…You can run most of this on yourself with Try my AI.", because items that need voice, nutrition or meal photos stay off even there. With the AI model off it ends after "…subscriber payments are not on.", and with payments on while publishing is not, it reads "Subscribers can't join yet: publishing is not on yet." It goes once trainers can publish: sign-ups, payments and the model.)
- **A's eyebrow:** "A SAMPLE HOUR OF YOUR BRAIN". Never "right now", "live" or a real clock.
- **Mission control and playground footer:** "A mix chosen to show every path. Not real rates."
- **Counts** always read "in this sample". They are capped and reset each loop (A) or each day (B).
- **Playground banner:** "Sample moments. Code steps use the app's own limits on sample data. AI steps replay answers from test runs, or are marked illustrative. No AI model is called on this page." (Corrected 28 Oct: "…AI steps replay answers from test runs or the app's tests, or are marked illustrative…", since three steps are tagged "From the app's tests".)
- **Tag on every AI step:** "From a test run", "From the app's tests" or "Illustrative". Computed code steps show "Worked out by the app's own rules".
- **Other fixed labels:**
  - "No AI called"
  - "STOP · No AI called"
  - "Code picks the specialist. No AI chooses which AI runs."
  - "Slowed down so you can follow it"
  - "Your rule, applied by code. Not a medical threshold."
  - "Chat replies have no score. They must cite your rule."
  - "Spot check: 1 in 4 sent plans while fewer than 20 are reviewed."
  - "Your choice · off by default"
  - "Level 2 needs a passing check of 20+ of your own cases."
  - "How we count"
- **Never** use model or vendor names. Say "frontier model" only behind the `frontier` flag.

### 1.6 Shared engine and performance contract

**Files.** Prototypes use `assets/`. Production goes under `apps/web/components/marketing/brain/`; read the repo's Next docs first, as `apps/web/AGENTS.md` says.
- `brain-core.js`, ≤ 6 KB gz.
- `brain-field.js` (A), ≤ 24 KB. It adds ghosts, the subtitle and the auto-demo.
- `brain-day.js` (B), ≤ 14 KB.
- `brain-anatomy.js` (C, and A's zoom), ≤ 12 KB.
- `brain-play.js` (playground), ≤ 16 KB.
- `brain.css`, ≤ 6 KB per concept.
- No libraries and no WebGL. The impact comes from meaningful parallel motion, not 3D, and Canvas2D handles 20 dots easily.

**Loading:**
- The H1 and lede stay the LCP. On phones the field sits between the H1 and the lede (§2).
- The field's start frame is server-rendered HTML text and boxes at a fixed px size, never an image or poster. No text inside it is larger than the H1.
- Bootstrap, 1 KB or less: `load` → `requestIdleCallback(start, {timeout: 1500})` → IntersectionObserver (rootMargin 200 px) → `import()`.
  - Safari has no `requestIdleCallback`; fall back to `setTimeout(start, 300)`.
  - The bootstrap sets `data-sc="pre"`, which hides result states until the module plays. If the module hasn't started by 6 s, it removes the attribute so the static final state shows.
- `brain-anatomy.js` is prefetched on idle 10 s after start, or on the first pointerdown or focus on a tile.

**Frame loop:**
- One rAF loop per page:
  - 60 fps while the field plays (ghosts are always moving);
  - 12 fps breathing while a receipt or zoom is open;
  - 0 when off screen, when the tab is hidden, when the visitor presses Pause, or after 90 s with no interaction (60 s on phones). It then shows "Play".
- Static edges and lane rails are pre-drawn to a bitmap. Rail motion is a canvas dash offset drawn inside the same loop.
- No SVG or CSS infinite animation anywhere in a showcase.
- Use OffscreenCanvas where it exists, otherwise a detached `document.createElement('canvas')`.
- Rects are read once and on ResizeObserver. C's leader-line anchors come from the 3D matrix maths, not from layout reads.

**Budgets:**
- Main thread: 4 ms or less per frame at 4× CPU throttle. No task over 50 ms.
- Total Blocking Time: no more than 50 ms above today's prototype.
- INP: 200 ms or less.

**Tiers:**
- devicePixelRatio is capped at 2.
- Chromium starts on the lite tier when `hardwareConcurrency ≤ 4`, `deviceMemory ≤ 3` or `saveData`.
- WebKit (iOS Safari, and the Instagram and Facebook in-app browsers on iPhone) has no `deviceMemory`, and its `hardwareConcurrency` is unreliable. It starts on the full tier with 12 ghosts, and the watchdog becomes the main tier signal.
- The watchdog steps down one tier when frames average over 20 ms for 2 s. It never steps back up within a page view.
  - full: 20 ghosts on desktop or 12 on phones, halos, 60 fps;
  - lite: 8 ghosts, no halos, DPR 1.5, 30 fps;
  - minimal: foreground only, 30 fps.

**Reduced motion:**
- Showcases follow `prefers-reduced-motion` and the member's "Reduce motion" setting, even under `MARKETING_MOTION = "always"`, as the pinned scenes already do.
- Any auto-playing motion longer than 5 s has a visible Pause button (WCAG 2.2.2).
- The zoom becomes a crossfade.

**Accessibility:**
- The canvas and the subtitle are `aria-hidden`. Every moment is also a real button with an accessible name.
- One polite live region announces only changes the visitor caused. The auto-demo announces nothing.
- Tabs and segments follow the ARIA patterns. Sliders carry `aria-valuetext`.

**Right-to-left:**
- Layouts use logical properties. Canvas paths come from DOM rects, so they mirror on their own.
- The scan highlighter sweeps right to left for Arabic.
- A native translator writes the `ar` strings.

**Production:**
- Today the scroll-scenes engine runs only on the home page ("No other page has scenes"). C's pin on `/trainer-brain` and B's pin on `/how-it-works` extend it:
  - mount the scenes head script and `scene-mount` on those pages;
  - one pin per page;
  - pins only on viewports at least 700 px tall, as today.
- C's anatomy recipe reads `c.t` for its one-time intro, so it registers with `{ ambient: true }`, which the engine test requires.
- A is a client island.

## 2. Concept A, "Live Brain": Mission control (home hero)

**In 5 seconds (phone and desktop):**
- Noura's message lands, and the safety bar lights her words "pop … knee … swollen … gives way".
- "STOP · No AI called" stamps across the dimmed Brain.
- Her dot drops down the red route into Training paused, while ghost dots keep flowing through the rest of the Brain.

**In 30 seconds, with no tap:**
- the subtitle narrates 6–8 moments, with one specialist lit per moment;
- Confidence holds Aisha's plan at 78% against her trainer's bar of 80%;
- a scripted press on "1 Waits for me" sends the chat tiles flying into Your Today and back;
- the edit "5 kg → 2.5 kg" becomes a new rule.

### Layout at 1440 (ink stage)

The container is unchanged: 1280 px, 12 columns, 24 px gap.
- **Copy:** columns 1–5, as today, on paper.
- **Field:** columns 6–12, 737 × 652 px, radius 12, `--sc-stage` with the dot grid.

**Field, top to bottom:**
1. **Header (32 px):** the mono eyebrow "A SAMPLE HOUR OF YOUR BRAIN" in muted. At the inline end: the legend (a pill for "AI specialist", a square for "Code, no AI") and the Pause button.
2. **Status strip (24 px):** the status sentence at 12 px, muted.
3. **Body (476 px):** three columns with 24 px gaps.
   - **Members (128 px):** 8 rows × 56 px.
     - Avatar 28 px with initials on `--sc-tint`, name 13 px/500, event icon.
     - A one-line message chip under the name; the full text is in the receipt.
     - The active row gets a Pace overlay at 12%.
   - **Brain frame (392 px):** a nodes area of 362 px, an 8 px gap and a 22 px rulebook spine at the inline end.
     - y 12: the label "Checks first" and a "Your rules" bracket spanning the band.
     - y 32: four squares of 84 × 48 px (Safety rules, Your topics, Memory, Rule finder).
     - y 88: the bus.
     - y 100–296: **the "Your Brain" shell.** A 1 px `--sc-control` border, radius 16.
       - Title row (16 px): the monogram "LS", "Your Brain", and the caption "Code picks one specialist per moment".
       - Rows of 48 px with 10 px gaps:
         - y 120: Reply picker, Draft writer, Plan writer;
         - y 178: Week reviewer, Meal photo reader, Voice lines;
         - y 236: Set logger (square, "code rule for workouts").
       - Pills are 112 × 48 px.
     - y 304: the bus.
     - y 316: the label "Checks after" and its "Your rules" bracket.
     - y 332: Checker, Confidence and Lane gate, 116 × 48 px each.
       - Confidence holds a 60 px gauge with the bar tick and the label "78% · your bar 80%".
       - On chat moments it shows "—", with the no-score tooltip.
     - y 392–420: the "Learns from you" strip: Privacy (a tiny square) → Learner (a small pill) → Examiner (a small square with its "uses your AI" badge), 28 px high.
     - y 436–464: the dashed "Not on yet" shelf, outside the shell: Meal planner and Recovery rule (corrected 28 Oct: only those not on yet under the page's flags; with nutrition on, the Meal planner sits beside the Set logger in row 3 on desktop).
     - **Rulebook spine** (y 32–380): the vertical card "Your method · 24 rules (sample)". Rule lines run from it to the nodes that cite a rule.
   - **Lanes (169 px):** older tiles collapse into "+n".
     - **Sent on its own** (190 px, 6 tiles). Fatima's tile carries the tag "Spot check".
     - **Your Today** (170 px). The header has the "LS" avatar and the title "Your Today"; tiles carry the chip "Waits for you". Under them, a separate row: "To check · already sent: n".
     - **Training paused** (100 px, 3 tiles).
     - Tiles are 28 px high, e.g. "Omar · +2.5 kg".
     - Counts are "in this sample hour", capped (Sent 12, Your Today 8, Paused 4), and reset each loop.
4. **Subtitle (28 px):** mono 13 px. It shows the foreground moment's `subtitle` with a 160 ms crossfade. A stop's matched words show in `#F08A80`. Between moments it reads "Tap any moment to see each step".
5. **Controls (56 px):**
   - **Brain level** segment: "1 Waits for me" / "2 Routine replies" / "3 Most replies", plus the chip "Last check: passed (sample)" with the tooltip "Level 2 needs a passing check of 20+ of your own cases."
   - **"How sure it must be to send alone (%)":** a 180 px slider showing "80%".
   - **"Supplement questions: I answer myself":** a toggle that starts on, with the sublabel "Your choice · off by default".
   - The lock chip **"Safety rules · can't switch off"**.
6. **Footer (28 px):** "Sample · scripted · no AI model called" · "A mix chosen to show every path. Not real rates." · the "How we count" link.

The whole hero is about 804 px tall, so it fits a 900 px viewport.

### Layout at 390: a phone-native vertical field

**Hero order on phones:** eyebrow → H1 (2 lines) → field → lede → CTA → secondary → micro line. This changes the layout, not the copy, but still needs the owner's OK (decision 5).

**Field size and fit:** 358 × 376 px, radius 12, ink.
- In today's shot the H1 ends at y≈200 and the consent banner starts at y≈770 at 390×844.
- So the field sits at about y 212–588, and the stop and all three lanes are visible above the banner.
- At 375×667, the lanes end at about y 520.

**Rows:**

| Height | Row |
|---|---|
| 24 | "A SAMPLE HOUR · SAMPLE", plus Pause (24 px target, 44 px hit area) |
| 72 | Incoming chat bubbles (first name and message, 13 px, up to 2 lines). They fall in from the top; 2 are visible at most |
| 28 | The "Checks first" bar: one bar with 4 icon cells that light in sequence, and a "Your rules" micro-bracket |
| 92 | The Brain ring: the "Your Brain" shell with "LS" at its centre, 6 AI icons on the ring (36 px pills) and the Set logger square at its foot, icons only. Tap opens the roster sheet. A dashed "Not on yet: 2" micro-chip sits at the corner |
| 28 | The "Checks after" bar: Checker, Confidence, Lane gate |
| 60 | 3 bins of 114 × 60 px: "Sent on its own", "Your Today" (with the LS avatar) and "Paused". Each shows its count and last first name; tap opens the list |
| 24 | Subtitle (12 px, one line, ellipsis) |
| 32 | The Brain level segment (1 · 2 · 3) plus "More settings": a bottom sheet at 45% height with the slider, toggle, lock and last check |
| 16 | "Sample · scripted · no AI · subscribers can't join yet"; tap expands the full status strip |

**Density on phones:** 1 foreground narrated moment, plus 12 ghosts (8 on lite, 0 on minimal).
- Ghosts drop from the bubble row and pass through the bars and the ring on true paths.
- They fade into the bins without changing the counts.

**Receipt on phones:** a bottom sheet at 85% height with focus trapped, holding C's flat plate list.

### Storyboard (time from activation)

**First frame** (server-rendered; also the no-JS state through `data-sc`):
- Noura's bubble has just arrived: "I heard a pop in my knee, now it's swollen and it gives way."
- Omar's dot sits on the lit Reply picker, with the bubble "Picked: back squat +2.5 kg".
- Ghosts are drawn as static dots on their paths.
- Lanes already hold: Sent (Fatima · Spot check, Sara), Your Today (Khalid), Paused (Mariam).
- With no JS, the result is shown: her matched words in red, the stamp, and her tile in Paused.

| t (s) | Event |
|---|---|
| 0.00–0.45 | Safety rules scans Noura's words with a Pace highlighter sweep |
| 0.50 | Matched words (pop, knee, swollen, gives way) turn `#F08A80` and are underlined. The Safety node turns red and shakes. "STOP · No AI called" stamps over the shell (scale 1.12→1, 180 ms). Hit-stop: every other dot and ghost freezes for 400 ms. The shell and the after band dim to 35% |
| 0.90–1.50 | Red route along the frame's inline-start and bottom edges into Training paused; the count goes 1→2. The dim lifts over 300 ms and the ghosts resume |
| 1.3 | Omar: a Checker tick, with a rule line to Checker ("cites your rule"); Lane gate, with a rule line (level 2, last check passed); his tile lands in Sent |
| 2.2 | Aisha: checks tick 110 ms apart. Week reviewer streams "Next week: squat 62.5 kg" (40 characters/s, caret, basis tag). An amber warning on Checker. Confidence fills to 78% against its 80% tick and bounces. The dot turns amber and lands in Your Today at 5.0 |
| 3.4 | Priya: Meal photo reader, "4 items · all unsure". The dot returns to her row with the tag "Priya confirms" |
| 5.2 | Fatima: Plan writer streams "4-week plan · 3 sessions a week". The gauge passes at 86%, and her tile lands in Sent tagged "Spot check". The "To check · already sent" row goes 0→1 |
| 6.6 | Zayed: Rule finder says "No approved reply for upper body yet". Draft writer streams 'Draft: "Add 5 kg next time."'. His tile lands in Your Today |
| 8.0 | **Auto-demo:** a press ring appears on "1 Waits for me", with a "Demo" chip. The Lane gate note shows the level 1 summary. Chat tiles fly from Sent into Your Today (FLIP 420 ms, 40 ms stagger). Plan and code-rule tiles stay put |
| 11.0 | A press on "2 Routine replies": the tiles fly back. The note shows the level 2 summary and "Level 2 needs a passing check of 20+ of your own cases." |
| 12.5 | Khalid: Your topics turns amber, "No AI called", "Your choice: you answer supplements". His tile lands in Your Today |
| 14.0 | Sara: Safety shows "Say pain or tap Stop". Voice lines lights ("Lines ready"). Her "too heavy" bubble passes a Safety tick. Set logger shows "Your 10% rule → 54 kg". Her tile lands in Sent, tagged "Your rule, applied by code" |
| 16.5 | **Learning loop** (Zayed's draft, t7):<br>• the LS avatar pulses and his tile opens inline;<br>• "5 kg" is struck through and "2.5 kg" is typed (12 characters/s);<br>• the chip "Privacy: name becomes [client]" appears;<br>• a line draws to Learner (700 ms), which streams "Suggests: Upper body increments";<br>• Checker ticks; "Make this a rule?" turns to "Confirmed";<br>• Examiner sweeps (600 ms) with the tag "About a minute later", then "Passed · live";<br>• the rulebook rolls 24→25 and the new rule card slides into the spine |
| 20 | A nudge ring on Brain level. The subtitle reads "Your turn: set Brain level to 1, or tap any moment to see each step" |
| 20–75 | A seeded (mulberry32, seed 7) playlist weighted by `weight`, with t3 left out unless its flag is on:<br>• 1–2 foreground moments at once (1 on phones), a new one every 2.4–3.6 s;<br>• stops about 1 in 8, and never within 6 moments of the last one;<br>• ghosts spawn every 300–500 ms with the same weights. They follow true paths and never visit Not-on-yet nodes |
| 75 | The sample hour ends: bins fade (400 ms), counts reset to the first frame, and the subtitle reads "New sample hour". Playback continues until the 90 s idle pause (60 s on phones) |

### Interactions

**Tap or press Enter on a tile, member row or bubble** to see the receipt.

- **On desktop: a semantic zoom.**
  - The field scales 1→2.2 around that moment's path (420 ms, `cubic-bezier(.4,0,.2,1)`), and the rest fades to 15%.
  - C's plates for that trace explode in the Brain frame (600 ms: rotateX 56°, rotateZ −32°, 28 px apart), then lie flat as the receipt.
  - Receipt sections, following C's (a)–(j):
    1. The message.
    2. Step by step: each row shows a glyph, name, kind tag and what it said. AI rows stream `out.reason` at 40 characters/s with their basis tag.
    3. Your rule.
    4. How sure: plans get a % bar and the verbatim reasons; chat gets the no-score line.
    5. What {name} sees, with provenance highlights.
    6. What you see, in product wording, e.g. "Confidence 0.78 is below your threshold 0.80".
    7. Where this comes from.
  - Buttons: Replay, "Change this setting", CTA, and "Back to the Brain" (also Esc).
  - The field pauses, with the caption "Paused while you read".
- **On phones:** the same flat plate list in the 85% bottom sheet.

**Brain level.** Uses the verbatim summaries (§1.5).
- Chat tiles move lanes with FLIP; code-rule and plan tiles stay put.
- Levels 2 and 3 send chat only while the last check is passing.

**Plans slider** (50–99%, step 1, debounced 120 ms):
- Aisha's tile crosses lanes at 78%, and Fatima's at 86%.
- The gauge tick moves, and Fatima's spot-check row follows her tile.

**Supplements toggle.** It starts on. Turning it off keeps Khalid's tile in Your Today with the sub-label "Drafted for you". The Topics node notes "Supplements still never send on their own."

**Safety lock.** It shakes, and the tooltip reads "Safety rules can't be switched off. You can only make them stricter."

**Arrow keys** move between tiles within a lane (roving tabindex).

### Motion spec

| What | Spec |
|---|---|
| Continuous | Ghosts (3 px, paper at 35%) on true paths. Lane rails drawn in canvas: dash 3 3, offset loop 1.6 s. Matrix breathing. All of it runs in the one loop |
| Spawn | Bubble falls in over 240 ms (translateY −12→0 plus opacity). Dot scales 0→1 in 160 ms |
| Travel | Orthogonal routes, corner radius 10. Legs of 320–520 ms. The foreground trail is 1.5 px Pace fading over 600 ms; ghosts have no trail |
| Code picks | The dot goes straight from the bus to the picked node. "Code picks" flashes on the shell for the first two moments only |
| Checks | 110 ms per node; tick stroke 120 ms |
| AI step | Fill in 140 ms. Matrix sparkle for 900–1300 ms. Bubble streams 8–12 words at 40 characters/s with a caret, then holds 1.4 s. Basis tag |
| Rule line | 1.5 px Pace: draws in 240 ms, holds 400 ms, fades over 600 ms |
| Confidence | The gauge fills in 420 ms. Below the bar: translateY −4→0 on `--ease-spring` |
| Stop | Scan 450 ms → red → shake 240 ms → stamp 180 ms → hit-stop 400 ms → dim 120 ms → red route 600 ms ease-in |
| Tile land / re-sort | Land: 280 ms `--ease-enter`. Re-sort: FLIP 420 ms, 40 ms stagger. Count rolls 280 ms, capped (`aria-hidden`; the real number is text) |
| Auto-demo press | A 32 px ring, scale 0.8→1 plus opacity, 300 ms, with the "Demo" chip |
| Zoom | Scale 1→2.2 in 420 ms, plates explode in 600 ms |

**Rendering:** HTML nodes, tiles and bubbles, plus one Canvas2D overlay (`pointer-events: none`, `aria-hidden`) for edges, particles, halos and matrices. Only opacity and transform animate.

**Reduced motion:**
- A static frame after the stop: Noura is paused, the lanes are filled, and there are no ghosts.
- Tiles open receipts without the zoom.
- "Play the field" crossfades state changes every 2.5 s, with the subtitle.
- Controls re-sort instantly, and there is no auto-demo.

### Where it lives

| Page | Treatment |
|---|---|
| Home | The hero; on phones the field sits between the H1 and the lede. Band 2 is "Change a setting. Watch it re-sort." Tapping a moment zooms into C. The journey band stays the page's one pin |
| `/demo` | The field at full width, then the playground |
| `/trainer-brain` | The roster with status chips and "How we count"; clicking a specialist filters the field to its moments. Then §3 (C), then the playground |
| `/how-it-works` | B. No mini field |
| `/features` | Node vignettes: Safety → the stop; Nutrition → Meal photo reader, with Meal planner marked "Not on yet"; Voice coach → safety line + Voice lines + Set logger; AI training plans → Plan writer + Confidence |

## 3. Concept B, "Beyond Your Hours": 24 hours of your Brain (`/how-it-works` only)

**In 5 seconds:** a big clock, "You: coaching in person" on one track, and Brain events firing on the other, with dense ghost events along it.
**In 30 seconds:** the Today list fills while you work, you clear it in one evening check, and your edit becomes a rule.

**Placement:** `/how-it-works` only, as its one pinned scene on viewports at least 700 px tall. Home keeps its journey band. The status strip and honesty chip sit in the top row of the pinned stage.

### Desktop (1440)

Pinned, `data-scene="day"`, `--len: 360`, on an ink stage. Rows A, B and C are as in round 1 (clock; You card; Your Today; sun arc; You strip; Brain strip; playhead; Right now card; phone; Today list), with these changes:
- **Brain strip:** named event dots (12 px), plus 48 seeded ghost ticks (4 px) at 35% that light as the playhead passes.
  - Stops are about 1 in 8, in `#F08A80` at 35%.
  - The label is "Other sample moments".
- **Right now card:** 4 squares → a "Code picks" line → the specialist node → 3 squares → the lane chip.
- **Day and night:** a 6% paper wash on the stage by day (06:00–17:30), fading to none by 19:30 and back by 06:00. This replaces `--sc-night`.

### Beats

The intro takes 0.04 of p, the 7 beats take 0.12 each, and the outro 0.12. Times are sample times, Dubai time.

| # | Time | Beat |
|---|---|---|
| 1 | 07:30 | Sara (t5): safety line → Voice lines → "too heavy" screened → Set logger, 54 kg |
| 2 | 09:00 | Aisha (t8) → Today card "Your Brain suggests a plan change" (78% · your bar 80%) |
| 3 | 12:30 | Priya (t4) |
| 4 | 14:00 | Fatima (t10) → Sent, spot check → Today card "Check a plan your Brain sent" |
| 5 | 17:45 | Omar (t1) → Sent on its own |
| 6 | 19:20 | Noura (t2) → "Training paused: a safety report" goes to the top of Today |
| 7 | 21:00 | You check Today, safety first. Zayed's draft: you edit 5 kg → 2.5 kg → Privacy → "Make this a rule?" → Confirmed → about a minute later the Examiner passes → "Passed · live" |

- **Outro (no clock time):**
  - Khalid's creatine question waits in Today, due within 72 hours.
  - Once a week, the Weekly learner suggests rules from your edits; they wait for your OK.
- **Recovery flag on:** Hamdan (t3) is inserted at 06:10, giving 8 beats within the same `--len`. With the flag off, the scene never opens on a Not-on-yet beat.
- **Inside a beat** (local progress q):
  - 0–0.15: the clock digits roll, and the playhead and sun move;
  - 0.15–0.30: checks light;
  - 0.30–0.35: "Code picks";
  - 0.35–0.55: the specialist, with its text revealed in proportion to scroll;
  - 0.55–0.62: checks after;
  - 0.62–0.70: lane chip and phone message;
  - 0.66–0.72: the Today card enters;
  - 0.70–1: hold.
- Everything is a pure function of p.

### Phone (390)

Not pinned. A player card, as in round 1:
- 7 beats of 4.2 s each plus a 4 s outro, about 33 s in all;
- ghost ticks on the mini track;
- the status strip inside the card;
- the range input's `aria-valuetext` names the beat, e.g. "07:30, Sara's voice session".

### End card, rendering and reduced motion

- **End card:** "In this sample day: 3 within your rules · 1 member check · 3 waited for you · 1 paused · 1 new rule". With the recovery flag on, it reads "4 within your rules".
- **Rendering:** HTML and CSS transforms plus one inline SVG, with no SVG or CSS infinite animation.
- **Reduced motion:** no pin and no autoplay; static hour cards in their final state.

### Where it lives

| Page | Treatment |
|---|---|
| `/how-it-works` | The pinned day; static hour cards under reduced motion or under 700 px tall |
| `/features` | Static hour labels, e.g. "12:30 · Meal photo" |

## 4. Concept C, "The Method": Anatomy of a decision

**In 5 seconds:** as the section comes into view, the reply card bursts once (1.2 s, automatically) into a stack of labelled layers on ink.
**In 30 seconds:** checks surround one AI specialist that code picked, and "Not one word Omar reads was written by AI. Your words, plus numbers from your rule."

**Placement:**
- `/trainer-brain` §3, "How it decides", pinned; it is that page's one pin.
- On home, C appears only through A's zoom (receipt mode, not pinned).
- `/how-it-works` cites "see Fig. 3b" and links to it.

### Desktop

The 8 + 4 grid (max 1200), `data-scene="anatomy" data-pin --len: 520`, on an ink stage.
- **Stage:** columns 1–8, sticky at top 72, height 100svh − 72 px. All ancestors use `overflow: clip`, never `hidden`, because `hidden` flattens `preserve-3d` in Safari.
- **Plates:** 9 of them, 520 × 96 px, radius 2.
  - AI plates: Pace at 14% over `--sc-node`. Code plates: `--sc-node` with a 1 px `--sc-line`. No shadows.
  - Inside `perspective: 1600px; transform-style: preserve-3d`, the stack is `rotateX(56deg) rotateZ(-32deg)`; plate i sits at translateZ(−i × 56 px) when exploded.
- **Margin notes:** columns 9–12, in `--sc-text` and `--sc-muted`, with letters (a)–(j).
- **Leader lines:** SVG, at most 2 animating at once. Their anchors are projected in JS from the known transform (perspective, rotations, translateZ per plate) and the stage size read on ResizeObserver. No rect reads happen in the scroll loop.

### Scroll steps

| p | Step |
|---|---|
| On view (time-driven, once) | **Intro:** the card "Answered Omar · Sent on its own, within your rules" explodes over 1.2 s, and the leader lines draw. Caption: "Fig. 3 — Omar asks to go up in weight. Sample, scripted, no AI model called." Scrolling first snaps it to the scroll state |
| 0–0.06 | **Exploded hold** (scrolling back to 0 stays exploded) |
| 0.06–0.78 | **Inspect** (a)–(i), 0.08 each |
| 0.78–0.90 | **(j) Correction:** the plate "Upper body increments" drops in and is stamped "Confirmed", then "About a minute later: check passed · live" |
| 0.90–1 | **Recompress** into the card. The What-if row appears and persists |

**What happens during an inspection.** As in round 1: the inspected plate comes forward flat and the others drop to 0.35. Content effects, all scrubbed:
- (a) the message;
- (b) the Pace highlighter sweeps the scanned words, ending in "clear";
- (e) four check rows tick;
- (f) **changed:**
  - the seven coaching pills sit in an arc, each labelled with its moment: "Reply picker · a rule fits", "Draft writer · no rule fits", "Plan writer · new plan", "Week reviewer · week ends", "Meal photo reader · meal photo", "Voice lines · before a voice session", and "Meal planner · Not on yet" (dashed);
  - a straight line from the tag "Chat · a rule fits" lights only the Reply picker. There is no sweep;
  - the label reads "Code picks the specialist. No AI chooses which AI runs.";
  - then the reason text reveals in proportion to scroll;
- (g) three ticks, with a rule line to "cites your rule";
- (h) the lane chip;
- (i) Omar's bubble with the provenance marks and the hollow chip "AI words: none".

**Ghost stacks at (f).** The camera pulls back (scale 1→0.88). Three faint stacks light at the same time, each lighting only its own node:
- Aisha → Week reviewer;
- Priya → Meal photo reader;
- Noura → a red Safety plate, which stops before any specialist.

### Phone (390)

As in round 1, on ink:
- the intro becomes a fan-out over 0.9 s;
- 6 steps, `--len-phone: 330`;
- viewports under 700 px tall get no pin, only static flat plates.

### After the pin

**Fig. 4, "Try another moment":** a flat 2D list of the plates with three What-if buttons, each replaying a 2.4 s time-driven version.
- **Knee:** (b) turns red with the matched words and "STOP · No AI called"; (c)–(h) read "Not reached · no AI called"; (i) shows the paused notice.
- **Plan:** (f) becomes the Week reviewer (code picked it: the week ended); (g) adds Confidence 78% · your bar 80%; (h) becomes "Waits for you"; (i) "What you see" shows "Confidence 0.78 is below your threshold 0.80".
- **Level 1:** (h) becomes "Waits for you", with the level 1 summary.

**Receipt mode (for A):** `anatomy.open(traceId, {from: rect, mode: "receipt"})`. It works for any trace: a 600 ms time-driven explode, then the flat list. No pin.

**Rendering:** HTML plates with CSS 3D through `scroll-scenes` (inline transforms only while moving), SVG leaders, no canvas.

**Reduced motion:** Fig. 3a–3j as stacked flat plates with all notes; no intro; the What-if buttons swap instantly.

### Where it lives

| Page | Treatment |
|---|---|
| `/trainer-brain` §3 | Pinned (the page's one pin) |
| Home | Through A's zoom |
| `/features` | A "Fig." plate per feature (that feature's layer) |

## 5. Shared playground: "Throw a moment at your Brain"

Lives on `/trainer-brain` and `/demo`.
- **Skin:** with the recommended mix, A's mono console on ink, with C's receipt plates. C's worked-example skin is used only if C is chosen alone.

### Desktop layout (3 / 6 / 3 columns)

**Picker:**
- the "Your specialty" select (Strength, Weight loss, Muscle gain, Pre- and postnatal), which only reorders the chips;
- the 12 preset chips; "Low recovery" carries "Not on yet" unless the flag is on;
- a textarea (2 rows, 140 characters) with "Run it";
- a secondary "Throw them all" button.

**Stage (616 × 560 px, ink):**
- the status strip along the top inside the stage, then the message bubble (Arabic right-to-left, with its gloss);
- checks first;
- the "Your Brain" shell: 6 live AI pills in rows of 3 + 3, plus Set logger;
- the Not-on-yet shelf: Meal planner and Recovery rule (corrected 28 Oct: the Meal planner moves into the shell once nutrition is on, leaving the Recovery rule; a moment whose specialist is not on yet shows "Built and tested. Not on yet." and does not play);
- checks after;
- the rulebook spine;
- static edges, with 8 or fewer dash animations at once, drawn in the one loop;
- the panel "What each step said": AI `out` fields stream at 40 characters/s with a caret; code steps appear whole; never chain-of-thought.

**Result:**
- the lane chip;
- the member phone with provenance highlights;
- the Today card;
- the rule card;
- Confidence, for plans only, in % (the verbatim reason sits in "What you see");
- "Change and run again", showing only the trace's `controls`;
- the CTA "Teach your AI — free".

**Phone layout:** a horizontal row of chips with scroll-snap, then the compact stage, the result, a "Change a setting" disclosure and a "Step by step" disclosure.

**Specialty order** (traces by number, first 6 shown on phones). With the flag off, t3 renders as the dashed card.
- Strength: 1 6 8 2 5 10 3 9 7 4 11 12
- Weight loss: 4 10 8 9 2 1 3 6 7 5 12 11
- Muscle gain: 10 1 8 9 4 6 5 2 3 7 12 11
- Pre- and postnatal: 11 2 12 10 5 4 9 1 8 6 3 7

### States

| State | Behaviour |
|---|---|
| Idle | Dim nodes; placeholder "Pick a moment above" |
| Running | Steps at JSON timings (speed 1). A "Code picks" line goes from the moment's kind straight to its one specialist. Chips are `aria-disabled`; a "Skip to result" link is offered |
| Resolved | Announces "Result: {lane}" |
| Changed | "Run it again" becomes primary; a ghost of the previous lane chip remains |
| Replaying | Steps before the first affected one stay ticked; only the affected steps re-light and flow down differently |
| Low recovery, flag off | No run and no pulse. A dashed static receipt from the tests: "Built and tested. Not on yet." |
| Throw them all | 12 mini stacks (4 × 3 on desktop, 2 × 6 on phones) at speed 0.6 with a 120 ms stagger, using A's canvas module. t3 shows as a dashed card unless its flag is on. Ends with `labels.totals`: by default "In this sample: 3 within your rules · 1 member check · 3 waited · 3 paused · 1 new rule"; with the flag on, "4 within your rules". Tap any one to open it in the main stage |
| No JS | t1 shown resolved, as static HTML |

When a setting changes, a diff line explains it, e.g. "Before: Sent on its own. Now: Waits for you. Why: 2.5 kg is 4.2%, over your 3% cap."

### Free text

A local keyword table picks the closest sample. No network call.

| Keywords | Trace |
|---|---|
| pain, hurt, injur, pop, swell, knee | t2 |
| chest, dizzy, faint, numb, ألم, يعور, دوخة, صدري | t12 |
| pregnan, حامل | t11 |
| creatine, supplement, protein powder, pre-workout, vitamin, medication | t9 |
| deload, skip, rest week | t6 |
| easy, heavier, add weight, go up, RIR | t1 |
| photo, meal, ate, lunch, calories | t4 |
| tired, sleep, recovery, whoop, HRV | t3 (the dashed card while the flag is off) |
| new, plan, programme | t10 |
| week, next week | t8 |
| voice, talk, session | t5 |
| anything else | t1 |

- It always shows: "Closest sample: {chip}. This page can't read new messages."
- Running the real safety rules in the browser stays off by default; the owner decides.

## 6. Copy

All strings are grade 6. One CTA: "Teach your AI — free". Changes to existing copy need the owner's approval (decision 18).

### A

| Item | Copy |
|---|---|
| Eyebrow | "A SAMPLE HOUR OF YOUR BRAIN" |
| Bands | "Checks first", "Your Brain", "Checks after", "Learns from you", "Not on yet" |
| Shell caption | "Code picks one specialist per moment" |
| Rulebook | "Your method · 24 rules (sample)" |
| Lanes | "Sent on its own" (the full string is in the chip), "Your Today" (chip "Waits for you"), "Training paused", "To check · already sent" |
| Tags | "No AI called", "STOP · No AI called", "Spot check", "Your rule, applied by code", "Privacy: name becomes [client]", "About a minute later", "Passed · live", "Demo" |
| Bubbles | "Picked: back squat +2.5 kg", "Asks for your review", "Next week: squat 62.5 kg", "4-week plan · 3 sessions a week", "4 items · all unsure", "Lines ready", "Say pain or tap Stop", 'Draft: "Add 5 kg next time."', "Suggests: Upper body increments" |
| Subtitles | `trace.subtitle` from the JSON |
| Controls | The level names and summaries verbatim; "Level 2 needs a passing check of 20+ of your own cases."; "Last check: passed (sample)"; "How sure it must be to send alone (%)"; "Supplement questions: I answer myself" with "Your choice · off by default"; "Safety rules · can't switch off" |
| Band 2 H2 | "Change a setting. Watch it re-sort." |
| Band 2 lede | "Your settings apply to every moment at once. Make it stricter and more waits for you. Safety rules never switch off." |
| Receipt headings | "The message", "Step by step", "Your rule", "How sure", "What {name} sees", "What you see", "Where this comes from" |
| Provenance key | "Your words", "Numbers from your rule", "AI words" |

**Screen-reader summary:** "A sample animation. Messages from sample subscribers pass through code checks, then one AI specialist that code picks, then more code checks. Each ends sent on its own, waiting for you, or paused. Below it, every moment is listed as a button."

**Optional hero lede (needs approval):** "Specialists inside your AI handle every message. Code checks every step. You decide what goes out."

### B

| Item | Copy |
|---|---|
| H2 | "While you coach, it coaches" |
| Lede | "Scroll through a sample day. Your AI handles routine work within your rules. Anything unsure waits in your Today list." |
| You states | "You: coaching in person", "You: lunch", "You: checking Today", "You: asleep" |

**Beat captions:**
1. "Sara trains with your voice. It starts with your safety line. Code logs her reps and follows your too-heavy rule."
2. "Aisha's week ended. Your AI suggests next week. It's 78% sure and your bar is 80%, so it waits."
3. "Priya snaps her lunch. Your AI estimates it. Nothing is saved until she confirms."
4. "Fatima finished her intake. Your AI writes her first plan. It's 86% sure, so it goes out, and you get a spot check."
5. "Omar's squats felt easy. Your AI picks your approved reply. It sends on its own."
6. "Noura's knee popped. Safety rules pause her training at once. No AI is called."
7. "You open Today. Safety first. You edit one reply, and your AI asks to make it a rule. About a minute later a check runs. It goes live only if it passes."
- **Outro:** "Overnight, Khalid asks about creatine. You chose to answer supplements yourself, so it waits in Today, due within 72 hours. Once a week, your AI reads your edits and suggests new rules. They wait for your OK."
- **Hamdan (flag only):** "Hamdan's recovery is low. You turned on your recovery rule and he opted in, so code lightens his workout. No AI."

**End card:** H3 "Your method worked all day." Body: the totals sentence, the subscribers strip, then the CTA.

### C

| Item | Copy |
|---|---|
| Eyebrow | "§3 How it decides" |
| H2 | "Anatomy of one decision" |
| Lede | "One reply, taken apart. Fixed checks before and after. One AI specialist in the middle. Your rules at every layer." |

**Margin notes:**
- (a) The message: "Omar logged four sets with 2 reps in reserve. He asks to go up."
- (b) Safety rules: "Read first, every time. Pain or red flags stop here. Nine kinds, in English and Arabic."
- (c) Your topics: "Topics you chose to answer yourself, like supplements. Not this one."
- (d) Memory: "His intake and his last 28 days of training. Facts from your app only."
- (e) Rule finder: "Which approved replies fit? One: +2.5 kg. That's 4.2%, inside your 5% cap."
- (f) One specialist: "Seven coaching specialists. One is not on yet. Code picks one from the kind of moment. A rule fits, so it's the Reply picker. It picks. It never writes." With the label "Code picks the specialist. No AI chooses which AI runs."
- Ghost stacks: "Meanwhile, other members' moments run at the same time. One specialist each."
- (g) Checks after: "Does it cite your rule? Only facts it was shown? Nothing changed meanwhile? All pass."
- (h) The lane: "Your Brain is at level 2 and passed its last check. So it sends on its own."
- (i) What Omar reads: "Your words, plus one line of numbers from your rule. No AI wording."
- (j) Your correction: "Edit any reply. Your AI suggests a rule. You confirm. About a minute later, your AI answers your test cases and code marks them. It goes live only if they pass."

**What-if buttons:** "What if his knee popped?", "What if it's a plan change?", "What if you're at level 1?"

### Playground

| Item | Copy |
|---|---|
| H2 | "Throw a moment at your Brain" |
| Lede | "Pick something a member might say. Watch each check and specialist work. Then change a setting and run it again." |
| Chips | "Squats felt easy", "My knee popped", "22 weeks pregnant", "Chest pain (Arabic)", "Skip my deload?", "Creatine question", "Week is over", "First plan", "Meal photo", "Low recovery" (+ "Not on yet"), "Voice session", "You edit a reply" |
| Placeholder | "Or type what a member might say" |
| Buttons | "Run it", "Throw them all", "Change a setting", "Run it again" |
| Panel | "What each step said" |

### Round-one corrections (needed whatever the choice)

- **A hero:** remove "86%", "How sure it is" and "Your bar 80% · above it, it acts" from the chat decision; show them only on plan examples. Replace "Applied automatically" with "Sent on its own, within your rules". Use the fixture message, not "Week three done. Squats felt easy."
- **A `/trainer-brain`:** "Pain, medical, red flags → pause" merges two paths. Medical topics go to "Waits for you" as a personal review; only red flags pause.
- **C ledes:** "acts alone only when confident" is wrong for chat. Proposed: "Routine replies use your approved words. Anything else waits for you."
- **Roster pages:** "Rep counter" → "Set logger"; "Sure score" → "Confidence"; "Fixed check, no AI" → "Code, no AI".

## 7. Ranking and risks

**Review scores (1–5), before these fixes:**

| | Oomph, 5 s on a phone | 30 s grasp | Accuracy | Buildable at 60 fps |
|---|---|---|---|---|
| A, Mission control | 2 (desktop 4) | 3 | 3 | 4 |
| C, Anatomy | 3 desktop, 2 phone | 5 | 4 | 3 |
| B, 24 hours | 2 | 2 | 2 | 3 |

**What targets each gap:**
- **Phone oomph:** the vertical field above the fold, the stop at 0.5 s, the ink stage, ghost density.
- **30-second grasp:** the subtitle, the auto-demo, the visible shell, rulebook lines and trainer.
- **Accuracy:** the P0 fixes in §1.
- **C on phones:** the auto intro.

**Ranking: A > C > B.**

**Risks:**
- **A:** density at 390 px (now a vertical field); reading as live traffic (handled by the eyebrow, capped and reset counts, and the status strip inside the field); Instagram WebView frame rate (the watchdog is the main tier signal on iOS); reading as a developer dashboard (the ink stage and subtitle make it a story).
- **C:** slower to grasp; the pin extends scroll scenes to `/trainer-brain`; Safari 3D (`overflow: clip`); iOS toolbar resizing (heights in px).
- **B:** it depends on things that are off (subscribers, possibly WHOOP); it risks lifestyle over-promising (the end card wording guards against it). It is off the home page now.

**Build order:**
1. A's field and core, plus C's receipt mode (for the zoom).
2. C's pinned anatomy.
3. The playground.
4. B.

**Test before choosing:** 5-second and comprehension tests with UAE trainers, run on a phone's first screen. Ask: "What does this do? How many parts decide? What happens when a member reports pain? What would you do next?"

## 8. Owner decisions, and QA for the rebuild (task #5)

### Decisions needed

1. Scope the motion exception and the ink stage to `[data-showcase]` sections: continuous motion, canvas, capped sample counts, pinned scenes. Record it in `docs/features/marketing-motion.md`.
2. Showcases follow reduced motion even under `"always"`.
3. The live values of `WHOOP_TRAINING_APPROVED` (t3 stays hidden until confirmed), `NUTRITION_ENABLED`, `NUTRITION_SCOPE_APPROVED` and voice add-on availability.
4. The public names, including "Set logger" and "Confidence". Then either publish "14 AI specialists and 11 code steps" with "How we count", or show no number.
5. The copy set, including the corrections and the phone hero order (field between the H1 and the lede).
6. The mix:
   - A as the home hero with the zoom into C;
   - C pinned on `/trainer-brain` §3;
   - B pinned on `/how-it-works`;
   - home keeps the journey band as its one pin.
   This extends scroll scenes beyond the home page.
7. In-browser safety rules for free text (default: no).
8. Arabic strings from a translator.
9. The four `verify` items (t6, t9 and t7 × 2).

### QA for the rebuild

- **Data and maths:**
  - the JSON matches the schema;
  - the verbatim test, including the level summaries, the slider label, the reason strings and `VOICE_SAFETY_LINE`;
  - the browser maths matches the domain functions (through `tsx`), including % rounding;
  - the highlight-word test;
  - totals recomputed from the lanes equal `labels.totals`.
- **First screen on phones:**
  - At 390×844 with the consent banner open, Noura's matched words, the STOP stamp and the Paused bin are fully visible above y 770 within 2.5 s of load, at 4× CPU throttle.
  - At 375×667, the lanes are visible.
- **Rules checked by tests:**
  - text contrast on the ink stage is at least 4.5:1, and UI boundaries and the stop route at least 3:1;
  - no CSS or SVG infinite animation inside `[data-showcase]`;
  - no image or poster for the field;
  - the H1 is the LCP element at 390 and 1440 px;
  - counts hit their caps and reset at the end of each loop;
  - t3 is absent by default from A, B and the totals.
- **Screens:** Playwright at 390 and 1440 px of:
  - the first frame;
  - the stop at 0.5 s;
  - mid-run with ghosts;
  - the auto-demo at level 1;
  - the zoom or receipt open;
  - threshold 75% and 90%;
  - each B beat;
  - each C step;
  - reduced motion (emulated);
  - right-to-left;
  - no horizontal overflow;
  - plus a WebKit iPhone project for the requestIdleCallback and OffscreenCanvas fallbacks and the 3D stage.
- **Performance:** p95 frame time at 20 ms or less under `Emulation.setCPUThrottlingRate 4`. The watchdog steps down when slow frames are forced. Lighthouse mobile LCP, TBT and CLS are no worse than today.
- **Keyboard:** tiles, tabs, sliders, and the zoom, sheet or drawer with Esc.
- **Pausing:** the field pauses when off screen, in a hidden tab, after idle, and on Pause.

## Changelog (round 1 → round 2)

**P0, accuracy:**
- **Examiner:** described as "your AI answers your test cases; code marks them", with a "uses your AI" badge, and shown about a minute after the edit (`RECHECK_DELAY_SECONDS` is 60).
- **Names and counts:** Rep counter renamed Set logger, and Sure score renamed Confidence (shown in %). The legend reads "Code, no AI", the claim is "14 AI specialists and 11 code steps" with a "How we count" note, and the Not-on-yet shelf sits outside the shell.
- **Recovery rule:** off by default everywhere; turned on by flag, with the "you turned it on, the member opted in" caption.
- **Supplements:** the toggle starts on as the trainer's choice, labelled "off by default"; B's copy says "you chose".
- **Product wording:**
  - verbatim Brain level summaries, plus the 20+ cases note and the last-check chip;
  - the product slider label, "78% · your bar 80%", and the reason string only in "What you see";
  - the spot check moved to the Sent tile, plus a "Check a plan your Brain sent" row.
- **Learning loop (t7):** rebuilt as Zayed's Draft writer tile, with the typed edit and a Privacy step in place of Memory. Two `verify` items were added.
- **B timings:** the invented ones are removed (no 23:30 Examiner, no Sunday 05:00); Khalid's deadline is 72 h.
- **Totals:** corrected to 4/1/3/3/1, or 3 within your rules with the recovery flag off.
- **t5:** gets the safety line and pain screening of spoken replies.
- **Code picks the specialist:** C(f) has no sweep, and A has no scanning.
- **Eyebrow and status:** "A SAMPLE HOUR OF YOUR BRAIN"; counts capped and reset; the status strip inside every stage.
- **Tooltips:** one per specialist (the Plan writer's checked against `trainer-preview.ts`).
- **Section 0:** owns the miss and says "in the sites we reviewed".

**P1, oomph:**
- a phone-native vertical field above the fold, with the stop at 0.5 s;
- an ink stage from existing dark tokens, with contrast computed;
- two layers: 1–2 narrated moments plus 12–20 ghosts;
- a live subtitle;
- a cinematic stop (scan, red words, stamp, hit-stop, dim);
- the "Your Brain" shell with "Your rules" brackets and rulebook lines;
- streamed AI bubbles at 40 characters/s;
- the auto-demo on Brain level;
- a visible trainer (Your Today with an avatar, the typed edit);
- playlist weights with stops about 1 in 8.

**P2, per concept:**
- A's tap is a semantic zoom into C's plates (a sheet on phones).
- C auto-plays its explode once, projects its leader anchors in maths, and uses `overflow: clip`.
- B goes to `/how-it-works` only: 7 beats, `--len` 360, ghost ticks, no Not-on-yet opening, the status strip in the stage.
- The A/B/C mix is stated.

**P3, build:**
- canvas-drawn rails, and no SVG or CSS infinite animation;
- fallbacks for `requestIdleCallback`, `deviceMemory` and OffscreenCanvas;
- the watchdog is the main tier signal on iOS, with three tiers;
- no image poster, and fonts load after first paint;
- capped counts.

**Data:**
- `brain-traces.json` is now @2: renames, per-specialist tooltips, weights, subtitles, the t5 and t7 fixes, % display, totals, verbatim level strings, t2's computed highlight words and the `verify` tags.
- Round 1 is kept as `brain-traces.r1.json`.
- Reproduce the fixes with `node patch-r2.cjs` then `node patch-r2b.cjs` on the round-1 copy.

Files are in `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/showcase/`:
- brain-traces.json
- brain-traces.r1.json
- patch-r2.cjs
- patch-r2b.cjs