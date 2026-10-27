# Competitor and design-reference teardown for the trainsyou marketing revamp (26 Oct 2026)

**How this was done:** I fetched each live page with WebFetch on 26 Oct 2026, plus raw `curl` of the HTML and CSS for Stan, the language check and the motion check. No cloud browser was used. Quotes come from the page text. Where the hero is an image I could not see it, so I say "not visible in text" instead of guessing. Every count a company states about itself is its own claim and was not verified.

**Evidence weights used below:**
- **[M]** measured study, with sample size
- **[V]** vendor claim
- **[E]** expert or practitioner opinion
- **[A]** anecdote
- **[O]** my own direct check of the live page or its code

## 1. Trainer software (the direct competitors)

**Trainerize** (trainerize.com, now part of ABC Fitness)
- **Hero:** "The #1 coaching app to better engage your clients" / "Take your coaching online and deliver an experience like nothing your clients have ever seen before."
- **CTAs:** "Get started" next to an email field, which reserves `yourname.trainerize.com`. There is no secondary CTA. Hero visual not visible in text.
- **Proof:** "400k+" trainers, "45k+" businesses, "1.6M+" clients. Logos for Gold's Gym, Life Time and YMCA. Press logos (WSJ, GQ and others). No testimonials. [V]
- **Pricing:**
  - Basic is free for 1 client. Grow is $9 a month. Pro 5 is $23 a month. Studio Plus is $248 a month.
  - "Enjoy 30 days free with unlimited clients. No credit card required."
  - Branded app costs $169 to set up. Payments are a $10 a month add-on. Annual billing saves 10%.
  - The page contradicts itself: Grow is $9 or $10, Pro 5 is $23 or $25, Studio Plus is $248 or $275. [O]
- **AI:** "Your coaching, amplified by AI … build workouts in 50% less time." It faces the coach only: "You review the draft in the preview", and clients get only workouts the coach has confirmed.
- **Distinctive:**
  - A free marketplace listing (Trainerize.me).
  - Footer buttons "Ask AI for a summary of ABC Trainerize" that open ChatGPT, Claude, Perplexity and Gemini with a prefilled prompt.
  - A "Hey AI, learn about us" page aimed at AI systems.

**TrueCoach** (truecoach.co)
- **Hero:** "Train Your Clients Online With The #1 Platform Built For Personal Trainers" / "Grow your business with the personal trainer software platform trusted by 16,000+ coaches. Start your free 14-day trial today!"
- **CTAs:** "Try it free" with an email field. Microcopy: "No credit card required", "Cancel any time".
- **Hero visual:** an image with a testimonial overlay, "TrueCoach has increased our monthly revenue by over $55,000."
- **Proof:** 16K+ coaches, 250K+ clients, 50M+ workouts. The page elsewhere says "over 20,000+", which conflicts. G2 and Capterra badges. 3 testimonials. [V]
- **Pricing:** Starter $26.34 (5 clients), Standard $57.99 (20 clients), Pro $136.99 (50 clients). 14-day trial with no card. 90-day money-back guarantee on annual plans.
- **AI:** none in the product copy, only in blog posts.
- **Nav:** Specialties, Features, Partner Perks, Pricing, Resources.

**Everfit** (everfit.io)
- **Hero:** rotating text, "The all-in-one platform for [Fitness Coaches / Gyms & Studios / Nutrition Coaches / Sport Coaches]" / "Unlock your full potential with the #1 platform to coach, scale, and win."
- **CTAs:** "Start free trial" and "Sign In". The hero rotates photos.
- **Proof:**
  - "Trusted by over 380,000 coaches", "5.0 From G2 & Capterra". [V]
  - Stats with no source: "+82% free trial conversion rate", "12x increase in revenue in first 3 months", "25+ hours per week freed up". [V, no source]
  - 9 testimonials.
- **Pricing:**
  - Starter is free forever for 5 clients.
  - Pro starts at $19 a month for 5 clients and rises to $290 for 300. Studio starts at $105.
  - Paid add-ons: Autoflow from $29, meal plans from $39.
  - "No credit card required". The hero says "Start free trial" while later CTAs say "30-day trial", which is inconsistent.
- **AI:** "Create structured, progressive workout plans in minutes, assisted by AI". "MacroSnap" meal scanning. "AI-powered matchmaking" in the marketplace. All of it serves the coach or matchmaking.
- **Distinctive:** a section organised around high-ticket and low-ticket clients.

**Kahunas** (kahunas.io)
- **Hero, written as a problem statement:** "When it comes to coaching, who has time for clunky platforms and dull spreadsheets?" / "Switch to Kahunas, and get back to doing what you do best - helping your clients transform their lives!"
- **CTAs:** "Start your 14 day free trial" and "See How it works" (video).
- **Proof:** "Trusted by 750,000+ users", "Over 14,000 coaches". 11 video testimonials. PureGym "Recommended by". [V]
- **Pricing on the home page:** Essentials $35, Growth $69, Ultimate $99 a month, with a monthly or yearly toggle. The headline compares the price to "the cost of protein shake each day". No commission; payments go through the coach's own Stripe or PayPal. A branded app-store app comes only with Ultimate.
- **AI:** only a "Health Score A.I" line item.
- **Distinctive:** a 3-month guarantee from the named founder, with a same-day refund. Nav includes "Watch the Demo" and "Our Coaches".

**PT Distinction** (ptdistinction.com)
- **Hero:** "Personal Trainer Software" / "Train more clients in less time, with better results"
- **CTAs:** "Start your 1-month free trial" and "How it works" (video). The hero shows product screenshots on several devices.
- **Proof:** 4.9 on Capterra, GetApp and G2. A wall of badges. "Used by over 60,000 training businesses". [V]
- **Pricing:** Basic $19.90 (3 clients), Pro $59.90 (25 clients), Master $89.90 (50 clients). Monthly billing only. Branded apps on Pro and above.
- **AI:** "Create custom programs in 20 secs" and "AI Meal Planner". The coach side only.
- **Distinctive:** "Completely branded as yours … won't know we exist."

**My PT Hub** (mypthub.net)
- **Hero:** "The all-in-one personal training software and app" / "Unlimited clients. Unlimited growth. One coaching app."
- **CTAs:** "Start free trial" with an email field.
- **Proof:** "200,000+ fitness coaches", "170+" countries, "3m+" clients. Founder testimonials that include "$750,000 lifetime company value". [V]
- **Pricing:**
  - Starter $25 (3 clients), Premium $59 (unlimited; 50% off the first 2 months), Ultimate $215.
  - Branded app is $95 once. White-label app is $145 a month. Check-Ins AI is $12 a month.
  - 30 days free, "No card details required".
- **AI:** "AI coaching app for personal trainers … automate the tasks that drain your time". Nutrition AI "runs every plan past you for final approval". Claims "Build up to 10x faster!" with no source. All of it faces the coach.

**Exercise.com** (owned by Daxko)
- **Hero:** "The #1 Software for Fitness Businesses" / "Ditch the generic salon tools…"
- **CTA:** "Book Demo" is the only conversion path. There is no trial and no public prices (the /pricing/ URL returned 404).
- **Proof:** a wall of gym logos, a video testimonial, an avatar grid of well-known coaches, PCI Level 1. No numbers.
- **AI:** none.
- **Distinctive:** a feature table naming Mindbody, Trainerize, ZenPlanner and Pike13. Done-for-you data migration.

**FitBudd** (fitbudd.com)
- **Hero:** "#1 Personal Training Software for Fitness Coaches & Gyms" / "Launch your Branded Fitness App in minutes"
- **CTAs:** "Start Free Trial" and "Book a Demo". The hero shows a photo of three coaches, a Capterra 4.6 badge and 9 logos.
- **Pricing:** Starter $15 (2 clients), Pro $79 (20 clients), Super Pro $149 plus a $75 setup fee. Apple and Google developer fees of $99 and $25 for a white-label app. 30 days free, no card.
- **AI:** a "Smart AI Assistant for Fitness Pros", "Create weeks of programming in minutes, not hours". Coach side only.
- **Demo:** "Take a Tour" plus two self-guided interactive demos (built with Navattic).
- **Distinctive:** the same "ask AI about us" footer as Trainerize. Lists Razorpay, which suggests it markets outside the US.

**Playbook** (playbookapp.io): the strongest converter of the fitness group
- **Hero:** "Turn your audience into recurring income" / "A decade of data across thousands of creators tells us exactly what drives subscribers, retention, and revenue…"
- **CTA:** "Start now for free". The hero is a scrolling strip of creator photos, each with a stat.
- **Proof:** "$233M+ paid to creators", 2,500+ earning creators, 300k+ subscribers, and about 30 named creator cards with figures such as "Poppi Louiz: $30K+ MRR". [V]
- **Pricing:**
  - $0 a month, and the creator keeps 80% ("we only make money when you do").
  - A table puts competitors at "$99–$799/month" plus transaction fees.
- **AI:** "AI prompts" only.
- **Sections:** includes "From sign-up to first dollar" (4 steps), a creator management team, and quarterly challenges with cash prizes.

## 2. "AI version of you" products

**Coachvox** (coachvox.ai)
- **Hero:** eyebrow "Your AI, live today", then "You're already the person they should hire. Now be the one they can experience." / "…An AI version of you gives them your thinking on-demand, in your voice, before they make an inquiry."
- **CTAs:** "Start free trial" and "Or join the next live demo" (30 minutes with the founder).
- **How the AI is explained:**
  - "trained only on your content, your methods and your voice"
  - "We never use it to train wider AI models, and we never share it between models"
  - "Review what your AI says"
- **Pricing:** one plan at $83 a month billed annually. 14 days free with a card. Monetisation for the coach: they can charge for access, add coupons and set trial periods.
- **Other features:** replies in over 50 languages, lead capture through Zapier, and an "audience challenges" view.
- It names its AI vendors (OpenAI, Anthropic) on the page. trainsyou must not do this.

**Delphi** (delphi.ai now redirects to delphi.co)
- **Hero:** "Find people who've been there" / "Describe your situation. Get their perspective."
- **CTAs:** "Create your Delphi" and "Learn more".
- **How the AI is explained:** "an interactive digital mind, built from a real person's knowledge, content, and experience"; "All responses are grounded in your expertise, and all data is owned by you."
- **Demo:** a sample chat on the page, plus a "Chat" button on each expert's card. Visitors can talk to a real Delphi before signing up.
- **Proof:** named public figures (Karpathy, Michael Dell, Lenny Rachitsky and others).
- **Pricing:** Scaler $5k a year, Scaler + API $10k a year, "Immortal" custom.

**Twise** (new.twise.ai/for/personal-trainer)
- **Hero:** "AI Twin for Personal Trainers" / "You see each client three hours a week. They train, eat, and recover the other 165."
- **CTA:** "Start free".
- **How the AI is explained:** "grounded only in knowledge you approve"; the trainer starts with 5 starter cards (warm-up protocol, form cues, substitution chart, nutrition principles, recovery and sleep).
- **Pricing and proof:** $29 a month standalone. No proof of any kind.
- This is the closest fitness match to trainsyou, and it is thin.

**Also seen:**
- **Kajabi "Expert Agents":** "AI teammates trained on your content … Working at 11pm on a Sunday night, while you're not."
- **KEEPON:** a hiring post says it is building AI twins of fitness creators. I could not open or verify the post. [A]

## 3. Creator monetisation sites

**Stan** (stan.store)
- The site is rendered by JavaScript, so I took the copy from its JS bundle. [O]
- **Hero:** "Your All-in-One Creator Store" / "Launch your link-in-bio store, sell products, book calls, and grow your audience all in one place."
- A fitness version exists: "The Easiest Way to Monetize Your Fitness Content".
- **Distinctive:** dozens of hero versions per referrer, for example "Ali's community gets 30 days of Creator Pro free. Claim this limited offer now." The CTA is "Claim 30 Days Free". The affiliate engine is built into the landing page.
- **Pricing:** $29 or $99 a month, from third-party listings only. [V]

**Kajabi**
- **Hero:** "All-in-one. Because six separate tools isn't a business plan."
- **CTA:** "Start Free Trial". The hero shows a screenshot of the course builder.
- **Proof:** named creators with totals, e.g. "Justin Welsh … $10M+ Earned on Kajabi", "$2M+" (nutritionist).
- **Pricing:** $179, $249 or $499 a month. No revenue share. "every plan has a 30-day money-back guarantee".
- Also offers a live workshop and a demo form.

**Passes**
- **Hero:** "Where Creators Come to Grow." / "You've already built something real. Now let's make it pay."
- **CTAs:** "Start monetizing today →" and "Become a creator".
- **Hero visual:** a creator carousel with a live-style alert, "1:1 Call Booked, $500.00".
- **Proof:** "10,000+" creators, "9 Figures" paid out. [V]
- **Pricing:** "Keep up to 90% of everything you earn". An earnings calculator (fans × price, shown as $9,000 a month, $108,000 a year). A comparison table against "Others".

## 4. What followers pay elsewhere (adjacent apps)

- **Future** (human coach app): "Personal training, reimagined"; "$50 first month, then $199/month" (about AED 731); "98% say they're more consistent within 4 weeks". [V]
- **Ladder** (coach-designed programs, no AI): $29.99 a month or $179.99 a year (about AED 110 a month). 7-day free trial with no card. Its own wording: "coach-designed and program-based — not algorithm-generated".

USD amounts are converted to AED at the 3.6725 peg.

## 5. Design and motion references

**Linear**
- **Hero:** "The product development system for teams and agents" / "Purpose-built for planning and building products. Designed for the AI era."
- **CTAs:** "Get started" and "Contact sales".
- **What to borrow:** product screens built as live HTML pieces (an issue list, a roadmap, an agent chat with "Working…" states), not screenshots. They read as the real product.
- **How they keep it fast:** I counted 150 `@keyframes` in the CSS. Every one animates opacity only (dot-grid "working" indicators), so it all runs off the main thread. The homepage has no `<video>` and no `<canvas>`, and has 32 lazy-loaded images. [O]

**Stripe**
- **Hero:** "Financial infrastructure to grow your revenue."
- **CTAs:** "Get started" and "Sign up with Google".
- **What to borrow:** proof made of hard numbers ($1.9T volume, 99.999% uptime, "50% of Fortune 100"), and bento cards that hold small product interfaces.
- **How they keep it fast** [O]:
  - The hero's largest image is a static WebP "wave-fallback", preloaded with `fetchpriority="high"` in responsive sources. The motion is layered on top afterwards.
  - Scroll-driven CSS (`animation-timeline`) sits inside `@supports`, so older browsers get a fallback.
  - Motion durations are CSS custom properties that drop to 0s under `prefers-reduced-motion`, with 170 such rules.
  - The one canvas is `aria-hidden`.
- **Their written rules:** animate only "cheap properties (transform and opacity)", keep durations under 500 ms, and stop the rAF loop when reduce-motion is on (Stripe design blog, 2017). [E]

**Vercel**
- **Hero:** "Agentic Infrastructure" / "Deploy now" and "Talk to sales". The hero is text only.
- **What to borrow:** proof given as customer-scale sentences, e.g. Zapier "over 100 million monthly website visits".
- **Motion:** 74 keyframes, 28 reduced-motion rules, and Tailwind `motion-reduce` variants on the charts. [O]

**Framer**
- **Hero:** "Framer is the pro website builder with a world-class design agent".
- **CTAs:** "Get started for free" and "Download app". There is a hero video (0:36).
- **What to borrow:** speed shown as a feature, with a Core Web Vitals mock (LCP 1.1s, INP 95ms, CLS 0.01). AI described as "Agents that work alongside you, not instead of you".
- **Caution:** 236 `will-change` uses, which web.dev advises against ("sparingly"). [O]

**Rive**
- **Hero:** "Build games, apps, and interactive UI".
- **What to borrow:** interactive state-machine animation in a single `.riv` file. A customer (CARS24) reports "~150KB to ~15KB" animation files. [V]
- **Cost:** it needs the Rive runtime and a canvas (34 canvases on their homepage). I did not measure the runtime's size.
- This fits one interactive hero object, such as a coach avatar or a "Trainer Brain" orb that reacts to the visitor. It does not fit whole pages.

**Arc / Dia**
- The arc.net homepage is now "A farewell to Arc … sunsetting on December 22, 2026".
- **Dia's hero:** "More than a browser. A better workday." with CTAs "Download Dia for free" and "Watch the trailer video".
- **What to borrow:** a warm voice, soft natural imagery (leaf shadows), and AI explained through verbs rather than the word "AI" ("just ask Dia", "reads between the tabs"). A full "Privacy first with you in control" section.

## 6. Where everyone sounds the same

1. **"#1":** 5 of the 9 fitness platforms use it (Trainerize, TrueCoach, Everfit, Exercise.com, FitBudd).
2. **"All-in-one":** Everfit, My PT Hub, Exercise.com, Kajabi and Stan.
3. **Saving the coach time:**
   - "Shave hours" (TrueCoach), "25+ hours per week" (Everfit), "in less time" (PT Distinction), "automate the tasks that drain your time" (My PT Hub).
   - **AI is always the coach's speed tool:** "50% less time" (Trainerize), "20 secs" (PT Distinction), "10x faster" (My PT Hub), "weeks … in minutes" (FitBudd).
   - **No fitness platform sells an AI that coaches the clients.** Every AI output goes back to the coach for approval.
4. **"Your branded app":** sold as a paid add-on ($75 to $169 setup, or $145 a month for white label, plus Apple's $99).
5. **Huge counts no one can check, some contradicting themselves:**
   - TrueCoach says 16K and 20K.
   - Trainerize's pricing page disagrees with itself in three places.
   - Everfit gives two trial lengths.
   - Playbook says both 29K+ and 30,000+ for the same creator.
6. **Trial terms are the same everywhere:** 14 to 30 days, no card.

## 7. White space trainsyou can own

1. **An AI that coaches followers in the trainer's own method, as the product followers pay for.** Fitness platforms only build AI for the coach. The "AI version of you" products are general knowledge chat with no workouts, logging or nutrition (Coachvox at $83 a month, Delphi at $5k a year). Twise is close but has no proof and little depth. This lines up with the owner's moat decision.
2. **Coaching followers can afford, priced in AED.** Human coaching apps cost about AED 731 a month (Future). Programs alone cost about AED 110 a month (Ladder). trainsyou can show a price ladder in AED, between a static plan and a human coach.
3. **Free to start, paid only when the trainer earns.** That is the creator-platform model (Playbook: $0 a month, keep 80%; Passes: keep 90%), but nobody uses it for an AI fitness coach. trainsyou is already "free to join" with commission, so the honest "aligned incentives" table can be its own. Compare against the subscription plus branded-app add-ons listed in section 6.
4. **Arabic and right-to-left, AED, the UAE.**
   - None of the 12 homepages I checked (all of the above except Stan, plus Coachvox, Kajabi and Passes) has an Arabic version: no hreflang alternates and no `dir="rtl"`. None mentions the UAE, Dubai, AED or Arabic in visible text. Everfit blocked the raw fetch, so it was checked only through its readable page text. [O]
   - Trainerize has an open request for right-to-left support (one post from 2023, one vote). [A]
   - Caveat: many UAE trainers work in English. The Arabic case is strongest on the follower side, so the site should present AR and EN as equals and not over-claim.
5. **Honesty used as proof.** Competitors' numbers contradict each other or have no source. "Every number on this site has a source" can carry the proof that trainsyou cannot fake: the /methodology page, labelled estimates, and a guarantee in place of testimonials.
6. **A "What your AI won't do" section.** Coachvox and Twise only hint at it. A fitness version could say: stays within your method, does not diagnose injuries, hands medical questions back to the trainer, does not train shared models on the trainer's data. The skill notes say a list of limits is persuasive when given a full section.
7. **Let visitors try the AI.** Delphi's in-page chat is the only "try the mind" demo. No fitness platform lets a visitor talk to a sample AI coach. A demo Trainer Brain on the home page would be unique in this category.

## 8. What the best converters have in common

1. **The hero names the outcome and shows the product or the result, not a problem** (Playbook, Stripe, Kajabi, Linear). Kahunas and Twise lead with a problem; the skill's pitch-page rule says this creates resistance. [E]
2. **One main CTA, repeated, with reassurance underneath:** "No credit card required / Cancel any time". Some put an email field in the hero (Trainerize, TrueCoach, My PT Hub).
3. **Proof that is named and specific** (Kajabi "$10M+ Earned", Playbook creator cards). trainsyou cannot fabricate this yet. Use the working product, sourced estimates and a guarantee instead (Kahunas: a founder guarantee; Kajabi: 30 days; TrueCoach: 90 days).
4. **Money tools the visitor controls:** the Passes calculator, Playbook's cost comparison. The skill's rule is that visitors enter their own numbers, the site supplies the ratio, and the result is deliberately understated. [E]
5. **Pricing as aligned incentives** (Playbook, Passes).
6. **Navigation by business type** (TrueCoach, FitBudd, Trainerize).
7. **Demos you can try** (Delphi chat, FitBudd's self-guided tour, Coachvox live sessions).
8. **New ways to be found:**
   - "Ask AI about us" buttons and pages written for AI systems (Trainerize, FitBudd).
   - Hero versions per referrer (Stan), useful for trainers referring other trainers.

**Outside evidence on these patterns:**
- **Attention stays near the top.** 57% of viewing time is above the fold and 74% within the first two screens (NN/g eye tracking, 120 participants, 130k fixations, 2018). Put the demo, the promise and the CTA in the first two screens. [M]
- **Avoid hero carousels that rotate on their own** (Everfit, Passes). NN/g: "carousels should show a new panel only when users ask for it". This is one user session plus expert reasoning. [A/E]
- **Speed matters.** 0.1 s faster mobile sites went with +8.4% retail conversion (Deloitte for Google, 37 brands, 30M sessions; correlation, not proven cause). Use a static image as the first thing that loads and add motion after, as Stripe does. [M]
- **Language matters.** 76% prefer buying when product information is in their own language, and 40% never buy from sites in another language (CSA Research 2020, 8,709 consumers in 29 countries; self-reported survey). [M]
- **Trials with no card bring more signups. Trials that ask for a card convert more of them.** Opt-out (card) trials convert 48.8% and opt-in trials 18.2% (First Page Sage, via a Userpilot summary). The source is weak, so use it for direction only. [V]
- **Benchmarks from the installed skill:** median landing page converts 6.6%, top quartile 11.4%+ (Unbounce, 41,000 pages). Conversion drops about 7% per second of load. A CTA written in the first person converts +90%. [M/V]

**Motion rules to carry over:**
- Animate only transform and opacity (web.dev; Stripe). [E]
- Use `will-change` sparingly.
- Use scroll-driven CSS inside `@supports`.
- Store durations as tokens so the pinned scroll scenes can still follow reduce-motion. This matches PROJECT_MEMORY: the short motion stays on for everyone; pinned scenes follow the device setting.
- At most one heavy object (Rive, WebGL or video) per page, `aria-hidden`, loaded after the static image.

## Sources

**Live pages fetched 26 Oct 2026** (what they say about themselves counts as [V]):
- https://www.trainerize.com/
- https://www.trainerize.com/pricing/
- https://resources.trainerize.com/ai-workout-builder
- https://truecoach.co/
- https://truecoach.co/pricing/
- https://everfit.io/
- https://everfit.io/pricing/
- https://kahunas.io/
- https://www.ptdistinction.com/
- https://www.ptdistinction.com/pricing
- https://www.mypthub.net/
- https://www.mypthub.net/pricing/
- https://www.mypthub.net/ai-personal-training-app/
- https://www.exercise.com/
- https://www.fitbudd.com/
- https://www.fitbudd.com/pricing
- https://www.playbookapp.io/
- https://coachvox.ai/
- https://www.delphi.co/
- https://www.delphi.co/pricing
- https://new.twise.ai/for/personal-trainer
- https://stan.store/ (copy taken from its JS bundle, `/js/index.71cbd839.js`)
- https://kajabi.com/
- https://kajabi.com/pricing
- https://passes.com/
- https://www.future.co/
- https://www.joinladder.com/
- https://www.joinladder.com/pricing
- https://linear.app/
- https://stripe.com/
- https://vercel.com/
- https://www.framer.com/
- https://rive.app/
- https://arc.net/
- https://www.diabrowser.com/

**Third-party and research sources:**
- Stan's prices, from third-party listings [V]: https://schoolmaker.com/blog/stan-store-pricing and https://findstack.com/products/stan-store/pricing
- KEEPON hiring post, not verified [A]: https://lavish-iguana-b36.notion.site/founding-senior-software-engineer
- Trainerize right-to-left request [A]: https://ideas.abcfitness.com/forums/167887-coach-trainer-abc-trainerize/suggestions/47245526-right-to-left-language-support
- NN/g, scrolling and attention [M]: https://www.nngroup.com/articles/scrolling-and-attention/
- NN/g, auto-forwarding carousels [A/E]: https://www.nngroup.com/articles/auto-forwarding/
- Milliseconds Make Millions [M]: https://web.dev/case-studies/milliseconds-make-millions
- CSA Research, Can't Read Won't Buy [M]: https://csa-research.com/More/Featured-Content/Global-Growth/CRWB-Series/CRWB-B2C and https://www.newswire.com/view/content/survey-of-8-709-consumers-in-29-countries-finds-that-76-prefer-21174283
- Trial conversion summary [V]: https://userpilot.com/blog/?p=1723
- Stripe, Connect front-end experience [E]: https://stripe.com/blog/connect-front-end-experience
- web.dev animations guide [E]: https://web.dev/articles/animations-guide
- Installed skill benchmarks: /root/.claude/skills/synced/c6c905b1-2437-445a-8e88-8e6b31312270_a057cd18-c03c-410b-9ddd-a8536b405e53/vertical-conversion-funnels/references/benchmarks.md and output-formats.md

Raw HTML and CSS I downloaded for the motion and language checks are in /tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/dl/