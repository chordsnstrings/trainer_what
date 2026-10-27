**Adversarial review: trainsyou marketing revamp synthesis (26 Oct 2026)**

I checked this against the repo on `claude/repository-overview-osejlw` and the page registry from `dump.ts index`. I re-fetched or searched 5 external sources.

## REQUIRED FIXES

### A. Facts about the product that are wrong or overclaimed

1. **The "Live today" list is wrong.**
   - Going live is blocked while payments are off. `apps/api/src/onboarding.ts:713-720` adds a `payments` gate owned by trainsyou (`ok: commerceReady`), and `readyToPublish` is `gates.length === 0`. `docs/features/coach-setup.md:88-92` says the same: `priced_plan` is "turned on once payments work", and the platform check covers `legal`, `payments` and `model`.
   - So trainers cannot publish today. Subscribers do not get daily plans, guided workouts or chat from a published page.
   - "Premium voice stays a paid capability" (`docs/features/joining*.md:60`). So the voice add-on is not live for subscribers.
   - Complimentary nutrition needs the approval flags.
   - **Fix:** build the panel from launch gates as well as feature flags.
     - Today: sign up, set up your page, teach and test your AI, preview what subscribers will see.
     - Next: publishing your page, subscriber payments in AED, payouts, paid bookings, and the voice add-on for subscribers.
   - Do not promise "we'll email you". No email provider is configured.

2. **Remove or re-scope everything that assumes publishing works today.**
   - Business conversion "3. Site published" and the KPI "sign-up → published within 14 days" cannot happen while the gate is on. Mark them as blocked.
   - "Collect the first five consented trainer stories … link to their real coaching sites" is not possible until go-live works.
   - "A live sample coach site labelled Sample" must be a static mock inside marketing. It cannot be a published tenant, which would be gated and would look like a real coach.

3. **"You pay nothing unless subscribers pay you" is not verified.**
   - The statement deducts "Optional services such as voice and your own domain" (`marketing-content.ts:1662`).
   - Domain cost is "shown before purchase" (`:1284`).
   - The own domain is a purchase that can happen with no subscribers, which contradicts the synthesis's own justification.
   - **Fix:** use the existing true line, "We earn only when your subscribers pay", unless billing code proves the stronger claim.

4. **"Operator access: audited, and requires a second sign-in" overclaims.**
   - The live copy says "Fresh authenticator checks apply only when authenticator enforcement is enabled" (`marketing-content.ts:2135`).
   - Keep the condition, in plain words.
   - Likewise, retitle "Encryption: keys encrypted at rest" as "Provider keys encrypted at rest". As written it implies all data is encrypted at rest.

5. **There is no "12th page in the registry".**
   - The registry has 11 feature pages.
   - **Fix in C5:**
     - drop the placeholder row;
     - change "12 pages" to 11;
     - recheck the "12 tiles" count.
   - **Build note:** "38 live pages plus 404 and /login" also leaves out `/signup` and `/coaches`, which are not in the registry. Change it to 38 + `/signup` + `/coaches` + `/login` + 404.

6. **`price_aed` is not read anywhere in `apps/web`.**
   - The signup chip "Your price: AED 199" and the carried CTA promise behaviour that does not exist.
   - Either specify the code change (the signup reads it and the wizard's "Your plan" step pre-fills it, an owner OK on a protected path) or drop the chip.
   - "your-name.trainsyou.com reserved next" also overclaims. Today the slug is only pre-filled (`marketing-site.md:343`). Say "we'll check it's free in setup".

7. **The Kamran label drops the AI disclosure.**
   - The live label is "Talk to Kamran (AI voice)" (`assistant-button.tsx:108`). The synthesis changes it to "Ask Kamran (voice)".
   - Keep "(AI voice)" everywhere.
   - Kamran also says "I built trainsyou". The FounderNote's name, photo and voice must be reconciled with that persona: say Kamran is an AI voice of the named founder, with consent. Add this to the owner decision.

8. **"Every number on this site has a source" is an absolute claim that is false.**
   - It would cover samples (86%, Layla Strength), product counts (91 capabilities, 282 layouts), example prices and the "about 15 minutes" estimate.
   - **Fix:** "Every market figure links to its source."

9. **The "replaces 7 tools" row (home band 5, `/features`, B) counts tools that are not live.**
   - The booking tool and payments/invoicing are "Available soon" (bookings `avail=payments`).
   - Mark them "switching on later", or show 5 until they are live.

10. **The home calculator headline drops its qualifier.**
    - It must keep "before platform commission", as on live.
    - B's take-home tile must say "before card processing" on the tile itself.

11. **"Teach my AI — free at AED 199" can be read as "teaching costs AED 199".**
    - **Fix:** keep the label "… — free" and put the carried price in a sub-line ("Your price, AED 199, carries into setup").

### B. Evidence cited wrongly or given too much weight

12. **The Highrise findings are attributed wrongly, and the two principles contradict each other.**
    - The post says long-form beat the original by 37.5%, and the much shorter person-photo page beat long-form by 47% ([source](https://signalvnoise.com/posts/2991-behind-the-scenes-ab-testing-part-3-final)).
    - Principle 8 says photos won "by 37.5% and then by 47%". Fix principle 8.
    - "42,000+ visitors" is not in that post. Mark it untraced or cite the post that gives it.

13. **The Unbounce sample size is overstated.**
    - "41,000+ pages" is the dataset across all industries. The SaaS page gives no SaaS sample size ([source](https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/); the audit says the same).
    - Change the label to "Vendor data, SaaS n undisclosed, correlational".
    - The same applies to the 79% mobile and the 16.9% vs 2.9% figures.

14. **The KPMG figures are self-reported survey attitudes, not behaviour.**
    - The UAE subsample size is not given on the cited page ([source](https://kpmg.com/ae/en/media/press-releases/2025/10/97-percent-of-uae-residents-now-use-ai.html)).
    - Relabel: "Survey, global n≈48k, UAE n not stated".

15. **The Unbounce links figures do not support a single label.**
    - 13.5% / 11.9% / 10.5% is for 1 / 2 / 3 links or CTAs on standalone landing pages, n=18,639 ([search confirmation](https://www.marketingprofs.com/charts/2018/33935/what-converts-web-landing-page-benchmarks-and-trends-infographic)).
    - It measures how many links a page has, not whether labels are consistent. The plan itself adds a 7-item nav and "Try the demo" as a nav item and secondary CTA.
    - Cite it only for campaign landing pages. Argue for label unification on consistency grounds instead.

16. **The CTA wording is justified by an untraced claim.**
    - The synthesis says it echoes `BRAND_COPY.primaryAction` and the owner's HTML. Both say "Teach your AI" (`brand.ts`; HTML "Teach your AI — free"). Neither says "my".
    - **Fix:**
      - default to the owner's "Teach your AI — free";
      - put "my" against "your" in the CTA test list.

17. **The scroll-jacking evidence does not match the pattern.**
    - NN/g's study covers pages that hijack scroll speed and behaviour.
    - The live journey is a sticky scene on native scroll.
    - Use the attention data instead: 480svh pushes the value bands past the 81%-within-three-screens point. Drop the scroll-jacking framing as the main argument.

18. **A vendor claim is used to wave away a measured study.**
    - The FitBudd "91% of trainers already use AI" (n undisclosed) is used to dismiss the measured Cicek result. Say this is a judgement call to be tested, not an evidence-based override.

19. **Recommendation E.3 overclaims.**
    - "A client-facing AI coach visitors can try" is wrong: the trainsyou demo is scripted and calls no model.
    - Change it to "a hands-on, scripted walkthrough of how your AI decides".
    - Also scope "no fitness platform lets a visitor try…" to "none of the 12 competitors checked".

20. **Baymard's 19% (forced account creation at e-commerce checkout) does not apply.** Trainers must create an account anyway. Mark it "not applicable" or drop it.

21. **New claims added that are not among the 33 `/methodology` sources** (`marketing-content.ts` has 0 matches for GymNation, women-only or Mu'Ahal):
    - **GymNation AED 99:** a price label is attached to an "operator survey" tag, which is confusing.
    - **46% women-only:** a survey about physical gyms, so weak support for online pre and postnatal coaching.
    - **Mu'Ahal:** effective 9 July 2026, not "announced 13 July".
      - Its scope is professionals working in Dubai-registered federations, academies and fitness facilities. It is not all trainers.
      - The cited source is the vendor partner. Cite the press coverage instead ([Gulf Today](https://www.gulftoday.ae/sport/2026/07/11/dubai-sports-council-launches-the-muahal-programme-for-accreditation-of-coaches), [Zawya](https://www.zawya.com/en/press-release/government-news/dubai-sports-council-and-dataflow-group-launch-muahal-tt9ta5cp)).
    - **Fix:** add each figure to `/methodology` with an evidence label before it can appear with a `SourceBadge`. Otherwise drop it.

22. **The advertiser-permit exemption is stated flatly in C10.**
    - The live copy hedges: "Reports … say … exempt. Rules change, so check with the UAE Media Council. This is information, not legal advice." (`marketing-content.ts:2219`)
    - Keep the hedge.

23. **Persona figures and trigger quotes have no source.**
    - Unsourced: "gym takes 30–60%", "AED 150–350 sessions", "2k–30k followers", "fully booked and not earning more", "DMs full of people who can't afford me".
    - Cite the buyer-research source, or mark them as hypotheses. Never put them on the site as trainer quotes.

### C. Owner constraints and house rules broken

24. **Hidden-before-reveal is used on the hero, which breaks a house rule.**
    - `marketing-motion.md:35-36,89`: "every word … visible from the first paint"; hidden-before-reveal "never [applies] to above-the-fold content or the LCP element" and "never the hero".
    - Breaches:
      - A's hero sequence fades in the subscriber bubble and the rule chip;
      - C's hero margin notes fade in;
      - the shared reveal does not exclude the first screen.
    - **Fix:**
      - render the hero's start state fully visible and animate only the change (60→62.5 kg, the lane, the bar);
      - exclude first-screen units from reveals.
    - The "remove the hide after 1.5 s" safety net would also stop every reveal below the fold from ever animating. **Fix:** it should fire only if the reveal script fails to initialise.

25. **"Colour changes are instant" is a house rule** (`marketing-motion.md:33`). A's "button background 140 ms" breaks it. Make the colour change instant, or crossfade an overlay's opacity.

26. **The reduced-motion rule reverses an explicit owner decision without marking it.**
    - The owner chose: short marketing motion plays even with reduce-motion (`PROJECT_MEMORY.md:28-30`; `MARKETING_MOTION="always"`).
    - A's spec and the shared page-transition spec state opacity-only as if decided.
    - Make every reduced-motion branch conditional on the `MARKETING_MOTION` switch, defaulting to "always". Keep it as owner decision 5 only.

27. **"Keep the marketing widgets and the trainer sign-up path as they are"** (`PROJECT_MEMORY.md:30`).
    - The plan changes these widgets:
      - calculators: three-column results, digit roll, carried price;
      - demo: rule builder and threshold slider;
      - journey: replaced by a stepper;
      - AddressPreview: label and CTA.
    - Only the journey, the digit roll and signup appear in the owner decisions. Add the others.
    - Also fix the internal contradiction: principle 7 keeps "Claim this address", but C11 and C17 rename it "Claim my address — free" and "Claim my link — free".

28. **Two earlier owner choices are hidden.**
    - For the HTML home the owner chose "no social proof, no card-fee line" (`PROJECT_MEMORY.md:35`).
    - Decisions 2 (FounderNote) and 3 (processing rate) must say this explicitly, so the owner reverses it knowingly.

29. **The home word budget conflicts.**
    - The house budget is 400 visible words (`marketing-site.md:671`). The synthesis raises it to about 700 without saying so.
    - The C1 content (8 bands, constraint list, live panel, founder note, 7-tools row, stepper, 6 FAQ questions) adds up to about 800 or more.
    - Set per-band word budgets, cut bands, or make the change an owner decision.

30. **H1 rule ("8 words or fewer, now enforced") is only applied partly.**
    - These feature-detail H1s are still over the limit:
      - ai-training-plans (12 words);
      - chat-and-digital-coach (9);
      - payments-and-payouts (10).
    - Guide titles break it too (the advertiser-permit title has 12 words and a colon).
    - Rewrite them, or exempt guides explicitly.
    - C3's "An AI trainer built…" breaks the plan's own "AI is always possessed" rule.

31. **B drifts from the AI moat, and its own text contradicts itself.**
    - The risk table says "the AI mechanism band sits second". B's order (1 → An hour sells once → 5 → 6 → 2 …) actually puts the mechanism fifth.
    - B's hero visual is an offer and earnings, which also conflicts with the motion house rule "No metrics, counts, revenue … only features that are available now" (`marketing-motion.md:24-26`).
    - **Fix:**
      - move the mechanism band to second;
      - keep the 92-session grid out of the hero ("never make a session countdown the headline");
      - get owner OK for revenue in the hero.

32. **On the home page, the payments-off disclosure comes after the money.**
    - It sits in band 7, after the AED headlines in bands 5 and 6.
    - Put the status chip in bands 5 and 6 and next to every AED headline (calculators, specialty CTAs, `/payments-and-payouts` H1).
    - "Switching on next" implies a date. Use "Not on yet" unless the owner commits.

### D. Motion, Core Web Vitals and accessibility

33. **Shared-element morphs point at targets off screen.**
    - On `/how-it-works` the console is in section 2. B's take-home tile on `/pricing` sits in section 5. On phones both are below the fold, so the morph would fly off screen.
    - Morph only when the target is in the first viewport (for example home → `/demo`); otherwise use the root crossfade.

34. **C's H1 morph between different texts will stretch the glyphs.**
    - Crossfade instead. If it must morph, use `::view-transition-old/new(page-title){height:100%;object-fit:none;object-position:left top}` (`inset-inline-start` in RTL).

35. **The production View Transitions path needs checks.**
    - Next 16.3.6 / React 19.3.0 `experimental.viewTransition` and `<ViewTransition>` must be verified and gated as enhancements.
    - Splitting the marketing bundle through separate root layouts forces full reloads to `/signup`, so the same-document transition will not apply there. Use cross-document transitions.

36. **Font loading creates layout-shift risk.**
    - At risk: C's Newsreader H1 (the LCP element), B's Archivo figures and A's mono figures, all loaded with `display=swap`.
    - Production must:
      - self-host and subset these fonts;
      - preload the H1 face;
      - set size-adjust fallback metrics.
    - C's 128 px section padding lengthens phone pages for Instagram traffic. Cap it at about 96 px.

37. **Layout shift in values.**
    - 60→62.5 kg and digit rolls change text width. Use tabular figures, fixed-width slots and stacked crossfade spans.
    - The B mitigation "figures go below 32 px at 360 px" contradicts its own token `clamp(48px,…)`.

38. **The phone header does not fit.**
    - At 360 px, a logo of 160 px or more, the menu button and "Teach my AI — free" do not fit (328 px usable).
    - Specify: the CTA moves to the sticky bar on phones, and the header shows the logo and menu only.

39. **The bottom of the phone screen will collide.**
    - The consent bar (after 40 px of scroll), the sticky CTA bar and the Kamran pill all fix to the bottom.
    - Define their stacking and order. Use `env(safe-area-inset-bottom)`. Animate the bar by transform only. Reserve bottom padding so the bar never covers content or footer links.

40. **Accessibility for the widgets:**
    - one polite `aria-live` result region per calculator and demo, with debounced announcements;
    - digit-roll strips and typing dots `aria-hidden`, with the real value as text;
    - the threshold slider as a labelled `input type=range` with `aria-valuetext`;
    - tabs following the ARIA tabs pattern;
    - rule-builder fields at least 44 px.

41. **Web Share needs a fallback.** Add copy-link where `navigator.share` is missing (desktop Firefox and others).

42. **The dev panel's RTL toggle should apply only to the subscriber-app vignette.** Flipping the English marketing page to RTL misrepresents the product.

### E. Funnel, measurement and test plan

43. **First-touch storage of UTM, gclid, fbclid and ref only exists after consent** ("Nothing is recorded before consent").
    - Specify: append from storage only when consent is given; otherwise pass through the current URL's parameters only, without storing them.

44. **The A/B test sample and assignment must respect consent.**
    - Without consent, signups cannot be linked to a variant. The 5,800 per arm must be consented visitors, and the assignment cookie needs consent or must not persist.
    - State the likely duration at current traffic. It is probably many months, so lean on the 5-second tests first.

45. **Do not run A against B while payments are off.** B's headline promise cannot be honoured.
    - Test A against C now.
    - Test B only after payments go live, or re-scope B's hero to "free to start, your price" until then.

46. **Specify the registration-closed variant** of the header, sticky bar and closing-panel labels everywhere (for example "Join early access — free"). Today it is only in C11.

47. **Add SEO and generated metadata to the blueprint.**
    - The title, meta, JSON-LD, sitemap and llms files are all generated from `marketing.ts`, and the blueprint says nothing about them.
    - The H1 rewrites drop query terms ("take your coaching online" on `/uae`, "for strength coaches" on the specialty pages). Keep those terms in titles and metas, and keep canonicals.
    - Add `noindex` for `/coaches`.

48. **Copy changes must be re-run against the tests.**
    - Copy rewrites (which motion work must never do) need owner approval.
    - Then re-run `tests/marketing-site.test.ts`:
      - banned phrases, including the payout provider;
      - word budgets.

## STRONG POINTS TO KEEP

- **Facts reconciled correctly:** the live audit is treated as winning on facts; open registration and `/signup` as the conversion; early access only as the fallback.
- **Evidence handling:** every claim carries an evidence label, and there is a list of weak claims the plan will not lean on, including "users decide in 50 ms" and "7% per second".
- **Maths checked and correct:**
  - pricing example: 150×199 → commission 4,975 + 1,990 = 6,965, keep 22,885, about 92 sessions;
  - blended rates 25 / 21.7 / 17 / 14.7%;
  - guide table: 5,771 at 24.17%, 18,053;
  - nutrition average AED 229;
  - sample sizes about 52k and 5.8k for a 10% and 30% lift at a 3% baseline;
  - chip contrast 6.4, 5.7 and 5.2 to 1; `--keep` 7.4 to 1.
- **Header CTA:** always sign-up on every page, with the page's own action as a secondary. This ends the detours through `/get-started`, `/earnings-calculator` and `/ai-disclosure`.
- **Honest content fixes:**
  - the Progress chip `some(!available)` bug;
  - the stale "What can I connect?" answer;
  - removing the empty directory from `/uae`;
  - `noindex` for `/coaches`;
  - the Bookings H1 reframed around the AI moat;
  - the FAQ "Can subscribers pay me today?".
- **Control as the selling point:** the full "You stay in charge" band and the "What your AI will never do" list. These turn the main fear (unsafe advice) into control, in line with Dietvorst.
- **The ungated, deterministic demo:** an editable rule and a threshold slider, labelled "no AI model is called".
- **The performance budget:** H1 as the LCP element, product UI in HTML not images, no GSAP, motion JS of 12 KB or less, compositor-first, no pinned scenes, carousels or mobile parallax, and reveals that play once off IntersectionObserver.
- **Calculators:** the owner's best-case headline kept, all three scenarios shown, no email gate, and the earnings calculator linked to the follower calculator.
- **Events:** a privacy-aware event spec (slug length only, consent first, first-party endpoint, no tag manager).
- **Local fit:** logical properties and RTL mirroring with the logo never mirrored, marketing pages kept in English, an honest Arabic scope, and an RTL vignette using real member-app strings.
- **The "frontier model" wording** stays gated by the flag (consistent with `MARKETING_REFRESH`), and no vendor is named.
- **Three genuinely different strategies:** product-led, outcome-led and editorial, with explicit risks and brand deviations sent to the owner.
- **Testing order:** comprehension testing before any A/B test, and only big swings tested first.
- **Owner decisions:** the explicit list is the right mechanism. Extend it per fixes 26 to 28 and 31.

Files checked:
- /home/user/trainer_what/apps/api/src/onboarding.ts
- /home/user/trainer_what/docs/features/coach-setup.md
- /home/user/trainer_what/docs/PROJECT_MEMORY.md
- /home/user/trainer_what/docs/features/marketing-motion.md
- /home/user/trainer_what/docs/features/marketing-site.md
- /home/user/trainer_what/packages/contracts/src/marketing-content.ts
- /home/user/trainer_what/apps/web/components/marketing/assistant-button.tsx