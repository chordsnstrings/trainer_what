**What converts for trainsyou: ranked principles, with sources and how much weight each one bears (research for the 26 Oct 2026 marketing revamp)**

Reliability key used below:
- **A**: peer-reviewed, or an independent large-sample study.
- **B**: a large vendor or platform dataset with its method stated, or a single company's A/B test with a stated sample.
- **C**: vendor marketing or a self-reported survey. The direction is useful; the size of the effect is suspect.
- **D**: anecdote, or a figure I could not trace.
- **E**: expert guidance.

Context I checked in the repo: the marketing pages are home, /features/*, /trainer-brain, /how-it-works, /pricing, /earnings-calculator, /demo, /methodology, /about, /for-trainers, /start and /apply. Pricing is commission by paying subscriber (25% on the first 100, 20% on the next 50, …). The conversion step is early access.

---

## Ranked principles (most impact first)

### 1. Make it clear within seconds, with the product as the hero, in plain words
**Evidence**
- **Visitors leave fast.** Dwell-time analysis of a large browser log (Liu, White and Dumais, SIGIR 2010) found strong early abandonment. Visitors decide whether to stay in the first seconds, and leaving only slows after about 30 seconds. **A**. https://www.microsoft.com/en-us/research/publication/understanding-web-browsing-behaviors-through-weibull-analysis-of-dwell-time/ and the NN/g summary at https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/
- **The first screen gets most attention.** An NN/g eye-tracking study from 2018 (120 participants, more than 130,000 fixations) found 57% of viewing time above the fold, 74% in the first two screens and 81% in the first three. **B**. https://www.nngroup.com/articles/scrolling-and-attention/
- **Plain copy converts better.** Unbounce's 2024 benchmark (41,000+ pages, 464M visitors, 57M conversions, July 2023 to July 2024) found SaaS pages at a 5th–7th grade reading level converted at 12.9%, against 2.1% for professional-level copy. The SaaS median is 3.8%. This is a correlation. **B**. https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/ and methodology at https://unbounce.com/conversion-benchmark-report/methodology/
- **Visual appeal is judged almost instantly.** Lindgaard et al. (2006, Behaviour & Information Technology) found appeal judgements formed in 50–500 ms. **A**. https://www.nature.com/news/2006/060109/full/news060109-13.html
- **The skill's pitch-page rule** says the hero must be the product, not a statement of the problem. **E**.
- I found no published controlled test of a product screenshot against an illustration in a SaaS hero. This principle rests on how attention and comprehension work, not on a measured lift.

**How to apply it**
- Above the fold, show a real Trainer Brain exchange on a trainer-branded phone screen: a follower asks something and the coach answers in the trainer's method.
- Headline at about grade 6, for example: "Your coaching method, as an AI coach your followers can afford."
- Put AED pricing intent and the primary CTA in the first screen.
- Use one clear idea per screen, and keep the hero shorter than two screens on mobile.

### 2. Speed protects conversion, so motion has to live inside a performance budget
**Evidence**
- **Deloitte for Google, "Milliseconds Make Millions".** A 0.1 s mobile speed gain went with +8.4% retail conversion and +10.1% travel conversion. It covered retail, travel, luxury and lead-gen brands in the EU and US over 4 weeks. Google commissioned it and the result is a correlation. **B**. https://web.dev/case-studies/milliseconds-make-millions
- **Vodafone A/B test.** A 50/50 split with identical-looking pages; 31% better LCP gave +8% sales and +15% lead-to-visit. **B**. https://web.dev/case-studies/vodafone
- **redBus.** Better INP went with +7% sales. **B**. https://web.dev/articles/why-speed-matters
- **Portent.** 20 sites, about 100M pageviews. B2B lead-gen conversion was about 40% at 1 s, 34% at 2 s and 29% at 3 s. Above 5 s it was about half that of a fast site. **B**. https://www.portent.com/blog/analytics/research-site-speed-hurting-everyone.htm

**How to apply it**
- Set budgets on a mid-range Android phone over 4G: LCP at or under 2.0 s, INP at or under 200 ms, CLS at or under 0.05.
- The hero's LCP element should be text or a static poster image. No autoplay video, WebGL or Lottie in the hero.
- Load all motion code after first paint.

### 3. "Smooth" motion means short, purposeful, compositor-only, with no scroll-jacking
**Evidence**
- **Scroll-jacking.** An NN/g usability study across multiple sites (2023, qualitative) found most participants were disoriented. Every participant was disoriented by full-page scroll-jacks, and mobile was worse. NN/g's recommendation is to avoid it above the fold and on mobile. **B/E**. https://www.nngroup.com/articles/scrolljacking-101/
- **Durations.** NN/g (2020) recommends 100–500 ms, mostly 100–400 ms, ease-out, shorter on exit and subtler the more often an animation repeats. Parallax and scroll-jacking are flagged as dizzying, and NN/g says to honour reduce-motion. **E**. https://www.nngroup.com/articles/animation-duration/
- **What to animate.** Only `transform` and `opacity`; blurs and shadows are expensive to paint. **E** (web.dev). https://web.dev/articles/animations-guide
- **CSS scroll-driven animations** run off the main thread. Support: Chrome/Edge 115+, Safari 26+; Firefox is unconfirmed. https://developer.chrome.com/docs/css-ui/scroll-driven-animations
- **Cross-document View Transitions** work in Chrome 126+ and Safari 18.2+, but not Firefox per Chrome's docs. Google's AI Mode team calls the latency "negligible for 99% of use cases" and shipped it as progressive enhancement (**B**: https://developer.chrome.com/blog/google-ai-mode-view-transitions-case-study). A consultant's real-user data shows about 70 ms added to LCP on repeat mobile views (**C**: https://www.corewebvitals.io/pagespeed/view-transition-web-performance).
- **Carousels.** About 1% of ND.edu homepage visits clicked a feature (Runyon 2013). **D**. https://erikrunyon.com/2013/07/carousel-interaction-stats/
- **Design quality and credibility.** In Fogg's Stanford study (2002, 2,684 people), "design look" appeared in 46.1% of credibility comments. **A**, but old. https://advocacy.consumerreports.org/research/how-do-people-evaluate-a-web-sites-credibility
- **No measured evidence** shows that animation itself raises conversion. Motion earns its place by signalling quality (Fogg) and directing attention. It costs speed when done badly.

**How to apply it**
- Use cross-document View Transitions between the multipage routes, falling back to an instant navigation.
- Use CSS scroll-driven reveals of 200–400 ms: opacity plus a translate of 12–24 px.
- One number ticker on the calculator result, under 600 ms and run once.
- Hover and press micro-interactions at about 100 ms.
- No pinned, scroll-jacked scenes, no carousels, no parallax on mobile.
- **Reduced motion, compatible with the owner's "always on" decision:** keep motion on for everyone. Under `prefers-reduced-motion`, swap translate, scale and parallax for opacity crossfades, so motion stays but nothing that can make people dizzy moves.

### 4. Show the full price up front, framed in AED that trainers keep
**Evidence**
- **Buyers want to find pricing themselves.** TrustRadius 2022: 81% of B2B buyers want to find pricing on their own, and pricing tops the list of things buyers want to self-serve. **C/B** (vendor survey). https://solutions.trustradius.com/vendor-blog/tech-buyers-demand-honest-and-up-front-pricing-info/
- **Cost transparency ranks first on vendor sites.** Clutch 2020: 25% of B2B buyers rank it the most important element of a vendor website, ahead of case studies at 23%. **C**. https://martechseries.com/technology/b2b-buyers-concerned-transparent-costs-b2b-companies-websites-highlighting-importance-trust-b2b-sales-funnel/
- **Up-front disclosure is one of NN/g's four credibility factors:** state base costs, all fees and policies, and don't gate value behind a login. **E**/qualitative. https://www.nngroup.com/articles/trustworthy-design/
- **Revenue share versus subscription for creator platforms:** I found no measured study. Creator-platform comparisons (Kajabi, Teachable, Stan) only argue the trade-off. This is a gap. https://schoolmaker.com/blog/kajabi-vs-teachable

**How to apply it**
- Show the commission bands on /pricing with one worked AED example. For example: 120 followers paying AED X gives you AED Y after commission, card processing and VAT.
- Lead with what the trainer takes home, and add the line "no monthly fee — we earn only when your followers pay" (only if that is true).
- Add an FAQ covering refunds, payouts and who owns the followers.
- Don't invent tiers to create anchors (see principle 12).

### 5. Remove sign-up friction: few fields, SSO, no card, and ask for details later
**Evidence**
- **Field type matters more than field count.** HubSpot analysed 40,000+ landing pages: extra plain text fields cost little, while asking for a phone number dropped conversion from about 19% to 13%. **B**, correlational. https://blog.hubspot.com/blog/tabid/6307/bid/6746/which-types-of-form-fields-lower-landing-page-conversions.aspx
- **Forced accounts lose people.** Baymard: 19% of US shoppers (n=1,026) abandoned an order because they would have had to create an account. **B**, from e-commerce. https://baymard.com/blog/current-state-of-checkout-ux
- **Google's SSO case studies.** Reddit saw +50% sign-ups from Sign in with Google and another +90% from One Tap. **C**. https://developers.google.com/identity/sign-in/case-studies
- **Trials with or without a card.** First Page Sage (86 companies, cited second-hand) reports 48.8% trial-to-paid with a card required against 18.2% without. Without a card, more people start, and one analysis estimates about 27% more paying customers end to end. **C**. https://www.shno.co/marketing-statistics/free-trial-conversion-statistics
- **Multi-step forms** beat single-step forms on long forms in agency case studies, with widely varying lifts. **C**. https://zuko.io/blog/single-page-or-multi-step-form

**How to apply it**
- /start or /apply takes Google, Apple or email, then the trainer's Instagram handle, then submit.
- The method interview, prices and Arabic preference move into onboarding.
- No card, which fits a commission-only model.
- If early access is gated, say exactly what happens next: cohort, date, and "we build your Brain with you."

### 6. Build honest proof when you have no testimonials yet
**Evidence**
- **The first reviews carry most of the lift.** Spiegel Research Center (2017, Northwestern) found purchase likelihood rose about 270% with 5 reviews against none, with most of the gain from the first 5. The lift was larger for higher-priced items (+380% against +190%). **A/B**, retail. https://www.marketingprofs.com/charts/2017/32629/the-measurable-impact-that-reviews-and-ratings-have-on-sales
- **Outside sources beat on-site testimonials.** NN/g found users trust external sources (social, press, reviews) more than testimonials on the vendor's own site. **E**. https://www.nngroup.com/articles/trustworthy-design/
- **Buyers start out sceptical.** TrustRadius puts vendor-written case studies at the bottom of the trust scale. In Rob Roy Consulting's 2021 survey, 73% of buyers assume vendors aren't fully honest. **C**. https://solutions.trustradius.com/vendor-blog/b2b-buying-disconnect-vendors-need-to-spin-less-to-sell-more/ and https://www.businesswire.com/news/home/20211021005235/en/Rob-Roy-Consulting-Releases-2021-B2B-Tech-Purchase-Study/
- **People photos helped Highrise.** Their tests concluded big photos of smiling people work. Their long-form page beat the original by 37.5% across 42,000+ visitors; a later, shorter "person page" beat the long form by 47%. **B**, single company. https://signalvnoise.com/posts/2991-behind-the-scenes-ab-testing-part-3-final

**How to apply it**
- Proof is the live product: a clearly labelled demo trainer.
- Add a named founder with a face, UAE presence and the reason they built this.
- Link /methodology from every estimate.
- Run a "founding trainers" programme described as it really is.
- Once trainers consent, link their real Instagram profiles, which gives the "connection to the web" signal.
- Get the first 5 trainer stories as soon as possible, because they carry most of the lift.
- No counts until they are real.

### 7. Let trainers try the AI without a form
**Evidence**
- **Navattic 2025 report** (28,000+ demos, 280 surveyed, about 5,000 sites scraped):
  - about 70% of the top 1% of demos had no form gate in front of them;
  - ungated demos get about 10% more engagement;
  - 73% of top demos' CTAs sit above the fold or in the nav;
  - the most common length is 5–12 steps;
  - 88% of demo sessions are on desktop, and desktop CTR is 52% higher than mobile.
  - Conversion lifts in the report are self-reported. **C**. https://navattic.com/report/state-of-the-interactive-product-demo-2025
- **Using AI builds trust in it.** Edelman's 2025 AI flash poll (5 markets) found trust rises when people get hands-on use and when AI helps them understand something. **B**. https://www.edelman.com/insights/familiarity-breeds-trust-in-ai

**How to apply it**
- Make /demo an ungated chat with a demo Trainer Brain, offering 3 suggested prompts: a workout swap, an AED meal plan, an injury question that shows the refusal working.
- Add a secondary hero CTA, "Try a demo coach".
- Build a mobile-first version, because trainers arrive from Instagram on their phones and most demo tools are built for desktop.

### 8. Sell trust in an AI that acts for the trainer through control, review and guardrails, and don't lead with "AI"
**Evidence**
- **Control.** Dietvorst, Simmons and Massey (2018, Management Science, 3 incentivised experiments): people use an imperfect algorithm when they can adjust it even slightly, and how much they can adjust it hardly matters. **A**. https://ideas.repec.org/a/inm/ormnsc/v64y2018i3p1155-1170.html
- **The word "AI" itself.** Cicek et al. (2024, J. Hospitality Marketing & Management; experiments with more than 1,000 US adults across product categories): saying "artificial intelligence" lowered emotional trust and purchase intent. The drop was larger for high-risk purchases. **A**. https://news.wsu.edu/press-release/2024/07/30/using-the-term-artificial-intelligence-in-product-descriptions-reduces-purchase-intentions/
- **Human checking and disclosure.** Salesforce Connected Customer (14,000+ respondents): about 80% say it matters that people check AI output, and 89% want to know whether they are talking to AI or a person. **B/C**, vendor survey, figures second-hand. https://diginomica.com/salesforce-research-find-business-buyer-and-consumer-trust-levels-ai-decline-despite-generative
- **UAE context.** KPMG with the University of Melbourne (2025; 48,340 people in 47 countries, nationally representative): 65% of UAE respondents are willing to trust AI and 86% accept it, both higher than the global figures. **A**. https://kpmg.com/ae/en/home/insights/2025/05/trust-attitudes-and-use-of-artificial-intelligence.html

**How to apply it**
- Headlines sell the trainer's method and reach. "Frontier model" belongs in /trainer-brain and /how-it-works, not the hero.
- Make "You stay in control" a full section: the trainer approves the Brain, sets the rules, sees conversations and can edit or override.
- Add a "What your Brain will never do" section: medical or injury advice beyond the rules, extreme diets, and so on.
- Followers are always told they are talking to their trainer's AI coach.
- In the UAE this can be confident rather than defensive.

### 9. CTAs: one main action per page, one easy secondary path, a sticky bar on mobile
**Evidence**
- **Fewer links.** Unbounce analysed 18,639 pages: those with one link converted at 13.5%, against 11.9% with two and 10.5% with three. **B**, correlational, 2018. https://www.marketingprofs.com/charts/2018/33935/what-converts-web-landing-page-benchmarks-and-trends-infographic
- **Sticky CTAs** have 29 logged tests in GoodUI pattern 41, mostly on mobile, but the results are behind a paywall. **B−**. https://goodui.org/patterns/41
- **Thumb reach.** Hoober (2013, 1,333 observations): of people touching the screen, 49% used one hand, 36% cradled the phone and 15% used two hands. **B**, observational. https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- **Demo CTA wording.** In Navattic's data, "Explore product", "Watch/try demo" and "Take a tour" had 52–56% engagement. **C**.

**How to apply it**
- Primary CTA on every page: "Build my Trainer Brain" or "Apply for early access".
- Secondary: "Try a demo coach".
- A sticky bottom bar on mobile that appears once the hero has scrolled past, within thumb reach.
- Keep the nav lean.
- Write CTAs as outcomes and test first-person wording; don't assume a lift (see the myths list).

### 10. Make the earnings calculator the centrepiece: their inputs, conservative maths, sources shown
**Evidence**
- Only vendor claims exist for calculator lifts: Outgrow says 15–40% engagement against 2–5% for static content (https://outgrow.co/blog/interactive-content-roi-data-driven-insights), and Demand Metric's 2015 report is marketers' perception. **C**.
- The skill's calculator rule (**E**): the trainer sets the inputs, you supply the measured ratio, and you deliberately understate.

**How to apply it**
- Inputs: followers and AED price.
- Show the commission bands and the take-home pay.
- Use conservative defaults sourced on /methodology, labelled "estimate".
- No email gate; offer "send me this" as an optional extra.

### 11. Design for phones, but let decisions finish on desktop
**Evidence**
- **Desktop converts better.** Contentsquare's 2026 benchmark (2025 data, 99 billion sessions, 6,500+ sites): desktop converts at 3.4%, about 74% higher than mobile web; the commonly cited mobile share of traffic is about 70%, though I saw that figure second-hand. **B**. https://contentsquare.com/de-de/blog/mobile-vs-desktop-traffic/
- **SaaS landing pages.** Unbounce: 79% of visits are on mobile, and mobile converts at 6.4% against 6.2% on desktop. That is paid landing-page traffic. **B**.
- **UAE.** 99% internet penetration and mobile connections equal to 195% of the population. **B**. https://datareportal.com/reports/digital-2025-united-arab-emirates

**How to apply it**
- Design every page mobile-first.
- Add "send me this link" by email or WhatsApp so a trainer can pick it up on a laptop. WhatsApp being the preferred channel is my assumption, not sourced.

### 12. Pricing structure: few choices, and no decoys
**Evidence**
- **Choice overload depends on context.** Chernev, Böckenholt and Goodman (2015 meta-analysis, 53 studies, 7,202 participants): too many options cause overload when the decision is hard and the buyer is unsure what they want. **A**. https://www.kellogg.northwestern.edu/faculty/research/detail/2015/when-product-assortment-leads-to-choice-overload-a-conceptual
- **Middle options attract.** The compromise effect (Simonson 1989): the middle option gains share. **A**.
- **Decoys are weak with real products.** The decoy (attraction) effect mostly disappears with realistic stimuli (Frederick, Lee and Baskin 2014, JMR). **A**, but disputed. https://marketing.wharton.upenn.edu/wp-content/uploads/2016/10/The-Limits-of-Attraction.pdf

**How to apply it**
- Keep a single commission plan.
- Show extras such as voice coaching as add-ons, not as fake tiers.
- If follower-facing price examples are shown, three with the middle one highlighted is reasonable.

### 13. Keep the site multipage, one job per page, and only as long as the objections need
**Evidence**
- **Length is not the lever.** At Highrise, long beat short (+37.5%) and then shorter beat long (+47%). At Crazy Egg, a page 20 times longer won by 30%, and then a shorter rewrite beat it by 13% (Copy Hackers). What won was answering objections. **B/C**. https://crazyegg.com/blog/high-performing-landing-pages and https://copyhackers.com/2014/02/optimized-crazy-egg-home-page/
- **Traffic source matters more than layout.** In Unbounce's data, email traffic converts at 16.9% against 2.9% for paid social. **B**.

**How to apply it**
- Home: 5–7 sections that move the visitor to the demo, the calculator, or the primary CTA.
- Deep objection-handling goes on /trainer-brain, /features/*, /pricing and /methodology.
- Build dedicated landing variants for Instagram and email traffic.

### 14. Write Arabic natively and mirror the whole layout
**Evidence**
- **The content was the problem, not the design.** Arif and Gupta (2014, IJTHI, Dubai Municipality site, 30 evaluators): the Arabic and English versions looked the same, but the Arabic content was less usable. **A−**, small sample. https://salford-repository.worktribe.com/output/1411726/assessing-the-usability-for-arabic-language-websites
- **Who needs localisation.** NN/g: B2B audiences who speak English may accept English, but broad consumer audiences need localisation. **E**. https://www.nngroup.com/articles/international-usability-details-differ/
- **Gap.** I found no measured data on how bilingual GCC visitors convert.

**How to apply it**
- Arabic copy is written, not machine-translated.
- Use logical CSS properties and mirror the direction of motion in RTL.
- Give Arabic text a larger size and more line height.
- AED formatting stays consistent in both languages.

### 15. Most tests will be underpowered, so research qualitatively first
**Evidence**
- At a 3% baseline, detecting a 10% relative lift needs roughly 52,000 visitors per variant (the standard rule n ≈ 16·p(1−p)/MDE²). **E**.

**How to apply it**
- Run 5-second tests and message tests with UAE trainers, and watch session recordings.
- A/B test only big swings, such as concept against concept, and only after traffic grows.

---

## Myths and weak evidence to avoid

1. **"First-person CTA +90%"** (it appears in the skill's benchmarks). I found no traceable test, so treat it as a hypothesis.
2. **"Single-CTA pages convert 266% better."** This comes from an aggregator. The traceable data is 13.5% against 10.5–11.9%, and it is a correlation.
3. **"Highrise smiling photo +102%."** I found only secondary sources. What is verified is the conclusion that "big photos of smiling people work".
4. **"Hero video lifts conversion."** I found no published controlled test, and it reliably costs LCP.
5. **Decoy pricing and the jam study's "fewer choices always wins."** Both are weak or conditional with realistic choices.
6. **"Users decide in 50 ms."** That finding is about visual appeal, not a decision to buy. It is no reason to pile on visual effects.
7. **"Interactive content converts 2x" and "quizzes convert 40%."** These are vendor or perception data.
8. **Interactive-demo "6x" and "3x" figures.** These are single-customer quotes in vendor reports.
9. **"Card-required trials convert better."** Trial-to-paid is higher, but fewer people start, and it doesn't apply to commission pricing.
10. **"Mobile converts as well as desktop."** This is true only in Unbounce's paid landing-page data; whole-site data shows desktop about 74% higher.
11. **"About 30% of users enable reduced motion."** This figure is unsourced, and so is the 3.5% figure. Design for it whatever the number is.
12. **"Annual default +20–30%"** and **"7% loss per second of delay"** are unverified or old. Use the Deloitte, Vodafone and Portent figures instead.
13. **Scroll-jacked storytelling, pinned 3D scenes, carousels and parallax on mobile.** NN/g and the Runyon data both show usability harm.
14. **Wynter "simulated persona" message tests.** These are AI-generated and not buyer evidence.

## Rules every concept should share
- Commission-only, AED-first pricing transparency.
- A hero that shows the product, written at about grade 6.
- An ungated demo coach.
- A conservative calculator linked to /methodology.
- Sections on control and on what the Brain will never do.
- A founder and founding-trainers block, with no invented counts.
- One primary CTA per page, plus a sticky CTA on mobile.
- Compositor-only motion of 200–400 ms, View Transitions between pages, and no scroll-jacking or carousels.
- LCP at or under 2.0 s and INP at or under 200 ms on mid-range Android.
- Natively written Arabic with mirrored layout and motion.

Three concepts can then differ in visual language and story order, for example method-first, demo-first or earnings-first, while still following all of the above.