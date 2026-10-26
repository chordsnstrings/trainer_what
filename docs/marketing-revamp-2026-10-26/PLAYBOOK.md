# trainsyou marketing revamp: conversion playbook and three concepts (26 Oct 2026, revised after adversarial review)

**Inputs:**
- the site audit, conversion evidence, competitor teardown and buyer research reports;
- the installed skill's `benchmarks.md` and the "Pitch page / business case" section of `output-formats.md`;
- the adversarial review (48 required fixes), checked against the repo and the page registry (`dump.ts index`: 38 registered pages).

**Where the inputs disagree:**
- **The live audit wins on facts.** Registration is open. The primary conversion is a trainer account created at `/signup`. The `payments`, `payouts` and `frontier` flags are all off.
- **Trainers cannot publish today.**
  - `apps/api/src/onboarding.ts:713-720` adds a `payments` launch gate owned by trainsyou (`ok: commerceReady`), and `readyToPublish` is `gates.length === 0`.
  - `docs/features/coach-setup.md:88-92` agrees: `priced_plan` "turns on once payments work", and the platform check covers `legal`, `payments` and `model`.
  - So no subscriber gets plans, workouts or chat from a published page yet. Every page in this plan reflects that.
- **The conversion report is wrong about the conversion step.** It treats `/start`, `/apply` and early access as the conversion step, which is not true in production. Early access is only the fallback for when registration closes.

**Evidence weight labels used below:**

| Label | Meaning |
|---|---|
| [Measured] | An independent or peer-reviewed study that measured behaviour, with the sample size stated |
| [Survey] | An independent survey of what people say. It shows attitudes, not behaviour |
| [Vendor data] | A large vendor or platform dataset, or one company's A/B test |
| [Vendor claim] | Vendor marketing or a self-reported vendor survey. Trust the direction, not the size |
| [Press] | News coverage of an official announcement |
| [Expert] | Expert guidance or theory |
| [Anecdote] | An anecdote, or a figure we could not trace |
| [Direct check] | A researcher's own check of a live page or its code |
| [Hypothesis] | Our own assumption, not sourced. It never appears on the site |

---

## A) FINDINGS: the 15 conversion principles that matter most for trainsyou, ranked

### 1. Show the product working in the first screen, in plain words
Visitors decide within seconds whether to stay, and most attention never leaves the first two or three screens. The hero should show trainsyou making a decision, not describe trainsyou.

**Evidence**
- NN/g eye-tracking: 57% of viewing time is above the fold, 74% is within the first two screens and 81% within three. [Measured, 120 participants, 130,000+ fixations] https://www.nngroup.com/articles/scrolling-and-attention/
- Dwell-time analysis: visitors abandon pages fast in the first seconds. [Measured, large browser log; Liu, White and Dumais, SIGIR 2010] https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/
- SaaS pages written at a 5th–7th grade reading level converted at 12.9%, against 2.1% for professional-level copy. The best-performing length was 250–725 words. [Vendor data, SaaS n undisclosed (the 41,000+ pages are the all-industry dataset), correlational] https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/
- Visual appeal is judged in 50–500 ms. That is a judgement of appeal, not a decision to buy. [Measured, Lindgaard 2006] https://www.nature.com/news/2006/060109/full/news060109-13.html
- Skill rule: "the hero must BE the product". [Expert]
- **Gap:** no one has published a controlled test of a product screen against an illustration in a SaaS hero.

**Apply to trainsyou**
- **Replace the hero diagram.** Today's schematic three-card relay ("Illustration with sample data") becomes a live HTML product moment:
  1. a subscriber message ("Week three done. Squats felt easy.");
  2. the trainer's rule, with its source;
  3. a confidence reading of 86%;
  4. the lane it goes to ("Applied automatically");
  5. next Monday's squat changing from 60 kg to 62.5 kg.
- **The start state renders fully visible at first paint, and only the change animates** (the bar fill, the lane move, 60→62.5 kg). This follows the house rule in `marketing-motion.md:35-36,89`.
- **Keep the H1 short and plain.** The current "Teach your AI. It trains your subscribers." passes.
- **Put the CTA and "Free to join" in the first screen.** The home hero never names "Trainer Brain" and never gives payout details; existing tests enforce both.
- **Move the 480svh pinned journey out of position 2.** At 480svh, the value bands sit far past the point where 81% of attention has already been spent (three screens).
  - The walkthrough stays on the page, because the owner wants it always shown, but it becomes a stepper the visitor moves through themselves (principle 4, owner decision 4).
- **Visible home copy: the house budget of 400 words** in `main`, not counting the follower calculator block (`marketing-site.md:671`). Today it is 1,617. Section C1 gives per-band budgets. Raising the cap is owner decision 10.

### 2. Sell the trainer's control and method, not "AI"
Trainers fear unsafe output under their name, and people trust an algorithm they can adjust.

**Evidence**
- People keep using an imperfect algorithm when they can adjust it, even slightly, and how much they can adjust it barely matters. [Measured, 3 incentivised experiments; Dietvorst, Simmons and Massey 2018] https://ideas.repec.org/a/inm/ormnsc/v64y2018i3p1155-1170.html
- Saying "artificial intelligence" in a product description lowered emotional trust and purchase intent, more so for high-risk purchases. [Measured, more than 1,000 US adults; Cicek et al. 2024] https://news.wsu.edu/press-release/2024/07/30/using-the-term-artificial-intelligence-in-product-descriptions-reduces-purchase-intentions/
- 54% of coaches name inaccurate or unsafe advice as their top AI concern, and 77% say AI can never replace a human coach. [Vendor claim, FitBudd, n undisclosed] https://www.fitbudd.com/fitness-industry-trends/ai-fitness-coaching-report
- 10% of consumers prefer AI workout guidance and 52% lean human-first. [Vendor data, Les Mills, 10,000+ consumers] https://athletechnews.com/gym-is-one-place-ai-hasnt-won-over-les-mills-report/
- In the UAE, 65% say they would rely on information from AI and 84% say they would trust it more with assurance. [Survey of self-reported attitudes; KPMG and University of Melbourne; global n≈48,000 across 47 countries, UAE n not stated] https://kpmg.com/ae/en/media/press-releases/2025/10/97-percent-of-uae-residents-now-use-ai.html
- Skill rule: constraints are a selling section, and what a system refuses to do persuades cautious buyers. [Expert]

**Apply to trainsyou**
- **Headlines say "your AI", "your rules" and "your method".** "AI" always belongs to the trainer, and the owner's moat stays the headline.
- **This is a judgement call to test, not an evidence-based override.** Cicek measured consumers, and these buyers are trainers. The only counter-signal is FitBudd's vendor claim that 91% of coaches already use AI (n undisclosed). The hero comprehension tests and the CTA test in section E check it.
- **Give "You stay in charge" a full band.** It covers the "Waits for me" mode, choosing what runs automatically, taking over any subscriber, and rollback.
- **Give "What your AI will never do" its own section.** Your AI never:
  - hides pain or red flags;
  - pretends to be you (it is a labelled digital coach);
  - gives medical advice;
  - uses your teaching for anyone else.

  Add: "Pain and red flags pause the workout and come to you. Enforced in code, outside the AI."
- **Use one name.**
  - The hero says "your AI".
  - The product name, defined once per page, is "your AI (we call it your Trainer Brain)". On the home page it appears below the hero.
  - Retire "trainsyou learns" in the relay, and retire "digital coach" as a product name. "Digital coach" survives only as the label subscribers see.
- **"Frontier model" appears on `/trainer-brain` and `/how-it-works` only, gated by the `frontier` flag** (see owner decisions).

### 3. Speed is conversion, so motion lives inside a budget
**Evidence**
- A mobile site 0.1 s faster went with +8.4% retail conversion and +10.1% travel conversion. [Vendor data, Deloitte for Google, 37 brands, observational] https://web.dev/case-studies/milliseconds-make-millions
- Vodafone's 50/50 A/B test: 31% better LCP gave +8% sales. [Vendor data, single-company A/B] https://web.dev/case-studies/vodafone
- B2B lead-gen conversion was about 40% at 1 s, 34% at 2 s and 29% at 3 s. [Vendor data, Portent, 20 sites, about 100M pageviews] https://www.portent.com/blog/analytics/research-site-speed-hurting-everyone.htm

**Apply to trainsyou**
- **Budgets, on a mid-range Android phone over 4G:**
  - LCP 2.0 s or less;
  - INP 200 ms or less;
  - CLS 0.05 or less.
- **The LCP element is the H1 text.** No video, WebGL, Lottie or Rive in any hero.
- **Product screens are HTML and CSS, not images.**
- **Motion code:**
  - no animation library (no GSAP);
  - about 12 KB gzip per page at most;
  - loaded after first paint.
- **Fonts in production:**
  - self-host and subset Inter and each concept's accent face;
  - preload the H1 face;
  - give fallbacks size-adjust metrics so the swap causes no layout shift.

  Prototypes may load from Google Fonts with `display=swap`.
- **Production port:** split the marketing route group out of the shared ~850 KB client bundle. The owner accepted the speed cost of motion, and the revamp should win most of it back.
  - If the split uses separate root layouts, navigation to `/signup` becomes a full reload, so it uses cross-document View Transitions (see section D).

### 4. "Smooth" means short, purposeful, compositor-only and paced by the visitor
**Evidence**
- Use durations of 100–500 ms, mostly 100–400 ms, with ease-out, and honour reduce-motion. [Expert, NN/g] https://www.nngroup.com/articles/animation-duration/
- Animate only `transform` and `opacity`. [Expert, web.dev] https://web.dev/articles/animations-guide
- Visitors rarely click carousels: about 1% of ND.edu homepage visits clicked a feature. [Anecdote, Runyon 2013] https://erikrunyon.com/2013/07/carousel-interaction-stats/
- "Design look" appeared in 46.1% of credibility comments. [Measured, n=2,684, Fogg 2002; old] https://advocacy.consumerreports.org/research/how-do-people-evaluate-a-web-sites-credibility
- NN/g's scroll-jacking study covers pages that take over scroll speed and behaviour. [Expert, qualitative] https://www.nngroup.com/articles/scrolljacking-101/
  - The live journey is a sticky scene on native scroll, so this study is weak support here. The case for moving the journey is the attention data in principle 1.
- No measured evidence shows that animation itself raises conversion. Motion earns its place by signalling quality and directing attention.

**Apply to trainsyou** (existing house rules, `marketing-motion.md`)
- **Durations and easing:** the existing tokens (80/140/200/280/420 ms) and easings.
- **What may animate:** `transform`, `opacity`, SVG `stroke-dashoffset` and a disclosure's `grid-template-rows`. Nothing else.
  - **Colour changes are instant.** A hover tint is either an instant change or an overlay's opacity.
  - Hover effects sit inside `@media (hover: hover)`.
  - Nothing changes layout.
- **Hidden-before-reveal never applies to the first screen, the hero or the LCP element.** In the first screen, only a change of state animates.
- **No metrics, counts, revenue or count-ups in animated scenes.** Every animated scene shows only features that are available now. B's response to input is the exception, and needs owner decision 6.
- **Every reveal plays once,** off its own IntersectionObserver trigger. We don't use scroll-scrubbed `animation-timeline` effects, because they replay as the visitor scrolls.
- **Page to page:**
  - the static prototypes use cross-document View Transitions;
  - the Next 16 port uses same-document View Transitions on client navigation, and cross-document ones where navigation is a full reload;
  - both fall back to instant navigation where unsupported.
- **Never:** pinned scenes, auto-rotating carousels, or parallax on mobile.
- **Reduced motion is governed by the `MARKETING_MOTION` switch** (`apps/web/components/marketing/motion-mode.ts`). Today it is `"always"`, the owner's decision (`PROJECT_MEMORY.md:28-30`): the same short motion plays for everyone.
  - Opacity-only motion for reduce-motion users is an alternative only the owner can choose (decision 5).
  - Every reduced-motion branch below applies only if that switch changes.

### 5. Put the full price up front, framed as what the trainer keeps
**Evidence**
- 81% of B2B buyers want to find pricing on their own. [Vendor claim, TrustRadius 2022] https://solutions.trustradius.com/vendor-blog/tech-buyers-demand-honest-and-up-front-pricing-info/
- 25% of B2B buyers rank cost transparency as the most important element of a vendor website. [Vendor claim, Clutch 2020] https://martechseries.com/technology/b2b-buyers-concerned-transparent-costs-b2b-companies-websites-highlighting-importance-trust-b2b-sales-funnel/
- NN/g's credibility factors include disclosing base costs, all fees and policies up front. [Expert] https://www.nngroup.com/articles/trustworthy-design/
- The creator platforms with the strongest pages price as aligned incentives:
  - Playbook: $0 a month, and the creator keeps 80%;
  - Passes: the creator keeps up to 90%.

  [Direct check of their live pages] https://www.playbookapp.io/ and https://passes.com/
- **Gap:** no measured study compares revenue share with subscription pricing.

**Apply to trainsyou**
- **At-a-glance pricing:** three columns, Free / What we take / Optional.
- **Use the line that is already live: "We earn only when your subscribers pay"** (`marketing-content.ts:771`).
  - Do not use "You pay nothing unless subscribers pay you". The statement deducts optional services such as voice and your own domain (`:1662`). A domain is a purchase shown before you buy it (`:1284`), and you can make it with no subscribers.
- **Publish the card-processing rate, or how it is passed through, on `/pricing`.** It is unstated today, which leaves an objection open.
  - This reverses the owner's earlier "no card-fee line" choice for the HTML home (`PROJECT_MEMORY.md:35`), so it is owner decision 3.
- **Lead with one worked AED example,** with a "Not on yet: subscriber payments" chip beside it: 150 subscribers at AED 199 bring in AED 29,850. Commission is AED 6,965. You keep AED 22,885 before card processing.
- **Keep the single commission plan.** No invented tiers.

### 6. Say plainly what works today, so the money promise never runs ahead of the product
**Evidence**
- 73% of buyers assume vendors aren't fully honest. [Vendor claim, Rob Roy Consulting 2021] https://www.businesswire.com/news/home/20211021005235/en/Rob-Roy-Consulting-Releases-2021-B2B-Tech-Purchase-Study/
- Skill rules: "One fabricated figure at the top licenses rejection of every real figure below it"; and do not "lead with the demonstrable rather than the valuable". [Expert]
- Disclosing fees and policies up front builds credibility. [Expert, NN/g, as in principle 5]

**Apply to trainsyou**
- **Payments and payouts are off in production, and the payments launch gate blocks publishing.** Yet the home page, pricing, both calculators and the specialty pages all headline AED earnings.
- **Add one honest "Live today / Not on yet" panel,** built from the launch gates as well as the feature flags. It replaces the 21 scattered amber chips and the bare "when enabled" phrases.
  - **Live today:** sign up, set up your page and app, teach and test your AI, and preview what subscribers will see.
  - **Not on yet:** publishing your page to subscribers, subscriber payments in AED, payouts to a UAE bank, paid bookings, and the voice add-on for subscribers ("Premium voice stays a paid capability", `docs/features/joining*.md:60`).
  - The nutrition tier shows as available only when its approval flags are on.
  - Say "Not on yet", not "Switching on next", unless the owner commits to a date.
  - Never promise "we'll email you", because no email provider is configured.
- **Placement:**
  - home band 5, before any AED headline;
  - the top of `/pricing` and `/get-started`;
  - a status chip beside every AED headline: calculators, specialty CTAs, and the `/features/payments-and-payouts` and `/features/bookings` H1s.
- **Fix two wrong labels:**
  - the chip bug: Progress and Client Twin shows "Available soon" only because Zepp is off, since the chip uses `some(!available)`;
  - the stale `/faq` answer to "What can I connect?": rebuild it from the same flag and gate data so it lists exactly what connects today.
- **The owner approves the public wording** (decision 1).

### 7. One action with one label everywhere, plus a sticky bar on phones
**Evidence**
- One consistent label for one action follows the "consistency and standards" heuristic. [Expert, NN/g heuristic 4] https://www.nngroup.com/articles/ten-usability-heuristics/ This is the case for one label.
- On standalone campaign landing pages, pages with one link or CTA converted at 13.5%, against 11.9% with two and 10.5% with three. [Vendor data, Unbounce, 18,639 pages, correlational, 2018] https://www.marketingprofs.com/charts/2018/33935/what-converts-web-landing-page-benchmarks-and-trends-infographic
  - This counts links, not label consistency, and it applies only to campaign landing pages. This site keeps its nav. Use the figure only if paid campaigns get dedicated landing pages.
- The sticky-CTA pattern has 29 logged tests, mostly on mobile; the results are paywalled. [Vendor data, GoodUI pattern 41] https://goodui.org/patterns/41
- 49% of people use their phone with one hand. [Measured, Hoober 2013, 1,333 observations] https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- "First-person CTA +90%" appears in the skill but could not be traced. [Anecdote] We do not use it.

**Apply to trainsyou**
- **One label sitewide: "Teach your AI — free".** It matches `BRAND_COPY.primaryAction` and the owner's reverted HTML ("Teach your AI — free"). "my" against "your" goes into the CTA test list (section E).
- **On tablet and desktop, the header button is this sign-up CTA on every page.**
  - The page's own action becomes the secondary: "Estimate my earnings", "Read the AI disclosure", "Back to the follower calculator".
  - "Get started" stops routing to an intermediate page.
- **On phones, the header shows the logo and menu only.** At 360 px, a logo of at least 160 px, a menu button and the CTA do not fit in 328 px. The CTA lives in the hero, the sticky bar and the closing panel.
- **Micro line under the CTA:** "Free to join · Nothing to pay upfront · Nothing goes live until you publish".
  - It replaces the live "Free to join · No upfront cost · Built for UAE trainers", which a test encodes. This is a copy change (decision 18).
- **Sticky bar on phones:**
  - it slides up (transform only) once the hero leaves the viewport;
  - it hides over the closing panel and the footer;
  - the button is at least 48 px high;
  - section C0 sets its stacking with the consent bar and Kamran.
- **When registration is closed,** every primary label reads "Join early access — free" (see C0).
- **Retire the other seven labels.** The exception is "Claim this address", which stays everywhere AddressPreview appears, because it is a field action.

### 8. Build proof that is honest while there are no testimonials
**Evidence**
- Purchase likelihood rose about 270% with 5 reviews against none, and most of the gain came from the first five. [Measured; Spiegel Research Center, retail] https://www.marketingprofs.com/charts/2017/32629/the-measurable-impact-that-reviews-and-ratings-have-on-sales
- Users trust external sources more than testimonials on the site itself. [Expert, NN/g] https://www.nngroup.com/articles/trustworthy-design/
- Highrise: a long-form page beat the original by 37.5%. Then a much shorter page with a big photo of a real person beat the long form by 47%. [Vendor data, single company; the post gives no sample size, and the "42,000+ visitors" figure could not be traced] https://signalvnoise.com/posts/2991-behind-the-scenes-ab-testing-part-3-final
- Logos and testimonials with photos are the most recalled kind of proof. This measures recall, not conversion. [Measured attention, CXL] https://cxl.com/research-study/social-proof/
- None of the competitors' counts can be checked, and several contradict themselves:
  - TrueCoach says both 16K and 20K;
  - Trainerize's pricing page disagrees with itself in three places.

  [Direct check]

**Apply to trainsyou**
- **Proof, in this order:**
  1. **The working product:** the demo, and a static sample coach site mock inside the marketing site labelled "Sample". It is not a published tenant: that would be gated and would look like a real coach.
  2. **Open arithmetic:** commission bands and calculators.
  3. **"Every market figure links to its source"**: a badge linking to `/methodology` from each market figure. Samples (86%, Layla Strength), product counts and example prices are labelled as what they are.
  4. **The full constraint list.**
  5. **A named founder with a face and a short note.**
     - This reverses the owner's earlier "no social proof" choice for the HTML home (`PROJECT_MEMORY.md:35`).
     - It must be reconciled with Kamran, who says "I built trainsyou": the page says Kamran is an AI voice of the named founder, used with consent.
     - The owner supplies the name, photo and words (decision 2).
  6. **Company details and a support email.** Both are null on live today (owner action).
- **No counts, logos, ratings or "trusted by".**
- **The first five consented trainer stories can only be collected once go-live works,** because publishing is gated today. Then link to their real coaching sites; that is the external signal.
- **A "founding trainers" offer only if the owner defines real terms.**

### 9. Let trainers try it without a form
**Evidence**
- About 70% of the top 1% of interactive demos are ungated. 73% of top demos put their CTA above the fold or in the nav. The most common length is 5–12 steps. 88% of demo sessions happen on desktop. [Vendor claim, Navattic 2025] https://navattic.com/report/state-of-the-interactive-product-demo-2025
- Trust in AI rises with hands-on use. [Vendor data, Edelman 2025 AI flash poll, 5 markets] https://www.edelman.com/insights/familiarity-breeds-trust-in-ai
- Of the 12 competitors checked, none lets a visitor try a client-facing AI. Outside that set, Delphi offers a "try the mind" chat. [Direct check, 12 competitors]

**Apply to trainsyou**
- **`/demo` becomes an ungated, mobile-first, deterministic demo.** It is scripted, no model is called, and the page says so.
  - **4 decisions:**
    1. squat +2.5 kg;
    2. a missed session moved to Thursday;
    3. a hotel gym handed to the trainer;
    4. knee pain pauses the workout.
  - **A rule the visitor can edit:** "After [2] easy sessions at [3]+ reps in reserve, add [2.5] kg." The plan recomputes.
  - **A "how sure must it be" slider** that moves a decision between lanes. This is principle 2's adjustability made tangible.
  - The rule builder and the slider change an existing marketing widget, so they need the owner's OK (decision 9).
- **"Try the demo" goes in the nav and is the hero's secondary CTA.**
- **A live AI sandbox belongs after sign-up** (the wizard quiz), not on a public page.

### 10. Calculators: the trainer's inputs, sourced ratios, and the result carried into sign-up
**Evidence**
- Engagement lifts from calculators exist only as vendor claims. [Vendor claim, Outgrow] https://outgrow.co/blog/interactive-content-roi-data-driven-insights
- Skill rule: "they set the inputs, you supply the measured ratio. Understate deliberately… A big number they distrust converts worse." [Expert]
- **Owner decision on record:** the follower calculator's headline is the strong case, labelled a best case, with the cautious and typical cases shown (`COMPLETION_STAGES.md:779`).

**Apply to trainsyou**
- **Keep the calculator maths and the owner's headline, including its live qualifier "before platform commission".**
  - Put a "Not on yet: subscriber payments" chip beside every AED result.
- **Show all three scenarios side by side.** At defaults: Cautious AED 398, Typical AED 2,985 and Strong AED 23,084 a month at month 12. Typical stays one glance away, not one tap. This changes the widget (decision 9).
- **Carry the price only if the owner approves the code change.** Today nothing in `apps/web` reads `price_aed`.
  - The change: `/signup` reads `price_aed`, and the wizard's "Your plan" step pre-fills it. This is on the protected path (decision 8).
  - Until it ships: no price chip and no price promise.
  - Once it ships: the CTA label stays "Teach your AI — free", with a sub-line "Your price, AED 199, carries into setup". A label like "free at AED 199" could be read as "teaching costs AED 199".
- **Carry `slug` as today** (pre-fill only).
- **Link "Don't know your subscriber count? Estimate it from followers"** from the earnings calculator.
- **No email gate.**
- **Raise a test of the Typical default with the owner.** Do not change it unilaterally.

### 11. Low-friction sign-up: few fields, no card, details later
**Evidence**
- Field type matters more than field count: asking for a phone number dropped conversion from about 19% to 13%. [Vendor data, HubSpot, 40,000+ pages] https://blog.hubspot.com/blog/tabid/6307/bid/6746/which-types-of-form-fields-lower-landing-page-conversions.aspx
- Stated password rules rarely cause abandonment. [Expert, Baymard] https://baymard.com/blog/password-requirements-and-password-reset
- Reddit saw +50% sign-ups from Sign in with Google and a further +90% from One Tap. [Vendor claim, Google] https://developers.google.com/identity/sign-in/case-studies

**Apply to trainsyou**
- **Keep the 4 fields:** name, email, a password of 12 or more characters, and legal acceptance.
- **The sign-up card restates "Free · No card · Nothing goes live until you publish".**
- **When a slug was carried in,** show "your-name.trainsyou.com — we'll check it's free in setup". Today the slug is only pre-filled (`marketing-site.md:343`), so the card never says "reserved".
- **Show a price hint only after the `price_aed` change ships** (decision 8).
- **Turn on email codes, Google and Apple when ops are ready.** The flags exist; this is an owner and ops decision.
- **The sign-up path is protected** by the owner rule "keep the trainer sign-up path as it is", so copy changes need the owner's OK.

### 12. Multipage, one job per page, each page only as long as its objections need
**Evidence**
- Highrise: long form beat the original by 37.5%, then a much shorter page beat the long form by 47%. [Vendor data, single company] https://signalvnoise.com/posts/2991-behind-the-scenes-ab-testing-part-3-final
- Crazy Egg: a page 20 times longer won by 30%, then a shorter rewrite beat it by 13%. What won both times was answering objections. [Vendor data] https://copyhackers.com/2014/02/optimized-crazy-egg-home-page/
- Email traffic converts at 16.9% and paid social at 2.9%. [Vendor data, Unbounce, SaaS n undisclosed, correlational] https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/
- The owner's decision: the site stays multipage.

**Apply to trainsyou**
- **Home:** 8 bands plus the closing panel, each answering one objection, within the 400-word house budget.
- **Deep objection pages:** `/trainer-brain`, `/pricing`, `/security-and-privacy` and the specialty pages.
- **Tagged links:** the share links trainers put on Instagram can carry the source.

### 13. Design for phones, and let the decision finish on desktop
**Evidence**
- Desktop converts at 3.4%, about 74% higher than mobile web. [Vendor data, Contentsquare 2026 benchmark, 99 billion sessions] https://contentsquare.com/de-de/blog/mobile-vs-desktop-traffic/
- 79% of SaaS landing-page visits are on mobile, and that is paid traffic. [Vendor data, Unbounce, SaaS n undisclosed, correlational] https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/
- UAE internet penetration is 99%. [Vendor data, DataReportal 2025] https://datareportal.com/reports/digital-2025-united-arab-emirates

**Apply to trainsyou**
- **Build every template mobile-first.** The phone frame is the main product surface.
- **Add a "Send this to myself" button using the Web Share API.** It opens the native share sheet, so WhatsApp and email work without a backend.
  - Where `navigator.share` is missing (desktop Firefox and others), the button copies the link instead and announces "Link copied".
  - No email provider is configured, so the site never promises an email.

### 14. Local fit: AED, UAE facts, and an RTL-ready build
**Evidence**
- 76% prefer buying with information in their own language. [Vendor claim, CSA Research 2020, 8,709 consumers in 29 countries, self-reported] https://csa-research.com/More/Featured-Content/Global-Growth/CRWB-Series/CRWB-B2C
- When the Arabic and English versions of a site looked the same, the Arabic content was still less usable. [Measured but small; Arif and Gupta 2014, 30 evaluators] https://salford-repository.worktribe.com/output/1411726/assessing-the-usability-for-arabic-language-websites
- None of the 12 competitor homepages checked has Arabic, RTL, AED or any mention of the UAE. [Direct check]

**Apply to trainsyou**
- **AED and UAE facts everywhere.**
- **CSS uses logical properties,** and the direction of motion mirrors in RTL.
- **Marketing pages stay English until a human translates them** (owner rule).
  - The RTL preview applies only to the subscriber-app vignette. Flipping the English marketing page itself would misrepresent the product.
- **Be honest about Arabic:** the follower app is English and Arabic with RTL, the trainer area is English, and content the trainer writes is not auto-translated.

### 15. Measure first, and test only big swings
**Evidence**
- Rule of thumb: n ≈ 16·p(1−p)/MDE² visitors per variant. [Expert, standard statistics]
  - At a 3% baseline, detecting a 10% relative lift needs about 52,000 visitors per variant.
  - Detecting a 30% lift needs about 5,800 per variant.
- Today there are no CTA, calculator, demo, Kamran or form-start events, and UTM parameters are not carried into `/signup`. [Direct check, site audit]

**Apply to trainsyou**
- **Ship the event set** in section B with the revamp.
- **Only consented visitors count.** Both the sample sizes above and any variant assignment rely on consent (section E).
- **Before any A/B test,** run 5-second comprehension tests with 5–8 UAE trainers.
- **The first live test is concept against concept:** A against C while payments are off.

### Weak claims we will not lean on
- **"First-person CTA +90%"** (could not be traced).
- **"Single-CTA pages convert 266% better".**
- **Unbounce link-count figures as evidence for one consistent label.** They count links, on campaign landing pages only.
- **"Hero video lifts conversion".**
- **Decoy pricing.**
- **"Interactive content converts 2x".**
- **Single-customer "3x/6x" demo figures.**
- **"7% loss per second of load".** Use Deloitte, Vodafone and Portent instead.
- **"Users decide in 50 ms".** That is visual appeal, not a purchase decision.
- **NN/g scroll-jacking findings applied to a sticky scene on native scroll.**
- **Baymard's 19% forced-account abandonment.** It measured e-commerce checkout; trainers must create an account anyway.
- **The Highrise "42,000+ visitors" figure** (not in the cited post).
- **GymNation's 46% "women-only spaces are essential"** as support for online pre and postnatal coaching. The survey was about physical gyms.
- **Persona figures and trigger quotes** (unsourced; hypotheses only).
- **Unsourced shares of reduced-motion users.**
- **AI-simulated persona message tests.**

---

## B) FUNNEL

### Conversions
**Primary conversion:** a trainer account is created at `/signup`. The existing acquisition event `signup` fires, with an owner membership, attributed to the first touch.

**Business conversion further down** (tracked; not the marketing KPI yet):
1. Wizard complete: 6 steps, about 15 minutes.
2. First rule confirmed, plus 8 quiz answers and 3 own cases ("Waits for me" mode).
3. Site published. **Blocked while the payments launch gate is on.**
4. First paying subscriber. **Blocked while `payments` is off.**

**Micro-conversions,** which predict sign-up:
- a demo scenario played, or a rule or threshold edited;
- a calculator input changed, then the result viewed;
- AddressPreview typed into (3 or more characters);
- the `/signup` form started;
- a Kamran call started;
- an objection FAQ opened;
- a guide read to 75%;
- "Send this to myself" shared or copied.

### Ideal path per persona
The persona figures and trigger phrases below are hypotheses from the buyer-research report [Hypothesis]: "gym takes 30–60%", "AED 150–350 sessions", "2k–30k followers", and the objection phrasings. They guide the design. They never appear on the site, and never as trainer quotes.

| Persona | Likely entry | Path | Objection to clear first | Device |
|---|---|---|---|---|
| **T1, capped gym trainer** (2k–30k followers, AED 150–350 sessions, gym takes 30–60% [Hypothesis]) | Instagram bio or Story link, or a search such as "online personal training Dubai" | Home or specialty page → follower calculator ("what are my followers worth?") → AddressPreview → `/signup?slug=` (`price_aed` only after decision 8) | "Will my followers pay?" and "It'll make me look cheap" | Phone |
| **T2, online coach already selling** (AED 400–1,200 a month, WhatsApp check-ins [Hypothesis]) | Search, comparison, referral | Home → `/demo` (edit a rule; does it sound like me?) → `/trainer-brain` (Compare my replies; what it never does) → `/pricing` (what's your cut; who owns clients) → `/signup` | "It'll say something I'd never say" and "What's your cut?" | Desktop to decide |
| **T3, specialist** (pre and postnatal, women's coaching, Arabic audience) | Specialty page, `/uae` | Specialty → safety block (pregnancy always paused; "Waits for me") → `/security-and-privacy` → FAQ (Arabic scope) → `/signup` | "One wrong answer to a pregnant client and I'm finished" | Both |
| **T4, studio owner** (3–8 coaches) | Features, search | `/features/team` → `/pricing` → `/signup` | Staff access and who owns the brand | Desktop. Gap: there is no published contact |
| **Follower or consumer** | `/coaches` | Not this funnel. Hide the empty directory (C22). | | |

### What to measure
- **Consent.** All events wait for consent (existing rule) and go to the existing first-party acquisition endpoint. No tag manager is needed.
- **Attribution parameters.** UTM, gclid, fbclid and `ref`:
  - **with consent:** stored at first touch and appended to every `/signup` link from storage;
  - **without consent:** nothing is stored, and only the current URL's parameters pass through to `/signup` links.
- **Context.** `concept` and `page` are attached to every event.

| Event | Fires when | Properties |
|---|---|---|
| `cta_click` | any primary or secondary CTA | label, location (header, hero, sticky, inline, closing), page |
| `concept_exposure` | a page renders under an assigned A/B variant (consented visitors only) | concept, page |
| `demo_play` / `demo_rule_edit` / `demo_threshold` | demo interaction | scenario, field, value |
| `calc_input` (first per session) / `calc_result_view` | calculator | calc, scenario, price bucket |
| `address_typed` | AddressPreview has 3+ characters | length only; never the slug text |
| `faq_open` | an FAQ answer is opened | question id |
| `kamran_start` / `kamran_end` | a Kamran call starts or ends | duration bucket |
| `share_self` | Web Share or copy-link used | page, method (share or copy) |
| `signup_view` / `signup_field_start` / `signup_submit` / `signup_error` | `/signup` | has_slug, has_price (after decision 8), entry_page, error_type |
| `signup` (exists) | account created | first and last touch |
| `wizard_step_complete`, `brain_first_rule_confirmed`, `site_published` (blocked today), `first_paid_subscriber` (blocked today) | product | step |
| `web_vitals` | LCP, INP and CLS on marketing pages | page, device class |

**KPIs:**
- visit → sign-up rate, by entry page and first-touch source (consented visitors);
- CTR by CTA location (header, hero, sticky, closing);
- demo → sign-up and calculator → sign-up rates;
- sign-up → wizard complete within 7 days;
- sign-up → first rule confirmed within 7 days;
- median time to first confirmed rule;
- sign-up → published within 14 days. Blocked while the payments launch gate is on; report it once publishing works;
- consent rate (coverage is partial before consent);
- p75 LCP and INP.

---

## C) PAGE BLUEPRINT (shared by all three concepts)

### C0. Sitewide rules

**Header**
- **Tablet and desktop:**
  - the logo lockup, 41 px high and at least 160 px wide, never mirrored;
  - nav: How it works · Trainer Brain · Features · Demo · Pricing · For trainers ▾ (Weight loss, Strength, Muscle gain, Pre and postnatal, In the UAE) · Guides;
  - on the right: "Sign in", then the primary CTA **"Teach your AI — free"** on every page.
- **Phones (≤760 px):**
  - the logo and a menu button only;
  - the nav and "Sign in" open in a sheet;
  - the CTA lives in the hero, the sticky bar and the closing panel.

**Registration-closed variant** (driven by the `registration` flag)
- Every primary label reads **"Join early access — free"** and opens the early-access form: header, sticky bar, hero, closing panel, 404 and the calculators.
- The micro line becomes "Free to join · We'll tell you here when sign-ups reopen". No email is promised.

**Mobile bottom stack** (one order, no collisions)
1. The consent bar takes the bottom edge while it is showing. The sticky CTA bar waits until the visitor makes a consent choice.
2. The sticky CTA bar reads "Teach your AI — free", with "Free to join" underneath.
   - It sits above `env(safe-area-inset-bottom)`.
   - It animates by `transform` only.
   - It hides over the closing panel and the footer.
   - The page reserves bottom padding equal to the bar's height whenever the bar can show, so it never covers content or footer links.
3. On phones the Kamran pill does not float. It appears inline in the FAQ band and the closing panel. On desktop it floats at the bottom inline-end corner, clear of the consent bar.

**Footer**
- Every page, grouped: Product, For trainers, Resources, Company, Legal.
- Also "Analytics preferences" and "Every market figure sourced → Methodology".
- `/coaches` appears only once listings exist.

**Closing panel** (kept on every page)
- Pace background, ink text, H2 "Your coaching. Beyond your hours."
- Line: "Guided setup. Nothing goes live until you publish."
- The primary CTA, plus a page-relevant secondary.

**Status**
- **One chip set, driven by flags and gates:** Included, Optional tier, Add-on, Not on yet.
  - "Not on yet" replaces "Available soon". That wording is test-encoded, so the change goes with decision 1.
- **Fix the Progress chip logic:** use core availability, not `some()`.
- **The "Live today / Not on yet" panel** (principle 6) goes on the home, pricing and get-started pages. A chip sits beside every AED headline.

**Proof components** (reused)
- `SourceBadge`: "Source →" to `/methodology#id`, beside every market figure. A figure that is not yet in `/methodology` gets no badge and does not ship.
- `EstimateLabel`: "Estimate, not a promise".
- `SampleLabel`: "Sample trainer · scripted". Used on Layla Strength and all mock data.
- `ConstraintList`: what your AI never does.
- `FounderNote`: content from the owner (decision 2).
- `StatusPanel`: "Live today / Not on yet".

**Copy rules** (existing house limits, now enforced)
- **Headings and text lengths:**
  - H1: 8 words or fewer, no colon. This includes feature and guide pages; search wording stays in `<title>` and meta.
  - H2: 6 words or fewer.
  - Lede: 25 words or fewer.
  - Card body: 18 words or fewer.
  - FAQ answers: 45 words or fewer.
  - Home: 400 visible words in `main`, not counting the follower calculator block (`marketing-site.md:671`).
- **"AI" always belongs to someone.** Write "your AI", never "an AI" or "the AI", in headings.
- **Grade-6 vocabulary.** These terms are replaced on marketing pages:

  | Replace | With |
  |---|---|
  | held-out scenarios | your test cases |
  | marginal bands | our share for each group of subscribers |
  | confidence threshold | how sure it must be |
  | safety floor | safety rules it can't switch off |

- **Banned terms.**
  - Existing tests and house rules ban: seamless, revolutionary, cutting-edge, unlock, empower, game-changing; any AI cost, AI usage fee or model cost; vendor or model names; the payout provider's name.
  - This plan adds new assertions for: "trusted by", "#1", guaranteed, passive income.
- **Copy-change process.**
  - Motion work never rewords copy (`marketing-motion.md:27-28`). Every copy change in this blueprint is a copy change for the owner to approve (decision 18).
  - After approval, update deliberately the test assertions that encode today's structure: the home "relay and five sections", the hero micro line, and the chip wording.
  - Then re-run `tests/marketing-site.test.ts`. It must still pass on:
    - the banned phrases;
    - the word budgets;
    - one H1, highlighted with `span.mk-mark` and never `<mark>`;
    - no "Trainer Brain" in the home hero;
    - no "payouts to a UAE bank" in the home hero;
    - the `/features` section ids.

**SEO and generated metadata**
- Titles, meta descriptions, JSON-LD, the sitemap and the llms files are all generated from `marketing.ts`. Every H1 rewrite keeps the page's query terms in its `<title>` and meta:
  - `/uae` keeps "take your coaching online";
  - specialty pages keep "for strength coaches" and the like;
  - `/trainer-brain` keeps "AI trainer";
  - feature pages keep their `keyword`.
- Canonicals are unchanged.
- `/coaches` gets `noindex` (decision 11).

**Motion moments shared by all concepts**
- **Page transition.**
- **Highlight sweep on "trains":** the owner wants it. The words are visible; only the Pace mark scales.
- **Reveal-once on bands below the first screen only.**
- **Button press:** scale. **Hover:** an instant colour change or an overlay's opacity, inside `@media (hover: hover)`.
- **Disclosure grid rows.**
- **Sticky bar slide.**

Each concept sets its own values in section D.

**Widget accessibility** (all concepts)
- One polite `aria-live` result region per calculator and per demo, with announcements debounced to about 500 ms.
- Digit-roll strips and typing dots are `aria-hidden`; the real value is always present as text.
- The threshold control is a labelled `input type=range` with `aria-valuetext` (for example "90%: unsure, goes to you").
- Scenario and group tabs follow the ARIA tabs pattern, with arrow keys and roving tabindex.
- Rule-builder fields and stepper controls are at least 44 px.

**Bilingual-ready**
- A `dir` attribute and logical properties.
- Arrow icons mirror; the logo does not.
- An Arabic font loads only for `lang=ar`.
- Prototypes include an RTL preview toggle on the subscriber-app vignette only, using real member-app Arabic strings from the codebase. No invented translations.

**Measurement hooks** on every CTA, calculator, demo control, FAQ and Kamran button, as listed in section B.

### C1. Home `/`
**Job:** in one eyeful, the visitor learns three things: their method goes into their AI, the AI trains their subscribers under their name, and it is free to start. Then they click to sign up or to the demo.

**Sections in order, with word budgets** (total 400 or fewer, not counting the calculator block):

1. **Hero (45 words or fewer)**
   - Eyebrow "FOR UAE PERSONAL TRAINERS".
   - H1 (per concept; "trains" carries the Pace highlight) and lede.
   - Primary CTA "Teach your AI — free", secondary "Try the demo".
   - Micro line "Free to join · Nothing to pay upfront · Nothing goes live until you publish".
   - Product visual, per concept: always real UI, labelled "Sample trainer · scripted". Its start state is fully visible at first paint, and only the change animates.
2. **How it works, 3 steps (60 words or fewer, counting only the stepper's current step)**
   - The steps:
     1. **You teach:** rules, cases and an 8-answer quiz. Example rule: "Add 2.5 kg after two easy sessions."
     2. **It coaches:** a dated plan every day, guided workouts, and changes as they train.
     3. **You decide:** confident → applied; unsure → to you; pain → paused, to you.
   - The name is defined here: "your AI (we call it your Trainer Brain)".
   - Below the steps, the 8-step walkthrough as a stepper the visitor controls, never pinned (decision 4).
     - Chapters run from "Claim your address" to "Get paid monthly".
     - "Publish" and "Get paid" carry "Not on yet" chips.
     - Link "See how it works".
3. **What your subscribers get, under your name (45 words or fewer)**
   - Daily plan; guided workouts that keep working offline in the gym; progress they can see.
   - Nutrition, an optional tier (meal plans, grocery list, food diary).
   - Voice-led sessions in your own voice: an add-on, "Not on yet" for subscribers.
   - "Your site, your app icon, your-name.trainsyou.com."
   - Caption: "Once your page is live."
   - Link "All features".
4. **You stay in charge, and what it never does (70 words or fewer)**
   - The ControlFlow card:
     - a subscriber writes "Week three done. Squats felt easy.";
     - the card shows "Your rule: two easy sessions → add 2.5 kg" and confidence 86%;
     - three lanes: Applied automatically / Unsure → to you / Pain → paused, to you.
   - The `ConstraintList`.
   - "Waits for me" mode: every reply waits for you until you turn on automatic sending, which needs 20 cases and passing checks.
   - Link "How your AI decides" → `/trainer-brain`.
5. **Free to start. Your price. (50 words or fewer)**
   - The `StatusPanel` comes first, before any AED figure: "Live today / Not on yet".
   - Three facts:
     - free to join;
     - you set the AED price;
     - our share starts at 25% and falls to 10% as you grow (25% · first 100, 20% · 101–300, 15% · 301–1,000, 10% · 1,001+; each rate applies only to its band).
   - "We earn only when your subscribers pay."
   - A mini "tools it replaces" row:
     - 5 included: website builder, client app, meal-planning app, messaging app, spreadsheets;
     - plus booking tool and payments and invoicing, each with a "Not on yet" chip;
     - caption "once your page is live".
   - AddressPreview "Claim this address" → `/signup?slug=`, hint "We'll check it's free in setup".
   - Link "Pricing in detail".
6. **What are your followers worth? (calculator block, reported separately)**
   - A compact follower calculator (7,000 followers, AED 199, 8 link Stories).
   - Owner-approved headline: "Up to AED 23,084 a month at your price, before platform commission". It is labelled best case, with Typical AED 2,985 and Cautious AED 398 alongside.
   - "Not on yet: subscriber payments" chip, `EstimateLabel`, `SourceBadge`.
   - CTA "Teach your AI — free". The price sub-line appears only after decision 8.
7. **Honest proof (60 words or fewer)**
   - `FounderNote`: photo, name, why I built this (decision 2).
   - "We publish no testimonials, logos, ratings or counts we can't show. Check these instead:" Try the demo / Every market figure sourced / The commission maths / What works today (anchor to band 5).
8. **FAQ: 6 questions, ordered by objection (questions about 40 words; answers closed)**
   - Will my AI replace me?
   - What happens when a subscriber reports pain?
   - Does it cost anything to join?
   - Will my followers pay?
   - Can subscribers pay me today? The answer: not yet, and publishing waits for payments.
   - Do I need technical skills?
9. **Closing panel (15 words or fewer).**
10. **Kamran:** the pill "Talk to Kamran (AI voice)". The text label is always visible, never icon-only. It floats on desktop and sits inline on phones (C0).

Check every budget against the test's word counter before build. If the counter includes closed FAQ answers, cut the FAQ to 4.

**CTAs:** primary "Teach your AI — free"; secondary "Try the demo".

**Proof:** product UI, the constraint list, open commission maths, the sourced calculator, the founder, live status.

**Objections handled:** replacement, safety, cost, followers paying, technical skill, timing.

**Motion:**
- The hero's change sequence plays once, after first paint.
- The "trains" sweep.
- Stepper transitions.
- The lane slide.
- Calculator values update on input (B: digit roll, decision 6).
- Reveal-once per band below the first screen.

**Concept deviations (band order).** Each concept's extra band takes its words from an existing band's budget.
- **A:** 1 → demo-style "Change the rule" mini band (its words come from band 2) → 2 → 3 → 4 → 5 → 6 → 7 → 8.
- **B:** 1 (offer-screen hero, "free to start, your price") → 2 (the mechanism, second) → "An hour sells once" (static, 25 words or fewer, from band 5's budget) → 5 → 6 → 4 → 3 → 7 → 8.
- **C:** 1 (rule being confirmed) → "What you teach it" (replaces step 1 of band 2) → 4 enlarged into a two-part band (control, and the never-list as a signed page) → 2 → 3 → 5 → 6 → 7 as a founder letter → 8.

### C2. How it works `/how-it-works`
**Job:** explain the mechanism and the time it takes; send visitors straight to sign-up, not to `/get-started`.

**Sections:**
1. **Hero:** H1 "From your method to daily coaching". Lede: "Teach it your method, test it, then publish. It coaches every subscriber daily and hands you what it's unsure about."
2. **8-step walkthrough** (a stepper; desktop shows the laptop and phone, mobile shows the phone only):
   1. Claim your address.
   2. Teach your AI: confirm rules, answer the quiz, add client cases, and import documents after a private review.
   3. Test it: supervised, with 8 quiz answers and 3 own cases. Automatic sending needs 20 cases and passing checks.
   4. Create your offer.
   5. Publish and share your tagged link ("Not on yet" chip).
   6. It coaches daily.
   7. You correct, it learns.
   8. Get paid monthly ("Not on yet" chip, replacing "When enabled").
3. **Who does what:** the lanes table (You / Your AI / Your subscriber), all 4 rows as in the audit.
4. **Time to start:** six steps of 1, 3, 2, 6, 1 and 2 minutes, about 15 minutes in all. The copy says "start", not "launch".
5. **Control stays visible:** inspect every rule and its source, roll back a release, take over any conversation. Subscribers always see when guidance is digital.
6. **"Frontier model plus your corrections"** line, shown only when the `frontier` flag is on.
7. **FAQ (4):** setup time; when it's unsure; is it trained on my data; pain.

**CTAs:** primary "Teach your AI — free"; secondary "Try the demo". These replace today's "Get started → /get-started".

**Proof:** the stepper's product states.

**Objections handled:** time, control, safety.

**Motion:**
- In the stepper, the current step crossfades, the progress line draws with stroke-dashoffset, and the device content swaps by opacity with an 8 px rise.
- Arriving from home uses the root crossfade. The stepper sits below the fold on phones, so there is no shared-element morph (section D).

**Concept deviations:**
- **A:** the stepper is the Decision Console in 8 states.
- **B:** step 8 expands into a sample statement, labelled sample, with the "Not on yet" chip.
- **C:** a numbered manual layout with margin notes for times and requirements.

### C3. Trainer Brain `/trainer-brain`
**Job:** prove the moat: a bespoke AI built from the trainer's judgment, under the trainer's control.

**Sections:**
1. **Hero:** H1 "Your AI, built from your judgment". The title and meta keep "AI trainer".
   - The visual is a rule card: "After two sessions at 3+ reps in reserve, add 2.5 kg", source "Interview, 12 Oct", with the buttons Confirm / Edit / Reject.
2. **What it is:** "Not a generic workout generator. Every change traces back to something you taught. Every version can be rolled back."
3. **What you teach it:**
   - a guided interview;
   - plain-language rules you confirm, each with its source. Flagged rules are never included in "Approve all";
   - cases and worked examples;
   - your documents, after you review the extracted text;
   - the practice quiz.
4. **How it decides,** 3 cards:
   - **Confident:** applied automatically, with the reason recorded.
   - **Not sure:** handed to you, and your correction becomes teaching.
   - **Safety:** always to you. Pain, medical issues and red flags pause the workout. Enforced in code, outside the AI.
5. **How it gets better:**
   - corrections become suggested rules you confirm;
   - it is checked against your test cases before every release;
   - every release is versioned, with rollback;
   - "Compare my replies": rate its reply blind against yours, 1–5 on five points;
   - the frontier line, gated by the flag.
6. **What it never does:** the `ConstraintList`.
7. **Your method stays yours:** private to your workspace and isolated at the database layer. It is never used for another trainer, and you can export or delete it. Your voice is used only with consent you can withdraw.
8. **FAQ (4),** then the closing panel.

**CTAs:** primary "Teach your AI — free"; secondary "Try the demo".

**Proof:** the rule card UI, the release timeline with rollback, the blind comparison UI.

**Objections handled:** it'll say what I wouldn't; it'll replace me; who owns my method.

**Motion:**
- Clicking Confirm makes the rule card stamp. This is the only success state, so it gets spring easing. The background change is an overlay's opacity.
- In the release timeline, rollback moves the "live" marker back one version (translateX, 280 ms).

**Concept deviations:**
- **A:** a rule ledger with mono source chips.
- **B:** compact, and adds "What this means for your hours" with a link to `/pricing`.
- **C:** the flagship page, laid out as an annotated manual.

### C4. Features index `/features`
**Job:** let the visitor scan the breadth, outcomes first: everything included, free to join.

**Sections:**
1. **Hero:** H1 "Everything you need, under your own name".
2. **Four parts of one platform,** as bento cards, each with a mini screen:
   - **Your AI:** Inbox ("Hotel gym for two weeks → Draft plan with dumbbells to 20 kg · Approve / Correct").
   - **Subscriber experience:** Today (Week 3 · Day 2 · Lower body A).
   - **Your business:** the statement (150 × AED 199), labelled sample, with a "Not on yet" chip.
   - **Trust:** pain → paused.
3. **What your subscribers get:** 8 cards.
4. **Inside the product:** 5 screens (Inbox, Today, Logger, Statement, Editor). These are tabs the visitor chooses; nothing auto-rotates.
5. **Tools it replaces** (table, `id="replaces"`). Booking and payments/invoicing carry "Not on yet".
6. **Feature guides** (`id="feature-guides"`): 11 tiles, one per feature page, with corrected chips.
7. **All 91 capabilities** in 10 groups (`id="all-capabilities"`). Disclosures are collapsed by default, with a "Live today / Not on yet" legend at the top. This section stays below the feature guides (test-encoded).
8. **FAQ (2).**

**CTAs:** primary "Teach your AI — free"; secondary "See the pricing".

**Proof:** screens, the full matrix.

**Objections handled:** does it do X; is it really included.

**Motion:** bento cards reveal (below the first screen) with a 40 ms stagger; the tab indicator slides; disclosures open by grid rows.

**Concept deviations:**
- **A:** live mini-screens that run one state change, once.
- **B:** each part shows what it replaces. An optional tool-cost note comes from published competitor price pages; naming competitors and prices needs owner and legal OK (decision 17).
- **C:** an editorial index as a numbered list.

### C5. Feature detail template (11 pages) `/features/*`
**Job:** answer "how does this one thing work", with a visual. Today these pages have no visuals.

**Sections:**
1. **Hero:** eyebrow "FEATURE", H1, status chip, intro, and the page's own product vignette (required).
2. **What it does:** 5 bullets.
3. **What your subscriber sees:** a phone vignette.
4. **What you control:** a trainer vignette.
5. **How it runs:** steps or a table.
6. **FAQ and related features,** then the closing panel.

**H1 rewrites** (8 words or fewer; each page's `keyword` stays in its title and meta):

| Page | Live H1 (words) | New H1 |
|---|---|---|
| ai-training-plans | "A personalised plan for every subscriber, built and adapted by your Brain" (12) | "Your AI plans every subscriber's training" |
| subscriber-app | "A day-by-day training app with your name on it" (9) | "Your training app, with your name on it" |
| chat-and-digital-coach | "Stay close to every subscriber without answering every message" (9) | "Stay close without answering every message" |
| payments-and-payouts | "Get paid in AED, every month, to your UAE bank" (10) | "Monthly AED payouts to your UAE bank", with a "Not on yet" chip beside it |
| bookings | "Sell one-to-one sessions alongside your AI coaching" (7) | "Add paid sessions to your AI coaching", with a "Not on yet" chip. This keeps the moat primary |
| safety | "Safety rules the AI cannot override" (6) | "Safety rules your AI cannot override" (AI belongs to the trainer) |
| others | within the limit | unchanged |

**Vignette per page** (real facts only):

| Page | Vignette |
|---|---|
| ai-training-plans | Today: Back squat 4×6 · 62.5 kg · 120 s; RDL 3×8 · 50 kg; "Start guided session" |
| subscriber-app | "Add to home screen" with the Layla Strength icon; offline badge "Saved offline · syncs when you reconnect"; EN and AR RTL toggle (this vignette only) |
| website-and-domain | Editor: Home · Coaching · Results · Contact; "282 layouts in 40 section families"; desktop-only note; "Domain price shown before you buy" |
| nutrition | Weekly meal plan, grocery list, meal-photo estimate; "Optional tier, can't be bought alone". Shown as available only when its approval flags are on |
| voice-coach | Voice session player; "Your verified voice · consent can be withdrawn · own-music mode"; chip "Add-on · Not on yet for subscribers" |
| bookings | Slot picker (AED 250, capacity, cancellation window); chip "Not on yet" |
| chat-and-digital-coach | Chat with the "Digital coach" label, an attachment, and "You took over · digital coach paused" |
| progress-and-client-twin | Client Twin card: each field has a date and source, and unknowns show as "unknown"; Apple Health import |
| payments-and-payouts | Monthly statement (labelled sample) plus the chip "Not on yet" |
| safety | Pain button → "Workout paused" → trainer alert; "You can add red flags; you can't remove the safety rules" |
| team | Roles matrix: Owner / Staff coach (no finance, design or ownership) / Finance (no coaching data) |

**CTAs:** primary "Teach your AI — free"; secondary "Back to all features".

**Motion:** the vignette plays one state change, once. It plays on reveal when the vignette is below the first screen, or after first paint when it starts in view and fully visible (for example, pain tap → paused banner).

**Concept deviations:** the vignette style follows the concept. A uses live UI; B uses the sample offer and statement framing; C uses an annotated figure with margin notes.

### C6. Demo `/demo`
**Job:** ungated, hands-on proof of control. The visitor adjusts; it decides.

**Sections:**
1. **Hero:** H1 "See your AI make a coaching decision". Line: "Scripted examples. No AI model is called."
2. **Four decisions** (ARIA tabs; the phone and the trainer Inbox side by side, stacked on mobile):
   1. Squats easy → 60 → 62.5 kg, Applied.
   2. Missed yesterday → moved to Thursday, Friday rest, Rescheduled.
   3. Hotel gym for two weeks → Handed to you.
   4. Knee hurts → Workout paused.
3. **Change the rule.** Editable fields (44 px or more): [2] sessions, [3]+ reps in reserve, [2.5] kg. The outcome recomputes deterministically; for example, 3 sessions gives "not yet: one more easy session". The result is announced in a polite `aria-live` region.
4. **How sure must it be?** A labelled range input from 60% to 95%, with `aria-valuetext`, against the sample decision at 86%. At 90% the decision moves to "Unsure → to you".
5. **What happens next in your account:** "You'll teach your real rules in setup. Every reply waits for you until you choose otherwise."
6. **FAQ (4).**

**CTAs:** primary "Teach your AI — free" (replaces "Build my Brain"); secondary "See how it works".

**Proof:** interactivity plus honest labelling.

**Objections handled:** control, safety, "is it just generic".

**Motion:**
- The message enters (on tab click only).
- Typing dots: opacity only, 1.2 s at most, `aria-hidden`, on tab click only.
- Lane slide, 280 ms.
- Value crossfade with stacked spans in a fixed-width tabular slot, plus a Pace-wash overlay.

The rule builder and threshold slider are widget changes (decision 9).

**Concept deviations:**
- **A:** this is A's signature page.
- **B:** adds "If this were your subscriber at AED 199…", with a "Not on yet: subscriber payments" chip.
- **C:** each decision is a worked example in a manual, with the rule highlighted.

### C7. Security and privacy `/security-and-privacy`
**Job:** remove data and safety objections, and stay on the sign-up path.

**Sections:**
1. **Hero:** H1 "How we protect you and your subscribers". The title keeps "business" and "data".
2. **Six fact cards:**
   - **Sign-in:** passkeys, authenticator apps, recovery codes, device list.
   - **Workspace isolation** at the database level.
   - **Encryption:** provider keys encrypted at rest, audit logs, HTTPS. The card claims no blanket encryption at rest.
   - **Consent:** consent for each use, export and deletion.
   - **AI disclosure:** subscribers always see when guidance is digital.
   - **Payments:** Stripe holds card data; payouts go only to a verified UAE IBAN, with a short hold after a bank change. Chip "Not on yet".
3. **Operator access:** "Every operator access is audited. A fresh authenticator check applies when authenticator enforcement is switched on." This is the plain-words version of `marketing-content.ts:2135`.
4. **Your method and voice:** never used for another trainer; voice only with consent.
5. **Plain-language caveats.** Rewrite "enforcement depends on deployment settings" in plain words, and keep it while it is true. Make no certification claims (no "PDPL compliant").
6. **FAQ (5).**

**CTAs:** primary "Teach your AI — free" (header and closing); secondary "Read the AI disclosure".

**Motion:** minimal; reveal-once below the first screen only.

**Concept deviations:**
- **A:** an "access log" console mock: operator access → fresh authenticator check (when enforcement is on) → logged.
- **C:** a signed "our commitments" page with a version date.

### C8. For trainers index `/for-trainers`
**Job:** send visitors to the right page by specialty and by how they coach today.

**Sections:**
1. **Hero:** H1 "Your specialty, taught to your own AI".
2. **The 4 registered specialties as tiles,** each with one example rule and its example price: Weight loss AED 199, Strength AED 249, Muscle gain AED 229, Pre and postnatal AED 249.
   - Combat, yoga, pilates and endurance exist in the content file but are not in the registry; they stay out.
3. **"How do you coach now?"** routes:
   - "On a gym floor" → follower calculator;
   - "Already online" → `/demo` and `/pricing`;
   - "I run a studio" → `/features/team`.
4. **Where you coach:** `/uae`.

**CTAs:** primary "Teach your AI — free"; secondary "Try the demo".

**Motion:** on hover devices, a tile's rule gains emphasis by opacity. The rule text is always visible, so touch users see it too.

**Concept deviations:**
- **A:** a specialty switcher changes the console rule live.
- **B:** a price ladder per specialty.
- **C:** a chapter list.

### C9. Specialty page (4 pages)
**Job:** "This understands my discipline and my safety stakes."

**H1 rework** (8 words or fewer, no colon; titles and metas keep "for strength coaches" and the like):
- "Strength coaching, taught to your own AI";
- the same pattern for weight loss and muscle gain;
- "Pre and postnatal coaching, taught to your AI".

**Sections:**
1. **Hero** with a rule card applying the specialty's first rule (start state fully visible).
2. **Three example rules** as cards. For strength:
   - +2.5 kg after two sessions at 3+ reps in reserve;
   - form doubts → repeat the load and add a cue;
   - three weeks of rising effort → deload at 60% volume.
3. **"Always paused and sent to you, enforced in code":** pain, pregnancy, chest pain, dizziness, fainting, bleeding, plus the specialty's own items.
4. **Optional review topics.**
5. **Programme outline table.** For strength: weeks 1–3 technique, weeks 4–9 progressive overload, week 10 deload.
6. **Price ladder for followers:**
   - one session AED 70–350 (Hey Trainer [Vendor claim]);
   - your AI coaching at the example price (AED 249 for strength), with a "Not on yet: subscriber payments" chip;
   - budget gyms from AED 99 a month (GymNation). This rung appears only once the price is in `/methodology` with its URL, check date and a [Direct check] label (decision 19). Until then the rung is left out.

   Each rung carries a `SourceBadge`.
7. **Compact follower calculator** at the example price. The headline keeps "before platform commission" and the chip.
8. **FAQ (2–3).**

**Pre and postnatal extras:**
- "Waits for me" mode is shown first.
- Honest Arabic scope.
- The GymNation 46% women-only figure is dropped: it surveyed physical gyms, is weak support for online pre and postnatal coaching, and is not in `/methodology`.

**CTAs:** primary "Teach your AI — free" (price sub-line only after decision 8); secondary "See the full safety rules" → `/features/safety`.

**Motion:** the rule card's highlight sweep; the paused banner on reveal (below the first screen).

### C10. UAE `/uae`
**Job:** local relevance and credibility.

**Sections:**
1. **Hero:** H1 "Built for personal trainers in the UAE". The title and meta keep "take your coaching online".
2. **Built for here:** AED pricing; UAE IBAN payouts ("Not on yet"); English and Arabic RTL for followers; in-person bookings ("Not on yet"); UAE time zone.
3. **Your audience:** 11.1M internet users (99.0%), 7.60M Instagram users (67.8%), median age 31.6 (DataReportal 2025).
4. **What followers pay now:**
   - sessions AED 70–350 (Hey Trainer) and AED 200–700+ (Embody);
   - online coaching AED 400–2,000 a month (369MMAFIT);
   - budget gyms from AED 99 a month (GymNation), only after decision 19.

   Then: "Your AI coaching sits in between."
5. **Dubai / Abu Dhabi / Northern emirates:**
   - Dubai Fitness Challenge 2024: 2.73M participants.
   - Abu Dhabi: 60.3% meet WHO activity standards, up from 53.6% (about 31,000 responses).
6. **Licences and credentials (information only):**
   - **Advertiser permit,** with the live hedge kept (`marketing-content.ts:2219`): "Reports on the UAE Advertiser Permit say people promoting their own services through personal accounts are exempt. Rules change, so check with the UAE Media Council. This is information, not legal advice."
   - **Mu'Ahal:** Dubai Sports Council's programme took effect on 9 July 2026. It accredits coaches working in Dubai-registered federations, academies and fitness facilities, not all trainers. [Press] https://www.gulftoday.ae/sport/2026/07/11/dubai-sports-council-launches-the-muahal-programme-for-accreditation-of-coaches and https://www.zawya.com/en/press-release/government-news/dubai-sports-council-and-dataflow-group-launch-muahal-tt9ta5cp
     - It is shown only after it is added to `/methodology` with that label (decision 19).
   - "trainsyou doesn't verify credentials."
7. **Arabic, honestly:** the follower app is English and Arabic; the trainer area is English; what you write is not auto-translated.
8. **Ramadan:** questions about fasting meal timing go to you, and fasting is never treated as disordered eating. No Ramadan programming is claimed.
9. **FAQ (5).**

**Directory block:** removed from under the hero until listings exist.

**CTAs:** primary "Teach your AI — free"; secondary "See pricing in AED".

### C11. Get started `/get-started`
**Job:** a setup plan for cautious visitors, and a place to claim an address. It becomes a secondary destination ("See the 15-minute setup").

**Sections:**
1. **Hero:** H1 "Start your coaching business, free".
   - AddressPreview "Claim this address" → `/signup?slug=`, hint "We'll check it's free in setup".
   - The early-access form appears only when registration is closed.
2. **Six steps** with times (1, 3, 2, 6, 1 and 2 minutes).
3. **What you need:** identity, your method and limits, an offer, photos or a logo, and a UAE bank account at first payout.
4. **What you don't need:** a card, a trade licence to start, a minimum number of followers, coding skills, or your own domain.
5. **"Live today / Not on yet."**
6. **After you go live,** labelled as following go-live.
7. **FAQ (6).**

**Motion:**
- Step rows below the first screen reveal with a stagger.
- In AddressPreview the caret blinks (opacity) and the URL updates as the visitor types. Nothing types itself.

### C12. Sign-up `/signup` (protected path: copy changes need the owner's OK)
**Job:** finish the conversion with zero surprise.

**Story panel:** the headline "Teach your AI. Start free.", with three ticks:
- Free to join, no card.
- About 15 minutes to start; stop any time.
- Nothing goes live until you publish.

**Card:**
- The same 4 fields, with inline password guidance.
- When a slug was carried in, the chip "your-name.trainsyou.com — we'll check it's free in setup".
- The price chip "Your price: AED 199" only after the `price_aed` code change (decision 8).
- Button "Start my setup".
- Email code, Google and Apple appear when their flags are on.
- When registration is closed, the early-access form.

**Motion:** none on entry; the card is above the fold. Button press only.

**Measurement:** `signup_view`, `signup_field_start`, `signup_submit`, `signup_error`.

### C13. Guides index `/guides`
**Job:** a search entry point, and nurture.

**Sections:**
1. **Hero:** H1 "Guides for taking your coaching online".
2. **4 guide cards** with reading time:
   - pricing in the UAE;
   - Instagram to paying clients;
   - the advertiser permit;
   - writing rules your AI can follow.
3. **Tools:** the two calculators.

**CTAs:** primary "Teach your AI — free"; secondary "Estimate my earnings".

### C14. Guide article
**Job:** be useful first, then offer a next step in context.

**H1s within the rule; titles keep their search wording.** Re-count the live H1s at build.
- "How to price online coaching in the UAE" (8) stays.
- "Turning Instagram followers into paying clients" stays.
- "UAE advertiser permit: what trainers should know" (colon) becomes "What the UAE advertiser permit means for trainers".
- "How to write coaching rules your AI can follow" (9) becomes "Writing coaching rules your AI can follow".

**Sections:**
1. Title, reading time, last updated.
2. Table of contents.
3. Body with tables and `SourceBadge`s.
4. An inline CTA in context, after the first useful section:
   - pricing guide → "Try my price in the earnings calculator";
   - Instagram guide → "See what my followers are worth";
   - rules guide → "Try editing a rule in the demo".
5. FAQ, related guides, closing panel.

The advertiser-permit guide keeps all of its live hedges.

**The pricing guide keeps its worked examples:**

| Subscribers × price | Commission | Before other costs |
|---|---|---|
| 40 × AED 149 | AED 1,490 | AED 4,470 |
| 120 × AED 199 | AED 5,771 (24.17%) | AED 18,109 |
| 350 × AED 249 | AED 18,053 | AED 69,098 |

**Motion:** none beyond reveal-once below the first screen and the TOC active state (instant colour; the indicator moves by transform).

### C15. Pricing `/pricing`
**Job:** fully answer "what's your cut, and what do I keep?"

**Sections:**
1. **Hero:** H1 "Free to join. You set the price." Lede: "Nothing to pay upfront. We earn only when your subscribers pay, and our share falls as you grow."
   - A one-line status strip under the hero: "Subscriber payments and payouts are not on yet → What works today". It comes before any AED figure.
2. **At a glance,** three columns:
   - **Free:** joining, your site and app, teaching your AI, a free subdomain.
   - **What we take:** our share per paying subscriber (25 / 20 / 15 / 10%), with card processing itemised and its rate stated (decision 3).
   - **Optional:** your own domain (price shown before you buy) and add-ons.

   Plus the line "We earn only when your subscribers pay."
3. **How our share falls:**
   - The band table.
   - A slider from 1 to 1,500 subscribers at your price, showing the blended rate. At the same price: 100 → 25%, 300 → 21.7%, 1,000 → 17%, 1,500 → 14.7%.
   - "Reaching a new band lowers the rate for subscribers in that band only."
4. **Worked example,** with a "Not on yet" chip: 150 × AED 199 = AED 29,850. Commission is AED 4,975 + AED 1,990 = AED 6,965. You keep AED 22,885 before card processing, about 92 sessions at AED 250.
5. **Compact earnings calculator.**
6. **An hour sells only once:** a session costs AED 70–350 and online coaching AED 400–2,000 a month, each with a `SourceBadge`.
7. **Statement extras:** processing, own domain, refunds, disputes, booking fee.
8. **Billing:** monthly or upfront, trials, promotion codes.
9. **Payouts:** monthly to a UAE bank, chip "Not on yet".
10. **"Live today / Not on yet"** (the full panel).
11. **FAQ (6):**
    - What does it cost to join?
    - Who sets the price?
    - What will I pay?
    - How does commission work with different prices?
    - Who owns my subscribers' data, and what if I leave? (Export; the owner confirms the portability wording.)
    - Can subscribers pay me today? (Not yet.)

**CTAs:** primary "Teach your AI — free" (header and closing); secondary "Estimate my earnings".

**Motion:**
- Band segments scale in on reveal (420 ms, 80 ms stagger, below the first screen).
- The slider marker moves (140 ms).
- The result updates on input by stacked-span crossfade, with tabular figures in fixed slots.

### C16. Earnings calculator `/earnings-calculator`
**Job:** let trainers use their own numbers and carry them into sign-up.

**Calculator:** keep the inputs, defaults and maths. At defaults:
- an average price of AED 229;
- AED 13,740 in subscriptions;
- AED 3,435 commission;
- AED 10,305 kept;
- about 41 sessions.

It is labelled "ILLUSTRATIVE ARITHMETIC", with the "Not on yet: subscriber payments" chip beside the result.

**Sections:**
1. Calculator.
2. Result panel with a per-band breakdown (`aria-live`).
3. "Don't know your subscriber count? Estimate it from followers" → follower calculator.
4. Assumptions: excludes processing, domain, refunds, disputes and tax.
5. How to use it.
6. Worked example.
7. FAQ (3).

**CTAs:**
- primary "Teach your AI — free", with the sub-line "Your price, AED {price}, carries into setup" only after decision 8;
- secondary "Send this to myself" (Web Share, with a copy-link fallback).

**Motion:** the result updates on input by crossfade. The digit roll is B only, subject to decision 6.

### C17. Follower calculator `/follower-calculator`
**Job:** turn "will my followers pay?" into an estimate the trainer owns.

**Calculator:** keep the inputs, the defaults and the owner's strong-case headline, labelled "Best case" and keeping "before platform commission", with the "Not on yet" chip.

**H1:** "How many followers could become subscribers?" The title keeps "paying subscribers".

**Sections:**
1. Calculator.
2. Results as three columns (decision 9): Cautious / Typical / Strong, each with first month, active at 12 months, sign-ups and AED at month 12. `aria-live`.
3. AddressPreview "Claim this address".
4. "What moves your number" (7 levers).
5. The 8-step method, collapsed.
6. Sources.
7. FAQ (4).

**CTAs:** primary "Teach your AI — free" (price sub-line only after decision 8); secondary "How we calculate this" → `/methodology`.

**Motion:** the scenario columns update together. No count-up on load: the first-paint values are real HTML.

### C18. FAQ `/faq`
**Job:** clear objections fast.

**Structure:** grouped by objection, with a filter field:
- Your AI and control
- Safety
- Money
- Setup
- Your brand and followers
- UAE and legal

**Content:**
- 14 or more questions.
- Rebuild "What can I connect?" from the flag and gate data.
- Add "Can subscribers pay me today?"
- Legal answers keep their live hedges.

**CTAs:** primary "Teach your AI — free"; secondary "Talk to Kamran (AI voice)", if the owner extends Kamran to this page (decision 15).

**Motion:** disclosures open by grid rows; the group tab indicator slides.

### C19. About `/about`
**Job:** a human, accountable company.

**Sections:**
1. **Hero:** "About trainsyou", with a lede.
2. **`FounderNote`:** photo, name, the UAE connection, why I built this. The owner supplies all of it.
   - Kamran is introduced here as "an AI voice of {founder}, used with consent" (decision 2).
3. **Mission:** "Make personal training affordable to more people by scaling real trainers' judgment."
4. **What we are and are not:** `NOT_STATEMENTS`.
5. **How we make money.**
6. **How we talk about results.**
7. **Where we work.**
8. **Company and contact.** The owner must publish company details and a support email; the prototype shows `[owner to supply]`.
9. **FAQ (4).**

**CTAs:** primary "Teach your AI — free"; secondary "Read how we source numbers".

### C20. Methodology `/methodology`
**Job:** the honesty asset, reached from every market figure.

**Sections:**
1. Principles.
2. The follower formula (7 steps).
3. The earnings method.
4. The 33 sources with evidence labels, filterable by page. Any new figure (the GymNation price, Mu'Ahal) is added here with its label before it appears anywhere (decision 19).
5. "What we exclude."

**CTAs:** header "Teach your AI — free"; secondary "Back to the follower calculator".

**Motion:** a row highlights when the visitor arrives from a `SourceBadge` anchor: a Pace-wash overlay fades out over 420 ms. The row is already visible, so nothing is hidden.

### C21. Legal template: `/privacy`, `/terms`, `/ai-disclosure`
**Job:** readable and trustworthy.

**Layout:**
- H1, version and "Last updated".
- A sticky TOC on desktop.
- A 68-character measure.
- Numbered sections.
- No marketing CTA inside the body; the header CTA stays.

**Motion:** none, except the TOC active state.

### C22. Coaches directory `/coaches`
**Job:** consumer discovery, but it is empty today.

**Recommendation (decision 11):**
- `noindex`, and remove it from the footer and from `/uae` until a minimum number of listings exists. The owner sets the number.
- A trainer-facing empty state: "Coaches choose to be listed here. Coaching yourself? Start free and list your page when you publish."

### C23. 404
**H1:** "This page isn't here."

**Line:** "Your coaching still can be."

**Links:** home, demo, pricing, guides.

**CTA:** "Teach your AI — free" ("Join early access — free" when registration is closed).

**Motion:** none; everything is in the first screen.

### C24. Sign in `/login`
Unchanged. The marketing header stays; there is no sticky bar.

---

## D) THREE CONCEPTS

### Side-by-side

| | A. Live Brain | B. Beyond Your Hours | C. The Method |
|---|---|---|---|
| Strategy | Product-led: watch it decide, then change the rule | Outcome-led: an hour sells once; you set the price and keep most of it | Trust- and method-led editorial: your judgment, written down, checked and guarded |
| Primary persona [Hypothesis] | T2, then T1 | T1, then T2 | T3, then T1 |
| Hero mechanism | Decision Console (phone plus trainer panel); one decision's change plays once | Offer screen (your branded paywall at AED 199) plus a "Your price, our share" tile. No earnings figure until payments are live and the owner approves revenue in the hero | A rule card being confirmed, with source and margin notes |
| Home H1 | Teach your AI. It **trains** your subscribers. | Your AI **trains** subscribers beyond your hours. | Taught by you. It **trains** every subscriber. |
| Accent font | JetBrains Mono | Archivo (condensed numerals) | Newsreader (serif display) |
| Motion language | UI state changes | Figures respond to input; bands fill | Highlighter and ink |
| Biggest risk | Hero density on small phones | Payments are off, so it cannot be tested live until they are on; the best-case anchor | Slower comprehension; a serif that departs from the brand |

**All three concepts:**
- use the same blueprint (section C), honesty rules, CTA label, measurement and performance budget;
- use the logo lockup, with Pace only as a background behind ink;
- keep light surfaces: a white canvas and paper bands, no ink bands;
- treat the phone device frame as a product object, not a band.

**Tokens shared by all three** (from the brand):
```
--white:#FFFFFF; --ink:#171917; --paper:#F3F4F0; --muted:#616660; --line:#D9DDD5;
--pace:#D5F24A (background only, ink text on it, 14:1); --ink-hover:#343834;
--success:#226044; --warning:#805400; --error:#AD3535;
--ease-out:cubic-bezier(.2,0,0,1); --ease-in:cubic-bezier(.4,0,1,1);
--ease-inout:cubic-bezier(.4,0,.2,1); --ease-enter:cubic-bezier(.2,.8,.2,1);
--ease-spring:cubic-bezier(.34,1.4,.64,1) /* success states only */;
--d-press:80ms; --d-fast:140ms; --d-base:200ms; --d-slow:280ms; --d-emph:420ms;
--stagger-1:40ms; --stagger-2:80ms;
Figures in product UI and results: font-variant-numeric: tabular-nums, in fixed-width slots.
Arabic face (lang=ar only): A and B use IBM Plex Sans Arabic 400/500/600; C uses Noto Naskh Arabic 400/600.
Production: Inter / Inter Display and each accent face self-hosted and subset; the H1 face preloaded; fallbacks with size-adjust metrics.
Prototypes may load fonts from Google Fonts with display=swap.
```

**Page transition, shared mechanism**
- **Prototypes:** `@view-transition { navigation: auto; }` on every page.
- **Elements that persist without animating:** `header { view-transition-name: site-header }` and `footer { view-transition-name: site-footer }`.
- **Shared-element morphs only when the target is in the first viewport.**
  - In the `pagereveal` handler, if the named element is not inside the first viewport, its `view-transition-name` is cleared and the root crossfade runs instead.
  - In practice this means home → `/demo` (A) and home → `/earnings-calculator` (B), and on desktop only for most layouts.
- **Production:**
  - same-document transitions on client navigation, through Next 16.3.6 `experimental.viewTransition` and React 19.3.0 `<ViewTransition>`. Verify both on these exact versions first, and gate them as enhancements;
  - cross-document `@view-transition` wherever navigation is a full reload. That includes `/signup` if the marketing bundle is split into separate root layouts;
  - unsupported browsers navigate instantly.
- **Reduced motion:** follows `MARKETING_MOTION`. The default `"always"` plays the same short transition. Only if the owner switches it does reduced motion become a crossfade of 200 ms or less with no translation.

**Reveal mechanism, shared**
- After initialising, the script adds `.reveal-pending` only to units that start below the first viewport.
  - The hero, the first screen and the LCP element are never hidden.
  - Text is in the HTML for non-JS readers and bots.
- An IntersectionObserver with threshold 0.15 swaps `.reveal-pending` for `.is-in` once, then unobserves the unit.
- Items stagger by `--i * 40ms`, with at most 6 staggered items.
- **No timer-based safety net,** because one would cancel every reveal below the fold. If the script fails to initialise (IntersectionObserver missing, or an error before setup), it never adds `.reveal-pending`, so nothing is hidden. A `try`/`catch` around setup removes any pending classes if setup throws partway.

**Value changes, shared:** tabular figures, fixed-width slots, and the old and new values as stacked spans that crossfade. Nothing reflows.

---

### Concept A: "Live Brain"

**Thesis:** don't describe the AI. Let trainers watch it apply their rule, then change the rule themselves.

**Why it should convert:**
- **Principle 1:** the hero is the product, in one eyeful.
- **Principle 2:** the adjustable rule and threshold are the Dietvorst effect in practice. They answer the 54% "unsafe advice" fear [Vendor claim] with control.
- **Principle 9:** none of the 12 competitors checked offers a hands-on walkthrough of how a client-facing AI decides.
- **Principle 4:** every motion explains a state change.
- **Principle 6:** everything it shows can be previewed today. It needs neither publishing nor payments.
- **Skill rule:** it avoids "leading with the demonstrable": here the demonstrable is the valuable part, the AI coaching.

**Risks and mitigations:**

| Risk | Mitigation |
|---|---|
| The console is dense at 360 px | Mobile shows the phone only; the trainer panel collapses to a single lane chip under the phone |
| A scripted demo can feel fake | The "Sample trainer · scripted · no AI model called" label is always visible |
| Hero JS could hurt LCP | The H1 and lede are the LCP. The console's start state is complete static HTML; the deferred script only animates the change |
| Heavy "AI" wording (Cicek) | Every AI mention belongs to the trainer ("your AI", "your rule"); the comprehension tests check it |

**Design tokens (A)**
```
Fonts: Inter Display 500 (H1/H2), Inter 400/500/600 (body/UI), JetBrains Mono 400/500 (rules, timestamps, %, kg, AED inside product UI only; self-hosted subset in production)
H1 clamp(40px,4.6vw,64px)/1.04, -0.045em; H2 clamp(26px,2.8vw,36px)/1.1, -0.04em; body 16px/1.55; mono 13px/1.45, 0
Colours (added): --paper-2:#EBEDE7 (UI chrome inside frames); --pace-wash:#F2FBC9 (selected row, value flash, used as an overlay);
 lane chips: applied text #226044 on #E6F0EA (6.4:1); to-you #805400 on #F6EEDC (5.7:1); paused #AD3535 on #F7E5E5 (5.2:1)
Device: frame #171917, screen #FFFFFF, radius 28px (phone) / 12px (laptop window), bezel 8px
Radii: controls 6px, panels 8px, chips 999px
Spacing: 4 8 12 16 24 32 48 64 96; section padding 96px desktop / 64px mobile; container 1280 + 48 gutter (24 at ≤1150, 16 at ≤760)
Grid: 12 columns, 24px gap; hero 5/7 (copy/product); bento 4-4-4 / 6-6
Borders: 1px var(--line) hairlines on all cards, no card shadows
Shadow (device only): 0 2px 4px rgb(23 25 23/8%), 0 24px 64px rgb(23 25 23/14%)
Background motif: 24px dot grid at 6% ink, behind product frames only
```

**Motion spec (A)**
- **Page transition:**
  - `::view-transition-old(root)`: opacity 1→0, 140 ms, ease-in.
  - `::view-transition-new(root)`: opacity 0→1 and translateY 8 px→0, 200 ms, ease-enter.
  - Shared element `.brain-console { view-transition-name: brain-console }` morphs over 280 ms ease-out, only home → `/demo` and only when the console is in the first viewport. `/how-it-works` uses the root crossfade.
- **Hero start state** (fully visible at first paint, real HTML):
  - the subscriber bubble "Week three done. Squats felt easy.";
  - the rule chip "Your rule · from interview, 12 Oct";
  - the confidence label "86%" with an empty bar track;
  - the lane pill reading "Checking your rule";
  - the phone row "Squat 60 kg".
- **Hero change sequence** (plays once; starts 300 ms after `load`, and only if the console is in view):
  1. The confidence bar fills: scaleX 0→0.86, 420 ms, ease-out, origin inline-start.
  2. At 0.6 s, the lane pill translates 12 px into "Applied automatically" (280 ms, ease-out); the label swaps by stacked-span crossfade.
  3. At 1.0 s, "60 kg" crossfades to "62.5 kg" (200 ms) in a fixed-width tabular slot. A Pace-wash overlay fades 0→1→0 over 420 ms, and a tick draws (stroke-dashoffset, 280 ms).
  4. Total about 1.5 s, no loop. The scenario tabs replay on click only. The typing dots appear only on `/demo` tab clicks (`aria-hidden`).
- **"Trains" highlight:** a Pace bar on `span.mk-mark`, scaleX 0→1, 420 ms, ease-enter, 120 ms delay, origin inline-start (it mirrors in RTL).
- **Reveals** (below the first screen): opacity with a 12 px rise, 280 ms, ease-enter, 40 ms stagger.
- **Micro:**
  - hover: an instant colour change, or an `--ink-hover` overlay fading by opacity over 140 ms, inside `@media (hover: hover)`;
  - press: scale 0.97 at 80 ms;
  - arrow nudge: 3 px at 140 ms;
  - tab underline: translateX, 200 ms, ease-out;
  - disclosures: grid rows 0fr→1fr, 280 ms;
  - sticky bar: translateY 100%→0, 280 ms, ease-enter.
- **Rule builder (demo and home band 2):** a changed number swaps by stacked-span crossfade with a 4 px rise (140 ms). The outcome row repeats step 3 of the hero pattern.
- **Reduced motion:** follows `MARKETING_MOTION` (default `"always"`: unchanged). If the owner switches it, translations become 0, opacity stays, and the typing dots become a static "…".
- **Budget:** no library; motion JS of 12 KB gzip or less.

**Signature component:** the Decision Console, plus the Rule builder and the Threshold slider.

**Per-page treatment (A)**

| Page | Treatment |
|---|---|
| Home | Console hero; band 2 is a mini "Change the rule" builder (2 fields), then the blueprint order |
| How it works | The 8-step stepper is the console in 8 states (address → teach → test → offer → publish ("Not on yet") → daily → correct → paid ("Not on yet")) |
| Trainer Brain | Rule ledger: a mono rule list with source chips and Confirm / Edit / Reject; a release timeline v1–v4 with rollback; a Compare-my-replies card |
| Features index | A bento of live mini-screens (Inbox, Today, Statement with chip, Safety); 5 screens as tabs |
| Feature detail | One live vignette per page, with one state change |
| Demo | The full console, 4 scenario tabs, the Rule builder and the Threshold slider; on mobile, the phone plus a lane chip |
| Security | "Access log" mock: operator access → fresh authenticator check (when enforcement is on) → logged; an isolation diagram |
| For trainers | A specialty switcher re-skins the console rule (strength / weight loss / muscle gain / pre and postnatal) |
| Specialty | The console with that specialty's rule; paused-list chips in the error-lane colours |
| UAE | A subscriber-app vignette with an EN↔AR RTL toggle (real member-app strings, this vignette only); the AED price ladder as a mono list |
| Get started | A setup timeline: 6 rows with mono times; AddressPreview |
| Signup | Unchanged structure; a small static console echo in the story panel (the rule chip only) |
| Guides index / article | Mono metadata (reading time, updated); the rules guide gets an inline rule-builder CTA |
| Pricing | A band-meter slider (mono figures); a statement mock with chip |
| Earnings / follower calculators | A console-styled result panel; the three scenarios as lanes |
| FAQ | A filter field styled like a command palette; groups as tabs |
| About | The founder note, plus a "What shipped" changelog drawn from real release notes |
| Methodology | The source table with evidence-label filter chips |
| Legal | Doc layout, sticky TOC |
| Coaches | Empty state (trainer-facing) |
| 404 | A console line: "No rule for this page. Handed to you:" with links |

---

### Concept B: "Beyond Your Hours"

**Thesis:** an hour sells once, but your method coaches every day. Lead with the offer the trainer will sell and the price they set. Show what they keep, with an honest status chip, until payments are live.

**Why it should convert:**
- **Principles 5 and 10:** transparent maths with the trainer's own inputs.
- **Skill rule "All defence, no growth":** this pitch puts growth first, for business owners.
- **Competitor pattern:** Playbook and Passes, the strongest pages seen, lead with aligned incentives and calculators. [Direct check]
- **Suspected T1 and T2 triggers** ("fully booked and not earning more"; "DMs full of people who can't afford me") [Hypothesis]. These guide the design and never appear on the site as quotes.
- **The hero is still the product:** the trainer's own offer screen.

**Risks and mitigations:**

| Risk | Mitigation |
|---|---|
| Payments and payouts are off and publishing is gated, so a money-first promise can't be honoured yet. This is the biggest honesty risk | Until payments are live, the hero is "free to start, your price": the offer screen plus a "Your price, our share" tile, with no earnings figure. AED take-home figures appear only below the `StatusPanel`, each with "Subscriber payments are not on yet. Set up and teach your AI now." (owner wording). B is not A/B tested live until payments work |
| The best-case anchor (AED 23,084, about 8× typical) may be distrusted | All three scenarios are always visible |
| Drift from the AI moat | The mechanism band sits second on home (band order in C1) |
| Revenue and counts in motion break the house rule (`marketing-motion.md:24-26`) | Figures are static on load; only the response to input animates (decision 6). The 92-session grid is static and never in the hero. Revenue in the hero needs owner OK (decision 14) |
| May attract "passive income" seekers | That phrase is banned |
| Number-heavy layouts strain phones | The take-home figure is `clamp(36px,7vw,96px)`, so 36 px at 360 px. Tabular numerals sit in fixed slots, and long values wrap rather than shrink below 36 px |

**Design tokens (B)**
```
Fonts: Inter Display 500 (headings), Inter 400/500/600 (body), Archivo variable (wdth 62–125, wght 100–900; self-hosted subset in production) used ONLY for figures and eyebrows: font-stretch 75%, weight 700, font-variant-numeric: tabular-nums
Figure scale: take-home tile clamp(36px,7vw,96px)/0.95; band figures clamp(28px,4vw,56px); H1 clamp(40px,4.8vw,66px)
Colours (added): --pace-wash:#F2FBC9 (economics bands); --keep:#226044 (large "you keep" figures only, 7.4:1 on white);
 band fills (non-text graphics, with 1px ink outline): 25% #171917, 20% #616660, 15% #9BA096, 10% #D9DDD5
Radii: controls 10px, cards 16px, result tile 20px, phone 32px, chips 999px   [deviation from 6/8: owner OK]
Spacing: 4 8 12 16 24 32 48 72 112; section padding 112px desktop / 72px mobile
Grid: 12 columns, 24px gap; hero 6/6 (offer phone + price tile); economics bands full-bleed paper or pace-wash
Shadows: cards = brand shadow 0 1px 2px rgb(23 25 23/6%), 0 12px 32px rgb(23 25 23/6%); raised tile 0 1px 2px rgb(23 25 23/6%), 0 20px 48px rgb(23 25 23/10%)
Imagery: sample offer screens and statements (labelled Sample); no photos of people except the founder
```

**Motion spec (B)**
- **Page transition (direction-aware):**
  - old root: translateX(0→calc(-16px * var(--dir))) and opacity 1→0, 200 ms, ease-in;
  - new root: translateX(calc(16px * var(--dir))→0) and opacity 0→1, 280 ms, ease-enter;
  - `--dir` is 1 in LTR and -1 in RTL. It is set in the `pagereveal` handler from the navigation type and inverted for back/forward.
  - Shared element: the price tile, home hero → `/earnings-calculator` result, 280 ms ease-out, only when the target is in the first viewport. Otherwise the root transition runs.
- **Figures:**
  - First paint shows the real value. There is no count-up on load (house rule).
  - On input change, each digit rolls (translateY within an overflow-clipped strip) over 280 ms ease-out, staggered 20 ms from the last digit. The strips are `aria-hidden`, and the real value is text in the `aria-live` region.
  - This needs owner decision 6, because house rules ban count-ups and revenue motion. Without approval, values change by stacked-span crossfade over 140 ms.
- **Band bar:** 4 segments scaleX 0→1 on reveal (below the first screen), 420 ms ease-out, 80 ms stagger. The slider's blended-rate marker moves by translateX in 140 ms.
- **"An hour sells once" band:** static, with no motion.
  - Left: a single "1 session · AED 250" card.
  - Right: a grid of 92 small session marks (the AED 22,885 equivalent), with an `aria-label` that states the comparison.
- **Statement:** a static sample inside a band-level reveal. No line-by-line or per-figure animation.
- **Reveals** (below the first screen): opacity with a 16 px rise, 280 ms, ease-enter.
- **Micro:** as in A.
- **"Trains" highlight:** as in A.
- **Reduced motion:** follows `MARKETING_MOTION`, as in A.

**Signature component:** the Take-home tile (price slider → subscribers → our share → you keep, "before card processing" printed on the tile, plus the status chip), with the band meter and the static "An hour sells once" comparison.

**Per-page treatment (B)**

| Page | Treatment |
|---|---|
| Home | Hero: a phone with the sample offer "Layla Strength · Strength coaching · AED 199 a month · Workouts + Nutrition AED 299", plus a "Your price, our share" tile ("At AED 199, our share is 25% for your first 100 subscribers. We earn only when your subscribers pay.") with a "Not on yet: subscriber payments" chip. Then the mechanism (band 2), then "An hour sells once", then the `StatusPanel` and economics (the take-home tile at 150 subscribers → keep AED 22,885 before card processing, labelled Sample, with chip) |
| How it works | Step 8 expands into a sample statement with chip; steps 1–7 compact |
| Trainer Brain | Compact; adds "Why followers pay: your method, your name, you behind it" (supportive-accountability framing [Expert], https://pubmed.ncbi.nlm.nih.gov/21393123/) |
| Features index | Each part shows what it replaces. The optional tool-cost note from published price pages (e.g. branded-app setup fees of $75–169 elsewhere; [Direct check], dated 26 Oct 2026) needs owner/legal OK to name competitors (decision 17) |
| Feature detail | Payments and nutrition lead with the AED effect, with chip (the nutrition tier lifts the average: 30% at AED 299 gives an AED 229 average) |
| Demo | After each decision: "At AED 199, this is what your subscriber is paying for", with chip |
| Security | Payments-first ordering (Stripe holds card data; verified IBAN payouts; a hold after a bank change), with chip |
| For trainers | A price-ladder row per specialty (AED 199 / 249 / 229 / 249) |
| Specialty | The price ladder leads (session AED 70–350 → your coaching with chip → the gym rung only after decision 19); then rules |
| UAE | The "What followers pay now" table first, the market band second |
| Get started | "15 minutes to your offer" framing, with the price step highlighted |
| Signup | Shows the "Your price: AED {price}" chip only after decision 8 |
| Guides | The pricing guide is pinned first |
| Pricing | B's flagship: the take-home tile, band meter, worked example and session anchor, under the status strip |
| Earnings calculator | A full-width take-home tile; per-band breakdown bars |
| Follower calculator | Three scenario columns in Archivo figures; Best case labelled; "before platform commission" |
| FAQ | The Money group first, opening with "Can subscribers pay me today?" |
| About | "How we make money" beside the founder note |
| Methodology | Figures link back to where each one is used |
| Legal / Coaches / 404 | As the blueprint; the 404 says "This page isn't earning its keep." |

---

### Concept C: "The Method"

**Thesis:** your judgment is the product. Show it being written down, checked and guarded, like a coaching manual come alive, with every market figure sourced.

**Why it should convert:**
- **Principle 2:** constraints are a full selling section. Stated UAE trust in AI depends on assurance: 84% say assurance would raise it [Survey].
- **Principle 8:** honesty is the proof: sources in the margins and a founder letter, where competitors post unverifiable "#1" claims and counts that contradict themselves.
- **Fit:** T3 (safety-critical niches) and cautious T1 trainers [Hypothesis].
- **Fogg:** design look drives credibility, and an editorial finish reads as premium.

**Risks and mitigations:**

| Risk | Mitigation |
|---|---|
| Slower first-screen comprehension | The hero is still a product vignette |
| Text density against the grade-6 rule | Strict word budgets |
| A serif display face departs from the brand (Inter Display) | Owner OK (decision 13) |
| The serif H1 is the LCP element and can shift on swap | Self-hosted subset, preloaded, size-adjust fallback metrics |
| May feel less "fitness/tech" | Product vignettes inline on every page |
| Weaker for impulse Instagram traffic on phones | Margin notes collapse inline on mobile; section padding is capped at 96 px |

**Design tokens (C)**
```
Fonts: Newsreader (variable opsz 6–72, wght 300–700, italic; self-hosted subset + preload in production) for H1/H2 and pull quotes only — H1 500 opsz 72 clamp(40px,5vw,68px)/1.02 -0.02em; H2 500 clamp(26px,3vw,40px)/1.08;
 Inter Display 500 for UI headings/labels; Inter 400/500 body 17px/1.6, measure 64ch; Arabic: Noto Naskh Arabic
Colours (added): --rule:#D9DDD5 (1px section rules); --margin-ink:#616660 (margin notes 14px/1.45);
 Pace used as a highlighter mark behind ink phrases (max one per viewport) and on the closing panel; --pace-wash:#F2FBC9 for confirmed-rule cards (applied as an overlay)
Canvas: white; "sheets" (paper #F3F4F0) hold rule cards, the never-list and the founder letter
Radii: controls 4px, sheets 2px, rule cards 6px   [deviation: owner OK]
Spacing: 4 8 12 16 24 32 48 64 96 on an 8px baseline grid; section padding 96px desktop / 64px mobile (capped)
Grid: 12 columns split 8 (text) + 4 (margin notes: sources, status chips, times); max 1200; at ≤760px margin notes become inline notes under their paragraph
Shadows: none. Borders: 1px rules; section numbers "§1, §2…" in Inter 500 muted 12px uppercase
Imagery: typeset rule cards, annotated product figures ("Fig. 2 — The paused workout"), a real founder photo; no stock people
```

**Motion spec (C)**
- **Page transition:**
  - a root crossfade: old opacity 1→0 in 200 ms ease-in, new opacity 0→1 in 280 ms ease-out;
  - the H1 is part of the root crossfade and does not morph between pages with different text;
  - if a morph is ever wanted, it needs `::view-transition-old(page-title), ::view-transition-new(page-title) { height: 100%; object-fit: none; object-position: left top; }` (right top in RTL) so the glyphs don't stretch.
- **Highlighter:**
  - the Pace mark behind a key phrase scales X 0→1 from inline-start, 420 ms, ease-enter;
  - "trains" in the H1 is the first highlight (the words are visible from first paint);
  - at most one highlight per viewport.
- **Section rules:** SVG lines draw with stroke-dashoffset, 420 ms ease-out, once, below the first screen.
- **Rule card confirm:**
  - **Hero start state** (visible at first paint): the card with its source and the status "Waiting for your OK".
  - **After `load`, once:** the status swaps by stacked-span crossfade to "Confirmed · 26 Oct". The stamp scales 0.96→1 with opacity over 280 ms on the spring (a success state, so allowed). A Pace-wash overlay fades in, so there is no colour transition. The border swaps to ink by an opacity swap.
  - On `/trainer-brain` the same pattern runs on click.
- **Margin notes:** in the first screen they are visible at first paint. Below it, they reveal with opacity and an 8 px translateX from the inline-end side, 200 ms, 80 ms after their paragraph.
- **Reveals** (below the first screen): opacity with an 8 px rise, 280–420 ms, ease-enter (slower and calmer).
- **Micro:** as in A.
- **Reduced motion:** follows `MARKETING_MOTION`. If the owner switches it, the highlighter appears at full width by opacity.

**Signature component:** the annotated Rule card with margin notes, the "Never" sheet (a signed list of limits) and the Founder letter.

**Per-page treatment (C)**

| Page | Treatment |
|---|---|
| Home | Hero: a rule card being confirmed, with the margin notes "Source: your interview" and "Waits for you until you choose" visible from first paint. §2 What you teach. §3 a two-part band (in charge, and the Never sheet). §7 the founder letter |
| How it works | A numbered manual (§1–§8) with times, requirements and "Not on yet" chips in the margin |
| Trainer Brain | C's flagship: chapters "What it is / What you teach / How it decides / How it improves / What it never does / Whose method it is", with figures |
| Features index | An editorial index (a numbered list with one-line outcomes); the matrix as an appendix |
| Feature detail | A "Fig." annotated vignette; facts in the margin |
| Demo | Each decision as a worked example: message → highlighted rule → outcome, with a Confirm / Correct interaction |
| Security | An "Our commitments" sheet, versioned, dated and signed by the founder (decision 2) |
| For trainers | A chapter list per specialty, with an example rule as a pull quote |
| Specialty | Rules typeset as a manual page; the paused list as a Never sheet |
| UAE | A long-form local brief with sources in the margin, keeping the legal hedges |
| Get started | A checklist sheet ("What you need / What you don't") |
| Signup | The story panel shows a static confirmed rule card and three ticks |
| Guides index / article | C's strongest template: footnoted sources, pull quotes, a reading measure |
| Pricing | The commission maths set like a worked proof; the pull quote "We earn only when your subscribers pay" |
| Calculators | Inputs on the left; the result as a sheet, with assumptions and the status chip in the margin |
| FAQ | Grouped as chapters |
| About | The founder letter first, the mission second |
| Methodology | Presented as the "Sources" appendix, linked from every margin note |
| Legal | The same editorial doc system |
| Coaches / 404 | The 404 says "This page isn't in the manual." |

---

## E) RECOMMENDATION

**Expected best converter: Concept A, "Live Brain", merged with B's pricing page and calculators (with their payments-off chips) and with C's Never sheet, `SourceBadge`s and founder letter.**

**Why A:**
1. **It meets the strongest evidence head-on.** It satisfies the attention research and the skill's hero rule (principle 1) by showing the moat working in the first screen.
2. **It turns the top buyer fear into an interaction.** Unsafe advice under the trainer's name (54% [Vendor claim]) is answered by an adjustable rule and threshold. That is the mechanism with the strongest controlled evidence here (Dietvorst [Measured]).
3. **It fills a gap none of the 12 competitors checked fills:** a hands-on, scripted walkthrough of how your AI decides.
4. **It needs nothing that isn't live.** The demo is scripted and everything it shows can be previewed today.
   - B's headline promise depends on payments and publishing, both off in production, and its best-case anchor invites distrust.
   - C trades speed of understanding for depth. That suits trust-seekers but costs the impulse traffic from Instagram on phones.

**What to test, in order:**
1. **Before launch: 5-second and comprehension tests** of the three home heroes with 5–8 UAE trainers (a mix of T1, T2 and T3).
   - Ask: "What is this? Who is it for? What does it cost? What would you do next?"
   - Choose on correct answers, not on liking.
   - At likely traffic, these tests carry the early decision.
2. **First live A/B, once traffic allows: Concept A home against Concept C home.** Do not run A against B while payments are off, because B's promise can't be honoured.
   - **Split:** a route-level split with a `concept_exposure` event. The existing `landing-welcome` slot only swaps a notice, so it cannot run this.
   - **Consent:** the assignment cookie is set only after consent. Unconsented visitors see A and are excluded from the analysis.
   - **Primary metric:** visit → sign-up (first touch, consented visitors).
   - **Guardrails:** sign-up → first rule confirmed within 7 days, and p75 LCP. Sign-up → published can't be a guardrail while publishing is gated.
   - **Traffic needed:** about 5,800 consented visitors per variant to detect a 30% relative lift at a 3% baseline. A 10% lift needs about 52,000.
   - **Duration:** about 11,600 ÷ weekly consented home visitors. For example, 500 a week gives about 23 weeks [illustrative; read the real figure from the acquisition endpoint before committing]. This probably means many months.
   - Run until it reaches size; do not peek.
3. **Next tests:**
   - B against the winner, once payments are live (or B with its "free to start, your price" hero sooner);
   - the follower calculator default, Strong against Typical (needs owner OK; the owner-approved direction stands today), measured on calculator → sign-up and sign-up → first rule confirmed;
   - the mobile sticky bar, on or off;
   - the CTA label "Teach your AI — free" against "Teach my AI — free";
   - "Teach your AI — free" against "Start my coaching site — free".

### Owner decisions this plan needs
1. **The public wording of "Live today / Not on yet",** built from launch gates and flags. It says plainly that publishing and subscriber payments are not on yet. It also unifies the chip label to "Not on yet" in place of the test-encoded "Available soon".
2. **The founder's name, photo and note.** This reverses your earlier "no social proof" choice for the HTML home (`PROJECT_MEMORY.md:35`).
   - Reconcile it with Kamran, who says "I built trainsyou": the site says Kamran is an AI voice of the named founder, used with consent.
   - Publish company details and a support email on `/about`.
3. **The card-processing rate** (or how it is passed through), stated on `/pricing`. This reverses your earlier "no card-fee line" choice for the HTML home (`PROJECT_MEMORY.md:35`). Proposed for `/pricing` only.
4. **The home walkthrough** becomes a visitor-controlled stepper lower on the page. It is still always shown.
5. **Reduced motion:** keep `MARKETING_MOTION="always"` (current), or switch to opacity-only motion for reduce-motion users.
6. **B's calculator digit roll on input.** House rules ban count-ups and revenue motion; without approval, values crossfade.
7. **Whether to test the follower calculator's default scenario.**
8. **The sign-up path** (protected):
   - copy changes: the story panel, "Start my setup", the chips;
   - the `price_aed` code change (`/signup` reads it, the wizard's "Your plan" step pre-fills it);
   - turning on email codes, Google and Apple.
9. **Other widget changes under "keep the marketing widgets as they are"** (`PROJECT_MEMORY.md:30`):
   - calculators: three-column results, a carried price;
   - demo: the rule builder and threshold slider;
   - AddressPreview: placement and the "We'll check it's free in setup" hint. Its label stays "Claim this address".
10. **The home word budget:** keep 400 (this plan is written to it) or raise it.
11. **`noindex`** and removal from navigation for the empty `/coaches` until listings exist.
12. **"Frontier model" wording:** it stays gated by the `frontier` flag, which is off live. You either turn it on after qualification or accept the fallback copy.
13. **Brand deviations:** C's serif display face; B's radii and Archivo figures.
14. **Revenue figures in B's hero.** House rule `marketing-motion.md:24-26` keeps them out today; proposed only after payments are live.
15. **Kamran shown on more pages** (pricing, FAQ), always labelled "Talk to Kamran (AI voice)".
16. **Any "founding trainers" offer,** only with real terms.
17. **Naming competitors' prices** on `/features` or `/pricing` (B).
18. **All copy changes in section C, approved as one set.** Motion work never rewords copy. After approval, the tests that encode today's copy and structure are updated deliberately, and `tests/marketing-site.test.ts` is re-run.
19. **New figures for `/methodology`:** add the GymNation AED 99 price ([Direct check], dated) and Mu'Ahal ([Press]) with labels, or drop both.

### Content fixes common to all concepts
**Code and structure (no owner decision needed):**
- Fix the Progress chip logic (core availability, not `some()`).
- Build the status panel and chips from launch gates plus flags.
- Carry UTM, gclid, fbclid, `ref` and `slug` into `/signup` links under the consent rules in section B.
- Ship the event set from section B.
- Remove the directory block from under the `/uae` hero.
- Exclude the first screen from reveals.
- Fonts and performance work.

**Copy corrections (factual, but still copy, so they go with decision 18):**
- One CTA label, "Teach your AI — free". The header CTA is always the sign-up action (on phones, in the sticky bar).
- Rebuild the stale "What can I connect?" answer from the flag data.
- "trainsyou learns" becomes "Your AI learns".
- Feature, specialty, security, `/uae`, follower-calculator and guide H1s brought within 8 words with no colon. Titles and metas keep their query terms.
- Bookings and payments H1s reframed, with "Not on yet" chips.
- "We earn only when your subscribers pay" everywhere; never "you pay nothing unless…".
- "Every market figure links to its source"; never "every number".
- Kamran is always "Talk to Kamran (AI voice)".
- "Provider keys encrypted at rest"; the operator-access check is stated with its condition.
- The advertiser-permit hedge is kept everywhere.

### Prototype build notes for builders
- **Folders:** `concept-a/`, `concept-b/`, `concept-c/`, each a static multipage site covering 42 pages: the 38 registered pages plus `/signup`, `/coaches`, `/login` and the 404.
  - Every page is generated from one shared content JSON.
  - Export it with `npx tsx /tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/dump.ts`, which reads `packages/contracts/src/marketing-content.ts`.
  - Copy changes are the ones in section C, marked as pending owner approval.
- **Dev panel in each prototype:**
  - toggles for `payments`, `registration`, `frontier` and `voice`, plus a "publish gate" toggle, so every honest state can be reviewed (including the registration-closed labels);
  - an RTL preview toggle that applies to the subscriber-app vignette only;
  - a "replay hero" button.
- **`window.tyTrack(event, props)`** logs the section B events to the console, so the event names can be reviewed. Prototypes simulate the consent state.
- **Sample data:** "Layla Strength" is always labelled Sample. No stock people. No invented counts, testimonials or results.
- **Fonts:** Inter and the concept's accent from Google Fonts with `display=swap`; production self-hosts them (section D).
- **No libraries.** Motion JS of 12 KB gzip or less per concept.
- **Accessibility:** follow the widget rules in C0. Hover effects sit inside `@media (hover: hover)`.

### Files referenced
- /home/user/trainer_what/packages/contracts/src/marketing-content.ts
- /home/user/trainer_what/packages/contracts/src/marketing.ts
- /home/user/trainer_what/packages/contracts/src/brand.ts
- /home/user/trainer_what/apps/api/src/onboarding.ts
- /home/user/trainer_what/apps/web/components/marketing/site.tsx
- /home/user/trainer_what/apps/web/components/marketing/frame.tsx
- /home/user/trainer_what/apps/web/components/marketing/journey.tsx
- /home/user/trainer_what/apps/web/components/marketing/chip.tsx
- /home/user/trainer_what/apps/web/components/marketing/showcase.tsx
- /home/user/trainer_what/apps/web/components/marketing/assistant-button.tsx
- /home/user/trainer_what/apps/web/components/marketing/motion-mode.ts
- /home/user/trainer_what/apps/web/app/marketing.css
- /home/user/trainer_what/tests/marketing-site.test.ts
- /home/user/trainer_what/docs/PROJECT_MEMORY.md
- /home/user/trainer_what/docs/features/marketing-site.md
- /home/user/trainer_what/docs/features/marketing-motion.md
- /home/user/trainer_what/docs/features/coach-setup.md
- /root/.claude/skills/synced/c6c905b1-2437-445a-8e88-8e6b31312270_a057cd18-c03c-410b-9ddd-a8536b405e53/vertical-conversion-funnels/references/output-formats.md
- /root/.claude/skills/synced/c6c905b1-2437-445a-8e88-8e6b31312270_a057cd18-c03c-410b-9ddd-a8536b405e53/vertical-conversion-funnels/references/benchmarks.md

---

## Changelog (what the review changed)
- **Product facts (fixes 1–11):**
  - Publishing is blocked by the payments launch gate. The panel is now "Live today / Not on yet", built from gates and flags; publishing, payouts, bookings and voice for subscribers are listed as not on.
  - "Site published" and its KPI are marked blocked. Trainer stories wait for go-live. The sample site is a static mock.
  - "You pay nothing unless…" is replaced by the live "We earn only when your subscribers pay".
  - Operator access keeps its condition; encryption is narrowed to provider keys.
  - 11 feature pages and 11 tiles (the placeholder row is dropped). The build covers 42 pages.
  - `price_aed` is specified as a code change behind decision 8. The slug hint is "we'll check it's free in setup".
  - Kamran keeps "(AI voice)" and is reconciled with the founder.
  - "Every market figure links to its source."
  - The tools row marks booking and payments "Not on yet".
  - The calculator headline keeps "before platform commission", and the B tile says "before card processing".
  - The price moves to a sub-line, not the CTA label.
- **Evidence (fixes 12–23):**
  - Highrise is corrected (long form +37.5%, then the shorter photo page +47%), and 42,000+ is marked untraced.
  - Unbounce is relabelled "SaaS n undisclosed".
  - KPMG is relabelled [Survey], UAE n not stated.
  - The link-count figures are limited to campaign pages, and label unification rests on the consistency heuristic.
  - The CTA defaults to "Teach your AI — free", with my/your as a test.
  - Scroll-jacking is demoted, and attention data justifies moving the journey.
  - Cicek against FitBudd is framed as a judgement call to test.
  - E.3 is rescoped to "a hands-on, scripted walkthrough" among the 12 competitors checked.
  - Baymard 19% is dropped.
  - GymNation and Mu'Ahal are gated on `/methodology` (decision 19). Mu'Ahal is corrected (effective 9 July 2026, its scope) and cited to the press. The 46% women-only figure is dropped.
  - The advertiser-permit hedge is restored.
  - Persona figures and quotes are marked [Hypothesis].
- **House rules and owner constraints (fixes 24–32):**
  - The hero start state is fully visible and only changes animate. The first screen is excluded from reveals, and the timer safety net is removed.
  - Colour changes are instant or done by overlay opacity.
  - Reduced motion is tied to `MARKETING_MOTION="always"`.
  - All widget changes are listed as owner decisions, and "Claim this address" is used consistently.
  - The prior "no social proof / no card-fee line" choices are named in decisions 2 and 3.
  - Back to the 400-word home budget, with per-band budgets.
  - Over-limit H1s are rewritten (including subscriber-app and safety, found during the check), and C3 now uses "Your AI".
  - B's mechanism is truly second, its hero is re-scoped to "free to start, your price", and the session grid is static and out of the hero.
  - Status chips come before and beside every AED headline; "Switching on next" becomes "Not on yet".
- **Motion, Core Web Vitals and accessibility (fixes 33–42):**
  - Morphs only to targets in the first viewport.
  - C's H1 crossfades, with the `object-fit` rule as a fallback.
  - Next 16.3.6 / React 19.3.0 View Transitions are verified and gated, with cross-document transitions for full reloads.
  - Fonts are self-hosted, subset and preloaded, with size-adjust fallbacks. C's padding is capped at 96 px.
  - Tabular figures and stacked spans. B's figure token is fixed to a 36 px minimum.
  - The phone header is logo and menu only.
  - The bottom stack is ordered consent → sticky bar, with Kamran inline on phones, safe-area padding and reserved bottom padding.
  - Widget accessibility rules added.
  - Web Share gets a copy-link fallback.
  - The RTL toggle applies to the vignette only.
- **Funnel and tests (fixes 43–48):**
  - Parameters are stored only after consent, and pass through otherwise.
  - A/B sampling and assignment are consent-bound, with a duration formula.
  - The first test is A against C, and B only after payments are live.
  - A registration-closed variant sitewide.
  - An SEO and generated-metadata section.
  - A copy-change approval and test re-run process (decision 18).
- **Corrections found while checking:**
  - The paused-chip contrast is 5.2:1, not 5.1:1.
  - Sign-up and 404 entry animations are removed, because they are above the fold.
  - The registry has exactly 4 published specialty pages (combat, yoga, pilates and endurance are unregistered).
  - Existing test constraints are noted: `span.mk-mark` not `<mark>`, no "Trainer Brain" in the home hero, and the `/features` section ids and order.