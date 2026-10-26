# trainsyou marketing site audit: content, brand, constraints, funnel and conversion weaknesses (26 Oct 2026)

**Sources.** Code on branch `claude/repository-overview-osejlw` at `3d6b9bd`. Production is release `f1fbf8e`, read with curl from https://trainsyou.com (no browser was used).

**Live platform flags** (`GET /api/v1/public/platform`):
- Registration is open.
- Turned on: `model`, `nutrition`, `voice`, `customDomains`, `whoop`.
- **Turned off: `payments`, `payouts`**, plus `zepp`, `instagram` and `frontier`.
- `assistant` (Kamran) is on. `supportEmail` and `companyDetails` are both null.
- Sign-up options: password only. Email codes, Google and Apple are all off.

**What this means:** trainers can sign up today but cannot take money yet. The words "frontier model" appear nowhere on the live site.

---

## 1. PAGE_INVENTORY

**How every page is built**
- All copy lives in `packages/contracts/src/marketing-content.ts`. Navigation, sitemap, JSON-LD and llms files are generated from the page list in `marketing.ts`.
- There are 38 live pages. Four specialties are hidden (combat, endurance, yoga, pilates; `marketing.ts:184-193`).
- `{APP_NAME}` becomes "trainsyou".
- The renderer is `apps/web/components/marketing/site.tsx`. The home page uses `Home()`; every other page uses `StandardPage()`.

**StandardPage order, top to bottom:**
1. Breadcrumbs.
2. Eyebrow, H1 and an availability chip (Included, Optional tier, Add-on or "Available soon").
3. The lede, or the intro if there is no lede.
4. Primary CTA, plus a secondary link: "Estimate what your followers are worth" → `/follower-calculator`. On `/follower-calculator` the secondary link is "Estimate my earnings".
5. A page-specific block (CustomBlock).
6. The page's sections.
7. "In short" (the intro), only on pages that have a lede.
8. FAQs, Related links and "Last updated".
9. The closing panel, on every page: Pace background, H2 "Your coaching. Beyond your hours.", the line "Guided setup. Nothing goes live until you publish.", the CTA, and "What are my followers worth?". On `/` and `/follower-calculator` that link is "See how it works" instead.

**How the primary CTA is chosen** (`site.tsx:82-87`, `frame.tsx` `claimCta`):
- A page with no CTA, or a CTA pointing to `/signup`, shows "Start coaching" → `/signup` (or "Join early access" → `/get-started#early-access` when registration is closed).
- If such a page has its own label and registration is open, its label shows instead.
- Any other page CTA is shown as written. **The header button uses the same CTA**, so it changes from page to page.

### Home `/`

- **Funnel job:** first understanding and the main sign-up entry.
- **Title:** "Free-to-join AI trainer platform for UAE coaches".
- **Eyebrow:** "FOR PERSONAL TRAINERS".
- **H1:** "Teach your AI. It trains your subscribers." The word "trains" has a Pace highlight that sweeps in at load.
- **Lede:** "Free to set up, nothing to pay upfront. Share your methods and rules; your AI coaches every subscriber day by day, your way."
- **Hero:** CTA "Start coaching" → `/signup`, the link "See how it works", and the micro line "Free to join · No upfront cost · Built for UAE trainers".

**Sections in order:**

1. **Hero relay** (`hero-flow.tsx`), a diagram labelled "Illustration with sample data", headed "How trainsyou works":
   - 01 You teach: Methods / Rules / Programmes, "Add 2.5 kg after two easy sessions."
   - 02 trainsyou learns: "Your coaching, applied to every day.", "Confident: applies your rule".
   - 03 Subscribers train: "Today · Lower body, 45 min", "Next week · Squat +2.5 kg", "Voice-led session · Add-on" (shown while voice is on; otherwise "Missed Tuesday · moved to Thursday").
   - A loop back: "Not sure? It asks you first. Pain and red flags always come to you."
2. **Journey band** (`journey.tsx` JourneyBand), headed "From setup to daily coaching":
   - It is **pinned and scroll-driven for 480svh (500svh on phones)**.
   - Eight chapters show a laptop and a phone mock-up with sample trainer "Layla Strength" (`layla-strength.trainsyou.com`).
   - Link: "See how it works".
   - It plays only for visitors without reduced motion, and not for bots.
3. **"What your subscribers get"** (white band): "A plan for every day, built your way, that adapts as they train."
   - Tiles: Daily plan ("Dated, built from your rules."), Guided workouts ("Cues, set logging and rest timers."), Progress they can see ("Sessions and best loads, in one place.").
   - A fourth tile is the first available of Nutrition ("Meal plans and a food diary, as an optional tier."; this one shows live), Chat or Sessions with you.
   - Link: "All features".
4. **"You stay in charge"** (paper band): "You choose what runs on its own. Take over any subscriber, any time."
   - ControlFlow card:
     - SUBSCRIBER: "Week three done. Squats felt easy."
     - YOUR AI: "Your rule: two easy sessions → add 2.5 kg", with a confidence meter at 86% and "Confidence above your threshold".
     - Lanes: "Applied automatically", "Unsure → to you", "Pain → paused, to you".
   - Links: "How your AI decides" → `/trainer-brain`, "Try the demo".
5. **"Free to start. Your price."** (white band):
   - "Joining, your coaching site and app, and teaching your AI are free. Nothing to pay upfront; your own domain is optional."
   - "You set the price in AED. We earn only when subscribers pay: our share starts at 25% and falls as you grow. Card processing is itemised."
   - Visual: the AddressPreview field "Your coaching name" (placeholder "e.g. Layla Strength"), which previews `your-name.trainsyou.com`, with the button "Claim this address" → `/signup?slug=`.
   - Commission pills under "Commission by paying subscriber": 25% · first 100, 20% · 101–300, 15% · 301–1,000, 10% · 1,001+. Note: "Each rate applies only to the subscribers in its band."
   - Link: "Pricing in detail".
6. **"What are your followers worth?"** (paper band): "The headline is a strong case for an engaged, growing audience, from published benchmarks and our stated assumptions. An estimate, not a promise."
   - Compact follower calculator. Inputs: followers (7,000), monthly price (AED 199), link Stories a month (8).
   - Live headline: "Up to 31 new paying subscribers in your first month", "Up to 116 active subscribers after 12 months, after 30% yearly cancellations, and still growing", "Up to AED 23,084 a month at your price, before platform commission", "Up to 143 sign-ups over 12 months".
   - The scenario table sits underneath.
   - Link: "Open the full calculator".
7. **"Questions trainers ask"**, six FAQs, all closed by default:
   - How does trainsyou work?
   - Will the AI replace me?
   - What happens when a subscriber reports pain?
   - Does it cost anything to join?
   - Do I need technical skills?
   - How do my Instagram followers become subscribers?
8. **Closing panel.**
9. **Kamran:** a round Pace microphone button, bottom right, labelled "Talk to Kamran (AI voice)". It appears on `/` only.

**Visible words:** 1,617 in `main` on live (including the journey and calculator). The written budget is 400 words, not counting the calculator.

### How it works `/how-it-works`

- **Funnel job:** explain the mechanism.
- **H1:** "Your method, from setup to daily coaching".
- **Lede:** "Teach it your method, test it, then publish. It coaches every subscriber day by day and hands you what it's unsure about."
- **CTA:** "Get started" → `/get-started`. The header button shows the same.

**Sections:**

1. **Steps** "From setup to daily coaching", rendered as the 8-chapter journey player:
   1. Claim your address: "Reserve your address in the six-step setup. Personalise your page and brand."
   2. Teach your Brain: "Confirm rules, answer the quiz and add client cases. Import documents after a private redaction review."
   3. Test it: "Start supervised with 8 quiz answers and 3 own cases. Automatic sending needs 20 cases and passing checks."
   4. Create your offer: "Set your price and billing. Add nutrition or voice when available."
   5. Publish and share: "Check the subscriber preview, launch, then share your tagged link in your bio and Stories."
   6. It coaches daily: "Each subscriber gets a dated plan. Replies wait for you unless you enable qualified automatic sending."
   7. You correct, it learns: "Review your Inbox. Corrections and subscriber outcomes teach the next tested release."
   8. Get paid monthly: "When enabled, subscribers pay in AED and payouts reach your UAE bank. Your statement itemises costs."
2. **Lanes table** "Who does what", with columns You / Your Trainer Brain / Your subscriber:

   | You | Your Trainer Brain | Your subscriber |
   |---|---|---|
   | Teach rules, cases and limits | Builds a dated plan from each subscriber's input | Tells you their goal, schedule, experience and equipment |
   | Choose what runs automatically | Applies confident changes and records why | Trains day by day and logs sets |
   | Review what is handed to you | Hands over anything below your confidence threshold | Asks questions and reports pain in one tap |
   | Set price, length and billing | Sends safety issues to you and pauses the workout | Pays monthly or upfront in AED |

3. **"Control stays visible":** "Inspect every rule and its source, roll back a release, take over any conversation or write programmes yourself. Subscribers always see when guidance is digital."
4. **FAQs:** How long does setup take? / What does the Brain do when it is not sure? / Is the AI trained on my data? / Pain.

### Trainer Brain `/trainer-brain`

- **Funnel job:** prove the moat (the AI is built from the trainer's own judgment).
- **H1:** "An AI trainer built from your judgment".
- **Lede:** "Your rules, cases and corrections in one private AI. It acts alone only when confident and asks you when it isn't."
- **CTA:** "Start teaching your Brain" → `/signup`.

**Sections:**

- **What it is:** "A bespoke AI trainer built from your rules, cases and corrections, not a generic workout generator. Every change traces back to something you taught, and every version can be rolled back."
- **What you teach it:**
  - a guided interview
  - plain-language rules you confirm, edit or reject, each with its source
  - coaching cases and worked examples
  - your own documents, after you review the extracted text
  - a practice quiz and client cases; 20 cases for automatic sending
- **How it decides:** three cards.
  - Confident → Applied automatically.
  - Not sure → Handed to you; "your correction becomes teaching".
  - Safety → Always to you; "Pain, medical issues and red flags pause the workout and alert you. Enforced in code, outside the AI."
- **How it learns:**
  - approvals and corrections become teaching
  - subscriber outcomes inform later plans
  - evaluated against your scenarios before release
  - every release is versioned and can be rolled back
  - When the frontier flag is on, a bullet is added: "A frontier model plus your corrections: it keeps getting better with time."
- **What it never does:** hide pain or red flags; pretend to be you (it is a labelled digital coach); give medical advice; use your teaching elsewhere.
- **You stay in control:** five bullets.
- **FAQs:** Is the AI trained on my data? / Will the AI replace me? / Can another trainer see or use my Brain? / What if the Brain gets something wrong?

### Features index `/features`

- **H1:** "Everything you need, under your own name".
- **Lede:** "Your AI, a branded app and website, nutrition, bookings, payments and safety rules, in one workspace."
- **CTA:** Start coaching.

**Blocks in order:**

1. **IncludedStrip** "Everything included in trainsyou": **91** capabilities and **7** separate tools it replaces.
2. **"Four parts of one platform":**
   - The Brain: teaching, evaluation, releases, confident automation and handoffs, learning from corrections.
   - Subscriber experience: plans, guided workouts, nutrition, voice, chat, bookings, progress.
   - Your business: website, address, offers, billing, promotions, statements, payouts, team roles.
   - Trust: safety in code, AI disclosure, privacy, isolation, security.
3. **"What your subscribers get"**, eight cards:
   - A plan every day
   - Guided workouts ("keeps working offline in the gym")
   - Adapts as they train
   - Your voice, optionally
   - Nutrition, optionally
   - You, when it matters (chat, labelled digital coach, paid one-to-one sessions)
   - Progress they can see
   - Your brand throughout
4. **ProductScreens "Inside the product"**, five drawn screens with sample data:
   - **Inbox:** "Hotel gym for two weeks: Draft plan with dumbbells to 20 kg. Approve / Correct"; "My knee hurts when I squat: Workout paused"; "Squat 60 → 62.5 kg: Your rule: two easy sessions at 3+ reps in reserve".
   - **Today:** Week 3 · Day 2 · Lower body A. Back squat 4×6 · 62.5 kg · 120 s; Romanian deadlift 3×8 · 50 kg; Walking lunge 3×10; Plank 3×40 s; button "Start guided session".
   - **Logger:** Back squat · set 3 of 4, 62.5 kg, 6 reps, RIR 3, rest 1:24, "Saved offline · syncs when you reconnect".
   - **Monthly statement:** 150 subscribers at AED 199.
   - **Website editor:** Home · Coaching · Results · Contact; Hero · Programmes · Video · Before and after; Preview and Publish.
5. **Feature guides:** 12 tiles with chips. Live, three show "Available soon": Bookings, Progress and Client Twin, Payments and payouts.
6. **"The 7 tools it replaces":**

   | Instead of | In trainsyou |
   |---|---|
   | A website builder | Desktop drag-and-drop builder |
   | A booking tool | Session slots, paid bookings |
   | A payment set-up and invoicing | AED checkout, trials, refunds, statements, payouts |
   | A client training app | Branded app |
   | A meal-planning app | Nutrition tier |
   | A client messaging app | Chat, labelled digital coach |
   | Programme spreadsheets | Templates, exercise library, scheduling |

7. **FeatureMatrix**, 91 capabilities in 10 groups:
   - Your Trainer Brain 10
   - Plans and workouts 12
   - Nutrition tier 10
   - Voice add-on 4
   - Chat, progress and data 10
   - Bookings 5
   - Your brand, website and app 15
   - Offers, payments and payouts 10
   - Growth 6
   - Safety, privacy and team 9
   - The live page shows 21 "Available soon" chips.
8. **FAQs (2):** Are all features available today? / Is the subscriber app a separate download?

### Feature detail template (12 pages) `/features/*`

**Layout:** eyebrow "FEATURE · X", H1, chip, intro (no lede), CTA "Start coaching". Sections: "What it does" (bullets), "What your subscriber sees", "What you control", then one how-it-runs steps or table section, then FAQ. **There are no product images on these pages.**

**H1, offering and live chip for each page:**

| Page | H1 | Offering | Live chip |
|---|---|---|---|
| ai-training-plans | "A personalised plan for every subscriber, built and adapted by your Brain" | Included | Included |
| subscriber-app | "A day-by-day training app with your name on it" | Included | Included |
| website-and-domain | "Build your coaching website your way" | Included | Included |
| nutrition | "Nutrition coaching that follows your guidance" | Optional tier | Optional tier |
| voice-coach | "Your voice, running the session" | Add-on | Add-on |
| bookings | "Sell one-to-one sessions alongside your AI coaching" | Included | **Available soon** |
| chat-and-digital-coach | "Stay close to every subscriber without answering every message" | Included | Included |
| progress-and-client-twin | "Every subscriber's progress and context in one view" | Included | **Available soon**, only because Zepp is off |
| payments-and-payouts | "Get paid in AED, every month, to your UAE bank" | Included | **Available soon** |
| safety | "Safety rules the AI cannot override" | Included | Included |
| team | "Bring your team" | Included | Included |

**Facts builders can reuse from these pages:**
- 282 website layouts in 40 section families; AI starter sites; before-and-after galleries; autosave, undo and redo; publication history.
- The website editor is desktop only.
- The member app installs from the browser (no app store download), works offline, and has English and Arabic RTL member controls.
- Nutrition is a separate, higher-priced tier: weekly meal plans, recipe swaps, grocery list, food diary, meal-photo estimates, barcode lookup, weekly check-ins, exceptions queue. It cannot be bought on its own.
- Voice is a monthly add-on priced by the trainer. It uses the trainer's verified, consented voice, only for that trainer's own subscribers, with an own-music mode, and consent can be withdrawn.
- Bookings: one-off or weekly slots, capacity, card payment in AED, automatic refunds within the trainer's cancellation window, reminders, attendance and no-shows, calendar file export. Booking fees are separate from the commission bands.
- Chat: photo and PDF attachments, scheduled check-ins, takeover pauses the digital coach.
- Client Twin: intake, preferences, training history and shared wearable data, each with date and source. Unknowns are marked "unknown". Apple Health export import works today; WHOOP and Zepp connect when enabled.
- Payments: Stripe checkout in AED, monthly or upfront billing, trials, promotion codes, refunds the trainer approves, statements, ledger CSV, monthly payout to a verified UAE IBAN, a short hold after a bank change.
- Safety:
  - A pain button in every workout.
  - Worrying chat or intake messages trigger an automatic pause.
  - Unreviewed holds escalate.
  - Trainers can add red flags but cannot remove the floor.
- Team roles: Owner, Staff coach (no finance, design or ownership access), Finance (no coaching data).

### Demo `/demo`

- **H1:** "See your Brain make a coaching decision". No lede.
- **Intro:** "...These examples are fictional and scripted; no AI model is called."
- **CTA:** "Build my Brain" → `/signup`.
- **Section "Four decisions"**, shown as tabs (DemoScenarios). These are text cards, not product UI:
  1. "Week three done and the squats felt easy." → the 2.5 kg rule moves next Monday's squat from 60 to 62.5 kg (Applied automatically).
  2. "I missed yesterday. Should I do two sessions today?" → moved to Thursday, Friday becomes rest (Rescheduled automatically).
  3. "I'm travelling for two weeks with only a hotel gym." → Handed to the trainer.
  4. "My knee hurts when I squat today." → Workout paused.
- **FAQs (4).**

### Security and privacy `/security-and-privacy`

- **H1:** "How we protect your business and your subscribers' data".
- **CTA:** "Read the AI disclosure" → `/ai-disclosure`. **The header button shows the same.**
- **Sections:**
  - sign-in: authenticator apps, passkeys, recovery codes, list of devices
  - database-level workspace isolation
  - provider keys encrypted at rest, audit logs, HTTPS
  - consent, export and deletion
  - AI disclosure
  - operators and audit
  - payments: Stripe holds card data; payouts only to a verified UAE IBAN
- **FAQs (5).**

### For trainers hub `/for-trainers` and specialty template

**Hub:** H1 "Your specialty, taught to your own Trainer Brain", with tiles for the 4 specialties.

**Specialty pages:**
- **H1 pattern:** "For {weight-loss | strength | muscle-gain | pre and postnatal} coaches: your method, affordable for every follower" (11–13 words, with a colon).
- **CTA:** "Start teaching your Brain" → `/signup`.
- **Example prices:** AED 199 weight loss, 249 strength, 229 muscle gain, 249 pre/postnatal.

**Sections:**

1. **Three illustrative rules.** Strength examples:
   - "After two sessions with all sets completed at three or more reps in reserve, add 2.5 kg."
   - "When a beginner reports form doubts, repeat the load and add a technique cue."
   - "After three weeks of rising effort at the same load, schedule a deload week at 60% volume."
2. **"Always paused and sent to you, enforced in code"**: pain, pregnancy, chest pain, dizziness, fainting, bleeding, plus specialty-specific items.
3. **Optional review topics.**
4. **Programme outline table.** Strength: Weeks 1-3 technique, 4-9 progressive overload, week 10 deload.
5. **"What your followers could be worth"**, with the compact follower calculator at the example price.

**FAQs:** 2–3 per page.

### UAE `/uae`

- **H1:** "For personal trainers in the UAE: take your coaching online". CTA: Start coaching.
- **Directly under the hero sits the DirectoryBlock** "Looking for a coach in the UAE? Browse the directory". That directory is empty on live.

**Sections:**

1. **Instagram** (DataReportal 2025): 11.1M internet users (99.0%), 7.60M Instagram users (67.8%), median age 31.6.
2. **Built for the UAE:** AED, UAE IBAN, English and Arabic RTL, in-person bookings, UAE time zone.
3. **Dubai:** Fitness Challenge 2024 participation of 2.73M, and a price table:

   | Service | Published range | Source |
   |---|---|---|
   | One-to-one session | AED 70–350 | Hey Trainer 2026 |
   | One-to-one session | AED 200–700+ | Embody 2025 |
   | Online coaching per month | AED 400–2,000 | 369MMAFIT 2026 |
   | Hybrid, per month | AED 1,500–3,000 | 369MMAFIT 2026 |

4. **Abu Dhabi:** 60.3% of residents meet WHO activity standards, up from 53.6% (about 31,000 responses).
5. **Northern emirates.**
6. **Licensing:** "check your licence".
7. **"Online and in person, one brand".**

**FAQs (5).**

### Get started `/get-started`

- **H1:** "Start your coaching business in trainsyou".
- **Lede:** "Free to join. Six steps, about 15 minutes for a starter setup. Save your progress and continue later. Add bank details at your first payout."
- **CTA:** Start coaching.
- **Page block:** while registration is open, "Claim your coaching address" with AddressPreview. While closed, the "Join early access" form appears instead.

**Sections:**

- **What you need:** identity and business description; your method and limits; an offer (who it's for, AED price, length, billing); a UAE bank account at first payout; photos or logo.
- **Six steps:**

  | Step | Time | What happens |
  |---|---|---|
  | Create account | 1 min | |
  | About you | 3 min | |
  | Your page | 2 min | address, name, colours, starter page |
  | Teach your Brain | 6 min | confirm 8 quiz answers and write 3 client cases; replies wait for your approval |
  | Your plan | 1 min | offer and price |
  | Go live | 2 min | preview, publish when launch checks pass |

- **After launch.**
- **What happens at launch:** "Subscribers join and pay in AED when payments and launch are enabled".
- **How long it takes:** 8 quiz answers and 3 cases for supervised replies; automatic sending needs 20 cases.
- **FAQs (6):** bring existing clients (invite link), no coding, preview before publishing, no minimum followers, can start before a trade licence, own domain not needed.

### Guides hub `/guides` and the guide template

- **Hub H1:** "Guides for trainers taking their coaching online".
- **The four guides:**
  - "How to price online coaching in the UAE"
  - "Turning Instagram followers into paying clients"
  - "The UAE advertiser permit: what trainers promoting their own coaching should know"
  - "How to write coaching rules your AI can follow"
- **Template:** sections and tables, FAQ, default CTA.

**Example: pricing guide**
- Sections: published ranges table; "Why a subscription is priced differently from a session"; "Set your price in six steps"; worked examples; upfront example; tiers and add-ons; position your AI coaching; commission and costs; common mistakes; 4 FAQs.
- Worked examples:

  | Subscribers × price | Subscriptions | Commission | Before other costs | Sessions at AED 250 |
  |---|---|---|---|---|
  | 40 × AED 149 | AED 5,960 | AED 1,490 (25%) | AED 4,470 | ~18 |
  | 120 × AED 199 | AED 23,880 | AED 5,771 (24.17% overall) | AED 18,109 | ~72 |
  | 350 × AED 249 | AED 87,150 | AED 18,053 (20.71% overall) | AED 69,098 | ~276 |

- Upfront example: a 3-month programme at AED 540 upfront is AED 180 a month equivalent. 60 subscribers give AED 10,800 a month, commission AED 2,700, leaving AED 8,100.
- Tier example: 30 of 100 subscribers at AED 299 and 70 at AED 199 average AED 229, totalling AED 22,900, with commission AED 5,725.

### Pricing `/pricing`

- **H1:** "Your price, our transparent share".
- **Lede:** "Free to join, nothing to pay upfront. You set your price in AED; our commission starts at 25% and falls as you grow."
- **CTA:** **"Estimate my earnings"** → `/earnings-calculator`. **The header button shows the same.**

**Blocks in order:**

1. **WorkedExample:** 150 subscribers at AED 199 make AED 29,850. Commission is AED 4,975 (25% on the first 100) plus AED 1,990 (20% on the next 50), so AED 6,965 in total. That leaves AED 22,885 before payment processing, about 92 sessions at AED 250.
2. **Compact EarningsCalculator.**
3. **How you earn.**
4. **"An hour sells only once":** "Published Dubai price guides put one-to-one sessions at roughly AED 70-350... Online coaching guides quote AED 400-2,000 a month." Followed by three cited price-anchor cards.
5. **Marginal bands table:**

   | Paying subscriber positions | Rate in that band |
   |---|---|
   | 1–100 | 25% |
   | 101–300 | 20% |
   | 301–1,000 | 15% |
   | Above 1,000 | 10% |

   Note: "Reaching a new band lowers the rate for subscribers in that band only."
6. **Statement extras:** payment processing (no rate stated), own domain, refunds, disputes, booking fee.
7. **Programme length and billing.**
8. **Monthly payouts to a UAE bank.**
9. **FAQs (4):** join cost / who sets price / what will I pay / commission with different prices.

### Earnings calculator `/earnings-calculator`

- **H1:** "What could your coaching earn each month?". CTA: Start coaching.
- **Inputs and defaults:**

  | Input | Default |
  |---|---|
  | Paying subscribers | 60 |
  | Billing | Monthly (or Upfront) |
  | Workout price | AED 199 |
  | Programme length (upfront only) | 3 months |
  | Subscribers on workout + nutrition | 30% |
  | Nutrition price | AED 299 |
  | Subscribers adding voice | 0% |
  | Voice add-on per month | AED 49 |
  | Paid one-to-one sessions each month | 0 |
  | Price per session | AED 250 |
  | Your usual in-person rate | AED 250 |

- **Result at defaults:** average AED 229, subscriptions AED 13,740, commission AED 3,435 (25%), AED 10,305 before other costs, about 41 sessions at AED 250. Labelled "ILLUSTRATIVE ARITHMETIC".
- **Sections:** assumptions (excludes processing, domain, refunds, disputes, tax); how to use it (4 steps); worked example (120 × AED 199 → AED 18,109); 3 FAQs.

### Follower calculator `/follower-calculator`

- **H1:** "How many of your followers could become paying subscribers?".
- **CTA:** "Claim your link" → `/signup`. Inside the result, an AddressPreview with "Claim this address".
- **Inputs and defaults:**

  | Input | Default |
  |---|---|
  | Followers | 7,000 |
  | Price | AED 199 |
  | Link Stories a month | 8 |
  | Reels or posts with a call to action a month | 4 |
  | Comment-keyword DM | on |
  | Yearly cancellations | 30% |
  | Optional: profile visits, broadcast members, links a month (4), average Story views, engagement rate | blank |

- **Results at defaults:**

  | Scenario | First month | Active at 12 months | Sign-ups over 12 months | AED a month at month 12 |
  |---|---|---|---|---|
  | Cautious | under 1 | 2 | 2 | 398 |
  | Typical | 3 | 15 | 18 | 2,985 |
  | Strong (the headline) | 31 | 116 | 143 | 23,084 |

- **Sections:** an 8-step method; "Why the headline shows the strong case"; "What moves your number" (7 levers); 4 FAQs. Sources are cited throughout.

### FAQ `/faq`

- **H1:** "Questions trainers ask before they start". No sections.
- 14 FAQs, covering among others: "Will my followers pay?" ("Some will..."), "Does it work offline?", "What can I connect?" ("Apple Health exports today. WHOOP, Zepp, your own domain, the voice add-on and Instagram show 'Available soon'..."; this FAQ is stale, since WHOOP, voice and domains are now on), and the advertiser permit.
- **CTA:** "Get started" → `/get-started`. The header shows the same.

### About `/about`

- **H1:** "About trainsyou".
- **Lede:** "We help personal trainers coach more people with an AI they teach, under their own name."
- **CTA:** "Get started" → `/get-started`.
- **Sections:**
  - Mission: "Make personal training affordable to more people by scaling real trainers' judgment, not by replacing them with a generic app."
  - What we build.
  - What we are and are not.
  - Who it is for.
  - How we make money.
  - **How we talk about results:** "We publish no testimonials, logos, ratings or customer counts we cannot show."
  - Where we work.
  - Company and contact. **On live this reads "Company details have not been published yet." and "A public support email has not been published yet."**
- **FAQs (4).**

### Methodology `/methodology`

- **H1:** "Methodology and sources".
- **CTA:** "Back to the follower calculator" (also in the header).
- **Content:** principles; follower formula (7 steps with formulas); earnings method; a table of 33 sources with an evidence label for each.

### Legal: `/privacy`, `/terms`, `/ai-disclosure`

Published documents rendered by the workspace. Only the H1 comes from the registry.

### Coach directory `/coaches`

- **Text:** "FIND A COACH / Coaches who chose to be found." Filters for name or focus, 13 specialties and 21 languages.
- **Live empty state:** "No coaches are listed yet."
- **Linked from:** the footer, `/uae` and website-and-domain.

### Sign-up `/signup`

- **Story panel:** eyebrow "YOUR KNOWLEDGE. YOUR NEXT CHAPTER."; H1 "You've built the experience. Now build the business."; "Your judgment is the part that matters. Give it a place to grow."
- **Card:** H2 "Start coaching", with "About 15 minutes to your own page. Stop and come back any time."
- **Live form:** Your name, Email address, Password (at least 12 characters), a legal acceptance checkbox, then the button "Start my setup". A `?slug=` hint from the address preview is carried through.

### Sign-in `/login`

H1 "Sign in".

### The owner's HTML home (25 Oct, reverted 26 Oct)

**What it had:**
- Eyebrow "For personal trainers · Built for the UAE"; the same H1, with "It trains your subscribers." marked.
- One CTA repeated everywhere: **"Teach your AI — free"**. Micro line: "No upfront cost · Built for UAE trainers".
- Risk reversal: "Free to set up. No subscription fee. Nothing goes live until you publish."
- A "Your AI today: 4 decisions from your rules" sample feed with Replay.
- Stat strip: "0 AED to join", "91 capabilities", "7 tools replaced", "25→10 % commission".
- Section headings: "You teach. It learns. They train." / "Stop paying for 7 separate tools." / "Four parts. One platform." / "See what you could keep." (with an earnings slider and the button "Start free at this price", which passed `price_aed` to sign-up) / "It coaches. You decide." / "Free to start. Our share falls as you grow." / "Whatever you coach." / "Ready to teach your AI?"
- A sticky phone CTA bar, UTM/gclid/fbclid parameters carried to every sign-up link, `dataLayer` events, GSAP scroll-driven 3D and magnetic buttons.
- About 1,600 words and 8 FAQs.

**Where to read it:** `git show af457bd:apps/web/components/marketing/home-design.tsx`, and `docs/HOME_DESIGN_2026-10-25.md:117-134`.

---

## 2. BRAND

**Colours** (`apps/web/app/globals.css:10-18`, `packages/contracts/src/brand.ts:31-42`):
- White `#FFFFFF`, Ink `#171917`, Paper `#F3F4F0`, Muted `#616660`, Line `#D9DDD5`.
- **Pace `#D5F24A`**: a background accent behind ink text only, never text on any surface. A test enforces this (`docs/features/brand.md:168-172`).
- Success `#226044`, Warning `#805400`, Error `#AD3535`. `--green-hover` is `#343834`.
- Contrast: ink on white 17.68:1, ink on Pace 14:1, muted on white 5.87:1, muted on paper 5.31:1.
- Marketing pages are always light: white canvas, paper bands, **no ink bands** (`brand.md:173-174`).

**Fonts:**
- Inter variable (latin and latin-ext), self-hosted in `app/fonts`, with an Arial fallback.
- Inter Display Medium 500 for display text. Root font size is 14px.

**Type scale** (`marketing.css`):

| Element | Size | Other |
|---|---|---|
| Hero H1 | clamp(40px, 4.6vw, 64px) | line-height 1.04, letter-spacing -0.045em, weight 540 |
| Page H1 | clamp(34px, 4vw, 52px) | letter-spacing -0.045em |
| Section H2 | clamp(24px, 2.6vw, 34px) | letter-spacing -0.04em |
| Closing H2 | clamp(28px, 3.6vw, 46px) | |
| Lede | 18px | line-height 1.55, muted |
| Eyebrow | 11px | uppercase, letter-spacing 0.08em |
| CTA | 15px | semibold |

**Spacing and layout:**
- Spacing scale `--ty-space`: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Radius: 6px for controls, 8px for panels.
- Container: maximum 1280px plus a gutter of 48px, 24px at 1150px and below, 16px at 760px and below.
- Shadow: `0 1px 2px rgb(23 25 23/6%), 0 12px 32px rgb(23 25 23/6%)`.

**Motion tokens** (`marketing.css:20-50`):
- Durations: press 80ms, fast 140, base 200, slow 280, emphasis 420.
- Easing:
  - out `cubic-bezier(.2,0,0,1)`
  - in `(.4,0,1,1)`
  - in-out `(.4,0,.2,1)`
  - spring `(.34,1.4,.64,1)`, for success states only
  - enter `(.2,.8,.2,1)`
- Distances: nudge 3px, item 8, rise 12, load 16. Staggers: 40ms and 80ms.
- Only transform, opacity, SVG stroke-dashoffset and a disclosure's grid rows may animate.

**Buttons:** primary is `button mk-cta` (Pace fill, ink text, 1px ink border; hover mixes in 15% ink; pressed scale 0.97). Secondary is an ink text link with an arrow that nudges on hover.

**Logo** (`brand-logo.tsx`; `brand.md:72-79`):
- The trainsyou lockup SVG (viewBox 505×128): a two-stroke "Y"-like symbol plus the lowercase wordmark, ink on light.
- Displayed at 41px high, about 162px wide. The digital minimum is 160px.
- Never mirrored in RTL.
- Assets in `public/brand/`: lockup, wordmark and symbol in ink and white; favicon; app icons (mark on a Pace square); share card 1200×630.
- A renamed platform shows its initials and name instead of the logo.

**Fixed copy** (`brand.ts:13-28`):
- Brand line: "Your coaching. Beyond your hours."
- Descriptor: "Trainer-led AI coaching platform". Audience: "For personal trainers".
- `primaryAction`: "Teach your AI" (not used on the live site). `secondaryAction`: "Explore the platform".
- Home H1: "Teach your AI. It trains your subscribers."
- `ENTITY_SENTENCE` (`marketing.ts:347`).
- `NOT_STATEMENTS`: not a generic workout generator, not a medical service, not a replacement for the trainer.

**Voice rules** (`docs/features/marketing-site.md:658-677`):
- Second person, active voice, UAE/UK spelling.
- Limits: H1 8 words or fewer with no colon subtitle; eyebrow 4 or fewer; lede 25 or fewer; intro 35–65; H2 6 or fewer; sentences 20 words or fewer; card body 18 or fewer; bullets 12 words, 5 per list; FAQ answers 45 or fewer.
- Banned words: seamless, revolutionary, cutting-edge, unlock, empower, game-changing.
- Honesty tests ban "trusted by", "as seen in", "#1", "guaranteed", "passive income", invented proof, and naming the domain registrar or payout provider (`marketing-site.md:346-361`).
- Talk about AI only as "your AI" or "Trainer Brain". Digital guidance is always labelled.

---

## 3. CONSTRAINTS AND OWNER PREFERENCES

1. **AI training is the moat; one-to-one sessions are secondary.**
   - "our moat is the AI training, not personal one on one training" (`docs/PROJECT_MEMORY.md:37`).
   - "Bookings and 1:1 sessions stay available but secondary. Never make a session countdown the headline." (`:39`)
2. **Multipage only.** "the HTML design should be taken off. our previous marketing design is multipage one. let's get that back" (`PROJECT_MEMORY.md:32`; `HOME_DESIGN_2026-10-25.md:3`).
   - `PROJECT_MEMORY.md:33-36` is **stale**: it still describes the reverted `home-design.tsx` files as live, and "no social proof" as a rule of that design.
3. **Motion always on.** "accept the speed cost for now. we can always switch it back to motion matching the device" (`PROJECT_MEMORY.md:28`; switch at `motion-mode.ts:34`).
   - Rules: "New motion must be short, play once, and run off its own visibility trigger"; "Keep the marketing widgets and the trainer sign-up path as they are" (`PROJECT_MEMORY.md:30-31`).
   - House rules (`docs/features/marketing-motion.md:13-27`): every word is real HTML and visible from the first paint; no count-ups, metrics or testimonials; always light.
   - Pinned scroll scenes still follow reduced motion.
   - The owner overrode these rules once, for the GSAP 3D HTML home (`HOME_DESIGN:12`).
4. **"Frontier model" wording.**
   - "Public AI copy says frontier model" (`PROJECT_MEMORY.md:22`).
   - It is gated: "Public copy must not claim active frontier use until an operator has actually qualified and enabled it" (`docs/MARKETING_REFRESH_2026-10-03.md:40`). The live `frontier` flag is off.
   - A test forbids any model or vendor name (`marketing-site.md:1361-1384`).
5. **Free to join is the lead hook** (`PROJECT_MEMORY.md:25`): trainers pay nothing to join, set up or teach the AI. Commission and card fees come out of subscription revenue; the own domain is the only optional purchase.
6. **No AI-cost talk.** "Let's not talk about AI costs. It's integrated." (`marketing-site.md:13-14`; test-enforced)
7. **Honesty.**
   - "We publish no testimonials, logos, ratings or customer counts we cannot show." (`/about` registry)
   - Estimates are labelled; every market figure is cited on `/methodology`.
   - **Follower calculator:** "the strong case is always the headline, labelled a best case... with the cautious and typical scenarios shown" (`docs/COMPLETION_STAGES.md:779`, owner-approved).
8. **Visual identity.**
   - "Use a clean, minimal white interface, consistent buttons, spacing and navigation" (`PROJECT_MEMORY.md:20`).
   - "Hero trains highlight had to be there" (`marketing.css:2460`).
   - "The walkthrough is always shown" (owner, 30 Sept; `journey.tsx:37`).
9. **Hidden specialties:** combat, endurance, yoga and pilates stay hidden (`marketing.ts:184-193`).
10. **Process:** deployment is stopped and separately assigned; never use a cloud browser (`CLAUDE.md:9`).
11. **Marketing pages stay English.** Arabic marketing pages wait for human translation (`marketing-site.md` "Not done").

---

## 4. FUNNEL AND MEASUREMENT

**Primary conversion:** a trainer account created at `/signup`. It is recorded as the acquisition event `signup` with an owner membership (`apps/api/src/acquisition.ts:428-474`).

**The business conversion further down:** setup wizard → publish → first paying subscriber. **The last step is blocked in production while `payments` and `payouts` are off.**

**Steps:**
1. **Entry:** organic, Instagram, or Kamran (home only).
2. **Primary action:** "Start coaching" in the header, hero or closing panel, or a page-specific label.
3. **Optional address step:** the AddressPreview on the home economics band, `/get-started` or `/follower-calculator` carries `?slug=` to sign-up.
4. **`/signup`:** name, email, password (12+ characters), legal checkbox, "Start my setup".
5. **Setup wizard**, six steps, about 15 minutes: account, about you, page, teach Brain (8 quiz answers and 3 cases), plan, go live.
6. **Publish**, then share tagged links.

**Detours away from sign-up:**
- `/how-it-works`, `/faq` and `/about` → `/get-started`, which adds one extra page.
- `/pricing` → `/earnings-calculator`.
- `/security-and-privacy` → `/ai-disclosure`.
- `/methodology` → `/follower-calculator`.

**Early access** (used only while registration is closed):
- Fields: Your name, Email, Instagram handle (optional), Instagram followers (optional, prefilled from the calculator), Main specialty (optional), Where you coach (emirate or outside the UAE, optional), a consent checkbox, and a hidden honeypot field.
- No confirmation email is sent, because no email provider is configured.

**Analytics** (`apps/web/components/acquisition.tsx`, `apps/api/src/acquisition.ts`):
- Nothing is recorded before consent. On marketing pages the slim consent bar appears only after the visitor scrolls 40px. "Analytics preferences" sits in the footer.
- **With consent:**
  - one first-party `acquisition/visit` per public page, with `utm_source`, `utm_medium`, `utm_campaign` and `ref`
  - first and last touch stored for 90 days
  - sign-up attributed to the first touch
  - an A/B copy slot `landing-welcome` on `/`, shown as a notice with an exposure event (needs admin-configured variants)
  - trainers see "consented visitor sources"
- **Not found anywhere:**
  - events for CTA clicks, calculator use, scroll depth, FAQ opens, Kamran call starts or form starts
  - a tag manager
  - UTM parameters carried into `/signup` links (the reverted HTML home did this)
  - the calculator price carried into sign-up

---

## 5. CRO_WEAKNESSES

The external evidence these points cite is listed, with how much weight each source carries, at the end of this section.

### Sitewide

1. **The header CTA stops being a sign-up button on several pages.** Checked live:
   - `/pricing` header shows "Estimate my earnings".
   - `/security-and-privacy` shows "Read the AI disclosure".
   - `/methodology` shows "Back to the follower calculator".
   - `/how-it-works`, `/faq` and `/about` show "Get started", which leads to an intermediate page.
   - Fix: the sticky header should always carry the one sign-up action, with the page action as a secondary.
2. **The same action has eight different labels:** "Start coaching", "Start teaching your Brain", "Build my Brain", "Claim your link", "Claim this address", "Get started", "Join early access", "Start my setup".
   - None of them says "free".
   - `BRAND_COPY.primaryAction` "Teach your AI" is unused. The owner's HTML used "Teach your AI — free".
   - Skill benchmark: first-person CTA +90% [B].
3. **No product appears in the hero.** The home hero shows a schematic three-card diagram ("Illustration with sample data").
   - The realistic screens (Inbox approve/correct, Today, Logger, Statement, Editor) exist in `showcase.tsx`, but only on `/features`, below the fold.
   - Feature detail pages have no screens at all.
   - Skill pitch-page rule: "the hero must BE the product".
4. **A five-screen scroll trap right after the home hero.** The journey band pins for 480svh (500svh on phones) and plays a dense laptop-and-phone animation full of tiny labels before the value bands begin.
   - NN/g: 57% of viewing time is above the fold and 74% in the first two screens.
   - Scrolljacking is a recognised usability risk.
   - The visible word count reaches 1,617, against a 400-word budget.
5. **The money pitch runs ahead of what is live.** Payments and payouts are off in production.
   - Yet the home page, pricing, both calculators and the specialty pages headline AED earnings.
   - Trainers who sign up today cannot charge subscribers.
   - The site never states plainly what is live today and what comes next, and offers no "founding trainer" framing. The only signals are scattered amber "Available soon" chips: 21 on `/features`.
6. **Chip logic wrongly labels a core feature.** Progress and Client Twin shows "Available soon" because Zepp alone is off (the chip uses `some(!available)`). Its own FAQ says progress works today.
   - The `/faq` answer "What can I connect?" is also stale: it lists WHOOP, domains and voice as soon, although all three are on.
7. **Trust gaps, which honest proof can fill:**
   - No company details and no support email on `/about` (live placeholders).
   - The coach directory is empty ("No coaches are listed yet."), yet it is linked from the footer and promoted under the `/uae` hero.
   - No founder identity, although Kamran speaks as the founder: "I'm Kamran, I built trainsyou" (`kamran-assistant.md:28`).
   - No product video and no live sample coach site.
   - CXL: logos and testimonials with photos are the most recalled forms of proof (an attention study, not conversion). Real substitutes need to be found and must not be invented.
8. **Copy is hard to read.** The vocabulary is technical: held-out scenarios, versioned releases, marginal bands, Client Twin, confidence threshold, safety floor.
   - Qualifiers repeat heavily ("An estimate, not a promise", "when enabled").
   - Unbounce SaaS data: copy at a 5th–7th grade reading level converts 12.9%, professional-level copy 2.1%; 250–725 words performs best.
   - Specialty H1s break the house limit (11–13 words with a colon).
9. **Two names for one product.** The hero says "your AI", the relay says "trainsyou learns", inner pages say "Trainer Brain", and the demo says "digital coach". A visitor meets the moat under four names.
10. **Speed.**
    - The whole app ships one shared client bundle, about 850KB gzip (`HOME_DESIGN:44`).
    - `/` and `/how-it-works` already exceed the LCP and blocking-time budget because of the journey player (`MARKETING_MOTION_PLAN:254-256`; `marketing-site.md:1409-1420`). The owner accepted that cost.
    - Evidence: 0.1s faster gave +8.4% retail conversions (Deloitte) and +33% conversion rate in Rakuten's A/B test.
11. **Nothing measures the funnel.** There are no CTA, calculator, Kamran or form-start events, and UTM parameters are not carried into sign-up, so the redesign cannot be judged.
12. **The headline anchors on the best case.** The follower calculator's headline (AED 23,084 a month, 31 in the first month) is about 8 times typical and 58 times cautious.
    - This conflicts with the skill rule: "Understate deliberately... A big number they distrust converts worse".
    - It is an owner-approved direction (`COMPLETION_STAGES.md:779`), so raise it with the owner; do not change it unilaterally.

### Page by page

- **Home:**
  - The hero describes; it does not show.
  - The relay names the product "trainsyou learns", not the trainer's AI.
  - Bands 3–6 alternate as text plus a mock-up with no rising argument: there is no "why now" or "what it replaces" band (the 7-tools idea is buried on `/features`).
  - Risk reversal is weak. "Nothing goes live until you publish" appears only in the closing panel; "No subscription fee" is missing.
  - There is no sticky phone CTA.
  - The calculator price is not carried to sign-up.
  - Kamran is easy to miss (an icon only).
- **How it works:** the CTA "Get started" adds a page; eight dense steps; the Get paid step says "When enabled" with no context.
- **Trainer Brain:** the strongest moat page, but text only. No screen of rules being confirmed, a scenario test, or a rollback.
- **Features:**
  - The page is too long: strip, cards, screens, 12 tiles, table, then 91 matrix rows.
  - Amber chips are spread across it.
  - The capability counts lead the page instead of outcomes.
- **Feature detail pages:**
  - No visual.
  - The same "does / sees / control" pattern on all 12 pages.
  - The Bookings page H1 sells one-to-one sessions, which works against the moat.
- **Demo:** scripted text tabs. It is not a product walkthrough, and visitors cannot type their own rule. Interactive demos are a strong pattern according to vendor data.
- **Security and privacy:** the CTA leads away from sign-up, and fine print like "enforcement depends on deployment settings" weakens confidence.
- **Specialty pages:** H1s over the word limit; illustrative rules are good, but there is no screen of the Brain applying them; the CTA label differs from the rest of the site.
- **UAE:** the hero is immediately followed by a directory ad for consumers, aimed at a trainer audience and leading to an empty directory. Good local evidence follows, but it is placed under that block.
- **Get started:** good time-to-value copy ("about 15 minutes"). The address field and the six steps are the right shape. It is an extra hop for any visitor arriving via "Get started".
- **Pricing:**
  - The primary CTA is not sign-up.
  - There is no at-a-glance "Free / What we take / What's optional" table.
  - The payment processing rate is unstated, which leaves an open objection.
  - There is no "pay nothing if you get no subscribers" line.
  - The worked example comes before the bands.
  - There is no comparison with the trainer's current tool stack.
- **Earnings calculator:** solid arithmetic. The result is not carried to sign-up, and the price and subscriber assumptions are not linked to the follower estimate.
- **Follower calculator:** the best-case anchor (see weakness 12). The method text is very long. Instagram connect is "Available soon".
- **FAQ:** 14 questions with no grouping, one of them stale.
- **About:** live placeholders, no founder, no mission visual.
- **Methodology:** a credible honesty asset. Few visitors will reach it, and it could be surfaced as a trust badge ("Every number sourced").
- **Coach directory:** the empty state is public and indexed.
- **Sign-up:**
  - The headline changes register from the marketing promise ("Teach your AI").
  - The card does not restate "free / no card".
  - Password-only with a 12-character minimum. Baymard found that stated rules rarely cause abandonment, but sign-in failures later are the risk.
  - Email codes, Google and Apple are all off, so the lowest-friction sign-up options are missing.

### External evidence and its weight

| Source | Finding | Weight |
|---|---|---|
| [NN/g, Scrolling and attention (2018)](https://www.nngroup.com/articles/scrolling-and-attention/) | 57% of viewing time above the fold, 74% in the first two screens | Measured eye-tracking: 120 participants, 130,000 fixations |
| [Unbounce SaaS benchmark](https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/) | Median 3.8%; 5th–7th grade copy 12.9% vs professional 2.1%; 250–725 words best | Vendor dataset, correlational; SaaS sample size not disclosed |
| [Deloitte / Google, Milliseconds Make Millions](https://web.dev/case-studies/milliseconds-make-millions) | 0.1s faster: retail conversions +8.4%, travel +10.1% | Observational; 37 brands over 4 weeks; Google-commissioned |
| [web.dev, Rakuten 24](https://web.dev/case-studies/rakuten) | Conversion rate +33.13% | A/B test at a single company, published as a vendor case study |
| [CXL social proof study](https://cxl.com/research-study/social-proof/) | Testimonials with photos and logos are the most recalled proof | Measured attention and recall, not conversion |
| [Navattic, State of the Interactive Product Demo 2025](https://navattic.com/report/state-of-the-interactive-product-demo-2025) | Demo-to-opportunity conversion about 3x vs product pages | Vendor claim |
| [Baymard, password requirements](https://baymard.com/blog/password-requirements-and-password-reset) | Stated password rules rarely cause abandonment; later sign-in failure is the risk | Usability testing, qualitative |
| Skill `benchmarks.md` | Unbounce 6.6% median [A]; 3 fields 25% vs 6 fields 15% [B]; first-person CTA +90% [B]; 7% lost per second of load [B] | Ratings as given in the skill |
| Skill `output-formats.md` | Pitch-page rules | Expert guidance, not measured |

---

**Files referenced:**
- `/home/user/trainer_what/packages/contracts/src/marketing-content.ts`
- `/home/user/trainer_what/packages/contracts/src/marketing.ts`
- `/home/user/trainer_what/packages/contracts/src/marketing-features.ts`
- `/home/user/trainer_what/packages/contracts/src/brand.ts`
- `/home/user/trainer_what/packages/domain/src/marketing-calculators.ts`
- `/home/user/trainer_what/apps/web/components/marketing/site.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/frame.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/islands.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/showcase.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/hero-flow.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/journey.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/chip.tsx`
- `/home/user/trainer_what/apps/web/components/marketing/platform.ts`
- `/home/user/trainer_what/apps/web/components/acquisition.tsx`
- `/home/user/trainer_what/apps/web/components/public-pages.tsx` (sign-up, lines 580-790)
- `/home/user/trainer_what/apps/web/components/brand-logo.tsx`
- `/home/user/trainer_what/apps/web/app/marketing.css`
- `/home/user/trainer_what/apps/web/app/globals.css`
- `/home/user/trainer_what/docs/features/marketing-site.md`
- `/home/user/trainer_what/docs/features/marketing-motion.md`
- `/home/user/trainer_what/docs/features/kamran-assistant.md`
- `/home/user/trainer_what/docs/features/brand.md`
- `/home/user/trainer_what/docs/HOME_DESIGN_2026-10-25.md`
- `/home/user/trainer_what/docs/PROJECT_MEMORY.md`
- `/home/user/trainer_what/docs/COMPLETION_STAGES.md`
- Reverted HTML home: `git show af457bd:apps/web/components/marketing/home-design.tsx`
- Script that prints every page's full copy: `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/dump.ts`. Run it with `npx tsx <file> <path...>`, or `index` for the page list, or `sources` for the source list.