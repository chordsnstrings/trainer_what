# How top AI-agent sites make a multi-agent system visible, and 10 patterns for trainsyou (research, 27 Oct 2026)

I checked 34 live sites with WebFetch and curl, plus the page HTML and JS for animation code. No cloud browser was used. "Source-verified" means I read the actual markup, CSS or JS. Everything else comes from the page text.

## 0. Bottom line
- **Almost no leading agent site shows its agents working together on the homepage.** Decagon, Sierra, CrewAI, Devin, Harvey, Glean, Zapier, Replit, Salesforce Agentforce, Fin, Manus and Comet show none of it: they lean on outcome numbers, logos and still screenshots. Only a few show any of it: ElevenLabs Agents (a triage node routing to six branches), n8n (a prompt growing into a workflow graph), Sierra (a still "Agent reasoning" panel), Cursor (parallel agents with their states), Relevance AI (a table of specialists) and LangChain (pinned lifecycle stages). An honest showcase with real impact would therefore set trainsyou apart.
- **The impact on the best sites comes from four things, not from 3D brains:**
  1. Many things visibly happening at once.
  2. Real work compressed into a few seconds.
  3. A cause you can see turning into an effect.
  4. A "stop" moment, where a guardrail blocks something and hands it to a human.
- **The best-built demos are server-rendered HTML mock-ups of the product run by a small timed script,** not video or WebGL. Lindy, Cursor, Hebbia, Linear and n8n all work this way. The result is crisp at any screen density, translatable (it can mirror for Arabic), indexable, and light.

## 1. Why round one missed it (for the reply to the owner)
- **The playbook treated motion as a cost.** Principle 3 is "Speed is conversion, so motion lives inside a budget" and principle 4 is "short, purposeful". Concept A's hero is one change that "plays once", "total about 1.5 s, no loop".
- **The brief described one AI coach.** Nothing in it mapped the specialists, so the heroes showed a single decision.
- **The evidence base pushed the same way.** It was conversion studies plus 12 competitors, and even top agent sites rarely visualise how their agents work together. Nothing pulled the research towards showing the system.

## 2. Site-by-site findings

### Agent platforms and orchestration

**Lindy** (source-verified; the most useful build reference)
- **Hero:** an "Interactive example of Lindy working in Slack". It is a real tablist of channels (#growth, #support, #eng, #finance), and each channel is a scripted scenario.
- **Timeline** (`HeroDemo.astro` JS):
  - question at 260 ms and reply at 1150 ms;
  - a "thinking" line shows until 3130 ms;
  - work steps appear at 3250 + i·700 ms, each ticked done 560 ms later;
  - steps collapse at 5550 ms, then the artifact appears at 5970 ms and "draws" at 6330 ms;
  - ledger rows appear every 150 ms from 6500 ms;
  - action buttons switch from inert to clickable at 6850 ms, and reaction counts tick up from 7250 ms.
- **Scenario reset:** each scene starts by clearing its state classes (`visible`, `drawn`, `done`, `retired`).
- **Reduced motion:** the final state renders immediately.
- **Scaling:** on desktop a fixed 1296 px canvas is scaled with `transform: scale(min(1, width/1376))`. At 760 px and below it uses a natural layout and auto-scrolls the thread.
- **Detail:** tool-call rows in monospace (`posthog.query_funnel ✓`) and "3 steps · done in 21s" timers.
- **Honesty:** no sample label on invented metrics such as 1,340 tickets.
- **CTA:** the demo's own action buttons become live, and "Try for free" repeats.

**Cursor** (source-verified)
- **Hero:** the product UI rebuilt in server-rendered HTML, `aria-hidden`, with an `sr-only` summary ("interactive demo for sighted users"). Height is `min(780px, 70vh)`.
- **Impact:** parallel agents are visible from the first frame: "In Progress 2" (one row reading "Generating plan") and "Ready for Review 3", each with a runtime and a diff count.
- Later sections show cloud agents ("Worked for 14m 22s", "Explored 12 files, 4 searches") and a "Recents" list of six "Working" tasks.
- **Mobile:** a secondary demo is hidden below 767 px.
- **Honesty:** placeholder "Acme" names, no sample label.

**n8n** (source-verified)
- **Hero:** "Build the agent. Understand its workflow." A prompt ("When a refund request comes in… ask me in Slack whether to refund it or open a ticket") grows into a node graph.
- **Graph:** Refund requested → Lookup the order → Ask for approval on Slack → Approved? → Process refund / Open ticket → Classify reason → Route by reason → branches → Merge paths.
- **Detail:** node labels are split into one span per character for a letter-by-letter reveal. Tabs switch the use case ("Process invoice", "Knowledge assistant", "Daily News Digest").
- **Mobile:** the full graph is too tall, so a "Reveal more of the workflow" button is needed.
- **Elsewhere:** Lottie and MP4 media, plus an "Agent, workflow, or both?" autonomy slider.
- **Honesty:** the FAQ states plainly what is not yet supported ("on the roadmap").

**Gumloop** (source-verified)
- **Guardrail diagram** ("Block all external emails", "Write plain English rules that block, tag, or log actions before they run"): dashed connector paths (`stroke-dasharray 3 3`) with a `trace-dash-flow 1.6s linear infinite` marching-ants animation.
- **"Held to your standard" field:** SVG paths with `pathLength="1"`, `stroke-dasharray="0.24 0.76"` and `stroke-dashoffset` animated from 1, using a gradient "shine" stroke. This is the "pulse travels along an edge" technique.
- Small ambient loops: `secret-mask-pulse 3.6s`, `shimmer 1.4s`.

**ElevenLabs Agents**
- A "Triage Agent/Main" node ("Identify issue & triage") routes to six branches (iOS, web and Android, for refunds and purchases).
- A sample chat labelled "Request blocked by guardrail" declines financial advice.
- **Honesty:** analytics panels (resolution 87.37% vs 61.71%) carry no "illustrative" label.

**Sierra**
- A still "Agent reasoning" panel, grouped as:
  - Supervisors (Detect abuse ✓, Observations ✓)
  - Decisions (Journey: Security setup ✓)
  - Responses (Main response ✓)
- A trace timeline image (transcription, initialization, supervisor actions, intent classification).
- **Hero:** video plus logos. No demo labels anywhere.

**Relevance AI**
- "Specialist agents for every task": a table of tasks with Run by, Model, Eval and Cost columns, plus a weekly rollout timeline with agent avatars ("Contract Reviewer (Wk 7)").
- Dashboard numbers (1.24M tasks a month) are unlabelled.

**LangChain** (source-verified)
- A pinned "Agent Development Lifecycle" section with six stages (Build, Test, Deploy, Monitor, Iterate, Govern) on a pill arc.
- The active stage collapses into an icon chip. A connector from chip to panel is redrawn on each stage change with `scaleX` 0→1.
- Panels park above or below so their motion follows the scroll direction (0.25 s ease-out).
- Built with GSAP ScrollTrigger. On mobile (991 px and below) inline screenshots replace it, and an IntersectionObserver toggles the pill bar.
- The LangGraph page itself has no diagram: text only.

**Other platforms**
- **Decagon:** floating sample chat bubbles. Lottie is loaded on demand: lottie-web 5.13.0 from cdnjs, only when `[data-product-lottie-url]` elements exist. No orchestration visual.
- **CrewAI:** counters ("450M+ agentic workflows a month"). No crew diagram.
- **Zapier Agents:** an abstract image hero. Feature videos use `preload="none"`, `controls`, Cloudinary `q_auto` at 720 px and 1280 px widths.
- **Devin, Factory and Replit:** text and logos, no live session view.

### AI products with signature visuals
- **Hebbia** (source-verified)
  - **Hero:** a portrait video (1080×1920) with an eager, high-priority poster image.
  - **"Matrix" section:** a full HTML mock with about 494 cells and 331 document chips. Columns break a question into parts, rows are companies, and there are density and dark-mode toggles.
  - Citations are tagged "confirmed" or "unconfirmed". The CTA sits inside the Matrix section.
  - A "pages processed" stat card is a lazy, `preload="metadata"` video.
- **Linear** (source-verified)
  - Agents are shown as colleagues: an "Agents for every use case" grid and a "Delegate to an agent" control in the product UI.
  - A 5×5 dot-matrix "agent working" glyph in pure CSS: each dot has its own opacity keyframes (0.3 or 1) with `steps(1,end)`, cycling in 1600 ms ("pong") and 2800 ms ("upDown") patterns.
- **Glean** (source-verified)
  - Industry panels play in order: the background de-blurs (`blur(20px)`), the prompt pops in, typing dots run (`ip-dot`: translateY −4 px, opacity 0.35→1), then the answer streams in.
  - The CSS comment says it uses a "lighter blur on tablet + mobile (cheaper on mobile GPUs)".
  - GSAP ScrollTrigger drives `data-anim="scrub-words"` headlines.
  - A `motion-failsafe` forces any animated element the script never bound to show after 2.5 s. This safety net does not cancel reveals the script did bind.
- **Granola:** a "listening" indicator of three CSS bars (`dancing-bar` keyframes, 0.6 s, alternate, infinite).
- **Rabbit OS3:** the interface is an animated PNG ("the OS3 workspace: a single conversation carrying out work") hidden under reduced motion, with a still image in its place.
- **Dia:** Mux videos (`preload="metadata"` plus poster). Privacy demo toggles carry `aria-label`s ending "this is for demonstration only".
- **ElevenLabs home:** the hero is a playground: type text, pick a voice, press play.
- **v0:** the prompt box is the hero. Gallery videos use `preload="none"` with posters.
- **Runway:** a hub with videos. Small CSS loops (`breathe 2.4s`, `strokeDraw`).
- **Text-only showcases:** Harvey (a dashboard screenshot; "tasks automatically routed to the right agent" in text only), Perplexity Comet (example prompt cards, "Pause Comet Assistant"), Fin (counters only), Manus (prompt hero only).
- **Hume:** the one site with an explicit honesty label: "Illustrative, not real data".

### Explainers, award sites, fitness
- **Artificial Societies** (Awwwards Honorable Mention, Sep 2025; source-verified): the hero image (AVIF, high priority) is the LCP. A desktop-only, `aria-hidden` canvas sits on top, with persona labels ("Millennial, Instagram User", "Editor, Financial Times") as positioned HTML. In effect the society of agents is drawn over a photo, and phones get only the photo.
- **Cloudstudio** (Awwwards Honorable Mention, Jul 2026): eight particle "drivers" narrate and re-theme the page (Three.js, Matter.js).
- **Anthropic multi-agent research article:** the clearest orchestrator-worker diagram. A lead agent spins up 3 to 5 subagents in parallel, then a CitationAgent attaches sources, with a loop arrow back to "more research?".
- **The Pudding** (scrollama): a sticky graphic with text steps, driven by IntersectionObserver rather than scroll events. Its responsive guide says:
  - size steps in px from `window.innerHeight`, never `vh` (mobile toolbars resize the viewport);
  - keep mobile stories to a few steps, with no hover and no swipe steppers;
  - reduce motion on mobile, and fall back to stacked static frames.
- **Apple:** scroll-scrubbed canvas image sequences. They can reach 50 MB or more, so a single-image fallback is needed.
- **Stripe:** bento graphics are loaded lazily (`lazy-animation lazy-bento-graphic`). The WebGL hero gradient has battery complaints, though only anecdotal ones.
- **Fitbod:** explains its inputs (history, recovery, equipment) in text and states its limits honestly ("built exclusively for resistance and strength training").

## 3. The 10 most powerful patterns for trainsyou
Ranked by impact multiplied by fit for trainers arriving from Instagram on phones.

The specialist names below come from `MODEL_CALL_BUDGETS` in `/home/user/trainer_what/packages/providers/src/model-request.ts`: `coach_selection`, `coach_decision`, `rule_compilation`, `brain_quiz`, `brain_correction`, `brain_edits`, `plan_adaptation`, `meal_photo`, `voice_suggestions`, `onboarding_reply`, plus two I did not read. Add the code safety floor, the confidence lanes, WHOOP and nutrition. The specialist-mapping step owns the final list and which parts are live. Anything not live is drawn greyed out and labelled "Not on yet".

### 1. One message fans out to many specialists and converges on one decision
*Impact 5, fit 5. This is the core "oomph".*
- **Evidence:** Anthropic's orchestrator-worker diagram, the ElevenLabs triage graph, n8n's growing graph, Gumloop's edge pulses.
- **What it shows:**
  - a subscriber message arrives (for example, "Knee's sore after squats");
  - the Brain wakes 5 to 7 specialists in parallel: safety floor (code), your rules (`coach_selection`), coaching draft (`coach_decision`), plan (`plan_adaptation`), recovery (WHOOP), nutrition (`meal_photo`);
  - pulses return and land in one outcome chip: "Applied automatically", "Sent to you" or "Paused".
- **Build:**
  - The start state is server-rendered: an SVG edge layer with `pathLength="1"` on each path, and HTML node labels positioned over it (crisp, translatable, mirrored for Arabic by flipping x).
  - Pulse: `stroke-dasharray: .12 .88`, with `stroke-dashoffset` animated 1→0 over 600 to 700 ms, ease-in-out.
  - Fan-out stagger of 80 to 120 ms, so it reads as parallel rather than sequential. Return pulses all land within 150 ms.
  - Each node wakes with a ring (opacity 0→1, scale 1→1.04, 200 ms), and its status crossfades from "reading…" to "✓ your rule: +2.5 kg when RPE < 7".
  - Each scene lasts 4 to 6 s, holds 2.5 s, then loops to the next sample moment.
- **Phone layout (360 px):** message at the top, specialists as a 2-column chip grid, outcome at the bottom, short vertical connectors, and no more than 6 nodes.
- **Performance:**
  - Keep 8 or fewer concurrent dash-offset animations, since they repaint SVG.
  - Beyond that, draw the pulses on one canvas 2D layer under the HTML nodes, or move a dot with `transform`.
  - Run everything from one WAAPI or requestAnimationFrame scheduler, and pause it offscreen and in hidden tabs.
- **Honesty:** a fixed chip reading "Sample moment · scripted · no AI model called". Pulses skip "Not on yet" nodes.
- **CTA:** the outcome card offers "Teach your Brain this rule →", which goes to sign-up carrying the moment (for example `?moment=knee`).

### 2. A reasoning receipt that shows how the Brain thought
*Impact 5, fit 5. This is the trust layer.*
- **Evidence:** Sierra's grouped "Agent reasoning" panel, Lindy's tool rows with ticks, Hebbia's confirmed and unconfirmed citations.
- **Groups:**
  - Checks: safety floor, pain or medical words, then hold.
  - Your method: the rule, with its source ("from your interview, 12 Oct"), and confidence 86%.
  - Plan: Squat 60 → 62.5 kg.
  - Reply, in your voice.
- **Build:**
  - Rows appear whole (no typewriter): every 150 ms for data rows, every 700 ms for steps, each ticked 560 ms later.
  - Only the reply streams, word by word, at about 25 to 35 characters a second with a caret.
  - The confidence bar fills with `scaleX`. Rows expand with `<details>` for trainers who want more.
  - Pure HTML and CSS, no library.
- **Reduced motion:** the full receipt shows at once.

### 3. The stop moment: the safety floor blocks a reply and hands it to the trainer
*Impact 5, fit 5. It answers the "unsafe advice" fear directly.*
- **Evidence:** ElevenLabs "Request blocked by guardrail", n8n's "Ask for approval on Slack → Approved?" node, Lindy's "Nothing irreversible happens without your approval", Gumloop's guard diagram.
- **What it shows:** a pulse heading for "Applied" hits a solid bar labelled "Safety floor · code, not AI". It turns to the warning colour, gives a 120 ms shake (translateX ±3 px, twice), and reroutes along a newly drawn path to "To you". A notification card then slides onto the trainer's phone.
- **Lane rails:** the three lanes are dashed SVG with marching ants (`dasharray 3 3`, 1.6 s linear, infinite). This is ambient motion that means "always watching".

### 4. Scenario tabs that each play a scripted run
*Impact 4, fit 5. This is the delivery mechanism for patterns 1 to 3.*
- **Evidence:** Lindy's tablist with timed scenes, Cursor's and Lindy's server-rendered mock-ups.
- **Tabs:**
  - "Squats felt easy": progression.
  - "Knee hurts": safety, sent to you.
  - "Missed 3 sessions": `plan_adaptation`.
  - "Meal photo": `meal_photo`, only if live.
  - "Voice session": `voice_suggestions`.
- **Behaviour:**
  - The first tab plays once the demo is in view, and tabs auto-advance after a hold.
  - Auto-advance stops at the visitor's first interaction.
  - Each scene starts from a clean state, using Lindy's class reset.
  - Use real `role="tab"` controls and an `sr-only` summary of the scene.

### 5. Change the rule and watch the decision reroute
*Impact 4, fit 5. It proves the trainer is in control.*
- **Evidence:** Dia's demo toggles labelled "for demonstration only", Hebbia's view toggles, n8n's use-case switch.
- **Control examples:**
  - "When a subscriber reports pain: [Pause and send to me] / [Suggest a lighter swap]"
  - "Add weight when RPE ≤ [7]"
- Changing the control reruns the field from pattern 1 with the new route. It is a state change only, so it costs almost nothing.

### 6. A mission-control board of many sample moments handled at once
*Impact 4, fit 4. Scale and ambient motion.*
- **Evidence:** Cursor's "In progress 2 / Ready for review 3" sidebar with "Generating plan", Linear's dot-matrix glyph, Hebbia's large HTML matrix.
- **What it shows:** 8 to 12 named sample subscribers. Each row shows which specialist is working, a CSS dot-matrix glyph, and the lane result.
- **Timing:** a seeded scheduler changes one row every 1.2 to 2.5 s.
- **Header:** counts only the sample ("Sample board · 12 moments · 9 applied · 2 to you · 1 paused"), never live users.
- **Phone:** 4 rows plus "show all".

### 7. Throw a moment at your Brain (playground)
*Impact 4, fit 4.*
- **Evidence:** the ElevenLabs text-to-speech playground hero, v0's prompt-as-hero, n8n's prompt-to-graph.
- **Build:**
  - Preset chips plus a free-text box.
  - A local keyword table maps the text to one of N scripted scenarios, with "closest sample: …" as the fallback. No network call, no cost, no invented answers. Under 10 KB.
- **Honesty:** the label reads "Scripted · matches your words to one of N sample moments".

### 8. 24 hours of your Brain
*Impact 4, fit 4. Strongest for Concept B, "beyond your hours".*
- **Evidence:** Lindy's routine cards ("Daily briefs 8:00 AM", "Fridays 12:00 PM").
- **A day in Dubai time:**
  - 06:10 recovery read (WHOOP, if connected) → session adjusted;
  - 12:30 meal-photo estimate;
  - 18:00 check-in reply;
  - 22:00 digest of the day's "to you" items for the trainer;
  - Sunday: `plan_adaptation`, plus weekly rule suggestions from your edits (`brain_edits`) for you to confirm.
- **Build:** a horizontal scroll-snap strip of hour cards under a sticky clock, using native scroll. The clock hand's `rotate` is tied to scroll position. Events use CSS `animation-timeline: view()` (Chromium 115+ and Safari 26), with an IntersectionObserver fallback.

### 9. Pinned "anatomy of a decision" scroll story
*Impact 3, fit 4. Strongest for Concept C.*
- **Evidence:** LangChain's pinned stages, The Pudding's sticky graphic, Glean's scrubbed words.
- **What it shows:** a sticky phone plus Brain diagram. Five steps light one specialist each: message → safety floor → your rules → plan → reply and lane.
- **Build:**
  - `position: sticky` plus IntersectionObserver.
  - Panels enter in the direction of scroll, and connectors redraw with `scaleX` over 250 ms.
  - Step heights in px from `innerHeight`, 5 steps at most, no hover. Fall back to stacked static frames.
  - Never use a smooth-scroll library.

### 10. The team inside your Brain: a roster of specialists
*Impact 3, fit 5. Not much impact on its own, but it is the honest backbone.*
- **Evidence:** Relevance's specialist table, Linear's agent grid, the ElevenLabs template cards ("Triage Agent: Route & prioritize tickets").
- **Each card shows:**
  - what it reads, what it decides, and who signs off;
  - "Live" or "Not on yet";
  - a tiny CSS glyph: dot matrix for thinking, three bars for voice.
- Clicking a card plays that specialist's lane in pattern 1. The roster also feeds SEO and the feature pages.

**Optional ambient layer.** Only if it carries meaning, following the Artificial Societies approach: a desktop-only 2D canvas behind the hero where each particle is one labelled sample moment, with labels as positioned HTML. Phones get the static frame. No three.js.

## 4. Patterns that look impressive but confuse or slow the page
1. **A generic 3D brain, orb or neural-particle field.** The ElevenLabs orb only works because it shows the voice agent's actual states (idle, listening, talking). A generic one says "AI", not "your method". three.js costs roughly 150 KB or more gzipped, drains GPU and battery, and puts the Instagram in-app browser's memory at risk.
2. **A hero product video as the showcase** (Hebbia, Zapier, Dia):
   - it can't mirror for Arabic or carry live honesty labels;
   - phone-sized UI text in it is unreadable;
   - it goes stale when the product changes;
   - it is heavy. Use video only as a secondary, lazy item with `preload="none"` or `"metadata"` and a poster.
3. **Scroll hijacking, smooth-scroll libraries (Lenis), long pins, `100vh` on iOS, and Apple-style image sequences** (50 MB or more).
4. **Full node canvases with 15 or more nodes.** Even n8n needs a "Reveal more" button. At 360 px it reads as a developer tool to a trainer.
5. **Unlabelled fake dashboards and big counters** (Sierra's 120k, Relevance's 1.24M a month, the ElevenLabs analytics). They break our honesty rule. Hume's "Illustrative, not real data" is the exception that gets it right.
6. **Letter-by-letter typing of long text.** n8n's one-span-per-character approach bloats the page and floods screen readers. Use typing only for short prompts.
7. **Model-name lists and LLM logos** (Cursor's model picker, Relevance's model column). They mean nothing to trainers and feed their wariness of "AI".
8. **Hover-only reveals and heavy blur or `backdrop-filter`.** Glean had to make hover text always visible on mobile and lighten its blur there.
9. **Infinite marquees of agents or logos, and counters ticking up to invented totals.**
10. **Lottie or Rive runtimes for small loops.** Decagon loads lottie-web only when needed. Plain CSS is enough for status glyphs.
11. **"Done in 21s" timers** (Lindy). For trainsyou these would be invented unless measured.

## 5. Rules carried into the showcase
- **Loading:** the H1 and lede are the LCP. The showcase's complete start state is in the server-rendered HTML. Its JS is imported after `load`, through `requestIdleCallback` plus IntersectionObserver with a 200 px root margin. Target 35 KB gzipped or less, with no library.
- **Smoothness:** animate `transform` and `opacity`, with 8 or fewer SVG dash animations at once and a canvas 2D layer beyond that.
  - Cap device pixel ratio at 2.
  - Pause offscreen and on `visibilitychange`.
  - Test in the Instagram in-app browser on a mid-range Android phone.
- **Reduced motion:** show the final state (Lindy) or a still image (Rabbit), plus a "Play" button for motion the visitor starts.
- **Failsafe:** Glean's 2.5 s failsafe, applied only to elements the script never bound.
- **Honesty:** every trace carries "Sample · scripted · no AI model called". "Not on yet" items are greyed and dashed, and pulses never visit them. No customer counts, testimonials or timings.
- **CTA:** the demo continues into the CTA, as with Lindy's buttons that become clickable and n8n's prefilled prompt. "Teach your Brain this rule" carries the scenario into sign-up.

## Sources
- Agent platforms: [Lindy](https://www.lindy.ai) and [hero script](https://www.lindy.ai/_sherpa/assets/generated/HeroDemo.astro_astro_type_script_index_0_lang.BU1PTPOk.js), [Cursor](https://cursor.com), [n8n](https://n8n.io), [n8n AI agents](https://n8n.io/ai-agents/), [Gumloop](https://www.gumloop.com), [ElevenLabs Agents](https://elevenlabs.io/agents), [ElevenLabs](https://elevenlabs.io), [Sierra](https://sierra.ai), [Relevance AI](https://relevanceai.com), [LangChain](https://www.langchain.com), [LangGraph](https://www.langchain.com/langgraph), [Decagon](https://decagon.ai), [CrewAI](https://www.crewai.com), [Zapier Agents](https://zapier.com/agents), [Devin](https://devin.ai), [Factory](https://factory.com/), [Replit](https://replit.com/ai), [v0](https://v0.app)
- AI products: [Hebbia](https://www.hebbia.com), [Linear](https://linear.app), [Linear agents](https://linear.app/agents), [Glean](https://www.glean.com), [Granola](https://granola.ai), [Rabbit](https://rabbit.tech), [Dia](https://www.diabrowser.com), [Runway](https://runwayml.com), [Harvey](https://www.harvey.ai), [Perplexity Comet](https://www.perplexity.ai/comet), [Fin](https://fin.ai), [Manus](https://manus.im), [Salesforce Agentforce](https://www.salesforce.com/agentforce/), [Hume](https://www.hume.ai), [Stripe](https://stripe.com), [Fitbod](https://fitbod.me)
- Explainers and award sites: [Artificial Societies](https://societies.ai/) and [Awwwards entry](https://www.awwwards.com/sites/artificial-societies), [Cloudstudio on Awwwards](https://www.awwwards.com/sites/cloudstudio-this-site-is-awake), [Awwwards AI category](https://www.awwwards.com/websites/artificial-intelligence/), [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), [Pudding: Introducing Scrollama](https://pudding.cool/process/introducing-scrollama/), [Pudding: Responsive scrollytelling](https://pudding.cool/process/responsive-scrollytelling/)
- Techniques: [CSS-Tricks Apple scroll animation](https://css-tricks.com/?p=308477), [Setproduct AirPods scroll](https://www.setproduct.com/blog/how-to-3d-animate-scroll), [ElevenLabs UI blog](https://elevenlabs.io/blog/elevenlabs-ui), [ElevenLabs Orb on 21st.dev](https://21st.dev/@ElevenLabs-crawled/components/orb.md), [Rive vs Lottie (Rive)](https://rive.app/blog/rive-as-a-lottie-alternative), [Lottie vs Rive (Callstack)](https://callstack.com/blog/lottie-vs-rive-optimizing-mobile-app-animation), [Chrome scroll-driven animations](https://developer.chrome.com/docs/css-ui/scroll-driven-animations), [Codrops: Stripe gradient](https://tympanus.net/codrops/2022/09/26/how-to-recreate-stripes-lava-lamp-gradient-with-three-js)

Working files (downloaded page HTML and the fingerprint script) are in `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/oomph/`.