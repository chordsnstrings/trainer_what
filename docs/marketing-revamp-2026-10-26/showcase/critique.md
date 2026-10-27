**Verdict:** The honest model underneath is right, and the data and verification plan are excellent. As specced, though, it is not yet "oomph" on a phone, and it has about 15 accuracy slips. A is the right hero and C is the right deep-dive. B is the weakest and should leave the home page.

## Scores (1–5)

| | Oomph, 5 s on a phone | 30 s grasp | Accuracy | Buildable at 60 fps | Distinct |
|---|---|---|---|---|---|
| A Mission control | 2 (desktop 4) | 3 | 3 | 4 | yes (scale) |
| B 24 hours | 2 | 2 | 2 | 3 | partly (a slower, sequential A) |
| C Anatomy | 3 (desktop), 2 (phone) | 5 | 4 | 3 | yes (depth) |

## P0: Accuracy and honesty (fix before building)

1. **The Examiner is not "no AI".** `apps/api/src/brain-check.ts:42` says "Background checks run model calls one after another". Describe it as "Your AI answers your test cases; code marks them".
2. **"Rep counter" overstates.** In `packages/domain/src/voice-runner.ts:24-30`, reps come from what the member says or types. The name implies camera counting. Rename it to "Set logger" ("Logs the reps they say or type; 'pain' stops the session").
3. **Some "fixed checks" are not checks.** Memory and Today list are not checks, and the Examiner calls AI. Change the legend to "Code, no AI" and the claim to "14 AI specialists and 11 code steps". The 14 is a curated grouping (Meal planner bundles 4 model tasks), so publish a "how we count" note or skip the headline number.
4. **The recovery rule contradicts itself.** Pulses "never visit" Not-on-yet nodes, yet A sends Hamdan through Recovery rule at 6.0 s and B opens with it at 06:10.
   - By default, drop t3 from A's playlist and from B's first beat. Enable it only by flag once the owner confirms `WHOOP_TRAINING_APPROVED`.
   - The caption must also say the trainer turned the rule on and the member opted in.
5. **The supplements topic is off by default** (`packages/domain/src/safety-policy.ts:325`, `personalReviewCategories: []`).
   - A's toggle must start ON, labelled "your choice; off by default".
   - Copy like B beat 11 needs "you chose to answer supplements yourself".
6. **Brain level text is not verbatim.** Use the strings in `packages/domain/src/brain-teach.ts:212-236`:
   - L1: "Your Brain drafts replies. Nothing reaches a client until you approve it."
   - L2: "Up to 5 routine replies you choose can send automatically after a passing check."
   - L3: "Up to 30 routine replies can send automatically. Health and safety questions still come to you."
   - Add near the control: "Level 2 needs a passing check of 20+ of your own cases". Otherwise automation looks like a free toggle.
7. **Plan confidence wording doesn't match the product.**
   - The app shows a percentage (`percent(item.confidence.score)`), and the setting is "How sure it must be to send alone (%)".
   - The gauge should read "78% · your bar 80%", and the slider should use the product label.
   - "Sure score" is a made-up name. Show the reason string verbatim only in "What you see": "Confidence 0.78 is below your threshold 0.80" (`brain-plans.ts:1799`).
8. **The spot check is in the wrong lane.** A drops it into Waits, but the plan was sent.
   - Mark the Sent tile "Spot check" and add a "Check a plan your Brain sent" Today card instead.
   - Receipt text: "1 in 4 sent plans while fewer than 20 are reviewed" (`brain-plans.ts:301`).
9. **The learning loop doesn't match its source.**
   - A (13 s) and B (beat 9) attach t7 to Yousef's deload draft, but t7 is a bench "5 kg → 2.5 kg" edit (`tests/brain-check.test.ts:636-660`). Attach it to a matching Draft writer tile.
   - In the JSON, t7's first step is `memory`, but the Learner never reads member memory. Replace that step with a privacy step: "Name becomes [client]; their message is never sent". That is a strong trust beat.
10. **B invents timings.**
    - The Examiner runs about 60 s after the edit (`brain-check.ts:45`), not at "23:30 while you sleep".
    - The weekly learner runs once per ISO week inside an hourly sweep (`apps/api/src/brain-edits.ts:155-170`). There is no "Sunday 05:00".
    - Khalid's deadline is 72 h (`safety-policy.ts:21`), not "due by morning".
11. **The "Throw them all" totals are wrong.** The correct line is "4 within your rules · 1 member check · 3 waited · 3 paused · 1 new rule". The design says "4 waited". With the recovery flag off, it becomes 3 within your rules.
12. **t5 (voice) has no Safety step.** Spoken replies are screened twice (`apps/api/src/voice-session.ts:764-806`) and the session opens with `VOICE_SAFETY_LINE`. Add the step and route Sara's dot through Safety.
13. **C(f)'s sweep across seven pills implies an AI router.** In reality, code picks the specialist from the kind of moment. For chat the only options are Reply picker (a rule fits) or Draft writer.
    - Route the light directly to Reply picker; the others stay dark, labelled with their moments.
    - Note: "Code picks the specialist. No AI chooses which AI runs."
    - Apply the same rule in A: dots never "scan" the specialists.
14. **"YOUR BRAIN, RIGHT NOW" plus ever-rising counts reads as live traffic.** No subscriber can join (`apps/api/src/onboarding.ts:714`).
    - Change the eyebrow to "A SAMPLE HOUR OF YOUR BRAIN".
    - Cap the counts and reset them each loop.
    - Put the status strip inside the field.
15. **The "Try it on yourself" tooltip is too broad.** Give each specialist its own condition:
    - Voice lines need voice access and a verified trainer voice, even in Try my AI (`docs/features/trainer-preview.md`).
    - Week reviewer only runs after a programme week ends.
    - Meal photo reader needs nutrition access.
    - Confirm whether the intake handoff in preview really runs the Plan writer.
16. **Owner reply, section 0.** Point 3 names competitor sites as fact; link the evidence or say "in the sites we reviewed". Point 1 should own the miss: our brief said "an AI coach" and we didn't map the code first.

## P1: Oomph and comprehension (the owner's complaint)

1. **The phone's first screen loses the show.** In `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/showcase/shots/a-index-390.png`, the hero copy ends at y≈460 and the consent banner covers y≈770–844. That leaves about 300 px for the showcase.
   - A's 600 px phone field puts the specialists, lanes and the stop below the fold.
   - Required: a phone-native vertical field (about 358×320) under a 2-line H1, with the lede and CTA below it. Messages fall in as real chat bubbles, pass one check bar, reach a specialist ring (icons only) and the after-check bar, and fan into 3 lanes.
   - The stop must happen inside that first visible area.
2. **Use an ink stage for the showcase band only.** Use `#171917` as the background, with Pace `#D5F24A` pulses and halos. These are existing tokens, not new hues.
   - Today's light paper with 1 px lines reads as documentation, not spectacle.
   - Re-tune the lane chips for dark and re-check contrast.
3. **Make it dense, in two layers.**
   - Foreground: 1–2 narrated, labelled moments.
   - Background: 12–20 unlabelled ghost dots at about 35% alpha on the true paths (8 on the lite tier).
   - "2 in flight on phones" is too thin for "many agents at once", and Canvas2D handles this easily.
4. **Add a live subtitle line under the field.** It narrates the foreground moment from the trace's `say`. Example: "Noura: 'pop in my knee' → Safety rules stopped it. No AI called. → Training paused." This drives the 30-second grasp without any tap.
5. **Make the stop cinematic and early (about 0.5 s).**
   - Show her words, with the matched words in red.
   - Stamp "STOP · No AI called" and dim the whole Brain.
   - Send it down the red route.
6. **Make "one Brain, many inside" a visible object.**
   - Put a single bounded shell titled "Your Brain" (with the trainer's monogram) around the specialists, with a "Your rules" bracket on both the before and after bands. This is the owner's "sandwich".
   - Show the rulebook as a source ("Your method · 24 rules"). A thin line lights from a rule card to whichever node cites it: Rule finder, Checker "cites your rule", Lane gate. Today, "governed by your rules" is invisible apart from one chip.
7. **Stream the AI step's output in its bubble** (8–12 words at about 40 characters/s, with a caret). Tag it "From a test run" and never show chain-of-thought.
8. **Auto-demo the control once.** At about 8 s, a scripted press on "1 Waits for me" sends the chat tiles flying (FLIP) into Waits; at about 11 s it returns to level 2; then the nudge appears. Most visitors never touch the controls.
9. **Make the trainer visible.**
   - Label Waits as "Your Today", with the trainer's avatar.
   - The learning beat shows the edit being typed ("5 kg → 2.5 kg").
10. **Keep the live grid looking complete and the stops rare.**
    - Move the Not-on-yet items into a separate "Not on yet" shelf so the live grid looks whole.
    - Weight the playlist so stops come about 1 in 8 moments, not 3 in 12.

## P2: Per concept

**A.** Tapping a tile should zoom into C's plates (a semantic zoom from many moments to one) instead of opening a side drawer. Keep the bottom sheet on phones. This merges A's oomph with C's trust and reuses C's code.

**C.**
- Auto-play the explode once on view (about 1.2 s), then hand over to the scroll scrub. The closed card at p 0–0.06 has no 5-second hook.
- Compute leader-line anchors from the 3D transform maths, with no rect reads in the scroll loop.
- Use `overflow: clip` rather than `hidden` on ancestors, because `hidden` flattens `preserve-3d` in Safari.

**B.**
- Move it to `/how-it-works` only. On home its 560vh pin, plus C's 520vh pin, means two pins; that conflicts with the design's own "one pinned scene" claim.
- If it is kept:
  - cut to 6–7 beats with `--len` ≤ 360;
  - add ghost-event density along the Brain track;
  - don't open on a Not-on-yet beat;
  - keep the status strip inside the pinned stage.
- State plainly that A, B and C are alternatives. The recommended mix is A hero → zoom into C, with C on `/trainer-brain` §3 and B on `/how-it-works`.

## P3: Build and performance

1. The SVG `stroke-dashoffset` infinite loop on the lane rails repaints on the main thread every frame, which defeats the 12 fps idle rate. Draw the rails in the canvas loop or move a transformed repeating-gradient strip instead.
2. Feature support in the Instagram in-app browser on iPhone:
   - Safari has no `requestIdleCallback`; fall back to `setTimeout`.
   - Safari has no `deviceMemory`, and its `hardwareConcurrency` is unreliable. Make the frame watchdog the main tier signal on iOS.
   - Fall back from OffscreenCanvas to a normal canvas.
3. Keep the hero text as the LCP:
   - never ship the field's first frame as an image or poster;
   - load JetBrains Mono, Archivo and Newsreader subset and after first paint, so they can't block the H1.
4. Keep counts to "in this sample" and reset them per loop; this is both honesty and memory.

## Keep

- The story spine (checks → one specialist → checks → lane → you), the "never several AIs on one message" rule, and parallelism through many moments plus ghost stacks.
- Pill versus square shapes and the activity matrix: it reads as "thinking" without fake reasoning.
- The red stop with "No AI called", and the product's own lane words.
- The shared JSON and the pure `decide()`, plus the build checks: domain functions run through `tsx`, a test comparing the browser maths to the product, and the verbatim-string test.
- The Brain level re-sort and the plan slider, as live cause and effect.
- C's "Your words, plus numbers from your rule. AI words: none". I checked it: `coaching-runtime.ts` sends the approved text plus a code sentence ("Your next … prescription is … kg").
- C's ghost stacks.
- The playground's local keyword match with "Closest sample …", and in-browser safety rules off by default.
- The performance contract: one rAF loop, adaptive fps, pause off screen or hidden, the watchdog, the lite tier, the Pause button, and the reduced-motion versions.
- No WebGL, the round-one corrections, and the A > C > B ranking.

Files: design data `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/showcase/brain-traces.json`, which needs the t5 and t7 step fixes and the totals fix. Phone evidence: `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/showcase/shots/a-index-390.png`.