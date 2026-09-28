// Copy for the public marketing site. Rules for editors:
// - Describe only what the platform does (see docs/features and
//   docs/features/marketing-site.md). No invented testimonials, logos,
//   customer counts, ratings, awards or statistics.
// - Every market figure cites a MARKETING_SOURCES entry and appears on
//   /methodology. Earnings and follower figures are estimate ranges.
// - Never name the domain registrar or the payout provider.
// - {APP_NAME} is replaced with the configured platform name.
import type {
  MarketingCard,
  MarketingFaq,
  MarketingPage,
  MarketingSection,
  MarketingSource,
} from "./marketing.ts";

const UPDATED = "2026-09-28";
const RETRIEVED = "2026-09-28";

export const MARKETING_SOURCES: MarketingSource[] = [
  {
    id: "datareportal-uae-2025",
    publisher: "DataReportal",
    title: "Digital 2025: The United Arab Emirates",
    url: "https://datareportal.com/reports/digital-2025-united-arab-emirates",
    published: "2025",
    retrieved: RETRIEVED,
    claim:
      "UAE population 11.2 million (January 2025); 11.1 million internet users (99.0%); 7.60 million Instagram users, equal to 67.8% of the population; median age 31.6.",
    usedFor: "UAE Instagram reach on the UAE pages and the follower guide.",
  },
  {
    id: "dubai-fitness-challenge-2024",
    publisher: "Government of Dubai Media Office",
    title:
      "Dubai Fitness Challenge inspires new records with public participation topping 2.73 million",
    url: "https://mediaoffice.ae/en/news/2024/november/29-11/dubai-fitness-challenge-inspires-new-records-with-public-participation-topping",
    published: "29 November 2024",
    retrieved: RETRIEVED,
    claim: "Public participation in Dubai Fitness Challenge 2024 topped 2.73 million.",
    usedFor: "Local context on the Dubai page.",
  },
  {
    id: "abu-dhabi-activity-survey-2026",
    publisher: "Gulf News",
    title:
      "Abu Dhabi residents are getting fitter, and the numbers prove it (Fourth Abu Dhabi Sports and Physical Activity Survey)",
    url: "https://gulfnews.com/uae/health/abu-dhabi-residents-are-getting-fitter-and-the-numbers-prove-it-1.500559563",
    published: "1 June 2026",
    retrieved: RETRIEVED,
    claim:
      "60.3% of Abu Dhabi residents meet WHO physical activity standards, up from 53.6%, in the fourth survey by the Department of Community Development and Abu Dhabi Sports Council (about 31,000 responses).",
    usedFor: "Local context on the Abu Dhabi page.",
  },
  {
    id: "heytrainer-dubai-2026",
    publisher: "Hey Trainer",
    title: "Personal trainer cost in Dubai",
    url: "https://www.heytrainer.ae/blog/personal-trainer-cost-dubai",
    published: "11 May 2026",
    retrieved: RETRIEVED,
    claim:
      "Dubai personal training typically costs AED 70-350 per session in 2026: entry AED 70-120, certified AED 120-220, senior or specialist AED 220-350+.",
    usedFor:
      "Per-session price anchor (a published price guide, not an official statistic).",
  },
  {
    id: "embody-dubai-2025",
    publisher: "Embody Fitness",
    title: "How much does a personal trainer cost in Dubai?",
    url: "https://embodyfitness.ae/blog/how-much-does-personal-trainer-cost-dubai/",
    published: "2025",
    retrieved: RETRIEVED,
    claim:
      "Dubai personal training AED 200-350 per session (basic), AED 350-600+ (experienced or specialised), AED 600-700+ (premium).",
    usedFor:
      "Per-session price anchor (a published price guide, not an official statistic).",
  },
  {
    id: "369mmafit-online-2026",
    publisher: "369MMAFIT",
    title: "Online personal trainer in Dubai",
    url: "https://369mmafit.com/en/blog/online-personal-trainer-dubai",
    published: "updated 25 February 2026",
    retrieved: RETRIEVED,
    claim:
      "Online coaching in Dubai: basic AED 400-700 a month, standard AED 700-1,200, premium AED 1,200-2,000, hybrid AED 1,500-3,000.",
    usedFor:
      "Online coaching price anchor (a published price guide, not an official statistic).",
  },
  {
    id: "socialinsider-stories",
    publisher: "Socialinsider",
    title: "Instagram Stories benchmarks",
    url: "https://www.socialinsider.io/social-media-benchmarks/instagram-stories-benchmarks",
    published: "2025",
    retrieved: RETRIEVED,
    claim:
      "Stories reach rate by follower tier (image / video): 1-5K 9.55% / 10.40%; 5-10K 3.50% / 4.20%; 10-50K 1.35% / 2.00%; 50-100K 0.55% / 0.65%; 100K-1M 0.50% / 0.65%. Reach rises from 6.3% for a one-frame Story to 20.5% by the sixth frame. 161,180 Stories, January-May 2024 and 2025.",
    usedFor: "Story reach assumption of the follower calculator.",
  },
  {
    id: "socialinsider-engagement",
    publisher: "Socialinsider",
    title: "Instagram benchmarks",
    url: "https://www.socialinsider.io/social-media-benchmarks/instagram",
    published: "2025",
    retrieved: RETRIEVED,
    claim:
      "Average Instagram engagement rate by followers (likes plus comments divided by followers) was 0.48% across 35 million posts from 447,613 pages in 2025, down 24% year on year.",
    usedFor:
      "Engagement benchmark the follower calculator compares your own rate against.",
  },
  {
    id: "hypeauditor-2025",
    publisher: "HypeAuditor",
    title: "State of Influencer Marketing 2025",
    url: "https://hypeauditor.com/state-of-influencer-marketing-2025/",
    published: "2025 (2024 data)",
    retrieved: RETRIEVED,
    claim:
      "Nano-influencers (1K-10K followers) make up 76% of Instagram influencers and have the highest engagement rate, 2.19%.",
    usedFor: "Context that smaller, engaged audiences are valuable.",
  },
  {
    id: "creatorflow-link-sticker",
    publisher: "Creatorflow",
    title: "Instagram Story link sticker",
    url: "https://creatorflow.so/blog/instagram-story-link-sticker/",
    published: "May 2026",
    retrieved: RETRIEVED,
    claim:
      "There is no industry-standard published benchmark for Story link-sticker click-through; creators report roughly 1-5% of viewers, and below 5% is typical.",
    usedFor:
      "Link-click assumption of the follower calculator (anecdotal; shown as such).",
  },
  {
    id: "hootsuite-link-stickers",
    publisher: "Hootsuite",
    title: "Do links in Instagram Stories ruin engagement? (experiment)",
    url: "https://blog.hootsuite.com/adding-links-instagram-stories-ruin-engagement/",
    retrieved: RETRIEVED,
    claim:
      "In Hootsuite's experiment, Stories with link stickers received less engagement (replies, shares, reach) than Stories without links.",
    usedFor: "Advice to mix link Stories with ordinary Stories.",
  },
  {
    id: "dynamicyield-conversion",
    publisher: "Dynamic Yield",
    title: "Conversion rate benchmarks",
    url: "https://marketing.dynamicyield.com/benchmarks/conversion-rate/",
    published: "trailing 12 months",
    retrieved: RETRIEVED,
    claim:
      "Global e-commerce conversion rate 2.72% per session; EMEA 2.89%, APAC 1.51%, mobile 2.88%; beauty and personal care highest at 5.39%.",
    usedFor: "Visit-to-subscriber assumption of the follower calculator.",
  },
  {
    id: "unbounce-landing-pages",
    publisher: "Unbounce",
    title: "What's a good conversion rate?",
    url: "https://unbounce.com/landing-pages/whats-a-good-conversion-rate/",
    retrieved: RETRIEVED,
    claim:
      "Median landing page conversion rate 6.6% across industries (41,000 landing pages, 57 million conversions). These are mostly sign-ups, not purchases.",
    usedFor:
      "Context only: why the calculator uses purchase benchmarks, not lead benchmarks.",
  },
  {
    id: "nng-participation",
    publisher: "Nielsen Norman Group",
    title: "Participation inequality: the 90-9-1 rule",
    url: "https://www.nngroup.com/articles/participation-inequality/",
    retrieved: RETRIEVED,
    claim:
      "In most online communities about 90% of people only watch, 9% contribute a little and 1% account for most activity.",
    usedFor: "Why most followers never act on a single post.",
  },
  {
    id: "meta-instagram-login",
    publisher: "Meta for Developers",
    title: "Instagram API with Instagram Login",
    url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login",
    retrieved: RETRIEVED,
    claim:
      "The Instagram API with Instagram Login works only with professional (business and creator) accounts, with permissions such as instagram_business_basic.",
    usedFor: "The optional Connect Instagram feature.",
  },
  {
    id: "techcrunch-basic-display",
    publisher: "TechCrunch",
    title: "Instagram locks out developers of third-party consumer apps",
    url: "https://techcrunch.com/2024/12/06/instagram-locks-out-developers-of-third-party-consumer-apps",
    published: "6 December 2024",
    retrieved: RETRIEVED,
    claim:
      "The Instagram Basic Display API for personal accounts shut down in December 2024.",
    usedFor: "Why only professional accounts can connect.",
  },
  {
    id: "gulfnews-advertiser-permit",
    publisher: "Gulf News",
    title: "What is the UAE Advertiser Permit for social media?",
    url: "https://gulfnews.com/living-in-uae/ask-us/what-is-the-uae-advertiser-permit-for-social-media-1.500218180",
    published: "1 August 2025",
    retrieved: RETRIEVED,
    claim:
      "The UAE Advertiser Permit (Mu'lin) is required for individuals promoting products or services on social media, paid or unpaid. People promoting their own products or services, or their own company's, through personal accounts are exempt. It is free for three years for citizens and residents.",
    usedFor: "The advertiser permit guide (information only).",
  },
  {
    id: "uae-media-council-permit",
    publisher: "UAE Media Council",
    title: "Announcement of the Advertiser Permit",
    url: "https://uaemc.gov.ae/en/news/%D9%85%D8%AC%D9%84%D8%B3-%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA-%D9%84%D9%84%D8%A5%D8%B9%D9%84%D8%A7%D9%85-%D9%8A%D8%B7%D9%84%D9%82-%D8%AA%D8%B5%D8%B1%D9%8A%D8%AD-%D9%85%D8%B9%D9%84%D9%86/",
    retrieved: RETRIEVED,
    claim:
      "The official announcement of the Advertiser Permit (the page did not load when checked on 28 September 2026).",
    usedFor: "The authority to check for current permit rules.",
  },
];

/**
 * The trainer's setup checklist, in order: the same keys and labels as the
 * onboarding registry in apps/api/src/onboarding.ts (a test keeps them equal).
 */
export const SETUP_CHECKLIST: Array<{
  key: string;
  label: string;
  required: boolean;
  summary: string;
}> = [
  { key: "account", label: "Account", required: true, summary: "Verify your email; your coaching address is reserved." },
  { key: "identity", label: "Business identity", required: true, summary: "Describe your coaching business and who you serve." },
  { key: "brand", label: "Brand studio", required: true, summary: "Your public name, headline, biography and colours." },
  { key: "brain-intro", label: "Meet your Brain", required: true, summary: "Learn what runs automatically and what comes to you." },
  { key: "interview", label: "Coaching interview", required: false, summary: "Explain your recommendations, reasons and limits." },
  { key: "uploads", label: "Source material", required: false, summary: "Import your own documents and review the extracted text." },
  { key: "knowledge", label: "Knowledge review", required: true, summary: "Confirm your rules and resolve conflicts between sources." },
  { key: "scenarios", label: "Scenario lab", required: true, summary: "Write at least 20 held-out scenarios and check the answers." },
  { key: "readiness", label: "Brain readiness", required: true, summary: "Publish your evaluated Brain and choose what runs automatically." },
  { key: "offer", label: "Your offer", required: true, summary: "Set your price, programme length and billing." },
  { key: "payout", label: "Your payout account", required: true, summary: "Add the UAE IBAN your monthly payouts go to." },
  { key: "wearables", label: "Wearable policy", required: false, summary: "Choose whether subscribers can share wearable data." },
  { key: "voice", label: "Optional voice", required: false, summary: "Verify and consent to your own voice for guided sessions." },
  { key: "domain", label: "Your address", required: true, summary: "Your web address is reserved; an own domain is optional." },
  { key: "preview", label: "Subscriber preview", required: true, summary: "See exactly what subscribers will see before launch." },
  { key: "publish", label: "Publish", required: true, summary: "Launch once product, coaching, legal and payout checks pass." },
  { key: "share", label: "Share your link", required: false, summary: "Put your tagged link in your bio and Stories." },
];

const CLAIM = { label: "Claim your coaching address", href: "/signup" };

// ---------------------------------------------------------------------------
// Feature pages share one shape: what it does, what your subscriber sees,
// what you control, then FAQs and a related calculator.
function feature(
  slug: string,
  navLabel: string,
  options: {
    title: string;
    description: string;
    h1: string;
    intro: string;
    keyword: string;
    does: string[];
    subscriberSees: string[];
    youControl: string[];
    extra?: MarketingSection[];
    faqs: MarketingFaq[];
    related: string[];
    availability?: MarketingPage["availability"];
    offering?: string;
  },
): MarketingPage {
  return {
    path: "/features/" + slug,
    kind: "feature",
    group: "features",
    navLabel,
    title: options.title,
    description: options.description,
    h1: options.h1,
    eyebrow: "FEATURE · " + navLabel.toUpperCase(),
    intro: options.intro,
    primaryKeyword: options.keyword,
    parent: "/features",
    sections: [
      { id: "does", heading: "What it does", bullets: options.does },
      {
        id: "subscriber",
        heading: "What your subscriber sees",
        bullets: options.subscriberSees,
      },
      { id: "control", heading: "What you control", bullets: options.youControl },
      ...(options.extra ?? []),
    ],
    faqs: options.faqs,
    related: options.related,
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    availability: options.availability,
    offering: options.offering ?? "Included",
  };
}

// Specialty pages: illustrative rules, handoffs, a programme outline and a
// specialty FAQ, so each page carries its own substance.
function specialty(
  slug: string,
  navLabel: string,
  options: {
    who: string;
    keyword: string;
    description: string;
    intro: string;
    rules: MarketingCard[];
    handoffs: string[];
    programme: string[][];
    faqs: MarketingFaq[];
    examplePriceAed: number;
  },
): MarketingPage {
  return {
    path: "/for-trainers/" + slug,
    kind: "specialty",
    group: "specialties",
    navLabel,
    title: `AI coaching platform for ${options.who}`,
    description: options.description,
    h1: `For ${options.who}: your method, affordable for every follower`,
    eyebrow: "FOR TRAINERS · " + navLabel.toUpperCase(),
    intro: options.intro,
    primaryKeyword: options.keyword,
    parent: "/for-trainers",
    sections: [
      {
        id: "rules",
        heading: "Rules you might teach your Brain",
        body: [
          "Three illustrative rules. Your Brain learns your own wording, reasons and limits; these only show the shape a rule takes.",
        ],
        cards: options.rules.map((r) => ({ ...r, label: "Illustrative" })),
      },
      {
        id: "handoffs",
        heading: "What always comes to you",
        body: [
          "Pain reports always pause the workout and come to you, enforced in code, and the Brain hands over anything it is not confident about. Beyond that floor, you choose which situations always come to you. Examples a trainer in this specialty might set:",
        ],
        bullets: options.handoffs,
      },
      {
        id: "programme",
        heading: "An illustrative programme outline",
        table: {
          caption: "Illustrative structure only; you set the length and content",
          columns: ["Phase", "Focus", "How the Brain adapts it"],
          rows: options.programme,
        },
      },
      {
        id: "followers",
        heading: "What your followers could be worth",
        body: [
          "The follower calculator below starts from an example price. Change it to your own; the result is an estimate range built from cited benchmarks, not a promise.",
        ],
      },
    ],
    faqs: options.faqs,
    related: ["/follower-calculator", "/trainer-brain", "/features/safety", "/pricing"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    cta: { label: "Start teaching your Brain", href: "/signup" },
    examplePriceAed: options.examplePriceAed,
  };
}

function guide(
  slug: string,
  navLabel: string,
  options: {
    title: string;
    description: string;
    h1: string;
    intro: string;
    keyword: string;
    sections: MarketingSection[];
    faqs: MarketingFaq[];
    related: string[];
  },
): MarketingPage {
  return {
    path: "/guides/" + slug,
    kind: "guide",
    group: "guides",
    navLabel,
    title: options.title,
    description: options.description,
    h1: options.h1,
    eyebrow: "GUIDE",
    intro: options.intro,
    primaryKeyword: options.keyword,
    parent: "/guides",
    sections: options.sections,
    faqs: options.faqs,
    related: options.related,
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["Article", "FAQPage"],
  };
}

const SAFETY_FAQ: MarketingFaq = {
  q: "What happens when a subscriber reports pain?",
  a: "The workout pauses and you are alerted. Pain, medical issues and red flags are routed to you by rules enforced in code, outside the AI, so no prompt or setting can switch them off. Normal training stays paused until you review it.",
};
const REPLACE_FAQ: MarketingFaq = {
  q: "Will the AI replace me?",
  a: "No. Your Trainer Brain is built from your rules, cases and corrections and coaches under your name. It hands you anything it is not confident about, and safety issues always come to you. You can take over any subscriber or conversation at any time.",
};
const PRICE_FAQ: MarketingFaq = {
  q: "Who sets the subscription price?",
  a: "You do. You set the monthly or upfront price in AED, the programme length, trials and promotions. {APP_NAME} takes a transparent commission on subscription revenue using marginal bands of 25%, 20%, 15% and 10%.",
};
const TRAINED_FAQ: MarketingFaq = {
  q: "Is the AI trained on my data?",
  a: "Your Trainer Brain is taught by you: your confirmed rules, coaching cases, examples and corrections, tested against held-out scenarios and published as versions you can roll back. We do not claim to fine-tune a separate model on you, and your teaching stays private to your workspace.",
};

export const MARKETING_CONTENT: MarketingPage[] = [
  {
    path: "/",
    kind: "home",
    group: "product",
    navLabel: "Home",
    title: "AI personal trainer platform for UAE coaches",
    description:
      "Build an AI trainer from your own coaching method. {APP_NAME} coaches your followers day by day under your brand, priced in AED, and hands you anything it is unsure about.",
    h1: "Your coaching brain, trained into an AI that coaches every follower like you would.",
    eyebrow: "FOR COACHES WITH A METHOD OF THEIR OWN",
    intro:
      "Teach {APP_NAME} your rules, cases and examples. It builds and adapts each subscriber’s plan day by day, hands you anything it isn’t sure about, and sends pain and medical red flags straight to you. You set the price in AED.",
    primaryKeyword: "AI personal trainer platform",
    sections: [
      {
        id: "what-is",
        heading: "What is {APP_NAME}?",
        body: [
          "{APP_NAME} is a UAE platform that lets each personal trainer build a bespoke AI trainer, their Trainer Brain, from their own rules, cases and examples. It then sells personalised, day-by-day coaching to the trainer’s followers under the trainer’s own brand, priced in AED.",
          "It is not a generic workout generator, not a medical service, and it does not replace you: anything the Brain is unsure about, and every safety issue, comes to you.",
        ],
      },
      {
        id: "hours",
        heading: "Your income stops when your hours do.",
        body: [
          "Published Dubai price guides put one-to-one sessions at roughly AED 70-350, and experienced or premium trainers higher. Online coaching guides quote AED 400-2,000 a month. Either way, an hour can be sold only once.",
          "A Trainer Brain lets your method coach many people at the same time, at a monthly price far more followers can afford, while you keep the sessions and clients only you can serve.",
        ],
        note: "Price ranges come from published price guides, not official statistics. See Methodology.",
        sources: ["heytrainer-dubai-2026", "embody-dubai-2025", "369mmafit-online-2026"],
      },
      {
        id: "steps",
        heading: "Teach it. It coaches. You earn.",
        steps: [
          {
            title: "Teach it",
            body: "Answer a guided coaching interview, write or confirm rules, add cases and examples, and import your own documents. Test the Brain on held-out scenarios before anything goes live.",
          },
          {
            title: "It coaches",
            body: "Each subscriber gets a personalised, dated plan built from their own input. The Brain adapts it as they log workouts, and hands you anything it is not confident about.",
          },
          {
            title: "You earn",
            body: "Subscribers pay you in AED through your own branded website and app. You set the price; payouts arrive monthly in your UAE bank account.",
          },
        ],
      },
      {
        id: "brain",
        heading: "The Trainer Brain: your judgment, working when you’re not.",
        body: [
          "Every decision starts from something you taught. When the Brain is confident, it applies the change and records why. When it is not, it drafts a suggestion and sends it to you. Pain, medical issues and red flags never stay with the AI.",
        ],
        cards: [
          {
            title: "Confident",
            body: "The change follows your confirmed rules, so it is applied automatically and logged with its reason.",
            label: "Applied automatically",
          },
          {
            title: "Not sure",
            body: "Outside what you taught, or below your confidence threshold: a draft comes to you to approve or correct. Your correction becomes teaching.",
            label: "Handed to you",
          },
          {
            title: "Safety",
            body: "Pain, medical issues and red flags pause the workout and alert you. Enforced in code, outside the AI.",
            label: "Always to you",
          },
        ],
      },
      {
        id: "subscribers",
        heading: "What your subscribers get",
        cards: [
          { title: "A plan for every day", body: "A personalised, dated plan built from their goals, schedule, experience and equipment." },
          { title: "Guided workouts", body: "Exercise cues, set logging and rest timers; it keeps working offline in the gym." },
          { title: "Adapts as they train", body: "Progressions, missed sessions and swaps follow your rules automatically." },
          { title: "Your voice, optionally", body: "An add-on where a voice in your own verified voice runs the session." },
          { title: "Nutrition, optionally", body: "Meal plans, recipes, grocery lists, a food diary, meal photos and barcode scanning." },
          { title: "You, when it matters", body: "Chat with you, a clearly labelled digital coach, and paid one-to-one sessions." },
          { title: "Progress they can see", body: "Completed sessions, best loads and their coaching context in one place." },
          { title: "Your brand throughout", body: "Your website, your address, your colours and an installable app with your icon." },
        ],
      },
      {
        id: "economics",
        heading: "You set the price. We take a transparent share.",
        body: [
          "Commission is a share of subscription revenue in marginal bands: 25% for your first 100 paying subscribers, 20% for the next 200, 15% up to 1,000 and 10% beyond. Each band keeps its own rate.",
          "AI usage is passed through at cost and listed line by line on your statement, with payment processing and any optional services you choose. Payouts are monthly to your UAE bank account.",
        ],
      },
      {
        id: "control",
        heading: "You stay in control",
        bullets: [
          "Your rules are inspectable and every release can be rolled back.",
          "You choose which routine changes run automatically.",
          "You can take over any subscriber or conversation at any time.",
          "Safety routing is enforced in code and cannot be switched off.",
          "Subscribers always see when guidance comes from the digital coach.",
          "Your teaching is private to your workspace, and your data can be exported.",
        ],
      },
    ],
    faqs: [
      REPLACE_FAQ,
      SAFETY_FAQ,
      PRICE_FAQ,
      {
        q: "Do I need technical skills?",
        a: "No. Setup is a guided checklist: you answer interview questions, confirm rules in plain language, write test scenarios, set your offer and add your bank account. The website, app, payments and payouts are set up for you.",
      },
      {
        q: "How do my Instagram followers become subscribers?",
        a: "You share your coaching link in your bio and Stories. Followers open your branded page, choose your offer and pay by card in AED. The follower calculator estimates a realistic range from cited benchmarks; it is an estimate, not a promise.",
      },
    ],
    related: ["/how-it-works", "/trainer-brain", "/features", "/pricing", "/follower-calculator"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
  },
  {
    path: "/how-it-works",
    kind: "page",
    group: "product",
    navLabel: "How it works",
    title: "How an AI personal trainer built from your method works",
    description:
      "Eight steps from claiming your address to monthly payouts: teach your Trainer Brain, test it, publish your offer, share your link and let it coach day by day.",
    h1: "How {APP_NAME} turns your method into personalised coaching",
    eyebrow: "HOW IT WORKS",
    intro:
      "You teach a Trainer Brain your rules, cases and examples, test it on scenarios it has never seen, and publish an offer at your own price. It then plans and adapts each subscriber’s training day by day, hands you what it is unsure about, and learns from your corrections.",
    primaryKeyword: "how does an AI personal trainer work",
    sections: [
      {
        id: "steps",
        heading: "Eight steps from your method to monthly payouts",
        steps: [
          { title: "Claim your address and brand", body: "Reserve your coaching address, then set your public name, headline, biography, colours and logo in the Design Studio." },
          { title: "Teach your Brain", body: "Answer a guided coaching interview, confirm rules in plain language, add coaching cases and examples, and import your own documents with a private redaction review." },
          { title: "Test it", body: "Write at least 20 held-out scenarios with the answer you expect. The Brain is evaluated against them before a version can be published." },
          { title: "Create your offer", body: "Set your price in AED, the programme length, monthly or upfront billing, trials and promotions, and an optional nutrition tier or voice add-on." },
          { title: "Publish and share your link", body: "Review a preview of exactly what subscribers see, launch, then share your tagged link in your bio and Stories." },
          { title: "It plans and adapts daily", body: "Each subscriber gets a dated plan from their own input. Confident changes are applied automatically; anything uncertain is handed to you." },
          { title: "You correct, it learns", body: "Approve or correct what comes to you. Corrections and subscriber outcomes become teaching for the next evaluated release." },
          { title: "Get paid monthly", body: "Subscribers pay by card in AED. Your statement shows gross revenue, commission and itemised costs, and payouts go to your UAE bank account." },
        ],
      },
      {
        id: "lanes",
        heading: "Who does what",
        table: {
          caption: "Responsibilities once you are live",
          columns: ["You", "Your Trainer Brain", "Your subscriber"],
          rows: [
            ["Teach rules, cases and limits", "Builds a dated plan from each subscriber’s input", "Tells you their goal, schedule, experience and equipment"],
            ["Choose what runs automatically", "Applies confident changes and records why", "Trains day by day and logs sets"],
            ["Review what is handed to you", "Hands over anything below your confidence threshold", "Asks questions and reports pain in one tap"],
            ["Set price, length and billing", "Sends safety issues to you and pauses the workout", "Pays monthly or upfront in AED"],
          ],
        },
      },
      {
        id: "control",
        heading: "Control stays visible",
        body: [
          "You can inspect every rule and its source, roll back a release, take over any conversation and write programmes yourself. Subscribers see when guidance is digital.",
        ],
      },
    ],
    faqs: [
      {
        q: "How long does setup take?",
        a: "It depends on how much of your method you teach before launch. The checklist shows your progress step by step, and you can start teaching before your business details are complete.",
      },
      {
        q: "What does the Brain do when it is not sure?",
        a: "It drafts a suggestion and hands it to you instead of acting. You approve or correct it, and your correction becomes teaching for the next release.",
      },
      TRAINED_FAQ,
      SAFETY_FAQ,
    ],
    related: ["/trainer-brain", "/features", "/pricing", "/demo"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["HowTo", "FAQPage"],
    cta: { label: "Get started", href: "/get-started" },
  },
  {
    path: "/trainer-brain",
    kind: "page",
    group: "product",
    navLabel: "Trainer Brain",
    title: "Trainer Brain: an AI trainer built from your judgment",
    description:
      "Teach an AI your coaching rules, cases and examples. It plans and adapts training for each subscriber, learns from your corrections and hands you what it is unsure about.",
    h1: "The Trainer Brain: an AI trainer built from your judgment",
    eyebrow: "TRAINER BRAIN",
    intro:
      "The Trainer Brain is a private, versioned set of your coaching rules, cases and examples that plans and adapts training for each subscriber. It is taught by you, tested on held-out scenarios, acts on its own only when confident, and learns from your corrections.",
    primaryKeyword: "AI trained on my coaching method",
    sections: [
      {
        id: "what",
        heading: "What it is",
        body: [
          "A bespoke AI trainer trained on your rules, cases and corrections, not a generic workout generator. Every plan and change traces back to something you taught, and every published version can be rolled back.",
        ],
      },
      {
        id: "teach",
        heading: "What you teach it",
        bullets: [
          "A guided coaching interview: what you recommend, why, the alternatives and the conditions that change your answer.",
          "Rules in plain language that you confirm, edit or reject, each citing its source.",
          "Coaching cases and worked examples of real decisions.",
          "Your own documents, with a private review of the extracted text before anything is used.",
          "Held-out test scenarios: at least 20 situations with the answer you expect.",
        ],
      },
      {
        id: "decides",
        heading: "How it decides",
        body: [
          "For each subscriber it combines your published rules with their goals, schedule, experience, equipment and logged training. When its confidence meets your threshold, it applies the change and records the reason. When it doesn’t, it hands the decision to you with a draft.",
        ],
      },
      {
        id: "learns",
        heading: "How it learns",
        bullets: [
          "Your approvals and corrections become new teaching.",
          "Subscriber outcomes, such as completed sessions and logged loads, inform later plans.",
          "New teaching is evaluated against your scenarios before release.",
          "Every release is versioned; you can roll back to an earlier one.",
        ],
      },
      {
        id: "never",
        heading: "What it never does",
        bullets: [
          "Keep pain, medical issues or red flags to itself: they pause the workout and come to you, enforced in code.",
          "Pretend to be you: subscribers see a clearly labelled digital coach.",
          "Give medical or clinical advice.",
          "Use your teaching for another trainer: your Brain is private to your workspace.",
        ],
      },
    ],
    faqs: [
      TRAINED_FAQ,
      REPLACE_FAQ,
      {
        q: "Can another trainer see or use my Brain?",
        a: "No. Your rules, sources, cases and scenarios are private to your workspace, and workspaces are isolated at the database layer.",
      },
      {
        q: "What if the Brain gets something wrong?",
        a: "Correct it. The correction is recorded with its reason, becomes teaching, and is checked against your scenarios before the next release. You can also roll back to an earlier release at any time.",
      },
    ],
    related: ["/demo", "/features/safety", "/features/ai-training-plans", "/guides/writing-coaching-rules"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    cta: { label: "Start teaching your Brain", href: "/signup" },
  },
  {
    path: "/demo",
    kind: "page",
    group: "product",
    navLabel: "Demo",
    title: "See an AI coach make a decision: interactive demo",
    description:
      "Four scripted examples of a Trainer Brain decision: a confident progression, a missed session, a low-confidence handoff to the trainer and a pain report.",
    h1: "See your Brain make a coaching decision",
    eyebrow: "INTERACTIVE DEMO",
    intro:
      "Choose a subscriber message to see how a Trainer Brain responds. Confident changes follow the trainer’s rules automatically, uncertain ones go to the trainer, and pain always pauses the workout. These examples are fictional and scripted; no AI model is called.",
    primaryKeyword: "AI coach example",
    sections: [
      {
        id: "scenarios",
        heading: "Four decisions",
        cards: [
          {
            title: "A confident progression",
            label: "Applied automatically",
            body: "“Week three done and the squats felt easy.” The trainer’s rule: after two sessions with every set completed and three or more reps in reserve, add 2.5 kg to the main lower-body lift. The Brain moves next Monday’s squat from 60 kg to 62.5 kg and records why.",
          },
          {
            title: "A missed session",
            label: "Rescheduled automatically",
            body: "“I missed yesterday. Should I do two sessions today?” The trainer’s rule: never stack two sessions in a day; move the missed one to the next free day and keep a rest day between hard sessions. The session moves to Thursday and Friday becomes a rest day.",
          },
          {
            title: "Outside what it was taught",
            label: "Handed to the trainer",
            body: "“I’m travelling for two weeks with only a hotel gym. Can you rebuild my plan?” Nothing the trainer taught covers this equipment, so confidence is below the trainer’s threshold. The Brain drafts an option and hands it to the trainer; the subscriber is told the trainer will confirm.",
          },
          {
            title: "New pain",
            label: "Workout paused",
            body: "“My knee hurts when I squat today.” Pain is a safety rule enforced in code, outside the AI. The workout pauses, the trainer is alerted, and normal training stays blocked until the trainer reviews it.",
          },
        ],
        note: "Fictional, scripted examples. They do not assess anyone’s health or prescribe a workout.",
      },
    ],
    faqs: [
      {
        q: "Is this a real AI response?",
        a: "No. These are scripted examples that show the decision flow. A real Trainer Brain uses the trainer’s own confirmed rules and evaluated release.",
      },
      {
        q: "Who decides the confidence threshold?",
        a: "You do. You choose which routine changes may run automatically; everything else comes to you.",
      },
      SAFETY_FAQ,
    ],
    related: ["/trainer-brain", "/features/safety", "/how-it-works"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    cta: { label: "Build my Brain", href: "/signup" },
  },
  {
    path: "/features",
    kind: "hub",
    group: "product",
    navLabel: "Features",
    title: "Personal trainer software features",
    description:
      "Everything in {APP_NAME}: the Trainer Brain, AI training plans, a branded subscriber app and website, nutrition, voice, bookings, chat, progress, payments and safety.",
    h1: "Everything you need to run an AI coaching business under your own name",
    eyebrow: "FEATURES",
    intro:
      "{APP_NAME} combines a Trainer Brain that plans and adapts training, a subscriber app and website under your brand, optional nutrition and voice, bookings, chat, progress tracking, AED payments with monthly payouts, and safety rules enforced in code.",
    primaryKeyword: "personal trainer software features",
    sections: [
      {
        id: "groups",
        heading: "Four parts of one platform",
        cards: [
          { title: "The Brain", body: "Teaching, evaluation, releases, confident automation and handoffs, learning from corrections." },
          { title: "Subscriber experience", body: "Day-by-day plans, guided workouts, nutrition, voice, chat, bookings and progress." },
          { title: "Your business", body: "Website and address, offers and billing, promotions, statements, payouts and team roles." },
          { title: "Trust", body: "Safety routing in code, AI disclosure, privacy controls, workspace isolation and security." },
        ],
      },
    ],
    faqs: [
      {
        q: "Are all features available today?",
        a: "Features that depend on an outside provider show “Available soon” until that provider is enabled on the platform. Everything else is included.",
      },
      {
        q: "Is the subscriber app a separate download?",
        a: "No store download is needed. Subscribers install your app from their browser to their home screen, with your name and icon.",
      },
    ],
    related: ["/features/ai-training-plans", "/features/subscriber-app", "/pricing"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["CollectionPage", "FAQPage"],
  },
  feature("ai-training-plans", "AI training plans", {
    title: "AI workout plans built from your coaching rules",
    description:
      "Every subscriber gets a personalised, dated training plan built by your Trainer Brain from their input, adapted as they train, and handed to you when it is unsure.",
    h1: "A personalised plan for every subscriber, built and adapted by your Brain",
    intro:
      "Your Trainer Brain builds a dated, day-by-day training plan for each subscriber from their goals, schedule, experience and equipment, following your rules. It adapts the plan as they log workouts, applies confident changes automatically and hands you anything it is not sure about.",
    keyword: "AI workout plan generator for trainers",
    does: [
      "Generates a plan from each subscriber’s own intake, within your programme length.",
      "Schedules sessions by date and keeps rest days where your rules put them.",
      "Adapts progressions, missed sessions and swaps using your confirmed rules.",
      "Scores its own confidence and hands low-confidence decisions to you with a draft.",
      "Learns from your corrections and from subscriber outcomes, released only after evaluation.",
    ],
    subscriberSees: [
      "Today’s session and the days ahead, with dates.",
      "Why a change happened, in plain language.",
      "A note when their trainer is reviewing a change.",
    ],
    youControl: [
      "Which routine changes may run automatically.",
      "The confidence you require before a change is applied.",
      "Every plan: edit it, write your own programme or take over a subscriber.",
    ],
    faqs: [
      TRAINED_FAQ,
      {
        q: "Can I still write programmes myself?",
        a: "Yes. You can build programme templates with the exercise library, assign them and adjust any session. The Brain works alongside you.",
      },
      SAFETY_FAQ,
    ],
    related: ["/trainer-brain", "/demo", "/features/safety"],
    availability: ["model"],
  }),
  feature("subscriber-app", "Subscriber app", {
    title: "A branded fitness app for your clients",
    description:
      "Your subscribers get a day-by-day training app with your name and icon: set logging, rest timers, offline mode, approved swaps and one-tap pain reporting.",
    h1: "A day-by-day training app with your name on it",
    intro:
      "Subscribers open an app with your name, colours and icon that guides them day by day: today’s workout, exercise cues, set logging, rest timers and swaps you approved. It keeps working offline in the gym and reports pain to you in one tap.",
    keyword: "branded fitness app for my clients",
    does: [
      "Shows the plan by day, with each session’s exercises, sets and targets.",
      "Logs reps, load, effort and notes, with rest timers between sets.",
      "Keeps working offline and syncs when the connection returns.",
      "Offers only the exercise swaps you approved.",
      "Pauses the workout and alerts you when pain is reported.",
    ],
    subscriberSees: [
      "Your brand: name, colours, logo and an installable home-screen icon.",
      "Today’s session first, then the week ahead.",
      "An Arabic-ready right-to-left layout.",
    ],
    youControl: [
      "Your app design in the Design Studio.",
      "Approved exercise alternatives.",
      "Corrections to logged sets, kept with a history.",
    ],
    faqs: [
      {
        q: "Does it work without a connection?",
        a: "Yes. A workout opened online can be saved for offline use. Set logs stay on the device and sync when the connection returns, and the app shows when syncing is incomplete.",
      },
      {
        q: "Is it available in Arabic?",
        a: "The layout is Arabic-ready, including right-to-left pages. Full Arabic translation of the interface is not yet available.",
      },
    ],
    related: ["/features/ai-training-plans", "/features/voice-coach", "/follower-calculator"],
  }),
  feature("website-and-domain", "Website and domain", {
    title: "Personal trainer website and domain, set up for you",
    description:
      "Your own coaching website with your brand, galleries and contact form, on your own coaching address or your own domain, bought and renewed for you.",
    h1: "Your own coaching website and web address, set up for you",
    intro:
      "Every trainer gets a coaching website with their brand, photos, offers and a contact form, published at their own coaching address. You can also use your own domain: {APP_NAME} can buy and renew it for you, or connect one you already own.",
    keyword: "personal trainer website Dubai",
    does: [
      "Publishes your website from the Design Studio: headline, biography, colours, logo and pages.",
      "Adds photo galleries and a contact form whose messages reach your inbox.",
      "Sets search titles and descriptions for your pages.",
      "Serves your site at your coaching address, or on your own domain.",
    ],
    subscriberSees: [
      "Your brand from the first visit to checkout.",
      "Your offers, prices and how your coaching works.",
      "A clear sign-up that joins your coaching directly.",
    ],
    youControl: [
      "Every page, photo and headline, with a private preview before publishing.",
      "Whether you appear in the public coach directory.",
      "Whether to use your own domain.",
    ],
    faqs: [
      {
        q: "Can I use my own domain?",
        a: "Yes. You can connect a domain you already own, or have one bought and renewed for you with the cost shown on your statement. Own domains show “Available soon” until domain services are enabled on the platform.",
      },
      {
        q: "Will my website appear in search engines?",
        a: "Published websites are included in the sitemap and can be indexed. Private previews and app pages are not.",
      },
    ],
    related: ["/features/subscriber-app", "/follower-calculator", "/coaches"],
    availability: ["customDomains"],
  }),
  feature("nutrition", "Nutrition", {
    title: "Meal plan app for personal trainers",
    description:
      "An optional nutrition tier: AI meal plans, recipes and grocery lists that follow your guidance, plus a food diary, meal-photo estimates and barcode scanning.",
    h1: "Nutrition coaching that follows your guidance",
    intro:
      "Offer a higher-priced workout and nutrition tier. You teach your nutrition approach through cases, recipes and calorie methods; subscribers get weekly meal plans, recipes and grocery lists that follow it, and log meals with a food diary, photos and barcode scanning.",
    keyword: "meal plan app for personal trainers",
    does: [
      "Builds weekly meal plans from your recipes, rules and each subscriber’s targets and preferences.",
      "Suggests approved recipe swaps and consolidates a weekly grocery list.",
      "Keeps a food diary with corrections, favourites and weekly check-ins.",
      "Estimates foods and portions from a meal photo for the subscriber to confirm.",
      "Reads packaged foods by barcode for the subscriber to confirm.",
    ],
    subscriberSees: [
      "A week of meals with recipes, portions and a shopping list.",
      "Editable estimates: nothing is logged until they confirm it.",
      "Their progress against the targets you set.",
    ],
    youControl: [
      "Your nutrition teaching, recipes and calorie methods, evaluated before release.",
      "Each client’s calorie target and meal-plan edits.",
      "An exceptions queue for decisions outside your rules.",
    ],
    faqs: [
      {
        q: "Is this medical nutrition advice?",
        a: "No. Plans follow the general guidance and limits you teach, and decisions outside your rules go to your exceptions queue. It is coaching, not medical nutrition therapy.",
      },
      {
        q: "Can subscribers choose nutrition only?",
        a: "No. Nutrition is an optional tier on top of training: workout only, or workout and nutrition.",
      },
    ],
    related: ["/features/ai-training-plans", "/earnings-calculator", "/pricing"],
    availability: ["nutrition"],
    offering: "Optional tier",
  }),
  feature("voice-coach", "Voice coach", {
    title: "AI voice coach in your own voice",
    description:
      "An optional add-on where a voice in your own verified voice runs the workout session: cues, sets and rest, with your identity verified and your consent recorded.",
    h1: "Your voice, running the session",
    intro:
      "With the voice add-on, a voice in your own voice runs your subscribers’ workouts: it introduces each exercise, counts them through the session and calls the rest periods. Your identity is verified and your separate consent is recorded before your voice is used.",
    keyword: "AI voice coach in my own voice",
    does: [
      "Runs the guided session in your voice: exercise cues, sets and rest.",
      "Follows the same plan and safety rules as the written workout.",
      "Records voice usage cost and shows it on your statement.",
    ],
    subscriberSees: [
      "Their trainer’s voice guiding the workout, clearly disclosed as generated.",
      "The same pause and pain reporting as every workout.",
    ],
    youControl: [
      "Whether to offer voice, and its price as an add-on.",
      "Your consent, which you can withdraw.",
    ],
    faqs: [
      {
        q: "How is my voice protected?",
        a: "Your voice is used only after identity verification and your separate, recorded consent, only for your own subscribers, and you can withdraw consent.",
      },
      {
        q: "Does voice cost extra?",
        a: "Voice is an add-on you price for subscribers. The voice usage cost is passed through and itemised on your statement.",
      },
    ],
    related: ["/features/subscriber-app", "/earnings-calculator"],
    availability: ["voice"],
    offering: "Add-on",
  }),
  feature("bookings", "Bookings", {
    title: "Personal trainer booking app with paid sessions",
    description:
      "Sell one-to-one and group sessions alongside AI coaching: paid bookings in AED, cancellation rules, automatic refunds and calendar export.",
    h1: "Sell one-to-one sessions alongside your AI coaching",
    intro:
      "Sell one-to-one sessions next to your AI coaching, so subscribers who want more of you can book it. Publish one-off or weekly sessions; subscribers pay by card in AED, your cancellation rules decide refunds automatically, attendance is tracked and bookings export to their calendar.",
    keyword: "personal trainer booking app UAE",
    does: [
      "Publishes one-off or recurring session slots with capacity.",
      "Takes card payment at booking for paid sessions.",
      "Applies your cancellation window and refunds automatically when it allows.",
      "Tracks attendance and no-shows; exports bookings to calendars.",
    ],
    subscriberSees: [
      "Your upcoming sessions and their own bookings.",
      "Clear cancellation terms before they pay.",
    ],
    youControl: ["Session times, capacity and price.", "Your cancellation policy."],
    faqs: [
      {
        q: "Do paid sessions carry commission?",
        a: "Session payments follow the booking fee in your finance policy, shown on your statement, and are separate from the subscription commission bands.",
      },
    ],
    related: ["/earnings-calculator", "/features/payments-and-payouts"],
    availability: ["payments"],
  }),
  feature("chat-and-digital-coach", "Chat and digital coach", {
    title: "Client messaging for coaches, with a labelled digital coach",
    description:
      "Stay close to every subscriber without answering every message: private chat with you, a clearly labelled digital coach, takeover and photo or PDF attachments.",
    h1: "Stay close to every subscriber without answering every message",
    intro:
      "Subscribers can message you privately and ask a clearly labelled digital coach that answers from your teaching. Anything outside your rules, and every safety issue, comes to you. You can take over a subscriber at any time, so the digital coach steps back.",
    keyword: "client messaging app for coaches",
    does: [
      "Private trainer and subscriber threads with photo and PDF attachments.",
      "A digital coach that answers from your published teaching, labelled as digital.",
      "Personal takeover that pauses the digital coach for that subscriber.",
      "Scheduled check-in messages.",
    ],
    subscriberSees: [
      "Which replies come from you and which from the digital coach.",
      "A notice when you take over personally.",
    ],
    youControl: ["Takeover and hand-back.", "What the digital coach may answer."],
    faqs: [
      {
        q: "Will subscribers think the digital coach is me?",
        a: "No. Digital replies are labelled, and subscribers accept the AI disclosure when they join.",
      },
      SAFETY_FAQ,
    ],
    related: ["/trainer-brain", "/features/safety"],
    availability: ["model"],
  }),
  feature("progress-and-client-twin", "Progress and Client Twin", {
    title: "Client progress tracking with a Client Twin",
    description:
      "Every subscriber’s progress and coaching context in one view: completed sessions, volume, best loads, goals, preferences and permitted wearable data.",
    h1: "Every subscriber’s progress and context in one view",
    intro:
      "The Client Twin brings together what a subscriber told you, what they logged and what their wearables share with permission, each with its date and source. Subscribers see their own progress: completed sessions, training volume and best loads per exercise.",
    keyword: "client progress tracking app",
    does: [
      "Shows completed sessions, volume and best loads per exercise.",
      "Keeps goals, preferences and history in one coaching context.",
      "Imports Apple Health exports; WHOOP and Zepp connect when enabled.",
      "Marks missing information as unknown instead of guessing.",
    ],
    subscriberSees: ["Their own progress page.", "Their coaching context, which they can edit."],
    youControl: ["Your wearable data policy.", "What the Brain may use, within subscriber consent."],
    faqs: [
      {
        q: "Which wearables are supported?",
        a: "Apple Health exports can be imported. WHOOP and Amazfit / Zepp connections show “Available soon” until they are enabled on the platform.",
      },
    ],
    related: ["/features/ai-training-plans", "/security-and-privacy"],
    availability: ["whoop", "zepp"],
  }),
  feature("payments-and-payouts", "Payments and payouts", {
    title: "Accept online coaching payments in AED",
    description:
      "Card payments through Stripe in AED, your own programme length, monthly or upfront billing, trials and promotions, clear statements and monthly payouts to a UAE bank.",
    h1: "Get paid in AED, every month, to your UAE bank",
    intro:
      "Subscribers pay by card in AED through Stripe. You choose the programme length and whether it is billed monthly or upfront, add trials and promotion codes, and receive a monthly payout to your UAE bank account with a statement from gross revenue to net.",
    keyword: "accept payments online coaching AED",
    does: [
      "Card checkout in AED, with receipts and billing history for subscribers.",
      "Monthly or upfront billing for a programme length you set.",
      "Free trials and promotion codes.",
      "Refund requests you approve or decline, reconciled with the payment provider.",
      "Monthly statements and a ledger CSV export.",
      "Monthly payouts to a verified UAE IBAN.",
    ],
    subscriberSees: ["Your price and terms before paying.", "Their invoices, charges and refunds."],
    youControl: ["Price, programme length, billing, trials and promotions.", "Refund decisions."],
    extra: [
      {
        id: "statement",
        heading: "What your statement shows",
        bullets: [
          "Gross subscription revenue and commission by band.",
          "Payment processing fees.",
          "AI usage, passed through at cost, line by line.",
          "Optional services such as voice and your own domain.",
          "Refunds, disputes and any payout holds.",
        ],
      },
    ],
    faqs: [
      {
        q: "When do I get paid?",
        a: "Monthly, to your verified UAE bank account, after payments are reconciled. A newly changed bank account has a short hold for your protection.",
      },
      PRICE_FAQ,
    ],
    related: ["/pricing", "/earnings-calculator"],
    availability: ["payments", "payouts"],
  }),
  feature("safety", "Safety", {
    title: "Is an AI personal trainer safe? Safety rules in code",
    description:
      "Pain, medical issues and red flags are routed to the trainer by rules enforced in code, outside the AI. The workout pauses until the trainer reviews it.",
    h1: "Safety rules the AI cannot override",
    intro:
      "Safety in {APP_NAME} does not depend on the AI behaving. Rules enforced in code route pain, medical issues and red flags to the trainer, pause the workout and block normal training until the trainer reviews it. The service is coaching, not medical advice.",
    keyword: "is an AI personal trainer safe",
    does: [
      "A pain button in every workout pauses training and alerts you.",
      "Worrying messages in chat or intake trigger an automatic safety pause.",
      "Medical limitations from intake route decisions to you.",
      "Unresolved safety items escalate until they are reviewed.",
    ],
    subscriberSees: [
      "A paused workout and a message that their trainer will review it.",
      "Your decision, by chat and notification.",
      "A clear statement that the service is not medical advice.",
    ],
    youControl: ["Your decision on each safety pause, with a note.", "Resuming training when it is safe."],
    faqs: [
      SAFETY_FAQ,
      {
        q: "Can I switch safety routing off?",
        a: "No. Safety routing is part of the platform, not a setting, and applies to every trainer.",
      },
    ],
    related: ["/trainer-brain", "/security-and-privacy", "/demo"],
  }),
  feature("team", "Team", {
    title: "Coaching business team roles",
    description:
      "Bring coaches and finance staff into your workspace with restricted roles: staff coach without finance access, finance manages money without coaching data.",
    h1: "Bring your team",
    intro:
      "Invite staff coaches and finance members to your workspace. Staff see coaching screens but not finance, design or ownership settings; finance members see earnings, statements and payouts but not coaching conversations. You keep ownership of the brand and the Brain.",
    keyword: "coaching business team roles",
    does: [
      "Invites team members by email with a role.",
      "Restricts each role to the screens it needs.",
      "Records role changes and removals.",
    ],
    subscriberSees: ["One brand, whichever coach replies."],
    youControl: ["Who joins, their role and removal.", "Ownership transfer, if you ever need it."],
    faqs: [
      {
        q: "Can a staff coach see my earnings?",
        a: "No. Staff roles cannot open finance, design or ownership settings.",
      },
    ],
    related: ["/security-and-privacy", "/features/payments-and-payouts"],
  }),
  {
    path: "/pricing",
    kind: "page",
    group: "pricing",
    navLabel: "Pricing",
    title: "Online coaching platform fees and commission",
    description:
      "You set your price in AED. {APP_NAME} takes a marginal commission of 25%, 20%, 15% and 10% on subscription revenue, with AI costs passed through and monthly payouts.",
    h1: "You set the price. We take a transparent share.",
    eyebrow: "PRICING",
    intro:
      "You choose your subscription price in AED, the programme length and monthly or upfront billing. {APP_NAME} takes a commission on subscription revenue that falls as you grow: 25%, 20%, 15% and 10% in marginal bands. AI usage is passed through at cost and itemised.",
    primaryKeyword: "online coaching platform fees",
    sections: [
      {
        id: "how",
        heading: "How you earn",
        bullets: [
          "Subscribers pay you monthly or upfront, by card, in AED.",
          "Commission applies to subscription revenue by band.",
          "Your statement shows every cost, and payouts arrive monthly in your UAE bank account.",
        ],
      },
      {
        id: "bands",
        heading: "Marginal commission bands",
        table: {
          caption: "Each band applies only to the subscribers inside it",
          columns: ["Paying subscriber positions", "Rate in that band"],
          rows: [
            ["1-100", "25%"],
            ["101-300", "20%"],
            ["301-1,000", "15%"],
            ["Above 1,000", "10%"],
          ],
        },
        note: "Reaching a new band lowers the rate for subscribers in that band only; earlier bands keep their rate.",
      },
      {
        id: "statement",
        heading: "What else appears on your statement",
        bullets: [
          "Payment processing fees.",
          "AI usage, passed through at cost and listed line by line.",
          "Voice usage, if you offer the voice add-on.",
          "Your own domain, if you choose one.",
          "Refunds, disputes and any booking fee in your finance policy.",
        ],
      },
      {
        id: "billing",
        heading: "Programme length and billing",
        body: [
          "You set the length of each programme. Bill it monthly, or upfront for the whole programme. Add free trial days or promotion codes when you want them.",
        ],
      },
      {
        id: "payouts",
        heading: "Monthly payouts to a UAE bank",
        body: [
          "Earnings are paid monthly to your verified UAE IBAN after payments are reconciled. Holds, such as the short hold after a bank change, are shown on your statement.",
        ],
      },
    ],
    faqs: [
      PRICE_FAQ,
      {
        q: "What will I pay?",
        a: "Commission on subscription revenue by band, payment processing, AI usage at cost, and any optional services you choose, such as the voice add-on or your own domain. Every item appears on your monthly statement.",
      },
      {
        q: "Why is AI usage passed through?",
        a: "So you only pay for what your subscribers actually use, at cost, and can see it line by line instead of paying a hidden margin.",
      },
      {
        q: "How is commission counted when I have different prices?",
        a: "Each paying subscriber holds a position from their first payment. The band rate for that position applies to that subscriber’s charges.",
      },
    ],
    related: ["/earnings-calculator", "/follower-calculator", "/features/payments-and-payouts"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    cta: { label: "Estimate my earnings", href: "/earnings-calculator" },
  },
  {
    path: "/earnings-calculator",
    kind: "page",
    group: "pricing",
    navLabel: "Earnings calculator",
    title: "How much can a personal trainer earn online in Dubai?",
    description:
      "Estimate your monthly coaching income: subscribers, price, nutrition tier, voice add-on and sessions, with commission by band and the sessions it equals at your rate.",
    h1: "What could your coaching earn each month?",
    eyebrow: "EARNINGS CALCULATOR",
    intro:
      "Enter your subscribers, your price and the options you would offer. The calculator applies the marginal commission bands and shows what remains before other costs, and how many sessions at your usual rate that equals. It is arithmetic on your inputs, not an earnings promise.",
    primaryKeyword: "how much can a personal trainer earn online Dubai",
    sections: [
      {
        id: "assumptions",
        heading: "Assumptions",
        bullets: [
          "Commission follows the standard marginal bands of 25%, 20%, 15% and 10%.",
          "Upfront programmes are shown as a monthly equivalent: price divided by months.",
          "The tier mix and add-ons are assumed to be the same across all bands.",
          "The voice add-on is treated like subscription revenue in this estimate.",
          "Sessions are shown before any booking fee in your finance policy.",
          "Not included: payment processing, AI usage at cost, voice usage, domain, refunds, disputes and tax.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is this what I will earn?",
        a: "No. It is arithmetic on the numbers you enter. Real results depend on how many people subscribe, how long they stay, refunds and your costs.",
      },
      {
        q: "What does the sessions comparison mean?",
        a: "It divides the amount before other costs by your usual session rate, to show how many one-to-one sessions would earn the same.",
      },
    ],
    related: ["/follower-calculator", "/pricing", "/methodology"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebApplication", "FAQPage"],
  },
  {
    path: "/follower-calculator",
    kind: "page",
    group: "pricing",
    navLabel: "Follower calculator",
    title: "Instagram followers to paying clients calculator",
    description:
      "Estimate how many of your Instagram followers could become paying subscribers each month when you share your link, using cited reach, click and conversion benchmarks.",
    h1: "How many of your followers could become paying subscribers?",
    eyebrow: "FOLLOWER CALCULATOR",
    intro:
      "Enter your followers, how often you share your link in Stories and your price. The calculator applies published Story reach, link-click and purchase benchmarks to give a monthly range of new paying subscribers. It is an estimate from market research, never a promise.",
    primaryKeyword: "Instagram followers to clients calculator",
    sections: [
      {
        id: "how",
        heading: "How we calculate",
        steps: [
          { title: "Story views", body: "Followers × Story reach for your follower tier × link Stories per month. Reach comes from Socialinsider’s Stories benchmarks." },
          { title: "Visits", body: "Story views × link-sticker click-through. No industry benchmark exists, so we use the 1-5% creators report." },
          { title: "Subscribers", body: "Visits × purchase conversion of 1.51-5.39%, from Dynamic Yield’s e-commerce benchmarks." },
          { title: "Your engagement", body: "If you enter or connect your engagement rate, reach is scaled by your rate compared with the 0.48% average, within limits." },
        ],
        sources: ["socialinsider-stories", "creatorflow-link-sticker", "dynamicyield-conversion", "socialinsider-engagement"],
      },
      {
        id: "moves",
        heading: "What moves your number",
        bullets: [
          "Share more than once: each link Story is a new chance to be seen.",
          "Use more frames: Story reach rose from 6.3% for one frame to 20.5% by the sixth.",
          "Mix link Stories with ordinary ones: link stickers can reduce replies and shares.",
          "Make the offer clear: say who it is for, the price and what they get each day.",
          "Followers who never see your offer can’t subscribe.",
        ],
        sources: ["socialinsider-stories", "hootsuite-link-stickers", "nng-participation"],
      },
    ],
    faqs: [
      {
        q: "Is this a prediction of my results?",
        a: "No. It applies published averages to your inputs and shows a range. Your content, audience, offer and price change the real number.",
      },
      {
        q: "Can I use my real Instagram numbers?",
        a: "After you sign up, you can connect an Instagram professional account to fill in your follower count and recent engagement. We read those numbers once and do not keep access to your account.",
      },
      {
        q: "Why are the numbers lower than influencer marketing claims?",
        a: "Because most followers do not see any single Story, and most people who see an offer do not buy. The ranges use published benchmarks rather than best cases.",
      },
    ],
    related: ["/earnings-calculator", "/methodology", "/guides/instagram-followers-to-clients"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebApplication", "FAQPage"],
    cta: { label: "Claim your link", href: "/signup" },
  },
  {
    path: "/security-and-privacy",
    kind: "page",
    group: "product",
    navLabel: "Security and privacy",
    title: "Secure coaching platform: security and privacy",
    description:
      "How {APP_NAME} protects trainers and subscribers: authenticator apps and passkeys, database-level workspace isolation, encrypted keys, audit logs, consent and data export.",
    h1: "How we protect your business and your subscribers’ data",
    eyebrow: "SECURITY AND PRIVACY",
    intro:
      "Each workspace is isolated at the database layer, sign-in supports authenticator apps and passkeys, provider keys are encrypted, and sensitive actions are logged. Subscribers choose what their coaching data is used for and can export or delete it.",
    primaryKeyword: "secure coaching platform",
    sections: [
      {
        id: "sign-in",
        heading: "Sign-in security",
        bullets: [
          "Authenticator app codes, required again for sensitive actions.",
          "Passkeys and one-time recovery codes.",
          "A list of signed-in devices, with remote sign-out.",
        ],
      },
      {
        id: "isolation",
        heading: "Workspace isolation",
        body: [
          "Every trainer’s workspace is separated at the database layer, so one trainer’s subscribers, teaching and records are never visible to another. Subscribers see only their own records.",
        ],
      },
      {
        id: "keys",
        heading: "Keys, logs and transport",
        bullets: [
          "Provider keys are encrypted at rest.",
          "Sensitive actions are recorded in audit logs.",
          "Every page is served over HTTPS with security headers.",
        ],
      },
      {
        id: "consent",
        heading: "Consent, export and deletion",
        bullets: [
          "Separate choices for coaching data, marketing and optional analytics.",
          "Coaching-data consent can be withdrawn with one action.",
          "Trainers and subscribers can download their data and request deletion.",
        ],
      },
      {
        id: "ai",
        heading: "AI disclosure",
        body: [
          "Subscribers accept a digital coaching disclosure when they join, and digital guidance is always labelled.",
        ],
      },
    ],
    faqs: [
      {
        q: "Who can see my subscribers’ data?",
        a: "You and the team members whose role allows it. Other trainers cannot. Platform operators use separate, audited tools that require step-up sign-in.",
      },
      {
        q: "Is wearable data sent to the AI?",
        a: "Only when the subscriber’s permission and your policy allow that use.",
      },
    ],
    related: ["/features/safety", "/ai-disclosure", "/privacy"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    cta: { label: "Read the AI disclosure", href: "/ai-disclosure" },
  },
  {
    path: "/faq",
    kind: "page",
    group: "company",
    navLabel: "FAQ",
    title: "FAQ: questions trainers ask before they start",
    description:
      "Plain answers about the Trainer Brain, subscribers, money, safety, technology and advertising rules for personal trainers using {APP_NAME} in the UAE.",
    h1: "Questions trainers ask before they start",
    eyebrow: "FAQ",
    intro:
      "Short, plain answers to what trainers ask most: whether the AI replaces them, how it stays safe, who sets the price, how money reaches their bank, what the technology can do today and what UAE advertising rules mean for promoting their own coaching.",
    primaryKeyword: "AI personal trainer platform FAQ",
    sections: [],
    faqs: [
      REPLACE_FAQ,
      TRAINED_FAQ,
      {
        q: "Will it give bad advice under my name?",
        a: "The Brain acts on its own only where your confirmed rules make it confident. Everything else is handed to you, safety issues always come to you, and you can correct or roll back any release.",
      },
      {
        q: "Will my followers pay?",
        a: "Some will. Use the follower calculator for a realistic range based on published benchmarks, then test your offer. We never promise a number.",
      },
      {
        q: "What does a subscriber get for their money?",
        a: "A personalised, day-by-day plan in your method, guided workouts that adapt as they train, chat with you and a labelled digital coach, and optionally nutrition, voice and one-to-one sessions.",
      },
      PRICE_FAQ,
      {
        q: "How does money reach me?",
        a: "Subscribers pay by card in AED through Stripe. After reconciliation, your earnings are paid monthly to your verified UAE bank account, with a statement from gross to net.",
      },
      {
        q: "Is cancellation the same as a refund?",
        a: "No. A subscriber can stop renewal at the end of the period. A refund is a separate request that your policy decides.",
      },
      SAFETY_FAQ,
      {
        q: "Does it work offline?",
        a: "Yes. A workout opened online can be saved for the gym; logged sets sync when the connection returns.",
      },
      {
        q: "What can I connect?",
        a: "Apple Health exports today. WHOOP, Zepp, your own domain, the voice add-on and Instagram show “Available soon” until they are enabled on the platform.",
      },
      {
        q: "Do I need an advertiser permit to promote my own coaching?",
        a: "Reports on the UAE Advertiser Permit say people promoting their own services through personal accounts are exempt. Rules change, so check with the UAE Media Council. This is information, not legal advice.",
      },
    ],
    related: ["/how-it-works", "/pricing", "/guides/uae-advertiser-permit"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
    cta: { label: "Get started", href: "/get-started" },
  },
  {
    path: "/about",
    kind: "page",
    group: "company",
    navLabel: "About",
    title: "About {APP_NAME}",
    description:
      "{APP_NAME} makes personal training affordable to far more people by scaling real trainers’ judgment through a Trainer Brain each trainer teaches and controls.",
    h1: "About {APP_NAME}",
    eyebrow: "ABOUT",
    intro:
      "{APP_NAME} is a UAE platform that lets each personal trainer build a bespoke AI trainer, their Trainer Brain, from their own rules, cases and examples. It then sells personalised, day-by-day coaching to the trainer’s followers under the trainer’s own brand, priced in AED.",
    primaryKeyword: "{APP_NAME}",
    sections: [
      {
        id: "mission",
        heading: "Our mission",
        body: [
          "Make personal training affordable to far more people by scaling real trainers’ judgment, not by replacing trainers with a generic app.",
        ],
      },
      {
        id: "is-not",
        heading: "What we are, and what we are not",
        bullets: [
          "We are a platform for trainers: the brand, the method and the relationship stay theirs.",
          "We are not a generic workout generator.",
          "We are not a medical service.",
          "We do not replace the trainer: uncertain decisions and every safety issue go to them.",
        ],
      },
      {
        id: "money",
        heading: "How we make money",
        body: [
          "A commission on trainers’ subscription revenue in marginal bands of 25%, 20%, 15% and 10%. AI usage is passed through at cost, and optional services are itemised.",
        ],
      },
    ],
    faqs: [],
    related: ["/methodology", "/security-and-privacy", "/how-it-works"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["AboutPage"],
    cta: { label: "Get started", href: "/get-started" },
  },
  {
    path: "/methodology",
    kind: "page",
    group: "company",
    navLabel: "Methodology",
    title: "Methodology and sources",
    description:
      "Every market figure on {APP_NAME} with its source and date, and the assumptions behind the follower and earnings calculators, including their current values.",
    h1: "Methodology and sources",
    eyebrow: "METHODOLOGY",
    intro:
      "Every figure on this site that comes from outside {APP_NAME} is listed here with its source, the date we retrieved it and how we use it. The calculator assumptions below are the values the calculators use right now.",
    primaryKeyword: "methodology sources",
    sections: [
      {
        id: "principles",
        heading: "How we use figures",
        bullets: [
          "Price guides are published price guides, not official statistics.",
          "Benchmarks are averages across many accounts and industries; yours will differ.",
          "Estimates are shown as ranges, with their assumptions, and are never promises.",
          "We publish no customer counts, ratings or testimonials that we cannot show.",
        ],
      },
    ],
    faqs: [],
    related: ["/follower-calculator", "/earnings-calculator"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage"],
    cta: { label: "Back to the follower calculator", href: "/follower-calculator" },
  },
  {
    path: "/get-started",
    kind: "page",
    group: "trainers",
    navLabel: "Get started",
    title: "How to start online personal training in the UAE",
    description:
      "What you need to start: your identity, your method, an offer and a UAE bank account for payouts, then a guided setup checklist from address to launch.",
    h1: "Start your coaching business in {APP_NAME}",
    eyebrow: "GET STARTED",
    intro:
      "To start, you need your coaching method, a clear offer and a UAE bank account for payouts. A guided checklist takes you from claiming your address to teaching your Brain, testing it, setting your price and launching, and you can begin teaching before every business detail is ready.",
    primaryKeyword: "how to start online personal training UAE",
    sections: [
      {
        id: "need",
        heading: "What you need",
        bullets: [
          "Your identity and a short description of your coaching business.",
          "Your method: how you coach, and the limits you keep.",
          "An offer: who it is for, the price in AED, the programme length and billing.",
          "A UAE bank account (IBAN) for monthly payouts.",
        ],
      },
      {
        id: "checklist",
        heading: "The setup checklist",
        body: [
          "Each step shows its status. Nutrition steps are added if you offer the nutrition tier.",
        ],
      },
      {
        id: "after",
        heading: "After launch",
        bullets: [
          "Share your tagged link in your bio and Stories.",
          "Review what the Brain hands you; each correction teaches it.",
          "Watch where visitors come from, with their consent.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I start before I have a trade licence ready?",
        a: "Yes. You can set up your brand and teach your Brain while business details are collected. Payments and launch have their own checks.",
      },
      {
        q: "Do I need my own domain?",
        a: "No. Your coaching address is reserved when you sign up. An own domain is optional.",
      },
    ],
    related: ["/how-it-works", "/pricing", "/follower-calculator"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
  },
  {
    path: "/for-trainers",
    kind: "hub",
    group: "trainers",
    navLabel: "For trainers",
    title: "AI coaching for every training specialty",
    description:
      "How a Trainer Brain works for weight loss, strength, muscle gain, pre and postnatal, combat, yoga, pilates and endurance coaches, with illustrative rules and handoffs.",
    h1: "Your specialty, taught to your own Trainer Brain",
    eyebrow: "FOR TRAINERS",
    intro:
      "Every specialty has its own rules, progressions and red flags. Choose yours to see illustrative rules a trainer might teach, what always comes back to the trainer, an example programme outline and a follower estimate at an example price.",
    primaryKeyword: "online coaching platform for personal trainers",
    sections: [],
    faqs: [],
    related: ["/trainer-brain", "/uae"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["CollectionPage"],
  },
  specialty("weight-loss", "Weight loss", {
    who: "weight-loss coaches",
    keyword: "online weight loss coaching platform",
    description:
      "Scale your weight-loss coaching with a Trainer Brain that follows your rules on progression, adherence and nutrition, and hands you anything outside them.",
    intro:
      "Weight-loss coaching is steady, repeated decisions about training load, adherence and habits: the kind a Trainer Brain can apply every day from your rules. It adapts plans as subscribers log workouts and check-ins, and hands you anything outside what you taught.",
    rules: [
      { title: "Missed days", body: "When a subscriber misses two sessions in a week, keep next week’s volume the same instead of progressing." },
      { title: "Steady progress", body: "When weekly check-ins show steady progress, keep the plan and add one short conditioning finisher." },
      { title: "Stalled progress", body: "When there is no change for three weekly check-ins, flag the calorie target for review instead of cutting further." },
    ],
    handoffs: [
      "Any request for a very low-calorie diet or rapid weight-loss target.",
      "Reports of dizziness, fainting or chest discomfort during exercise.",
      "Disordered-eating signals in chat or check-ins.",
    ],
    programme: [
      ["Weeks 1-2", "Habits and consistency", "Adjusts days to the subscriber’s real schedule"],
      ["Weeks 3-8", "Progressive strength and conditioning", "Progresses load only when sessions are completed"],
      ["Weeks 9-12", "Consolidation", "Holds or deloads when adherence drops"],
    ],
    faqs: [
      { q: "Can the Brain set calorie targets?", a: "Targets follow the calorie methods you teach, and you can edit any client’s target. Requests outside your rules come to you." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 199,
  }),
  specialty("strength", "Strength", {
    who: "strength coaches",
    keyword: "online strength coaching platform",
    description:
      "Teach your progression, deload and technique rules once. Your Trainer Brain applies them to every lifter day by day and hands you anything it is unsure about.",
    intro:
      "Strength coaching runs on clear progression logic: load, reps in reserve, deloads and technique. Teach yours once and your Trainer Brain applies it to every lifter’s logged sets, progressing confidently where your rules allow and handing you anything unusual.",
    rules: [
      { title: "Progress on evidence", body: "After two sessions with all sets completed at three or more reps in reserve, add 2.5 kg to that lift." },
      { title: "Technique before load", body: "When a beginner reports form doubts, repeat the load and add a technique cue before progressing." },
      { title: "Deload", body: "After three weeks of rising effort at the same load, schedule a deload week at 60% volume." },
    ],
    handoffs: [
      "Joint pain during or after a lift.",
      "Requests to test a one-rep max without a coached session.",
      "A return from injury.",
    ],
    programme: [
      ["Weeks 1-3", "Technique and base volume", "Holds load until technique cues are confirmed"],
      ["Weeks 4-9", "Progressive overload", "Adds load from logged reps in reserve"],
      ["Week 10", "Deload", "Reduces volume automatically when effort rises"],
    ],
    faqs: [
      { q: "Does it read logged reps in reserve?", a: "Yes. Subscribers log reps, load and effort; your rules decide how those drive progression." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 249,
  }),
  specialty("muscle-gain", "Muscle gain", {
    who: "muscle-gain coaches",
    keyword: "online hypertrophy coaching platform",
    description:
      "Scale hypertrophy coaching: your Trainer Brain applies your volume, exercise selection and nutrition rules to every subscriber and adapts as they log sessions.",
    intro:
      "Muscle-gain coaching balances weekly volume, exercise choice, recovery and food. Teach your rules and your Trainer Brain builds each subscriber’s plan around their schedule and equipment, adjusts volume from their logs, and pairs with the optional nutrition tier.",
    rules: [
      { title: "Volume steps", body: "Add one set per muscle group per week while sessions are completed and recovery is reported as good." },
      { title: "Equipment swaps", body: "When a machine is unavailable, swap to the approved alternative for the same muscle and rep range." },
      { title: "Recovery", body: "When soreness is reported for three days running, hold volume for a week." },
    ],
    handoffs: [
      "Questions about supplements beyond your stated guidance.",
      "Sharp pain rather than muscle soreness.",
      "Rapid unexplained weight changes.",
    ],
    programme: [
      ["Weeks 1-4", "Base volume", "Sets volume from the subscriber’s experience"],
      ["Weeks 5-10", "Volume progression", "Adds sets from logged completion and recovery"],
      ["Weeks 11-12", "Deload and review", "Reduces volume, then suggests the next block"],
    ],
    faqs: [
      { q: "Can I pair it with meal plans?", a: "Yes. Offer the workout and nutrition tier so meal plans follow your nutrition teaching." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 229,
  }),
  specialty("pre-postnatal", "Pre and postnatal", {
    who: "pre and postnatal coaches",
    keyword: "online prenatal postnatal fitness coaching",
    description:
      "A careful way to scale pre and postnatal coaching: your rules plan routine sessions, and every symptom, clearance question or red flag comes straight to you.",
    intro:
      "Pre and postnatal coaching needs caution. A Trainer Brain can plan routine sessions within the limits you teach, while clearance questions, symptoms and red flags come straight to you, enforced in code. It is coaching, not medical advice.",
    rules: [
      { title: "Clearance first", body: "No programme starts until the subscriber confirms medical clearance for exercise." },
      { title: "Effort cap", body: "Keep effort at a level where the subscriber can hold a conversation; no breath-holding lifts." },
      { title: "Postnatal return", body: "Start with breathing and pelvic floor work before loaded core exercises." },
    ],
    handoffs: [
      "Any bleeding, dizziness, chest pain or reduced baby movement.",
      "Questions about diastasis or pelvic pain.",
      "Any change in medical advice from the subscriber’s doctor.",
    ],
    programme: [
      ["Early phase", "Gentle strength and mobility", "Keeps effort within your cap"],
      ["Middle phase", "Adapted strength", "Removes positions your rules exclude"],
      ["Postnatal return", "Breathing, pelvic floor, then strength", "Progresses only after the stage you set"],
    ],
    faqs: [
      { q: "Is this safe for pregnant clients?", a: "The platform does not give medical advice. It follows your limits, requires the steps you set such as clearance, and hands you the situations you mark as always yours. Pain reports always pause the workout." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 249,
  }),
  specialty("combat", "Combat", {
    who: "boxing and martial arts coaches",
    keyword: "online boxing coaching platform",
    description:
      "Scale conditioning and technique homework for boxing and martial arts: your Brain plans rounds, drills and conditioning, and hands you anything about sparring or injury.",
    intro:
      "Between classes, combat athletes need conditioning, drills and recovery. A Trainer Brain plans rounds, drills and strength work from your rules around each subscriber’s class schedule, and hands you anything about sparring, weight cuts or injury.",
    rules: [
      { title: "Class days", body: "Never schedule hard conditioning the day before a sparring class." },
      { title: "Round work", body: "Progress bag rounds from 3 to 6 over four weeks while form notes stay positive." },
      { title: "Hands", body: "Replace bag work with footwork drills when hand pain is reported, and alert the trainer." },
    ],
    handoffs: [
      "Any head impact symptoms.",
      "Weight-cut requests before a fight.",
      "Hand, wrist or shoulder pain.",
    ],
    programme: [
      ["Weeks 1-3", "Base conditioning and footwork", "Fits around class days"],
      ["Weeks 4-8", "Rounds and power", "Adds rounds as form notes allow"],
      ["Fight or test week", "Taper", "Reduces volume, hands decisions to you"],
    ],
    faqs: [
      { q: "Can it coach sparring?", a: "No. Sparring and contact work stay with you; the Brain plans conditioning, drills and recovery." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 199,
  }),
  specialty("yoga", "Yoga", {
    who: "yoga teachers",
    keyword: "online yoga teaching platform",
    description:
      "Offer a daily yoga practice built from your sequencing rules: your Trainer Brain plans sessions for each student’s level and time, and hands you anything it is unsure about.",
    intro:
      "Yoga students practise best with a daily plan that fits their level and time. Teach your sequencing and modification rules and your Trainer Brain builds each student’s week, offers the modifications you approve, and hands you injuries or anything it is unsure about.",
    rules: [
      { title: "Sequencing", body: "Warm the spine and hips before deep backbends; close with a down-regulating sequence." },
      { title: "Short days", body: "When a student has 20 minutes, keep the opening and closing and shorten the standing series." },
      { title: "Modifications", body: "Offer the knee-down variation when a student reports wrist discomfort." },
    ],
    handoffs: [
      "Pain during a pose, not just stretch sensation.",
      "Pregnancy or recent surgery.",
      "Dizziness in inversions.",
    ],
    programme: [
      ["Weeks 1-2", "Foundations and breath", "Sets session length from availability"],
      ["Weeks 3-6", "Building sequences", "Adds poses as foundations are logged"],
      ["Weeks 7-8", "Personal practice", "Suggests a repeatable home sequence"],
    ],
    faqs: [
      { q: "Can the voice add-on guide a yoga class?", a: "Yes, when the voice add-on is available, a voice in your own voice can guide the session’s cues and timing." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 149,
  }),
  specialty("pilates", "Pilates", {
    who: "pilates instructors",
    keyword: "online pilates instructor platform",
    description:
      "Scale mat pilates coaching with a Trainer Brain that follows your progressions and modifications, and hands you anything involving pain or special conditions.",
    intro:
      "Pilates progress depends on control before challenge. Teach your progressions and modifications, and your Trainer Brain plans each client’s mat sessions, moves them on only when they are ready, and hands you pain or special conditions.",
    rules: [
      { title: "Control first", body: "Progress to the next level only after a client logs three sessions with the current level marked controlled." },
      { title: "Neck support", body: "Offer head-down variations when neck strain is reported." },
      { title: "Frequency", body: "Schedule three short sessions a week for beginners, not one long one." },
    ],
    handoffs: [
      "Back pain that radiates or does not ease.",
      "Postnatal clients before the stage you set.",
      "Osteoporosis or other conditions that need special positions.",
    ],
    programme: [
      ["Weeks 1-3", "Breath, alignment and control", "Keeps to beginner variations"],
      ["Weeks 4-8", "Progressions", "Moves on when control is logged"],
      ["Weeks 9-10", "Flow and endurance", "Adjusts length to availability"],
    ],
    faqs: [
      { q: "Does it support reformer classes?", a: "The Brain plans what you teach it. In-studio reformer sessions can be sold as bookings alongside mat programmes." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 179,
  }),
  specialty("endurance", "Endurance", {
    who: "running and endurance coaches",
    keyword: "online running coach platform",
    description:
      "Plan every runner’s week from your rules on volume, intensity and recovery. Your Trainer Brain adapts to logged runs and missed days and hands you any injury signs.",
    intro:
      "Endurance plans are weekly volume, intensity and recovery, adjusted constantly. Teach your rules and your Trainer Brain builds each runner’s dated plan toward their event, adapts to logged runs and missed days, and hands you injury signs and race-week decisions.",
    rules: [
      { title: "Volume", body: "Increase weekly distance by no more than 10% and hold every fourth week." },
      { title: "Missed runs", body: "Drop a missed easy run; move a missed key session once, never back to back with another hard day." },
      { title: "Heat", body: "In summer, move key sessions to early morning and replace pace targets with effort targets." },
    ],
    handoffs: [
      "Pain that changes the runner’s stride.",
      "Heat illness symptoms.",
      "Race-week changes.",
    ],
    programme: [
      ["Weeks 1-4", "Base", "Builds volume from logged runs"],
      ["Weeks 5-10", "Build", "Adds key sessions, holds every fourth week"],
      ["Final weeks", "Taper and race", "Hands race-week decisions to you"],
    ],
    faqs: [
      { q: "Can it read runs from a watch?", a: "Apple Health exports can be imported. WHOOP and Zepp connect when they are enabled on the platform." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 179,
  }),
  {
    path: "/uae",
    kind: "hub",
    group: "uae",
    navLabel: "UAE",
    title: "Online coaching platform for personal trainers in the UAE",
    description:
      "Built for UAE personal trainers: AED pricing and card payments, monthly payouts to a UAE bank, an Arabic-ready layout and in-person session bookings.",
    h1: "For personal trainers in the UAE: take your coaching online",
    eyebrow: "UNITED ARAB EMIRATES",
    intro:
      "{APP_NAME} is built for trainers in the UAE: prices and card payments in AED, monthly payouts to a UAE bank account, an Arabic-ready layout and bookings for in-person sessions. Most of your future subscribers are likely already on Instagram.",
    primaryKeyword: "online coaching platform UAE",
    sections: [
      {
        id: "instagram",
        heading: "Your audience is already here",
        body: [
          "DataReportal counted 7.60 million Instagram users in the UAE at the start of 2025, equal to 67.8% of the population, and 99.0% of people online.",
        ],
        sources: ["datareportal-uae-2025"],
      },
      {
        id: "local",
        heading: "Built for the UAE",
        bullets: [
          "Prices, payments and statements in AED.",
          "Monthly payouts to a verified UAE IBAN.",
          "An Arabic-ready, right-to-left layout.",
          "Paid bookings for in-person sessions in your city.",
          "Timezone set to the UAE.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need a trade licence?",
        a: "You can start setting up and teaching your Brain without one; licence collection is handled separately and payments and launch have their own checks.",
      },
    ],
    related: ["/uae/dubai", "/uae/abu-dhabi", "/coaches"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["CollectionPage", "FAQPage"],
  },
  {
    path: "/uae/dubai",
    kind: "emirate",
    group: "uae",
    navLabel: "Dubai",
    title: "For personal trainers in Dubai: take your coaching online",
    description:
      "Dubai personal trainers can sell day-by-day AI coaching built from their own method, priced in AED, alongside in-person sessions. Local prices and context, cited.",
    h1: "For personal trainers in Dubai: take your coaching online",
    eyebrow: "DUBAI",
    intro:
      "Dubai is an active fitness market with a wide spread of prices. {APP_NAME} lets Dubai trainers keep their in-person sessions and add personalised online coaching built from their own method, at a monthly price more of their followers can afford.",
    primaryKeyword: "personal trainer Dubai online coaching",
    parent: "/uae",
    sections: [
      {
        id: "market",
        heading: "Dubai’s fitness market",
        body: [
          "Public participation in Dubai Fitness Challenge 2024 topped 2.73 million, according to the Dubai Media Office.",
        ],
        sources: ["dubai-fitness-challenge-2024"],
      },
      {
        id: "prices",
        heading: "What Dubai clients pay today",
        table: {
          caption: "Published price guides (not official statistics)",
          columns: ["Service", "Published range", "Source"],
          rows: [
            ["One-to-one session", "AED 70-350", "Hey Trainer, 2026"],
            ["One-to-one session", "AED 200-700+", "Embody Fitness, 2025"],
            ["Online coaching per month", "AED 400-2,000", "369MMAFIT, 2026"],
          ],
        },
        sources: ["heytrainer-dubai-2026", "embody-dubai-2025", "369mmafit-online-2026"],
      },
      {
        id: "offer",
        heading: "Online and in person, one brand",
        bullets: [
          "Sell day-by-day AI coaching at your own monthly price.",
          "Keep one-to-one sessions as paid bookings.",
          "Take payment in AED and receive monthly payouts to a UAE bank.",
        ],
      },
    ],
    faqs: [
      {
        q: "Looking for a coach in Dubai?",
        a: "Browse the coach directory to find independent coaches who chose to be listed.",
      },
    ],
    related: ["/uae/abu-dhabi", "/coaches", "/guides/pricing-online-coaching-uae"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
  },
  {
    path: "/uae/abu-dhabi",
    kind: "emirate",
    group: "uae",
    navLabel: "Abu Dhabi",
    title: "For personal trainers in Abu Dhabi: take your coaching online",
    description:
      "Abu Dhabi personal trainers can sell personalised AI coaching built from their own method, in AED, with in-person bookings and monthly payouts to a UAE bank.",
    h1: "For personal trainers in Abu Dhabi: take your coaching online",
    eyebrow: "ABU DHABI",
    intro:
      "More Abu Dhabi residents are active than before, and many want guidance they can afford every day. {APP_NAME} lets Abu Dhabi trainers offer personalised online coaching in their own method, priced in AED, next to their in-person sessions.",
    primaryKeyword: "personal trainer Abu Dhabi online coaching",
    parent: "/uae",
    sections: [
      {
        id: "market",
        heading: "An increasingly active emirate",
        body: [
          "The fourth Abu Dhabi Sports and Physical Activity Survey, by the Department of Community Development and Abu Dhabi Sports Council, found 60.3% of residents meet WHO physical activity standards, up from 53.6%, from about 31,000 responses.",
        ],
        sources: ["abu-dhabi-activity-survey-2026"],
      },
      {
        id: "offer",
        heading: "Online and in person, one brand",
        bullets: [
          "Sell day-by-day AI coaching at your own monthly price.",
          "Keep one-to-one sessions as paid bookings.",
          "Take payment in AED and receive monthly payouts to a UAE bank.",
        ],
      },
    ],
    faqs: [
      {
        q: "Looking for a coach in Abu Dhabi?",
        a: "Browse the coach directory to find independent coaches who chose to be listed.",
      },
    ],
    related: ["/uae/dubai", "/coaches", "/for-trainers"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
  },
  {
    path: "/guides",
    kind: "hub",
    group: "guides",
    navLabel: "Guides",
    title: "Guides for personal trainers going online in the UAE",
    description:
      "Practical guides for UAE personal trainers: pricing online coaching, turning Instagram followers into clients, the advertiser permit and writing coaching rules.",
    h1: "Guides for trainers taking their coaching online",
    eyebrow: "GUIDES",
    intro:
      "Practical, sourced guides for UAE personal trainers: how to price online coaching, how followers become paying clients, what the advertiser permit means for promoting your own coaching, and how to write rules an AI can follow.",
    primaryKeyword: "online personal training guide UAE",
    sections: [],
    faqs: [],
    related: ["/follower-calculator", "/pricing"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["CollectionPage"],
  },
  guide("pricing-online-coaching-uae", "Pricing online coaching", {
    title: "How to price online coaching in the UAE",
    description:
      "A sourced guide to pricing online coaching in the UAE: published session and monthly price ranges, positioning against one-to-one, and how commission affects your price.",
    h1: "How to price online coaching in the UAE",
    intro:
      "Price online coaching between what followers can afford and what your time is worth. Published Dubai guides put sessions at roughly AED 70-350 and online coaching at AED 400-2,000 a month; day-by-day AI coaching in your method can sit below one-to-one prices while serving many more people.",
    keyword: "how to price online coaching UAE",
    sections: [
      {
        id: "ranges",
        heading: "Published price ranges",
        table: {
          caption: "Published price guides (not official statistics)",
          columns: ["Service", "Published range", "Source"],
          rows: [
            ["One-to-one session in Dubai", "AED 70-350", "Hey Trainer, 2026"],
            ["One-to-one session in Dubai", "AED 200-700+", "Embody Fitness, 2025"],
            ["Online coaching, basic to premium, per month", "AED 400-2,000", "369MMAFIT, 2026"],
            ["Hybrid online and in person, per month", "AED 1,500-3,000", "369MMAFIT, 2026"],
          ],
        },
        sources: ["heytrainer-dubai-2026", "embody-dubai-2025", "369mmafit-online-2026"],
      },
      {
        id: "position",
        heading: "Position your AI coaching",
        bullets: [
          "Price below your one-to-one rate: subscribers get your method daily, not your hour.",
          "Keep a premium tier: nutrition, voice or included sessions.",
          "Consider upfront programmes for a defined outcome and length.",
          "Use trials or promotion codes to reduce the first step, not permanent discounts.",
        ],
      },
      {
        id: "commission",
        heading: "Include commission and costs",
        body: [
          "Commission falls from 25% to 10% as you grow, and AI usage is passed through at cost. Use the earnings calculator to see what remains before other costs at your price.",
        ],
      },
    ],
    faqs: [
      { q: "Should online coaching cost less than sessions?", a: "Usually. A monthly subscription to your method reaches people who cannot pay for regular sessions; your one-to-one time stays the premium option." },
    ],
    related: ["/earnings-calculator", "/pricing", "/uae/dubai"],
  }),
  guide("instagram-followers-to-clients", "Followers to clients", {
    title: "Turning Instagram followers into paying clients",
    description:
      "Why most followers never see a single Story, what published reach, click and conversion benchmarks suggest, and practical steps trainers can take to convert more.",
    h1: "Turning Instagram followers into paying clients",
    intro:
      "Only a small share of followers see any one Story, a few of them tap a link, and a few visitors buy. Published benchmarks put each step in single-digit percentages, so regular sharing, a clear offer and more frames matter more than follower count alone.",
    keyword: "how to monetise fitness followers",
    sections: [
      {
        id: "funnel",
        heading: "The follower funnel, with benchmarks",
        bullets: [
          "Reach: Stories reached about 9.6-10.4% of followers for accounts with 1-5K followers, and about 0.5-0.65% above 100K.",
          "Clicks: there is no industry benchmark for link stickers; creators report about 1-5% of viewers.",
          "Purchase: e-commerce converts about 2.72% of sessions globally, from 1.51% (APAC) to 5.39% (beauty and personal care).",
          "Participation: most people in online communities watch without acting.",
        ],
        sources: ["socialinsider-stories", "creatorflow-link-sticker", "dynamicyield-conversion", "nng-participation"],
      },
      {
        id: "steps",
        heading: "What you can do",
        bullets: [
          "Share your link in Stories regularly, not once.",
          "Use several frames: reach rose from 6.3% at one frame to 20.5% by the sixth.",
          "Mix link Stories with ordinary content: link stickers can reduce engagement.",
          "Keep your link in your bio, tagged so you can see which posts bring visitors.",
          "Engaged smaller audiences matter: nano accounts had the highest engagement, 2.19%.",
        ],
        sources: ["socialinsider-stories", "hootsuite-link-stickers", "hypeauditor-2025"],
      },
    ],
    faqs: [
      { q: "How many followers do I need?", a: "There is no minimum. Engagement and regular sharing matter; use the follower calculator with your own numbers." },
    ],
    related: ["/follower-calculator", "/methodology"],
  }),
  guide("uae-advertiser-permit", "Advertiser permit", {
    title: "The UAE advertiser permit: what trainers should know",
    description:
      "Information for trainers promoting their own coaching on social media in the UAE: what reports say about the Advertiser Permit and its exemption. Not legal advice.",
    h1: "The UAE advertiser permit: what trainers promoting their own coaching should know",
    intro:
      "Reports on the UAE Advertiser Permit say individuals promoting products or services on social media need one, paid or unpaid, while people promoting their own products or services through personal accounts are exempt. Rules change: check the UAE Media Council. This is information, not legal advice.",
    keyword: "UAE advertiser permit personal trainer",
    sections: [
      {
        id: "summary",
        heading: "What has been reported",
        bullets: [
          "The permit, known as Mu’lin, applies to individuals promoting products or services on social media, paid or unpaid.",
          "People promoting their own products or services, or their own company’s, through personal accounts are reported to be exempt.",
          "The permit was reported as free for three years for citizens and residents.",
        ],
        sources: ["gulfnews-advertiser-permit", "uae-media-council-permit"],
      },
      {
        id: "check",
        heading: "Check before you promote others",
        body: [
          "If you promote brands, gyms or supplements other than your own coaching, you may need a permit. Confirm current rules with the UAE Media Council or a legal adviser.",
        ],
      },
    ],
    faqs: [
      { q: "Does {APP_NAME} give legal advice?", a: "No. This guide summarises public reports; confirm your situation with the UAE Media Council or a legal adviser." },
    ],
    related: ["/faq", "/guides/instagram-followers-to-clients"],
  }),
  guide("writing-coaching-rules", "Writing coaching rules", {
    title: "How to write coaching rules your AI can follow",
    description:
      "A practical format for coaching rules an AI trainer can apply consistently: when, what to do, unless, why, plus how to test rules with held-out scenarios.",
    h1: "How to write coaching rules your AI can follow",
    intro:
      "A good coaching rule names the situation, the action, the exceptions and the reason, in plain language. Write it as “When…, do…, unless…, because…”, cite where it comes from, and test it on scenarios you did not use to write it.",
    keyword: "how to write coaching rules for AI",
    sections: [
      {
        id: "format",
        heading: "The format",
        steps: [
          { title: "When", body: "The situation, as a subscriber would describe it or as their logs show it." },
          { title: "Do", body: "The specific action, with numbers where you use them." },
          { title: "Unless", body: "The exceptions that change your answer." },
          { title: "Because", body: "Your reason, so the Brain can tell similar situations apart." },
        ],
      },
      {
        id: "example",
        heading: "An example",
        cards: [
          {
            title: "Progression",
            label: "Illustrative",
            body: "When a client completes every set with three or more reps in reserve for two sessions, add 2.5 kg to that lift, unless they reported pain or poor sleep that week, because load should follow evidence of recovery.",
          },
        ],
      },
      {
        id: "test",
        heading: "Test with held-out scenarios",
        body: [
          "Write situations you did not use while writing the rules, with the answer you expect, including cases that should come to you. {APP_NAME} requires at least 20 before a Brain can be published.",
        ],
      },
    ],
    faqs: [
      { q: "How many rules do I need?", a: "Start with the decisions you make most often. Anything not covered is handed to you, and your answers become new teaching." },
    ],
    related: ["/trainer-brain", "/demo"],
  }),
  {
    path: "/terms",
    kind: "legal",
    group: "legal",
    navLabel: "Terms",
    title: "Terms of service",
    description: "The terms of service for {APP_NAME} trainers and subscribers, as currently published.",
    h1: "Terms of service",
    eyebrow: "LEGAL",
    intro: "",
    primaryKeyword: "terms",
    sections: [],
    faqs: [],
    related: [],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage"],
    renderer: "workspace",
  },
  {
    path: "/privacy",
    kind: "legal",
    group: "legal",
    navLabel: "Privacy",
    title: "Privacy policy",
    description: "How {APP_NAME} collects, uses and protects personal data, as currently published.",
    h1: "Privacy policy",
    eyebrow: "LEGAL",
    intro: "",
    primaryKeyword: "privacy",
    sections: [],
    faqs: [],
    related: [],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage"],
    renderer: "workspace",
  },
  {
    path: "/ai-disclosure",
    kind: "legal",
    group: "legal",
    navLabel: "Digital coaching disclosure",
    title: "Digital coaching disclosure",
    description: "How digital coaching works on {APP_NAME}, what it does and does not do, and when a trainer is involved.",
    h1: "Digital coaching disclosure",
    eyebrow: "LEGAL",
    intro: "",
    primaryKeyword: "AI disclosure",
    sections: [],
    faqs: [],
    related: [],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage"],
    renderer: "workspace",
  },
];
