// Copy for the public marketing site. Rules for editors:
// - Describe only what the platform does (see docs/features and
//   docs/features/marketing-site.md). No invented testimonials, logos,
//   customer counts, ratings, awards or statistics.
// - Every market figure cites a MARKETING_SOURCES entry and appears on
//   /methodology. Earnings figures are estimates; the follower calculator
//   headlines a strong case (a best case, not typical) with cautious and
//   typical scenarios, and every assumption shown.
// - Never name the domain registrar or the payout provider.
// - {APP_NAME} is replaced with the configured platform name.
// - Copy limits (docs/features/marketing-site.md "Copy limits"): H1 at most 8
//   words, eyebrow 4, hero lede 25, H2 6, card titles 4 and bodies 18,
//   bullets 12 (5 per list), FAQ answers 45. Long detail belongs on a deeper
//   page, not on the home page.
import { BRAND_COPY } from "./brand.ts";
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
    evidence: "Measured",
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
    evidence: "Official statistic",
    published: "29 November 2024",
    retrieved: RETRIEVED,
    claim: "Public participation in Dubai Fitness Challenge 2024 topped 2.73 million.",
    usedFor: "Dubai context on the UAE page.",
  },
  {
    id: "abu-dhabi-activity-survey-2026",
    publisher: "Gulf News",
    title:
      "Abu Dhabi residents are getting fitter, and the numbers prove it (Fourth Abu Dhabi Sports and Physical Activity Survey)",
    url: "https://gulfnews.com/uae/health/abu-dhabi-residents-are-getting-fitter-and-the-numbers-prove-it-1.500559563",
    evidence: "Press report",
    published: "1 June 2026",
    retrieved: RETRIEVED,
    claim:
      "60.3% of Abu Dhabi residents meet WHO physical activity standards, up from 53.6%, in the fourth survey by the Department of Community Development and Abu Dhabi Sports Council (about 31,000 responses).",
    usedFor: "Abu Dhabi context on the UAE page.",
  },
  {
    id: "heytrainer-dubai-2026",
    publisher: "Hey Trainer",
    title: "Personal trainer cost in Dubai",
    url: "https://www.heytrainer.ae/blog/personal-trainer-cost-dubai",
    evidence: "Published price guide",
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
    evidence: "Published price guide",
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
    evidence: "Published price guide",
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
    evidence: "Measured, brand accounts",
    published: "2025",
    retrieved: RETRIEVED,
    claim:
      "Stories reach rate by follower tier (image / video): 1-5K 9.55% / 10.40%; 5-10K 3.50% / 4.20%; 10-50K 1.35% / 2.00%; 50-100K 0.55% / 0.65%; 100K-1M 0.50% / 0.65%. Reach rises from 6.3% for a one-frame Story to 20.5% by the sixth frame, across accounts of all sizes. 161,180 Stories, January-May 2024 and 2025.",
    usedFor:
      "Story audience of the follower calculator: the image reach in the cautious scenario and the video reach (at least 5%) in the typical one. The strong case applies the 20.5% six-frame reach as a monthly audience up to 10,000 followers: our assumption, well above the measured 3.5-4.2% for 5,001-10,000 followers. Reach is the share of followers who viewed at least one frame, so repeat Stories in a month are treated as reaching the same people.",
  },
  {
    id: "socialinsider-engagement",
    publisher: "Socialinsider",
    title: "Instagram benchmarks",
    url: "https://www.socialinsider.io/social-media-benchmarks/instagram",
    evidence: "Measured, brand accounts",
    published: "2025",
    retrieved: RETRIEVED,
    claim:
      "Average Instagram engagement rate by followers (likes plus comments divided by followers) was 0.48% across 35 million posts from 447,613 pages in 2025, down 24% year on year. Median views and comments per Reel by follower tier give about 0.52%, 0.60%, 0.49%, 0.36% and 0.37% comments per view (our division of the published medians). Yearly follower growth in 2025 by tier: 1-5K 22.00%, 5-10K 20.29%, 10-50K 17.20%, 50-100K 13.62%, 100K-1M 11.25%.",
    usedFor:
      "Engagement benchmark the follower calculator compares your own rate against, comments per Reel view for the keyword DM funnel, and the typical scenario's new people each month (about 1.5%, near the measured growth of 1-1.7% a month).",
  },
  {
    id: "hypeauditor-2025",
    publisher: "HypeAuditor",
    title: "State of Influencer Marketing 2025",
    url: "https://hypeauditor.com/state-of-influencer-marketing-2025/",
    evidence: "Vendor data",
    published: "2025 (2024 data)",
    retrieved: RETRIEVED,
    claim:
      "Nano-influencers (1K-10K followers) make up 76% of Instagram influencers and have the highest engagement rate, 2.19%.",
    usedFor:
      "Context that smaller, engaged audiences are valuable, why the strong case treats every account up to 10,000 followers alike, and why your engagement does not raise the strong Story share again. Influencer post engagement, not Story reach.",
  },
  {
    id: "creatorflow-link-sticker",
    publisher: "Creatorflow",
    title: "Instagram Story link sticker",
    url: "https://creatorflow.so/blog/instagram-story-link-sticker/",
    evidence: "Rule of thumb",
    published: "May 2026",
    retrieved: RETRIEVED,
    claim:
      "There is no industry-standard published benchmark for Story link-sticker click-through; creators report roughly 1-5% of viewers, and below 5% is typical.",
    usedFor:
      "Link click per viewer per link Story: 1% cautious, 3% typical, 5% strong (creator reports; no industry benchmark exists).",
  },
  {
    id: "hootsuite-link-stickers",
    publisher: "Hootsuite",
    title: "Do links in Instagram Stories ruin engagement? (experiment)",
    url: "https://blog.hootsuite.com/adding-links-instagram-stories-ruin-engagement/",
    evidence: "Experiment",
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
    evidence: "Measured; used as a proxy",
    published: "trailing 12 months",
    retrieved: RETRIEVED,
    claim:
      "Global e-commerce conversion rate 2.72% per session; EMEA 2.89%, Americas 2.66%, APAC 1.51%; by industry from luxury and jewellery 0.72% to beauty and personal care 5.39%.",
    usedFor:
      "Visit to paid in the cautious scenario: 0.72% (luxury and jewellery, the high-consideration retail rate). A retail e-commerce purchase rate; no published benchmark exists for coaching subscriptions.",
  },
  {
    id: "unbounce-landing-pages",
    publisher: "Unbounce",
    title: "What's a good conversion rate?",
    url: "https://unbounce.com/landing-pages/whats-a-good-conversion-rate/",
    evidence: "Measured",
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
    evidence: "Rule of thumb",
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
    evidence: "Platform statement",
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
    evidence: "Press report",
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
    evidence: "Press report",
    published: "1 August 2025",
    retrieved: RETRIEVED,
    claim:
      "The UAE Advertiser Permit (Mu'lin) is required for anyone creating advertising content on social media, paid or unpaid. People promoting their own products or services, or their own company's, through personal accounts are exempt. Applicants must be at least 18 with no past media content violations; citizens and residents need a valid electronic media trade licence. Free of charge for three years for citizens and residents; valid one year (renewable) for residents and three months for visitors. Applications through the UAE Media Council website.",
    usedFor: "The advertiser permit guide (information only).",
  },
  {
    id: "uae-media-council-permit",
    publisher: "UAE Media Council",
    title: "Announcement of the Advertiser Permit",
    url: "https://uaemc.gov.ae/en/news/%D9%85%D8%AC%D9%84%D8%B3-%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA-%D9%84%D9%84%D8%A5%D8%B9%D9%84%D8%A7%D9%85-%D9%8A%D8%B7%D9%84%D9%82-%D8%AA%D8%B5%D8%B1%D9%8A%D8%AD-%D9%85%D8%B9%D9%84%D9%86/",
    evidence: "Official announcement",
    retrieved: RETRIEVED,
    claim:
      "The official announcement of the Advertiser Permit (the page did not load when checked on 28 September 2026).",
    usedFor: "The authority to check for current permit rules.",
  },
  {
    id: "socialinsider-reach",
    publisher: "Socialinsider",
    title: "Social media reach statistics",
    url: "https://www.socialinsider.io/blog/social-media-reach/",
    evidence: "Measured, brand accounts",
    published: "3 September 2026",
    retrieved: RETRIEVED,
    claim:
      "Instagram feed-post reach by follower tier, as a share of followers: 1-5K 6.65%; 5-10K 5.75%; 10-50K 5.50%; 50-100K 4.50%; 100K-1M 3.50%. 872,075 posts by brand pages, January 2025-August 2026.",
    usedFor:
      "Reach of a call-to-action Reel or post in the cautious scenario.",
  },
  {
    id: "socialinsider-reels",
    publisher: "Socialinsider",
    title: "Instagram Reels statistics",
    url: "https://www.socialinsider.io/blog/instagram-reels-statistics/",
    evidence: "Measured, brand accounts",
    published: "24 June 2026",
    retrieved: RETRIEVED,
    claim:
      "Reels reach by follower tier: 1-5K 9.78%; 5-10K 7.55%; 10-50K 7.10%; 50-100K 5.60%; 100K-1M 5.00%. 140,000 Reels published by business pages, January-June 2026.",
    usedFor: "Reach of a call-to-action Reel in the typical and strong scenarios.",
  },
  {
    id: "metricool-2026",
    publisher: "Metricool",
    title: "Instagram study 2026",
    url: "https://metricool.com/press-release-instagram-study-2026/",
    evidence: "Measured",
    published: "16 June 2026",
    retrieved: RETRIEVED,
    claim:
      "Posts with a comment call to action received 202.78% more comments than the average. 24,364,803 posts from 375,118 accounts.",
    usedFor:
      "Keyword comments per Reel view: ordinary comments per view × 2.03. Treating the extra comments as keyword comments is our inference.",
  },
  {
    id: "meta-instagram-ranking",
    publisher: "Instagram",
    title: "Instagram ranking explained",
    url: "https://about.instagram.com/blog/announcements/instagram-ranking-explained/",
    evidence: "Platform statement",
    published: "31 May 2023",
    retrieved: RETRIEVED,
    claim:
      "Stories are ranked by how often you view an account's Stories, how often you engage with them and how close you are to the author. Most of the Reels people see come from accounts they don't follow.",
    usedFor:
      "Why repeat Stories reach the same people, and why Reels count as reaching new people in the typical and strong scenarios.",
  },
  {
    id: "iqfluence-engagement",
    publisher: "IQFluence",
    title: "Instagram engagement rate",
    url: "https://iqfluence.io/public/blog/engagement-rate-instagram",
    evidence: "Vendor claim, no dataset",
    published: "18 June 2026",
    retrieved: RETRIEVED,
    claim: "Story views above 5-8% of followers mean the audience is showing up.",
    usedFor:
      "The typical Story audience floor (5%) and the strong Story audience above 10,000 followers (8%, 6.5% and 5%).",
  },
  {
    id: "iqfluence-story-links",
    publisher: "IQFluence",
    title: "How to add a link to an Instagram Story",
    url: "https://iqfluence.io/public/blog/how-to-add-a-link-to-instagram-story",
    evidence: "Vendor data",
    published: "14 May 2026",
    retrieved: RETRIEVED,
    claim:
      "Link-sticker tap-through median 4.1%, strong creators 6-7%; bio links 1-2% of profile visitors. The sample is not disclosed.",
    usedFor: "Supports the 1-5% link click range; the strong case uses 5%.",
  },
  {
    id: "communipass-auto-dm",
    publisher: "CommuniPass",
    title: "Auto-DM statistics 2026: open rates and conversion benchmarks",
    url: "https://communipass.com/blog/auto-dm-statistics-2026-open-rates-conversion-benchmarks/",
    evidence: "Vendor claim, no dataset",
    published: "2026",
    retrieved: RETRIEVED,
    claim:
      "Automated DMs are opened by 70-90% of recipients within the first hour, and a link in a DM to a high-intent recipient gets 18-35% click-through. No sample or method is disclosed.",
    usedFor:
      "Share of keyword commenters who open the link sent by DM: 18% cautious, 30% typical, 45% strong.",
  },
  {
    id: "chatautodm-2026",
    publisher: "ChatAutoDM",
    title: "Instagram automation statistics 2026",
    url: "https://www.chatautodm.com/blog/instagram-automation-statistics-2026",
    evidence: "Vendor claim, no dataset",
    published: "10 June 2026",
    retrieved: RETRIEVED,
    claim:
      "Instagram DM automation: open rates of 80-90% (88% on average) and link click-through of 25-45% (35% on average), collected from brands, agencies and creators. No sample or method is disclosed.",
    usedFor: "The top of the DM link range (45%) used in the strong case.",
  },
  {
    id: "hopp-bio-link",
    publisher: "Hopp by Wix",
    title: "Understanding CTR and clicks on your link in bio",
    url: "https://www.hopp.co/post/understanding-ctr-and-clicks-on-your-link-in-bio",
    evidence: "Rule of thumb",
    retrieved: RETRIEVED,
    claim:
      "Link-in-bio click-through benchmarks sit between 1% and 3% of profile visits; niche audiences with high purchase intent may reach 8-10%.",
    usedFor:
      "Bio-link clicks per profile visitor a month: 1% cautious, 2% typical, 3% strong. Counted only when you enter your profile visits.",
  },
  {
    id: "mailerlite-benchmarks",
    publisher: "MailerLite",
    title: "Email marketing benchmarks by industry",
    url: "https://www.mailerlite.com/blog/compare-your-email-performance-metrics-industry-benchmarks",
    evidence: "Measured; used as a proxy",
    published: "3 December 2025, updated 7 April 2026",
    retrieved: RETRIEVED,
    claim:
      "Median email click rates: sports 1.27%, health and fitness 1.45%, all industries 2.09%. 3.6 million campaigns, December 2024-November 2025.",
    usedFor:
      "Broadcast channel link clicks per member per message (email stands in; no Instagram benchmark exists).",
  },
  {
    id: "revenuecat-state-2026",
    publisher: "RevenueCat",
    title: "State of Subscription Apps 2026",
    url: "https://www.revenuecat.com/state-of-subscription-apps",
    evidence: "Measured; used as a proxy",
    published: "2026",
    retrieved: RETRIEVED,
    claim:
      "Health & Fitness apps convert a median 2.9% of downloads to paid within 35 days; the upper quartile converts 6.2%. Over 115,000 apps.",
    usedFor:
      "Visit to paid in the typical scenario (2.9%, the median) and the strong case (6.2%, the upper quartile). An app install shows more intent than a Story tap, so both may overstate.",
  },
  {
    id: "revenuecat-trends-2026",
    publisher: "RevenueCat",
    title: "Subscription app trends and benchmarks 2026",
    url: "https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026",
    evidence: "Measured; used as a proxy",
    published: "19 March 2026, updated 22 April 2026",
    retrieved: RETRIEVED,
    claim:
      "Apps with a hard paywall have a median day-35 trial-to-paid conversion of 10.7%, against 2.1% for freemium apps, across all app categories. Over 115,000 apps and USD 16 billion in revenue.",
    usedFor:
      "Context only, not a rate the calculator uses: an all-category median that counts trial conversions and app installs, so it would overstate a Story visitor's chance of paying. The strong case uses the Health & Fitness upper quartile (6.2%) instead.",
  },
  {
    id: "revenuecat-renewals",
    publisher: "RevenueCat",
    title: "Average subscription renewal rates by app category",
    url: "https://www.revenuecat.com/blog/growth/average-subscription-renewal-rates-by-app-category",
    evidence: "Measured",
    published: "updated 24 April 2026",
    retrieved: RETRIEVED,
    claim:
      "Health & Fitness monthly plans: 46% (lower quartile), 57% (median) and 68% (upper quartile) renew for a second month.",
    usedFor:
      "Context for the cancellations you enter: many app subscribers leave after one month, more than the 30% a year default assumes.",
  },
  {
    id: "coachway-2026",
    publisher: "Coachway",
    title: "Online fitness coaching statistics",
    url: "https://coachway.io/articles/online-fitness-coaching-statistics/",
    evidence: "Vendor data",
    published: "August 2026, updated 6 September 2026",
    retrieved: RETRIEVED,
    claim:
      "Human online coaching: 45% of 5,666 Nordic clients were still active at month 12, about 6.4% leaving a month (derived from the retention curve, not measured directly).",
    usedFor: "Context for the cancellations you enter.",
  },
  {
    id: "passion-creator-rates",
    publisher: "Passion.io",
    title: "Creator app revenue: calculate your course and subscription earnings",
    url: "https://passion.io/blog/creator-app-revenue-calculate-your-course-subscription-earnings",
    evidence: "Rule of thumb",
    published: "19 October 2025",
    retrieved: RETRIEVED,
    claim:
      "Course conversion rates of 0.1-1% (low), 1.5-5% (mid) and 6-10% (highly optimised) of an audience; 0.52-1.1% for higher-priced courses; its worked example uses 2%.",
    usedFor:
      "Comparison for the strong case: its 12-month sign-ups (about 2% of followers up to 10,000) sit in the mid band, well above the 0.52-1.1% for higher-priced courses, so it is a best case, not a typical result.",
  },
  {
    id: "stan-creator-economy",
    publisher: "Stan",
    title: "The state of the creator economy 2026",
    url: "https://stan.store/blog/state-of-the-creator-economy/",
    evidence: "Vendor data",
    published: "21 July 2026",
    retrieved: RETRIEVED,
    claim:
      "Average monthly sales per creator by follower count: under 1K USD 89; 1-10K USD 273; 10-100K USD 666; 100K+ USD 1,378. Data from over 80,000 creators.",
    usedFor:
      "Comparison for the strong case: its monthly amount is far above these averages (for example, USD 273 a month for 1-10K followers). Larger accounts sell more in total but less per follower, so the strong case uses lower rates for larger accounts.",
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
  { key: "interview", label: "Coaching interview", required: false, summary: "Explain your recommendations, reasons and limits." },
  { key: "uploads", label: "Source material", required: false, summary: "Import your own documents and review the extracted text." },
  { key: "knowledge", label: "Knowledge review", required: true, summary: "Confirm your rules and resolve conflicts between sources." },
  { key: "scenarios", label: "Practice quiz", required: true, summary: "Take the practice quiz and write 3 to 5 of your own client questions." },
  { key: "readiness", label: "Brain readiness", required: true, summary: "Publish your evaluated Brain and choose what runs automatically." },
  { key: "offer", label: "Your offer", required: true, summary: "Set your price, programme length and billing." },
  { key: "payout", label: "Bank details", required: false, summary: "Asked at your first payout, not before launch." },
  { key: "wearables", label: "Wearable policy", required: false, summary: "Choose whether subscribers can share wearable data." },
  { key: "voice", label: "Optional voice", required: false, summary: "Verify and consent to your own voice for guided sessions." },
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
    /** Items the code-enforced safety floor already pauses (safetySignal). */
    floor: string[];
    /** Items a trainer might choose to route to themselves (never floor items). */
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
    title: `AI platform for ${options.who}`,
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
        id: "floor",
        heading: "Always paused and sent to you, enforced in code",
        body: [
          "Pain, pregnancy, chest pain, dizziness, fainting, bleeding and other red flags pause training and come to you. This is enforced in code, outside the AI, and no setting can switch it off. In this specialty that includes:",
        ],
        bullets: options.floor,
      },
      {
        id: "handoffs",
        heading: "What you might choose to review yourself",
        body: [
          "The Brain already hands you anything it is not confident about. Beyond the safety floor you decide what else comes to you: add your own red-flag terms, which also pause training, switch on review topics such as medication or supplements, or teach rules that hand a situation to you. Examples a trainer in this specialty might set:",
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
          "The follower calculator below starts from an example price. Change it to your own. The headline is a strong case for an engaged, growing audience, with cautious and typical results under How we estimate; it is an estimate from cited benchmarks and stated assumptions, not a promise.",
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
  a: "It is taught with your material: confirmed rules, coaching cases, examples and corrections. Each version is tested on held-out scenarios and can be rolled back. We do not claim to fine-tune a separate model on you, and your teaching stays private to your workspace.",
};
const TECH_FAQ: MarketingFaq = {
  q: "Do I need technical skills?",
  a: "No. Setup is a guided checklist: answer interview questions, confirm rules in plain language, test scenarios and set your offer. Your website and app are set up for you.",
};
const INSTAGRAM_FAQ: MarketingFaq = {
  q: "How do my Instagram followers become subscribers?",
  a: "You share your coaching link in your bio and Stories. Followers open your branded page, choose your offer and pay in AED. The follower calculator headlines a strong case: a best case, not typical. Cautious and typical results show too. An estimate, not a promise.",
};
/**
 * The home page's answer-first introduction (35-65 words, opening with the
 * copy bank's "Teach your own AI how you coach"). The hero shows the short
 * lede; this answers the first home FAQ and leads the page in llms-full.txt.
 */
const HOME_INTRO =
  "Teach your own AI how you coach: your rules, cases and examples. It builds and adapts each subscriber’s plan day by day, hands you anything it isn’t sure about, and sends pain and medical red flags straight to you. Build a paid coaching offering around your methods, your identity and your standards, priced in AED.";

export const MARKETING_CONTENT: MarketingPage[] = [
  {
    path: "/",
    kind: "home",
    group: "product",
    navLabel: "Home",
    title: "AI personal trainer platform for UAE coaches",
    // 28 September 2026 refresh: the H1 says what happens (the trainer
    // teaches, the platform trains their subscribers); the brand line leads
    // the description and closes every page. Removed home blocks now live
    // on deeper pages (docs/features/marketing-site.md "Where the home
    // content went").
    description:
      "Your coaching. Beyond your hours. Teach your AI how you coach; it trains your subscribers day by day under your brand, priced in AED.",
    h1: BRAND_COPY.homeHeadline,
    h1Highlight: "trains",
    eyebrow: "FOR PERSONAL TRAINERS",
    // One name in the hero ("your AI", as in the H1 and the call to
    // action); the relay's loop is the only place that says it asks you.
    lede: "Share your methods and rules. Your AI coaches every subscriber day by day, your way.",
    intro: HOME_INTRO,
    primaryKeyword: "AI personal trainer platform",
    sections: [
      {
        id: "subscribers",
        heading: "What your subscribers get",
        body: ["A plan for every day, built your way, that adapts as they train."],
      },
      {
        id: "control",
        heading: "You stay in charge",
        body: [
          "You choose what runs on its own. Take over any subscriber, any time.",
        ],
      },
      {
        id: "economics",
        heading: "Your site. Your price.",
        body: [
          "Your own coaching site and app, under your name. You set the price in AED.",
          "Our share starts at 25% and falls as you grow. Card processing is itemised.",
        ],
      },
      {
        id: "followers",
        heading: "What are your followers worth?",
        body: ["The headline is a strong case for an engaged, growing audience, from published benchmarks and our stated assumptions. An estimate, not a promise."],
      },
    ],
    faqs: [
      { q: "How does {APP_NAME} work?", a: HOME_INTRO },
      REPLACE_FAQ,
      SAFETY_FAQ,
      PRICE_FAQ,
      TECH_FAQ,
      INSTAGRAM_FAQ,
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
    title: "How an AI trainer built from your method works",
    description:
      "Eight steps from your address to monthly payouts: teach your Trainer Brain, test it, publish your offer, share your link and let it coach every day.",
    h1: "How {APP_NAME} turns your method into personalised coaching",
    eyebrow: "HOW IT WORKS",
    lede: "Teach it your method, test it, then publish. It coaches every subscriber day by day and hands you what it’s unsure about.",
    intro:
      "You teach a Trainer Brain your rules, cases and examples. You test it on scenarios it has never seen, then publish an offer at your own price. It plans each subscriber’s training day by day and adapts it. It hands you what it is unsure about and learns from your corrections.",
    primaryKeyword: "how does an AI personal trainer work",
    sections: [
      {
        id: "steps",
        heading: "Eight steps, start to finish",
        steps: [
          { title: "Claim your address", body: "Reserve your coaching address, then set your public name, headline, biography, colours and logo in the Design Studio." },
          { title: "Teach your Brain", body: "Answer a guided interview, confirm rules, add cases and examples, and import documents after a private redaction review." },
          { title: "Test it", body: "Write at least 20 held-out scenarios with your expected answers. Each version is evaluated on them before publishing." },
          { title: "Create your offer", body: "Set your AED price, programme length and billing, trials, and an optional nutrition tier or voice add-on." },
          { title: "Publish and share", body: "Check the subscriber preview, launch, then share your tagged link in your bio and Stories." },
          { title: "It coaches daily", body: "Each subscriber gets a dated plan from their input. Confident changes apply automatically; uncertain ones come to you." },
          { title: "You correct, it learns", body: "Approve or correct what comes to you. Corrections and subscriber outcomes become teaching for the next evaluated release." },
          { title: "Get paid monthly", body: "Subscribers pay by card in AED. Your statement itemises commission and costs; payouts go to your UAE bank." },
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
          "Inspect every rule and its source, roll back a release, take over any conversation or write programmes yourself. Subscribers always see when guidance is digital.",
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
    title: "Trainer Brain: an AI built from your judgment",
    description:
      "Teach an AI your coaching rules, cases and examples. It plans and adapts training for each subscriber, learns from your corrections and asks when unsure.",
    h1: "An AI trainer built from your judgment",
    eyebrow: "TRAINER BRAIN",
    lede: "Your rules, cases and corrections in one private AI. It acts alone only when confident and asks you when it isn’t.",
    intro:
      "The Trainer Brain is a private, versioned set of your coaching rules, cases and examples. It plans and adapts training for each subscriber. It is taught by you, tested on held-out scenarios, and acts alone only when confident. It learns from your corrections.",
    primaryKeyword: "AI trained on my coaching method",
    sections: [
      {
        id: "what",
        heading: "What it is",
        body: [
          "A bespoke AI trainer built from your rules, cases and corrections, not a generic workout generator. Every change traces back to something you taught, and every version can be rolled back.",
        ],
      },
      {
        id: "teach",
        heading: "What you teach it",
        bullets: [
          "A guided interview: what you recommend, why, and what changes it.",
          "Plain-language rules you confirm, edit or reject, each with its source.",
          "Coaching cases and worked examples of real decisions.",
          "Your own documents; you review the extracted text before use.",
          "Held-out test scenarios: at least 20 situations with the answer you expect.",
        ],
      },
      {
        // The three paths moved here from the home page (28 September 2026).
        id: "decides",
        heading: "How it decides",
        body: [
          "It combines your published rules with each subscriber’s goals, schedule, equipment and logged training. Then it takes one of three paths.",
        ],
        cards: [
          {
            title: "Confident",
            body: "The change follows your confirmed rules, so it is applied automatically and logged with its reason.",
            label: "Applied automatically",
          },
          {
            title: "Not sure",
            body: "Outside what you taught or below your threshold, a draft comes to you. Your correction becomes teaching.",
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
          "Keep pain, medical issues or red flags from you.",
          "Pretend to be you: subscribers see a clearly labelled digital coach.",
          "Give medical or clinical advice.",
          "Use your teaching elsewhere: your Brain stays private to your workspace.",
        ],
      },
      {
        // Moved from the home page (28 September 2026).
        id: "control",
        heading: "You stay in control",
        bullets: [
          "Your rules are inspectable and every release can be rolled back.",
          "You choose which routine changes run automatically.",
          "You can take over any subscriber or conversation at any time.",
          "Safety routing is enforced in code and cannot be switched off.",
          "Subscribers always see when guidance comes from the digital coach.",
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
    title: "See an AI coach decide: interactive demo",
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
        q: "Can I test my own Brain before launch?",
        a: "Yes. The scenario lab lets you write held-out situations with the answer you expect, and your Brain is evaluated against them before a version can be published."
      },
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
      "Every capability in {APP_NAME}: the Trainer Brain, plans, a branded app and website, nutrition, voice, bookings, chat, payments, payouts and safety.",
    h1: "Everything you need, under your own name",
    eyebrow: "FEATURES",
    lede: "Your AI, a branded app and website, nutrition, bookings, payments and safety rules, in one workspace.",
    intro:
      "{APP_NAME} combines a Trainer Brain that plans and adapts training with a subscriber app and website under your brand. It adds optional nutrition and voice, bookings, chat and progress tracking. Payments are in AED, and safety rules are enforced in code.",
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
      {
        // Moved from the home page (28 September 2026).
        id: "subscribers",
        heading: "What your subscribers get",
        cards: [
          { title: "A plan every day", body: "A personalised, dated plan built from their goals, schedule, experience and equipment." },
          { title: "Guided workouts", body: "Exercise cues, set logging and rest timers; it keeps working offline in the gym." },
          { title: "Adapts as they train", body: "Progressions, missed sessions and swaps follow your rules automatically." },
          { title: "Your voice, optionally", body: "An add-on where a voice in your own verified voice runs the session." },
          { title: "Nutrition, optionally", body: "Meal plans, recipes, grocery lists, a food diary, meal photos and barcode scanning." },
          { title: "You, when it matters", body: "Chat with you, a clearly labelled digital coach, and paid one-to-one sessions." },
          { title: "Progress they can see", body: "Completed sessions, best loads and their coaching context in one place." },
          { title: "Your brand throughout", body: "Your website, your address, your colours and an installable app with your icon." },
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
      "Each subscriber gets a personalised, dated plan built by your Trainer Brain from their input, adapted as they train, and sent to you when it is unsure.",
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
    extra: [
      {
        id: "practice",
        heading: "How a plan runs, week by week",
        steps: [
          {
            title: "Intake",
            body: "When a subscriber joins, they tell you their goal, schedule, experience and equipment."
          },
          {
            title: "First plan",
            body: "Your Brain builds dated sessions within your programme length, following your confirmed rules."
          },
          {
            title: "Training",
            body: "They log their sets; completed sessions and logged effort feed the next decision."
          },
          {
            title: "Adjustment",
            body: "Confident changes are applied and explained; anything below your threshold comes to you as a draft to approve or correct."
          }
        ]
      },
    ],
    faqs: [
      {
        q: "Does the Brain explain its changes?",
        a: "Yes. Each automatic change is recorded with its reason, and the subscriber sees why it happened in plain language."
      },
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
    extra: [
      {
        id: "session",
        heading: "A session, step by step",
        steps: [
          {
            title: "Open Today",
            body: "The day’s session comes first, with the week ahead below it."
          },
          {
            title: "Start the guided session",
            body: "Each exercise shows its cues, sets and targets, one step at a time."
          },
          {
            title: "Log each set",
            body: "Reps, load, effort and a note, saved on the device even without a connection."
          },
          {
            title: "Rest",
            body: "A rest timer counts down between sets, using the rest you set in the plan."
          },
          {
            title: "Swap if needed",
            body: "Only the alternatives you approved are offered."
          },
          {
            title: "Finish",
            body: "The session is saved and synced; completed work feeds the next plan decision and the progress page."
          }
        ]
      },
    ],
    faqs: [
      { q: "Can subscribers see why their plan changed?", a: "Yes. When the Brain changes a session, the subscriber sees the reason in plain language, and a note when you are reviewing a change yourself." },
      {
        q: "Do subscribers need to download anything?",
        a: "No store download is needed. Subscribers open your app in their browser and can add it to their home screen with your name and icon."
      },
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
    title: "Your personal trainer website and domain",
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
    extra: [
      {
        id: "launch",
        heading: "From draft to live",
        steps: [
          {
            title: "Design",
            body: "Set your public name, headline, biography, colours and logo in the Design Studio."
          },
          {
            title: "Add pages and galleries",
            body: "Write your pages, add photo galleries and switch on the contact form."
          },
          {
            title: "Preview privately",
            body: "See the whole site exactly as visitors will, before anything is public."
          },
          {
            title: "Publish",
            body: "Launch once your checklist is complete; your site goes live at your coaching address."
          },
          {
            title: "Share",
            body: "Put your tagged link in your bio and Stories."
          },
          {
            title: "Add your own domain",
            body: "Optionally, have a domain bought and renewed for you, or connect one you already own."
          }
        ]
      },
    ],
    faqs: [
      { q: "Can I preview changes before they go live?", a: "Yes. Every page, photo and headline has a private preview. Hidden pages are not published and are left out of the sitemap." },
      {
        q: "Where do contact-form messages go?",
        a: "To the inquiries inbox in your workspace, so you can reply and follow up in one place."
      },
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
      "An optional nutrition tier: AI meal plans, recipes and grocery lists that follow your guidance, with a food diary, meal photos and barcode scanning.",
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
    extra: [
      {
        id: "week",
        heading: "How a nutrition week works",
        steps: [
          {
            title: "Your teaching",
            body: "You teach your approach through cases, recipes and calorie methods, evaluated before release."
          },
          {
            title: "Targets",
            body: "You set each client’s calorie target, or let your method set it within your rules."
          },
          {
            title: "The weekly plan",
            body: "The subscriber gets a week of meals with recipes and portions, and swaps you allow."
          },
          {
            title: "Shopping",
            body: "A consolidated grocery list covers the week, using what they already have where possible."
          },
          {
            title: "Logging",
            body: "The food diary takes typed entries, meal photos and barcodes; estimates are only saved once confirmed."
          },
          {
            title: "Check-in",
            body: "A weekly check-in compares progress with the targets you set; anything outside your rules comes to your exceptions queue."
          }
        ]
      },
    ],
    faqs: [
      { q: "Does nutrition cost the subscriber more?", a: "Yes, if you offer it. Nutrition is a separate, higher-priced tier that you price yourself, on top of workouts." },
      {
        q: "Can I edit a subscriber’s meal plan?",
        a: "Yes. You can set each client’s calorie target and edit their meal plan; decisions outside your rules go to your exceptions queue."
      },
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
      "An optional add-on: a voice in your own verified voice runs the workout, with cues, sets and rest. Your identity is verified and your consent recorded.",
    h1: "Your voice, running the session",
    intro:
      "With the voice add-on, a voice in your own voice runs your subscribers’ workouts: it introduces each exercise, counts them through the session and calls the rest periods. Your identity is verified and your separate consent is recorded before your voice is used.",
    keyword: "AI voice coach in my own voice",
    does: [
      "Runs the guided session in your voice: exercise cues, sets and rest.",
      "Follows the same plan and safety rules as the written workout.",
      "Uses your voice only for your own subscribers who add it.",
      "Plays the session your plan already contains, so there is nothing extra to write.",
    ],
    subscriberSees: [
      "Their trainer’s voice guiding the workout, clearly disclosed as generated.",
      "The same pause and pain reporting as every workout.",
    ],
    youControl: [
      "Whether to offer voice, and its price as an add-on.",
      "Your consent, which you can withdraw.",
    ],
    extra: [
      {
        id: "how",
        heading: "How the voice add-on works",
        steps: [
          {
            title: "Verify and consent",
            body: "You verify your identity and give separate, recorded consent before your voice is used."
          },
          {
            title: "Offer it",
            body: "Add voice as a monthly add-on at a price you set, on top of your subscription."
          },
          {
            title: "Guided sessions",
            body: "Subscribers who add it hear the guided workout in your voice: each exercise, the sets and the rest periods."
          },
          {
            title: "Yours to withdraw",
            body: "Withdraw your consent at any time, and your voice is no longer used for your subscribers."
          },
          {
            title: "Same safety",
            body: "The pause and pain report work exactly as in every workout, and pain still comes straight to you."
          }
        ]
      },
    ],
    faqs: [
      { q: "Who can hear my voice?", a: "Only your own subscribers who add the voice add-on. Your voice is never used for another trainer’s subscribers." },
      {
        q: "Can I withdraw my voice later?",
        a: "Yes. You can withdraw your consent at any time, and your voice is then no longer used for your subscribers."
      },
      {
        q: "Is the voice disclosed?",
        a: "Yes. Subscribers are told the voice is generated from yours, the same way digital replies are always labelled."
      },
      {
        q: "How is my voice protected?",
        a: "Your voice is used only after identity verification and your separate, recorded consent, only for your own subscribers, and you can withdraw consent.",
      },
      {
        q: "Does voice cost extra?",
        a: "Voice is an add-on you price for subscribers. Only subscribers who add it hear the session in your voice.",
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
      "A reminder before each booked session.",
    ],
    youControl: ["Session times, capacity and price.", "Your cancellation policy.", "Whether a session is free or paid, and where it takes place."],
    extra: [
      {
        id: "how",
        heading: "How bookings work",
        steps: [
          {
            title: "Set your policy",
            body: "Choose your cancellation window: how long before a session a subscriber can cancel with a refund."
          },
          {
            title: "Publish sessions",
            body: "Add one-off or weekly recurring sessions with a time, capacity, location and an optional price."
          },
          {
            title: "Subscribers book",
            body: "They see your upcoming sessions and reserve a place, paying by card in AED when the session has a price."
          },
          {
            title: "Reminders",
            body: "Subscribers are reminded of a booked session within the day before it."
          },
          {
            title: "Cancellations",
            body: "When a subscriber cancels within your policy, the refund happens automatically."
          },
          {
            title: "After the session",
            body: "Mark attendance or a no-show, and export your sessions to your calendar."
          }
        ]
      },
    ],
    faqs: [
      { q: "What happens when a subscriber does not show up?", a: "You mark the booking as a no-show after the session. Refunds follow your cancellation policy, which subscribers see before they pay." },
      { q: "Where do sessions take place?", a: "Wherever you set. Each session has a location, so you can run in-person sessions in a gym, a studio or outdoors, alongside online coaching." },
      {
        q: "Can I run free sessions too?",
        a: "Yes. A session’s price is optional, so you can publish free sessions for your subscribers alongside paid one-to-one sessions."
      },
      {
        q: "Can subscribers add bookings to their own calendar?",
        a: "Yes. They can download their booked sessions as a calendar file."
      },
      {
        q: "Do paid sessions carry commission?",
        a: "Session payments follow the booking fee in your finance policy, shown on your statement, and are separate from the subscription commission bands.",
      },
    ],
    related: ["/earnings-calculator", "/features/payments-and-payouts"],
    availability: ["payments"],
  }),
  feature("chat-and-digital-coach", "Chat and digital coach", {
    title: "Client messaging with a labelled digital coach",
    description:
      "Stay close to every subscriber without answering every message: private chat, a labelled digital coach, takeover, and photo or PDF attachments.",
    h1: "Stay close to every subscriber without answering every message",
    intro:
      "Subscribers can message you privately and ask a clearly labelled digital coach that answers from your teaching. Anything outside your rules, and every safety issue, comes to you. You can take over a subscriber at any time, so the digital coach steps back.",
    keyword: "client messaging app for coaches",
    does: [
      "Private trainer and subscriber threads with photo and PDF attachments.",
      "A digital coach that answers from your published teaching, labelled as digital.",
      "Personal takeover that pauses the digital coach for that subscriber.",
      "Scheduled check-in messages.",
      "Keeps the whole conversation history for you and the subscriber.",
    ],
    subscriberSees: [
      "Which replies come from you and which from the digital coach.",
      "A notice when you take over personally.",
    ],
    youControl: ["Takeover and hand-back.", "What the digital coach may answer."],
    extra: [
      {
        id: "flow",
        heading: "How a conversation flows",
        steps: [
          {
            title: "A question arrives",
            body: "A subscriber asks about their plan, a swap or their week."
          },
          {
            title: "The digital coach answers",
            body: "If your published teaching covers it, the labelled digital coach replies from your rules."
          },
          {
            title: "Outside your rules",
            body: "Anything your teaching does not cover comes to you instead of a guess."
          },
          {
            title: "Safety",
            body: "A worrying message pauses training and comes to you, enforced in code."
          },
          {
            title: "Take over",
            body: "Reply yourself whenever you like; taking over pauses the digital coach for that subscriber until you hand back."
          }
        ]
      },
    ],
    faqs: [
      { q: "Can messages include photos?", a: "Yes. Subscribers and trainers can attach photos and PDFs to messages, for example a meal, a form check or a document." },
      { q: "What if the digital coach does not know the answer?", a: "It does not guess. Anything outside your published teaching is handed to you, and your answer can become teaching." },
      {
        q: "Can I schedule check-ins?",
        a: "Yes. Scheduled follow-up messages go out when you plan them, to subscribers with an active membership."
      },
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
      "Shows the date and source of every piece of context.",
      "Gives your Brain the same context you see, within the subscriber’s consent.",
    ],
    subscriberSees: ["Their own progress page.", "Their coaching context, which they can edit.", "What their coaching is based on, including what is still unknown."],
    youControl: ["Your wearable data policy.", "What the Brain may use, within subscriber consent."],
    extra: [
      {
        id: "twin",
        heading: "What the Client Twin holds",
        bullets: [
          "What the subscriber told you at intake, with the date it was given.",
          "Coaching preferences, which the subscriber can edit themselves.",
          "Training history built from logged sessions.",
          "Wearable data the subscriber chose to share, with its source.",
          "Missing information marked as unknown, never guessed."
        ]
      },
      {
        id: "consent",
        heading: "Wearables and consent",
        body: [
          "Subscribers decide what to share. Apple Health data comes from an export file they upload and review before importing. WHOOP and Amazfit / Zepp connect when those providers are enabled on the platform. Your wearable policy decides whether shared data may be used in coaching, and only within the subscriber’s consent."
        ]
      },
    ],
    faqs: [
      { q: "Where does progress data come from?", a: "From the sets subscribers log in their workouts: completed sessions, volume and best loads. Wearable data is added only when the subscriber shares it." },
      { q: "Can I see a subscriber’s Client Twin?", a: "Yes. You see the same coaching context your Brain uses, including what is still unknown, so you can fill gaps at a check-in." },
      {
        q: "Can subscribers see their own progress?",
        a: "Yes. Their progress page shows completed sessions, training volume and best loads per exercise, and it fills as they log workouts."
      },
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
      "Card payments in AED through Stripe, your programme length, monthly or upfront billing, trials, promotions, clear statements and monthly UAE payouts.",
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
      "A short hold on payouts after a bank account change, shown on your statement.",
    ],
    subscriberSees: ["Your price and terms before paying.", "Their invoices, charges and refunds.", "Their renewal date and how to stop renewal."],
    youControl: ["Price, programme length, billing, trials and promotions.", "Refund decisions."],
    extra: [
      {
        id: "billing",
        heading: "Billing options",
        body: [
          "Bill monthly for open-ended coaching, or upfront for a programme with a fixed length. Add free trial days or promotion codes when you launch or run an offer. Subscribers see your price and terms before they pay, and their invoices, charges and refunds afterwards.",
          "Refund requests come to you to approve or decline, and approved refunds are reconciled with the payment provider and shown on your statement."
        ]
      },
      {
        id: "statement",
        heading: "What your statement shows",
        bullets: [
          "Gross subscription revenue and commission by band.",
          "Payment processing fees.",
          "Optional services such as voice and your own domain.",
          "Refunds, disputes and any payout holds.",
        ],
      },
    ],
    faqs: [
      { q: "Which currency do subscribers pay in?", a: "AED, by card. Your statements and payouts are in AED too." },
      {
        q: "Can a subscriber cancel?",
        a: "A subscriber can stop renewal at the end of the period. A refund is a separate request that you decide."
      },
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
    title: "Is an AI personal trainer safe? Rules in code",
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
      "The same pain button in every guided session.",
    ],
    youControl: ["Your decision on each safety pause, with a note.", "Resuming training when it is safe."],
    extra: [
      {
        id: "pain",
        heading: "What happens when a subscriber reports pain",
        steps: [
          {
            title: "Pause",
            body: "The workout pauses the moment pain is reported, or when a worrying message arrives in chat or intake."
          },
          {
            title: "Alert",
            body: "You are alerted and the item appears in your review queue."
          },
          {
            title: "Review",
            body: "You see what was reported and the subscriber’s context."
          },
          {
            title: "Decide",
            body: "Resume training, change the plan or keep it paused, with a note the subscriber sees."
          },
          {
            title: "Escalate",
            body: "If a safety hold is not reviewed in time, it escalates until someone decides."
          }
        ]
      },
    ],
    faqs: [
      { q: "Does the AI decide whether pain is serious?", a: "No. Any pain report pauses training and comes to you; the AI does not judge whether it is serious. You decide what happens next." },
      {
        q: "Can I add my own red flags?",
        a: "Yes. You can add terms that also pause training and topics that come to you for review. You cannot remove or weaken the floor."
      },
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
      "Keeps every action attributed to the person who took it.",
    ],
    subscriberSees: ["One brand, whichever coach replies.", "A reply from a person or a labelled digital coach, never an unlabelled mix."],
    youControl: ["Who joins, their role and removal.", "Ownership transfer, if you ever need it."],
    extra: [
      {
        id: "roles",
        heading: "Roles at a glance",
        table: {
          caption: "What each role can open",
          columns: [
            "Role",
            "Can",
            "Cannot"
          ],
          rows: [
            [
              "Owner",
              "Everything: the Brain, brand, offers, finance, team and ownership",
              "Nothing is restricted"
            ],
            [
              "Staff coach",
              "Coaching screens: subscribers, programmes, chat and the review queue",
              "Finance, design, team or ownership settings"
            ],
            [
              "Finance",
              "The overview, finance and settings: earnings, statements and payouts",
              "Coaching conversations and subscribers’ coaching data"
            ]
          ]
        }
      },
      {
        id: "invite",
        heading: "Adding someone to your team",
        steps: [
          {
            title: "Invite by email",
            body: "Choose a role when you send the invitation."
          },
          {
            title: "They join",
            body: "The new member signs in with their own account; nobody shares a password."
          },
          {
            title: "Change or remove",
            body: "Change a role or remove a member at any time; every change is recorded."
          }
        ]
      },
    ],
    faqs: [
      { q: "Can staff coaches reply to subscribers?", a: "Yes. Staff coaches work in the coaching screens, including chat, and subscribers see one brand whichever coach replies." },
      { q: "Can a finance member read subscribers’ messages?", a: "No. Finance members see the overview, finance and settings, not coaching conversations or coaching data." },
      { q: "What happens when I remove a team member?", a: "They lose access to your workspace, and the removal is recorded with who made it and when." },
      {
        q: "Who owns the brand and the Brain?",
        a: "The owner. Staff coaches work inside your method but cannot change ownership, design or finance settings."
      },
      {
        q: "Does each team member need their own account?",
        a: "Yes. Everyone signs in with their own account, so every action is attributed to the person who took it."
      },
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
      "You set your price in AED. {APP_NAME} takes a marginal commission of 25%, 20%, 15% and 10% of subscription revenue.",
    h1: "Your price, our transparent share",
    eyebrow: "PRICING",
    lede: "You set your price in AED. Our commission starts at 25% and falls in bands as you grow.",
    intro:
      "You choose your price in AED, the programme length and monthly or upfront billing. {APP_NAME} takes a commission on subscription revenue in marginal bands of 25%, 20%, 15% and 10%. Payment processing and optional services are itemised on your statement.",
    primaryKeyword: "online coaching platform fees",
    sections: [
      {
        id: "how",
        heading: "How you earn",
        bullets: [
          "Subscribers pay you monthly or upfront, by card, in AED.",
          "Commission applies to subscription revenue by band.",
          "Your statement shows every cost; payouts arrive monthly in your UAE bank.",
        ],
      },
      {
        // Moved from the home page (28 September 2026) with its sources; the
        // page renders the three price anchors after it.
        id: "hours",
        heading: "An hour sells only once",
        body: [
          "Published Dubai price guides put one-to-one sessions at roughly AED 70-350, with experienced or premium trainers higher. Online coaching guides quote AED 400-2,000 a month.",
          "A Trainer Brain lets your method coach many people at once, at a monthly price more followers can afford. You keep the sessions only you can serve.",
        ],
        note: "Price ranges come from published price guides, not official statistics. See Methodology.",
        sources: ["heytrainer-dubai-2026", "embody-dubai-2025", "369mmafit-online-2026"],
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
        a: "Commission on subscription revenue by band and payment processing. Optional services you choose, such as the voice add-on or your own domain, are extra. Every item appears on your monthly statement.",
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
    title: "Online personal trainer earnings calculator",
    description:
      "Estimate monthly coaching income from subscribers, price, nutrition tier, voice add-on and sessions, with commission by band. Arithmetic, not a promise.",
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
          "Not included: payment processing, domain, refunds, disputes and tax.",
        ],
      },
      {
        id: "use",
        heading: "How to use it",
        steps: [
          {
            title: "Start cautiously",
            body: "Enter a number of subscribers you think you could reach in your first months, not your whole following. The follower calculator shows cautious, typical and strong scenarios."
          },
          {
            title: "Enter your offer",
            body: "Your monthly price, or your upfront programme price and length, plus the share of subscribers you expect on the nutrition tier and the voice add-on."
          },
          {
            title: "Add sessions",
            body: "Paid one-to-one sessions you would still sell alongside the subscription."
          },
          {
            title: "Read the result",
            body: "Subscriptions minus commission by band, plus sessions: the amount before other costs, and how many sessions at your usual rate it equals."
          }
        ]
      },
      {
        id: "example",
        heading: "A worked example",
        body: [
          "120 subscribers at AED 199 a month bring AED 23,880 in subscriptions. Commission is 25% on the first 100 subscribers and 20% on the next 20: AED 5,771 in total, 24.17% overall. That leaves AED 18,109 before payment processing and tax, about 72 sessions at AED 250."
        ],
        note: "Arithmetic with the commission bands, not a forecast or promise."
      },
    ],
    faqs: [
      {
        q: "Why does the overall commission fall as I grow?",
        a: "Commission is marginal: each band keeps its own rate, from 25% for your first 100 paying subscribers down to 10% above 1,000, so the overall share falls as more subscribers sit in lower bands."
      },
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
      "Estimate how many followers could become paying subscribers from Stories, Reels and your bio link: a strong case, with cautious and typical scenarios.",
    h1: "How many of your followers could become paying subscribers?",
    eyebrow: "FOLLOWER CALCULATOR",
    intro:
      "Enter your followers, your price and how you share your link. The headline is the strong case, for an engaged, growing audience and weekly sharing: new subscribers in your first month, active subscribers after 12 months of cancellations and what they pay each month. Cautious and typical results sit under How we estimate. It is an estimate, never a promise.",
    primaryKeyword: "Instagram followers to clients calculator",
    sections: [
      {
        id: "how",
        heading: "How we calculate",
        steps: [
          { title: "People who see your Stories", body: "Followers × the share who see at least one of your Stories in a month. Cautious and typical use Socialinsider’s Story reach for your follower tier, measured on brand accounts (typical at least 5%). The strong case assumes 20.5% up to 10,000 followers, the reach Socialinsider measured for a six-frame Story sequence, used as a monthly audience (our assumption; the measured reach for 5,001-10,000 followers is 3.5-4.2%), then 8%, 6.5% and 5% for larger accounts. Your own average Story views replace these guesses when you enter them." },
          { title: "Visits from link Stories", body: "Each viewer has a {CLICK_SCENARIOS} chance (cautious, typical, strong) of opening one link Story, the range creators report; no industry benchmark exists. The same people watch each Story, so over several Stories in a month the chance that a viewer visits is 1 − (1 − rate)^Stories: it rises quickly, then levels off." },
          { title: "New people each month", body: "Each month {RENEWAL_SCENARIOS} of each audience is new to your link (cautious, typical, strong): new followers, and people Instagram starts showing your content to. Cautious keeps the same people all year; typical is about the follower growth Socialinsider measured on brand accounts; strong is our assumption for a growing audience. So sign-ups keep coming after your first viewers have decided." },
          { title: "Reels with a comment keyword", body: "People comment your keyword and get your link by DM. Reel reach and comments per view come from Socialinsider, a comment call to action roughly doubles the usual comments (Metricool), and {DM_SCENARIOS} of commenters open the link (vendor claims). Reels reach people your Stories miss." },
          { title: "Bio link and broadcast channel", body: "Counted only when you enter them: {BIO_SCENARIOS} of monthly profile visitors open your bio link (a rule of thumb), and {BROADCAST_SCENARIOS} of broadcast members open each link message (email benchmarks stand in)." },
          { title: "Subscribers", body: "People who visit × visit to paid of {PAID_SCENARIOS}: a luxury-retail purchase rate, then the median and upper quartile of Health & Fitness app downloads that turn paid within 35 days. An app install shows more intent than a Story tap, so these may overstate, and no published benchmark exists for coaching subscriptions. Each person decides once, so repeat visits never add subscribers." },
          { title: "Cancellations", body: "The members who cancel per year that you enter, 30% unless you change it, become a monthly rate of 1 − (1 − yearly)^(1/12). Active subscribers after 12 months are after cancellations; sign-ups are before them." },
          { title: "Your engagement", body: "If you enter or connect your engagement rate, Story reach and comments are scaled by your rate compared with the {ENGAGEMENT_AVG} average, within limits. The strong case’s Story share already assumes an engaged audience, so your rate can lower it but does not raise it again." },
        ],
        sources: ["socialinsider-stories", "creatorflow-link-sticker", "socialinsider-reels", "metricool-2026", "communipass-auto-dm", "hopp-bio-link", "mailerlite-benchmarks", "dynamicyield-conversion", "revenuecat-state-2026", "socialinsider-engagement"],
      },
      {
        id: "strong-case",
        heading: "Why the headline shows the strong case",
        body: [
          "The strong case is a best case for an engaged, growing audience and weekly sharing. It is not a typical result and not a promise. Per link Story it turns {CLICK_STRONG} × {PAID_STRONG}, about {STRONG_PER_STORY} of the people who see it, into subscribers, and each month {RENEWAL_STRONG} of your audience is new to your link, so sign-ups keep coming and active subscribers are still growing at month 12.",
          "Over a year it signs up about 2% of followers for accounts up to 10,000 followers, a smaller share for larger accounts. That is far above published creator averages: course benchmarks put 0.52-1.1% for higher-priced courses, and creators with 1,000-10,000 followers sell about USD 273 a month on average. Cautious and typical apply published averages from brand accounts, retail and apps, and you may get fewer subscribers than the cautious figure.",
        ],
        sources: ["passion-creator-rates", "stan-creator-economy", "revenuecat-state-2026", "socialinsider-engagement"],
      },
      {
        id: "moves",
        heading: "What moves your number",
        bullets: [
          "Put your page in your bio: your bio link reaches people your Stories miss, every day.",
          "Add a comment keyword to your Reels: Reels reach people who don’t watch your Stories.",
          "Share link Stories weekly: more of your viewers get a chance to tap before they drift away, and new followers see your link too.",
          "Use more frames: Story reach rose from 6.3% for one frame to 20.5% by the sixth.",
          "Mix link Stories with ordinary ones: link stickers can reduce replies and shares.",
          "Make the offer clear: say who it is for, the price and what they get each day.",
          "Keep subscribers: fewer cancellations raise your active subscribers more than any single post.",
        ],
        sources: ["socialinsider-stories", "meta-instagram-ranking", "hootsuite-link-stickers", "nng-participation"],
      },
    ],
    faqs: [
      {
        q: "Is this a prediction of my results?",
        a: "No. It applies published averages and our stated assumptions to your inputs. The headline is a strong case; the cautious and typical results are under How we estimate, and you may get fewer subscribers than the cautious figure. Your content, audience, offer and price change the real number.",
      },
      {
        q: "Why does the headline show the strong case?",
        a: "It shows what an engaged, growing audience with weekly sharing could reach, using the top values found in the research and our stated assumptions. It is far above published creator averages, so we label it a strong case, not a typical result, and show the cautious and typical results with it so you see the whole range.",
      },
      {
        q: "Which of my numbers matter most?",
        a: "Your own average Story views, your price and your cancellations. How many people see your Stories is the biggest guess in the estimate, so entering your views from Instagram Insights replaces it.",
      },
      {
        q: "Can I use my real Instagram numbers?",
        a: "After you sign up, you can connect an Instagram professional account to fill in your follower count and recent engagement. We read those numbers once and do not keep access to your account.",
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
      "How {APP_NAME} protects trainers and subscribers: passkeys, authenticator apps, database-level isolation, encrypted keys, audit logs and consent.",
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
          "Private previews and app pages are kept out of search engines.",
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
      {
        id: "operators",
        heading: "Platform operators and audit",
        body: [
          "Platform operators work in separate administration tools. Every operator change needs a fresh authenticator check, and operator actions are recorded in an audit log."
        ]
      },
      {
        id: "payments",
        heading: "Payments",
        body: [
          "Subscribers pay by card through Stripe checkout, so card numbers are handled by the payment provider rather than stored in {APP_NAME}. Payouts go only to a verified UAE bank account, with a short hold after the account changes."
        ]
      },
    ],
    faqs: [
      { q: "Are sensitive actions protected?", a: "Yes. Sensitive actions ask for your authenticator code again and are recorded in an audit log." },
      { q: "Who can see my Trainer Brain?", a: "You and team members whose role allows coaching screens. Your teaching is private to your workspace and never used for another trainer." },
      {
        q: "Can I download my data?",
        a: "Yes. Trainers and subscribers can download their data and request deletion from their settings."
      },
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
        a: "Some will. Use the follower calculator for a strong case with cautious and typical scenarios from published benchmarks, then test your offer. We never promise a number.",
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
      TECH_FAQ,
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
    title: "About us",
    description:
      "{APP_NAME} makes personal training affordable to more people by scaling real trainers’ judgment through a Trainer Brain each trainer controls.",
    h1: "About {APP_NAME}",
    eyebrow: "ABOUT",
    lede: "We help personal trainers coach more people with an AI they teach, under their own name.",
    // The entity sentence (ENTITY_SENTENCE), which the home page's former
    // "What is {APP_NAME}?" block carried; it stays in llms.txt and JSON-LD.
    intro:
      "{APP_NAME} is a UAE platform that lets each personal trainer build a bespoke AI trainer, their Trainer Brain, from their own rules, cases and examples. It then sells personalised, day-by-day coaching to the trainer’s followers under the trainer’s own brand, priced in AED.",
    primaryKeyword: "{APP_NAME}",
    sections: [
      {
        id: "mission",
        heading: "Our mission",
        body: [
          "Make personal training affordable to more people by scaling real trainers’ judgment, not by replacing them with a generic app.",
        ],
      },
      {
        id: "what",
        heading: "What we build",
        body: [
          "One workspace runs a trainer’s whole coaching business. It holds the Trainer Brain, a plan per subscriber, a branded website and app, bookings and AED payments.",
          "Safety routing for pain, medical issues and red flags is enforced in code, outside the AI.",
        ],
      },
      {
        id: "is-not",
        heading: "What we are and are not",
        bullets: [
          "A platform for trainers: the brand, method and relationship stay theirs.",
          "Not a generic workout generator.",
          "Not a medical service.",
          "Not a replacement: uncertain and safety decisions go to the trainer.",
        ],
      },
      {
        id: "who",
        heading: "Who it is for",
        body: [
          "Personal trainers in the UAE with their own method and an audience that follows them. They want to coach more people without selling more hours.",
          "Subscribers get that trainer’s method every day at a price far more people can afford.",
        ],
      },
      {
        id: "money",
        heading: "How we make money",
        body: [
          "A commission on trainers’ subscription revenue in marginal bands of 25%, 20%, 15% and 10%. Optional services are itemised.",
        ],
      },
      {
        id: "honesty",
        heading: "How we talk about results",
        bullets: [
          "Earnings and follower figures are labelled estimates, never promises.",
          "The follower headline is a strong case: a best case, not typical.",
          "Every market figure cites its source on the methodology page.",
          "We publish no testimonials, logos, ratings or customer counts we cannot show.",
          "Digital guidance is always labelled as digital.",
        ],
      },
      {
        id: "where",
        heading: "Where we work",
        body: [
          "{APP_NAME} is built for the UAE: prices and payouts in AED, English first with an Arabic-ready, right-to-left layout.",
        ],
      },
    ],
    faqs: [
      {
        q: "How does {APP_NAME} make money?",
        a: "A commission on trainers’ subscription revenue in marginal bands of 25%, 20%, 15% and 10%. Optional services are itemised."
      },
      {
        q: "Does {APP_NAME} own my method?",
        a: "No. Your Brain is private to your workspace and is never used for another trainer."
      },
      {
        q: "Is {APP_NAME} a medical service?",
        a: "No. It is coaching, not medical advice. Pain, medical issues and red flags always go to the trainer, enforced in code outside the AI.",
      },
      {
        q: "Whose brand do subscribers see?",
        a: "The trainer’s. Subscribers join the trainer’s coaching through the trainer’s own website and app, with the trainer’s name, colours and prices.",
      },
    ],
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
      "Every market figure on {APP_NAME} with its source and date, and the assumptions behind the follower and earnings calculators, with current values.",
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
          "Estimates are shown with their assumptions and are never promises; the follower calculator’s headline is a strong case, labelled as not typical.",
          "We publish no customer counts, ratings or testimonials that we cannot show.",
        ],
      },
      {
        id: "follower-formula",
        heading: "How the follower estimate is calculated",
        body: [
          "Three scenarios use the same arithmetic with different rates. Cautious and typical use published averages. Strong is a best case for an engaged, growing audience and weekly sharing, from the top values found in the research and our stated assumptions: not a typical result and not a promise. The calculator headlines the strong case and shows cautious and typical under How we estimate.",
          "Not included: trials, discounts, refunds, failed payments, platform commission, payment processing and tax. New followers count only through the new people each month."
        ],
        steps: [
          {
            title: "Story audience",
            body: "S = followers × the Story share for your tier and scenario, scaled by your engagement against the {ENGAGEMENT_AVG} average when known (the strong share only down, never below the typical share at your engagement), or your own average Story views. Tier boundaries never lower the result: an account gets at least what an account at the top of each smaller tier gets, so more followers never mean fewer viewers."
          },
          {
            title: "Chance of a visit",
            body: "With k link Stories a month, a viewer who has not visited yet visits in a month with probability c = 1 − (1 − click)^k. Broadcast link messages work the same way for each member, and profile visitors open the bio link with probability bio click a month."
          },
          {
            title: "New people each month",
            body: "Each month a share r of every audience ({RENEWAL_SCENARIOS}: cautious, typical, strong) is replaced by people new to your link. The share who have not visited yet is f(1) = 1 and f(m + 1) = (1 − r)(1 − c) f(m) + r; visitors in month m = audience × c × f(m). With r = 0 the same people stay all year and visitors by month T are audience × (1 − (1 − c)^T)."
          },
          {
            title: "Keyword Reels",
            body: "Per Reel viewer per Reel: comments per view × 2.03 (the extra comments a comment call to action brings) × the share who open the DM link. Typical and strong count each Reel’s commenters afresh, n Reels a month, because most Reels people see come from accounts they don’t follow. Cautious counts Reel viewers inside the Story audience, with 1 − (1 − that)^n a month. A Reel’s viewers and comment rate come from one tier; visitors by each month are the most any tier at or below yours gives."
          },
          {
            title: "Channels together",
            body: "Stories and the broadcast channel reach nested groups, because members mostly already watch your Stories: each person visits with 1 − Π(1 − chance) over the channels that reach them. Bio-link visits are added."
          },
          {
            title: "Sign-ups",
            body: "C(T) = visit to paid × the people who first visited by month T. Each person decides once. New subscribers in month m = C(m) − C(m − 1); sign-ups over 12 months = C(12)."
          },
          {
            title: "Active subscribers and monthly amount",
            body: "A(m) = A(m − 1) × (1 − churn) + new(m), where churn = 1 − (1 − yearly cancellations)^(1/12). The monthly amount at month 12 = active subscribers at month 12 in the whole people shown (none below one) × your price, before platform commission."
          }
        ]
      },
      {
        id: "earnings-method",
        heading: "How the earnings estimate is calculated",
        bullets: [
          "Commission follows the standard marginal bands: 25% (1-100), 20% (101-300), 15% (301-1,000), 10% (above 1,000).",
          "Upfront programmes are converted to a monthly equivalent: price divided by months.",
          "The tier mix and add-ons are assumed to be the same in every band.",
          "Excluded: payment processing, domain, refunds, disputes, booking fees and tax."
        ]
      },
    ],
    faqs: [
      {
        q: "Can the assumptions change?",
        a: "Yes. The platform operator can review them. Any value that differs from its cited source is marked as adjusted on this page, with the operator’s reason, and the change log records it."
      },
    ],
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
    lede: "A guided checklist takes you from your address to launch. Start teaching before every business detail is ready.",
    intro:
      "To start, you need your coaching method, a clear offer and a UAE bank account for payouts. A guided checklist takes you from your address to teaching your Brain, testing it and setting your price. You can begin teaching before every business detail is ready.",
    primaryKeyword: "how to start online personal training UAE",
    sections: [
      {
        id: "need",
        heading: "What you need",
        bullets: [
          "Your identity and a short description of your coaching business.",
          "Your method: how you coach, and the limits you keep.",
          "An offer: who it’s for, your AED price, length and billing.",
          "A UAE bank account (IBAN) for monthly payouts.",
          "Photos or a logo for your brand, if you have them.",
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
      {
        id: "launch",
        heading: "What happens at launch",
        bullets: [
          "Your website and app go live at your coaching address.",
          "Subscribers can join, choose your offer and pay in AED.",
          "Your Brain starts planning for each new subscriber from their own input.",
          "You get tagged links for your bio and Stories."
        ]
      },
      {
        id: "time",
        heading: "How long it takes",
        body: [
          "It depends on how much of your method you teach before launch. Most of the work is the interview, confirming rules and writing at least 20 test scenarios. The checklist shows what is left.",
        ]
      },
    ],
    faqs: [
      { q: "Can I bring my existing clients?", a: "Yes. Invite subscribers you already coach with an invite link; each joins your workspace with their own account." },
      {
        q: "Do I need technical skills?",
        a: "No. The website, app, payments and payouts are set up for you. You answer questions, confirm rules in plain language and set your offer."
      },
      {
        q: "Can I see it before subscribers do?",
        a: "Yes. The subscriber preview shows exactly what subscribers will see, and nothing goes live until you publish.",
      },
      {
        q: "Do I need a minimum number of followers?",
        a: "No minimum is required. For your numbers, the follower calculator headlines a strong case: a best case, not typical. Cautious and typical results show too. An estimate, not a promise.",
      },
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
      "How a Trainer Brain works for weight-loss, strength, muscle-gain and pre and postnatal coaches, with example rules for each specialty.",
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
    floor: ["Reports of dizziness, fainting or chest pain during exercise."],
    handoffs: [
      "Any request for a very low-calorie diet or rapid weight-loss target.",
      "Disordered-eating signals in chat or check-ins, a review topic you can switch on.",
      "Questions about medication, another review topic.",
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
      "Teach your progression, deload and technique rules once. Your Trainer Brain applies them to every lifter, day by day, and asks you when it is unsure.",
    intro:
      "Strength coaching runs on clear progression logic: load, reps in reserve, deloads and technique. Teach yours once and your Trainer Brain applies it to every lifter’s logged sets, progressing confidently where your rules allow and handing you anything unusual.",
    rules: [
      { title: "Progress on evidence", body: "After two sessions with all sets completed at three or more reps in reserve, add 2.5 kg to that lift." },
      { title: "Technique before load", body: "When a beginner reports form doubts, repeat the load and add a technique cue before progressing." },
      { title: "Deload", body: "After three weeks of rising effort at the same load, schedule a deload week at 60% volume." },
    ],
    floor: ["Joint pain during or after a lift.", "A return from injury."],
    handoffs: [
      "Requests to test a one-rep max without a coached session.",
      "Programme changes in the weeks before a competition.",
      "Supplement questions, a review topic you can switch on.",
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
      "Scale hypertrophy coaching: your Trainer Brain applies your volume, exercise and nutrition rules to every subscriber and adapts as they log sessions.",
    intro:
      "Muscle-gain coaching balances weekly volume, exercise choice, recovery and food. Teach your rules and your Trainer Brain builds each subscriber’s plan around their schedule and equipment, adjusts volume from their logs, and pairs with the optional nutrition tier.",
    rules: [
      { title: "Volume steps", body: "Add one set per muscle group per week while sessions are completed and recovery is reported as good." },
      { title: "Equipment swaps", body: "When a machine is unavailable, swap to the approved alternative for the same muscle and rep range." },
      { title: "Recovery", body: "When soreness is reported for three days running, hold volume for a week." },
    ],
    floor: ["Sharp pain rather than muscle soreness."],
    handoffs: [
      "Questions about supplements beyond your stated guidance.",
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
    keyword: "online postnatal fitness coaching",
    description:
      "Scale pre and postnatal coaching safely: pregnancy and red flags always come to you, enforced in code; automation starts after your postnatal clearance.",
    intro:
      "Pre and postnatal coaching needs caution, and {APP_NAME} is built that way. Any mention of pregnancy, bleeding, dizziness or chest pain pauses training and comes to you, enforced in code whatever your settings. For pregnant subscribers the Brain drafts and you approve; routine automation applies to postnatal return only after your clearance step.",
    rules: [
      { title: "Clearance first", body: "No postnatal programme starts until the subscriber confirms their doctor has cleared them for exercise and you have reviewed it." },
      { title: "Effort cap", body: "For the first weeks back, keep effort at a level where the subscriber can hold a conversation; no breath-holding lifts." },
      { title: "Postnatal return", body: "Start with breathing and pelvic floor work before loaded core exercises." },
    ],
    floor: [
      "Any mention of pregnancy: training pauses and the decision is yours.",
      "Bleeding, dizziness, chest pain or pelvic pain.",
    ],
    handoffs: [
      "Postnatal subscribers before the clearance step you set.",
      "Questions about diastasis.",
      "Any change in advice from the subscriber’s doctor.",
    ],
    programme: [
      ["During pregnancy", "Sessions you write or approve", "Drafts only; every decision comes to you"],
      ["Postnatal clearance", "Your clearance step", "Nothing runs until you confirm it"],
      ["Postnatal return", "Breathing, pelvic floor, then strength", "Progresses within your rules after clearance"],
    ],
    faqs: [
      { q: "Is this safe for pregnant clients?", a: "The platform does not give medical advice. Any mention of pregnancy pauses training and comes to you, enforced in code, so a pregnant subscriber’s training decisions are always yours: the Brain can draft, and you approve. Routine automation is for postnatal return, after the clearance step you set." },
      { q: "Can I switch the pregnancy pause off for my clients?", a: "No. Pregnancy is part of the safety floor that applies to every trainer. You review the pause and decide what happens next." },
      SAFETY_FAQ,
    ],
    examplePriceAed: 249,
  }),
  specialty("combat", "Combat", {
    who: "boxing and martial arts coaches",
    keyword: "online boxing coaching platform",
    description:
      "Scale boxing and martial arts conditioning: your Brain plans rounds, drills and strength work, and sends you anything about sparring or injury.",
    intro:
      "Between classes, combat athletes need conditioning, drills and recovery. A Trainer Brain plans rounds, drills and strength work from your rules around each subscriber’s class schedule, and hands you anything about sparring, weight cuts or injury.",
    rules: [
      { title: "Class days", body: "Never schedule hard conditioning the day before a sparring class." },
      { title: "Round work", body: "Progress bag rounds from 3 to 6 over four weeks while form notes stay positive." },
      { title: "Hands", body: "Keep heavy bag work to three days a week and add wrist mobility after each bag session." },
    ],
    floor: ["Hand, wrist or shoulder pain."],
    handoffs: [
      "Head impact symptoms: add them as your own red-flag terms, which also pause training.",
      "Weight-cut requests before a fight.",
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
      "A daily yoga practice built from your sequencing rules: your Trainer Brain plans each student’s sessions and asks you when it is unsure.",
    intro:
      "Yoga students practise best with a daily plan that fits their level and time. Teach your sequencing and modification rules and your Trainer Brain builds each student’s week, offers the modifications you approve, and hands you injuries or anything it is unsure about.",
    rules: [
      { title: "Sequencing", body: "Warm the spine and hips before deep backbends; close with a down-regulating sequence." },
      { title: "Short days", body: "When a student has 20 minutes, keep the opening and closing and shorten the standing series." },
      { title: "Modifications", body: "Offer the knee-down variation when a student reports wrist discomfort." },
    ],
    floor: [
      "Pain during a pose, not just stretch sensation.",
      "Pregnancy.",
      "Dizziness in inversions.",
    ],
    handoffs: [
      "Recent surgery, a review topic you can switch on.",
      "A student’s first attempt at an advanced inversion.",
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
      "Scale mat pilates coaching with a Trainer Brain that follows your progressions and modifications and sends you pain or special conditions.",
    intro:
      "Pilates progress depends on control before challenge. Teach your progressions and modifications, and your Trainer Brain plans each client’s mat sessions, moves them on only when they are ready, and hands you pain or special conditions.",
    rules: [
      { title: "Control first", body: "Progress to the next level only after a client logs three sessions with the current level marked controlled." },
      { title: "Neck support", body: "Offer head-down variations when neck strain is reported." },
      { title: "Frequency", body: "Schedule three short sessions a week for beginners, not one long one." },
    ],
    floor: ["Back pain that radiates or does not ease."],
    handoffs: [
      "Postnatal clients before the stage you set.",
      "Osteoporosis or other conditions that need special positions: add them as review terms.",
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
      "Plan every runner’s week from your rules on volume, intensity and recovery. Your Brain adapts to logged runs and missed days and sends you injury signs.",
    intro:
      "Endurance plans are weekly volume, intensity and recovery, adjusted constantly. Teach your rules and your Trainer Brain builds each runner’s dated plan toward their event, adapts to logged runs and missed days, and hands you injury signs and race-week decisions.",
    rules: [
      { title: "Volume", body: "Increase weekly distance by no more than 10% and hold every fourth week." },
      { title: "Missed runs", body: "Drop a missed easy run; move a missed key session once, never back to back with another hard day." },
      { title: "Heat", body: "In summer, move key sessions to early morning and replace pace targets with effort targets." },
    ],
    floor: ["Pain that changes the runner’s stride."],
    handoffs: [
      "Heat illness symptoms: add them as your own red-flag terms, which also pause training.",
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
    kind: "page",
    group: "uae",
    navLabel: "UAE",
    title: "Online coaching for UAE personal trainers",
    description:
      "For personal trainers in Dubai, Abu Dhabi and across the UAE: AED pricing and card payments, monthly UAE payouts, an Arabic-ready layout and bookings.",
    h1: "For personal trainers in the UAE: take your coaching online",
    eyebrow: "UNITED ARAB EMIRATES",
    intro:
      "{APP_NAME} is built for trainers in the UAE: prices and card payments in AED, monthly payouts to a UAE bank account, an Arabic-ready layout and bookings for in-person sessions. Your future subscribers are likely already on Instagram, and a monthly price in your method reaches far more of them than your hours can.",
    primaryKeyword: "online coaching platform UAE",
    sections: [
      {
        id: "instagram",
        heading: "Your audience is already here",
        body: [
          "DataReportal counted 11.1 million internet users in the UAE at the start of 2025, 99.0% of the population, and 7.60 million Instagram users, equal to 67.8% of the population. The median age was 31.6.",
          "For a trainer, that means the people who follow you for workouts, meals and motivation are reachable where you already post. What most trainers lack is not an audience but an offer those followers can afford every month, and a way to deliver it without selling more hours.",
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
          "Dates and reminders in the UAE time zone.",
        ],
      },
      {
        id: "dubai",
        heading: "Dubai: a busy market with a wide spread of prices",
        body: [
          "Public participation in Dubai Fitness Challenge 2024 topped 2.73 million, according to the Government of Dubai Media Office. Published price guides show how wide the market is: one-to-one sessions from about AED 70 to above AED 700, and online coaching from AED 400 to 2,000 a month.",
          "With that spread, a monthly subscription to your method can be priced well below a single premium session and still add up, while your one-to-one time stays the premium option you sell as paid bookings.",
        ],
        table: {
          caption: "Published Dubai price guides (not official statistics)",
          columns: ["Service", "Published range", "Source"],
          rows: [
            ["One-to-one session", "AED 70-350", "Hey Trainer, 2026"],
            ["One-to-one session", "AED 200-700+", "Embody Fitness, 2025"],
            ["Online coaching per month", "AED 400-2,000", "369MMAFIT, 2026"],
            ["Hybrid online and in person, per month", "AED 1,500-3,000", "369MMAFIT, 2026"],
          ],
        },
        sources: ["dubai-fitness-challenge-2024", "heytrainer-dubai-2026", "embody-dubai-2025", "369mmafit-online-2026"],
      },
      {
        id: "abu-dhabi",
        heading: "Abu Dhabi: more residents active than before",
        body: [
          "The fourth Abu Dhabi Sports and Physical Activity Survey, by the Department of Community Development and Abu Dhabi Sports Council, found 60.3% of residents meet WHO physical activity standards, up from 53.6%, from about 31,000 responses.",
          "More active residents means more people who want guidance they can follow every day. A plan in your method, adapted as they log sessions, is that guidance at a monthly price, and you stay the person they can book when they want you in person.",
        ],
        sources: ["abu-dhabi-activity-survey-2026"],
      },
      {
        id: "emirates",
        heading: "Sharjah, Ajman and the northern emirates",
        body: [
          "Online coaching is not tied to where you train. Subscribers anywhere in the UAE follow the same dated plan, log their sessions and message you, and in-person bookings happen wherever you publish them. We have not found published local price data for the other emirates, so we do not quote any.",
        ],
      },
      {
        id: "licensing",
        heading: "Working as a trainer in the UAE: check your licence",
        body: [
          "Requirements for personal trainers depend on how and where you work: in a gym, through your own company, in a free zone or on a freelance permit. Check the current rules with your licensing authority and your emirate’s sports authority before you sell coaching. Setup collects your business details, and payments and launch have their own checks. This is general information, not legal advice.",
          "Promoting your own coaching on social media has its own rules; see the advertiser permit guide.",
        ],
      },
      {
        id: "offer",
        heading: "Online and in person, one brand",
        bullets: [
          "Sell day-by-day AI coaching at your own monthly price.",
          "Keep one-to-one sessions as paid bookings with your cancellation rules.",
          "Take payment in AED and receive monthly payouts to a UAE bank.",
          "Use one website, one address and one app for both.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need a trade licence?",
        a: "You can start setting up and teaching your Brain without one; business details are collected during setup, and payments and launch have their own checks. Check the licence you need with your licensing authority.",
      },
      {
        q: "Can I coach subscribers in other emirates?",
        a: "Yes. Online coaching follows the subscriber wherever they train. In-person bookings happen where you publish them.",
      },
      {
        q: "Do subscribers pay in AED?",
        a: "Yes. Prices, card payments, statements and payouts are all in AED.",
      },
      {
        q: "Is it available in Arabic?",
        a: "The layout is Arabic-ready, including right-to-left pages. Full Arabic translation of the interface is not yet available.",
      },
      {
        q: "Looking for a coach in Dubai or Abu Dhabi?",
        a: "Browse the coach directory to find independent coaches who chose to be listed.",
      },
    ],
    related: ["/guides/pricing-online-coaching-uae", "/guides/uae-advertiser-permit", "/for-trainers", "/coaches"],
    lastUpdated: UPDATED,
    indexable: true,
    jsonLd: ["WebPage", "FAQPage"],
  },
  {
    path: "/guides",
    kind: "hub",
    group: "guides",
    navLabel: "Guides",
    title: "Guides for UAE personal trainers going online",
    description:
      "Practical guides for UAE personal trainers: pricing online coaching, turning followers into clients, the advertiser permit and writing coaching rules.",
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
    description: "A sourced guide to pricing online coaching in the UAE: published price ranges, worked AED examples, tiers, upfront programmes and what commission costs.",
    "h1": "How to price online coaching in the UAE",
    intro: "Price online coaching between what your followers can afford and what your time is worth. Published Dubai guides put one-to-one sessions at roughly AED 70-350, and premium trainers higher, and online coaching at AED 400-2,000 a month. A day-by-day plan in your method can sit well below your session rate and still add up, because it serves many people at once.",
    keyword: "how to price online coaching UAE",
    sections: [
      {
        id: "ranges",
        heading: "Published price ranges",
        table: {
          caption: "Published price guides (not official statistics)",
          columns: [
            "Service",
            "Published range",
            "Source"
          ],
          rows: [
            [
              "One-to-one session in Dubai",
              "AED 70-350",
              "Hey Trainer, 2026"
            ],
            [
              "One-to-one session in Dubai",
              "AED 200-700+",
              "Embody Fitness, 2025"
            ],
            [
              "Online coaching, basic to premium, per month",
              "AED 400-2,000",
              "369MMAFIT, 2026"
            ],
            [
              "Hybrid online and in person, per month",
              "AED 1,500-3,000",
              "369MMAFIT, 2026"
            ]
          ]
        },
        note: "Price guides published by fitness businesses, not official statistics. See Methodology.",
        sources: [
          "heytrainer-dubai-2026",
          "embody-dubai-2025",
          "369mmafit-online-2026"
        ]
      },
      {
        id: "why",
        heading: "Why a subscription is priced differently from a session",
        body: [
          "A session sells an hour of your attention. A subscription sells your method every day: a dated plan, adjustments as the subscriber trains, and a route to you when something needs your judgment. Because your Trainer Brain applies your rules to every subscriber at once, the price no longer has to cover your hour, so you can set it for the follower who cannot book you every week.",
          "Keep the two offers apart. Subscribers who want more of you can still book a paid one-to-one session; the subscription is how everyone else trains your way."
        ]
      },
      {
        id: "steps",
        heading: "Set your price in six steps",
        steps: [
          {
            title: "Start from your session rate",
            body: "Write down what you charge for a one-to-one session today. It anchors your premium offer and the comparison the earnings calculator makes."
          },
          {
            title: "Decide what a subscriber gets each day",
            body: "A dated plan, guided workouts that adapt, chat with you and a labelled digital coach. Be specific: this is what the price buys."
          },
          {
            title: "Choose your tiers",
            body: "Workout only, or workout and nutrition at a higher price. A voice add-on in your own voice can be priced on top."
          },
          {
            title: "Pick a programme length and billing",
            body: "Monthly billing suits ongoing coaching; an upfront price suits a defined programme with an outcome and an end date."
          },
          {
            title: "Lower the first step, not the price",
            body: "Use a free trial or a promotion code for a launch, rather than a permanently low price you will struggle to raise."
          },
          {
            title: "Check the arithmetic",
            body: "Use the earnings calculator with your price and a cautious number of subscribers to see what remains after commission."
          }
        ]
      },
      {
        id: "examples",
        heading: "Worked examples in AED",
        table: {
          caption: "Monthly subscriptions and commission by band",
          columns: [
            "Subscribers × monthly price",
            "Subscriptions",
            "Commission",
            "Before other costs",
            "Sessions at AED 250"
          ],
          rows: [
            [
              "40 × AED 149",
              "AED 5,960",
              "AED 1,490 (25%)",
              "AED 4,470",
              "About 18"
            ],
            [
              "120 × AED 199",
              "AED 23,880",
              "AED 5,771 (24.17% overall)",
              "AED 18,109",
              "About 72"
            ],
            [
              "350 × AED 249",
              "AED 87,150",
              "AED 18,053 (20.71% overall)",
              "AED 69,098",
              "About 276"
            ]
          ]
        },
        note: "Arithmetic with the commission bands, not a forecast or promise; before payment processing, refunds and tax. The last column divides the amount by a AED 250 session rate."
      },
      {
        id: "upfront",
        heading: "Monthly or upfront: a worked example",
        body: [
          "Suppose you sell a three-month programme for AED 540 paid upfront. Spread over three months that is AED 180 a month, the monthly equivalent the earnings calculator uses. Sixty subscribers on that programme give AED 10,800 a month in subscriptions; commission at 25% is AED 2,700, leaving AED 8,100 before other costs.",
          "Upfront pricing works when the programme has a clear outcome and a fixed length. Monthly pricing suits open-ended coaching, where subscribers stay as long as it works for them. You can offer both across different programmes."
        ]
      },
      {
        id: "tiers",
        heading: "Tiers and add-ons",
        body: [
          "A nutrition tier lets a subscriber buy workout and nutrition together at a higher price. If 30 of 100 subscribers choose a AED 299 nutrition tier and 70 stay on a AED 199 workout tier, the average is AED 229 a month and subscriptions total AED 22,900; commission at 25% on the first 100 is AED 5,725.",
          "The voice add-on, where a voice in your own verified voice runs the session, is priced separately. Subscribers choose whether to add it, so price it as a clear extra for those who want to hear your own voice run every session."
        ]
      },
      {
        id: "position",
        heading: "Position your AI coaching",
        bullets: [
          "Price below your one-to-one rate: subscribers get your method daily, not your hour.",
          "Keep a premium tier: nutrition, voice or included sessions.",
          "Consider upfront programmes for a defined outcome and length.",
          "Use trials or promotion codes to lower the first step, not permanent discounts."
        ]
      },
      {
        id: "commission",
        heading: "Include commission and costs",
        body: [
          "Commission is a share of subscription revenue in marginal bands: 25% for your first 100 paying subscribers, 20% for the next 200, 15% up to 1,000 and 10% beyond. Each band keeps its own rate, so growing never raises the rate on earlier subscribers.",
          "Your statement also lists payment processing and any optional services you choose, such as the voice add-on or your own domain. Use the earnings calculator to see what remains before these costs at your price."
        ]
      },
      {
        id: "mistakes",
        heading: "Common pricing mistakes",
        bullets: [
          "Pricing the subscription like a session: followers who cannot book you weekly will not pay a session price every month.",
          "Launching at a price you plan to double later: add value with tiers instead.",
          "Leaving the offer vague: say who it is for, what they get each day and the price.",
          "Forgetting costs: commission and processing come out before your payout.",
          "Promising outcomes: describe what the coaching includes, not a result you cannot control."
        ]
      }
    ],
    faqs: [
      {
        q: "Should online coaching cost less than sessions?",
        a: "Usually. A monthly subscription to your method reaches people who cannot pay for regular sessions; your one-to-one time stays the premium option."
      },
      {
        q: "Should I charge monthly or upfront?",
        a: "Monthly suits ongoing coaching; upfront suits a defined programme with a clear end. You can offer both across different programmes."
      },
      {
        q: "Does the commission band change what subscribers pay?",
        a: "No. You set the price. The band only decides the share of each subscriber’s charges, falling from 25% to 10% as you grow."
      },
      {
        q: "How does this compare with my one-to-one income?",
        a: "The earnings calculator shows how many sessions at your usual rate would earn the same amount before other costs."
      }
    ],
    related: [
      "/earnings-calculator",
      "/pricing",
      "/uae"
    ]
  }),
  guide("instagram-followers-to-clients", "Followers to clients", {
    title: "Turning Instagram followers into paying clients",
    description: "Why most followers never see a Story, what published benchmarks and creator sales data suggest, and practical steps to turn followers into clients.",
    "h1": "Turning Instagram followers into paying clients",
    intro: "Only a share of your followers see any one Story, a few of them tap a link, and a few visitors buy. Published benchmarks put each step in single-digit percentages. Reaching more people, a clear offer and steady sharing matter more than follower count alone.",
    keyword: "how to monetise fitness followers",
    sections: [
      {
        id: "funnel",
        heading: "The follower funnel, with benchmarks",
        bullets: [
          "Reach: Stories reached about 9.6-10.4% of followers for brand accounts with 1-5K followers and about 0.5-0.65% above 100K; a six-frame Story sequence reached 20.5%.",
          "Clicks: there is no industry benchmark for link stickers; the calculator uses {CLICK_SCENARIOS} of viewers per link Story (cautious, typical, strong), the range creators report.",
          "Purchase: the calculator uses {PAID_SCENARIOS} of visitors, from a luxury-retail purchase rate to subscription-app medians. No published benchmark exists for coaching subscriptions.",
          "Creators: a creator platform’s course benchmarks put mid-range sales at 1.5-5% of an audience and 0.52-1.1% for higher-priced courses, and creators with 1,000-10,000 followers sell about USD 273 a month on average.",
          "Participation: most people in online communities watch without acting."
        ],
        sources: [
          "socialinsider-stories",
          "creatorflow-link-sticker",
          "dynamicyield-conversion",
          "revenuecat-state-2026",
          "passion-creator-rates",
          "stan-creator-economy",
          "nng-participation"
        ]
      },
      {
        id: "same-people",
        heading: "Why sharing the same link more often levels off",
        body: [
          "Socialinsider measures Story reach as the share of followers who viewed at least one frame. The people who watch one Story are largely the people who watch the next, so ten link Stories do not reach ten times as many people. Each extra Story gives the same viewers another chance to tap, which helps at first and then levels off within a month.",
          "Over months your audience changes: new followers arrive and others drift away. That is why the follower calculator treats repeat Stories in a month as more chances for the same audience, and adds a share of new people each month, so steady sharing keeps reaching people who have not seen your link. Reels with a comment keyword, your bio link and a broadcast channel reach people your Stories miss, and Instagram says most Reels people see come from accounts they don’t follow."
        ],
        sources: [
          "socialinsider-stories",
          "meta-instagram-ranking"
        ]
      },
      {
        id: "examples",
        heading: "Three example accounts",
        body: [
          "The table applies the calculator’s current assumptions to three example accounts at AED 199 a month, with 8 link Stories, 4 keyword Reels and 30% yearly cancellations. It shows the strong case, a best case for an engaged, growing audience and weekly sharing, not a typical result or a prediction; the calculator shows the cautious and typical results too."
        ]
      },
      {
        id: "steps",
        heading: "What you can do, step by step",
        steps: [
          {
            title: "Use a professional account",
            body: "Business and creator accounts show your follower and Story insights, and only professional accounts can connect to the follower calculator."
          },
          {
            title: "Write one clear offer",
            body: "Who it is for, what they get each day, the price in AED and how to start. Followers who cannot tell what you sell do not tap."
          },
          {
            title: "Put your tagged link in your bio",
            body: "Your bio link works every day, not only while a Story is live, and tagged links show which link brought a visitor when that visitor allows analytics."
          },
          {
            title: "Share a Story sequence, not a single frame",
            body: "Socialinsider found reach rose from 6.3% for a one-frame Story to 20.5% by the sixth frame. Tell a short story and place the link where it makes sense."
          },
          {
            title: "Mix link Stories with ordinary ones",
            body: "In Hootsuite’s experiment, Stories with link stickers got less engagement than Stories without. Keep most Stories useful and link some of them."
          },
          {
            title: "Reply to the people who reply",
            body: "Followers who message you about coaching are the warmest leads you have. Answer them with your link."
          },
          {
            title: "Show what subscribers get",
            body: "A day’s plan, a workout or a check-in makes the offer concrete, as long as you show only what you actually deliver."
          },
          {
            title: "Check and adjust monthly",
            body: "Watch how many people join each month, change one thing at a time, and rerun the calculator with your own numbers."
          }
        ],
        sources: [
          "socialinsider-stories",
          "hootsuite-link-stickers"
        ]
      },
      {
        id: "engagement",
        heading: "Engagement matters more than follower count",
        body: [
          "HypeAuditor reports that nano-influencers, accounts with 1,000 to 10,000 followers, make up 76% of Instagram influencers and have the highest engagement rate, 2.19%. Socialinsider’s average across 35 million posts in 2025 was 0.48%.",
          "If you enter or connect your engagement rate, the calculator compares it with the {ENGAGEMENT_AVG} average it uses and scales your Story reach and comments up or down, within limits; the strong case already assumes an engaged audience, so your rate can lower its Story reach but does not raise it again. A smaller, engaged audience that trusts you can matter more than a large, quiet one."
        ],
        sources: [
          "hypeauditor-2025",
          "socialinsider-engagement"
        ]
      },
      {
        id: "honest",
        heading: "Keep your promotion honest",
        bullets: [
          "Describe what the coaching includes, not a result nobody can promise.",
          "Show your real price in AED and what is included.",
          "Say that plans are delivered by your Trainer Brain and that you review what it is unsure about.",
          "If you promote brands or products other than your own coaching, check the advertiser permit rules first."
        ]
      }
    ],
    faqs: [
      {
        q: "How many followers do I need?",
        a: "There is no minimum. Engagement and regular sharing matter; use the follower calculator with your own numbers."
      },
      {
        q: "Why do the calculator’s scenarios differ so much?",
        a: "Because the cautious and typical results use published averages from brand accounts, retail and apps, while the strong case uses the top values found in the research and our assumptions for an engaged, growing audience. The headline is the strong case, a best case rather than a typical result. Your real number depends on your content, audience, offer and price."
      },
      {
        q: "Does sharing my link every day help?",
        a: "Some. Each Story gives the same viewers another chance to tap, so within a month the gain levels off, and link stickers can reduce engagement. Over months, regular sharing reaches the new people who join your audience. Reels with a comment keyword and your bio link reach new people."
      },
      {
        q: "Can I use my real Instagram numbers?",
        a: "After you sign up, you can connect an Instagram professional account to fill in your follower count and recent engagement. We read those numbers once and do not keep access to your account."
      }
    ],
    related: [
      "/follower-calculator",
      "/methodology",
      "/guides/uae-advertiser-permit"
    ]
  }),
  guide("uae-advertiser-permit", "Advertiser permit", {
    title: "UAE advertiser permit: what trainers should know",
    description: "What reports say about the UAE Advertiser Permit and its exemption for promoting your own services, with a checklist for trainers. Not legal advice.",
    "h1": "The UAE advertiser permit: what trainers promoting their own coaching should know",
    intro: "Reports on the UAE Advertiser Permit say anyone creating advertising content on social media needs one, paid or unpaid, while people promoting their own products or services through personal accounts are exempt. Rules change: check the UAE Media Council. This is information, not legal advice.",
    keyword: "UAE advertiser permit personal trainer",
    sections: [
      {
        id: "summary",
        heading: "What has been reported",
        bullets: [
          "The permit, known as Mu’lin, is reported to be required for anyone creating advertising content on social media, whether they are paid or not.",
          "People promoting their own products or services, or their own company’s, through personal accounts are reported to be exempt.",
          "Applicants are reported to need to be at least 18, with no past media content violations; citizens and residents are reported to need a valid electronic media trade licence.",
          "It was reported as free of charge for three years for citizens and residents, valid for one year and renewable; visitors can hold a three-month permit.",
          "Applications are made through the UAE Media Council’s official website."
        ],
        sources: [
          "gulfnews-advertiser-permit",
          "uae-media-council-permit"
        ]
      },
      {
        id: "own",
        heading: "Promoting your own coaching",
        body: [
          "Most of what a trainer posts to sell their coaching promotes their own services: your offer, your programme, your price and your link. Reports describe this as exempt when it is done through your personal account. Keep that promotion clearly about your own coaching, under your own name or your own company’s."
        ]
      },
      {
        id: "others",
        heading: "When it may apply to you",
        body: [
          "The permit is reported to cover promotion of other people’s products and services. Check the current rules with the UAE Media Council before you post if you do any of these:"
        ],
        bullets: [
          "Paid or gifted posts for a gym, brand or supplement.",
          "Promoting another trainer’s programme or a product you do not own, including through affiliate links.",
          "Running a page that advertises other businesses’ offers."
        ]
      },
      {
        id: "checklist",
        heading: "A practical checklist before you promote",
        steps: [
          {
            title: "List what you promote",
            body: "Separate your own coaching from anything you post for someone else."
          },
          {
            title: "Check the account",
            body: "Reports tie the exemption to promoting your own services through personal accounts."
          },
          {
            title: "Check the current rules",
            body: "Rules change. Read the UAE Media Council’s current guidance or ask a legal adviser."
          },
          {
            title: "Keep claims accurate",
            body: "Describe what subscribers get and your price in AED; avoid promising results."
          },
          {
            title: "Keep records",
            body: "Note paid partnerships, what you posted and when."
          }
        ]
      },
      {
        id: "platform",
        heading: "How {APP_NAME} fits",
        body: [
          "{APP_NAME} gives you a tagged link to your own coaching website and app, so the promotion you post is promotion of your own services. It does not post to Instagram for you and does not advise on permits."
        ]
      }
    ],
    faqs: [
      {
        q: "Does {APP_NAME} give legal advice?",
        a: "No. This guide summarises public reports; confirm your situation with the UAE Media Council or a legal adviser."
      },
      {
        q: "Do I need a permit to share my own coaching link?",
        a: "Reports say people promoting their own services through personal accounts are exempt. Confirm with the UAE Media Council, because rules change."
      },
      {
        q: "Does the permit cost money?",
        a: "It was reported as free for three years for citizens and residents. Check the current terms with the UAE Media Council."
      },
      {
        q: "What if I promote a supplement brand?",
        a: "Promoting products that are not your own is what the permit is reported to cover. Check the rules before you post."
      }
    ],
    related: [
      "/faq",
      "/guides/instagram-followers-to-clients",
      "/uae"
    ]
  }),
  guide("writing-coaching-rules", "Writing coaching rules", {
    title: "How to write coaching rules your AI can follow",
    description: "A practical format for coaching rules an AI trainer can apply consistently: when, what to do, unless, why, plus how to test rules with held-out scenarios.",
    "h1": "How to write coaching rules your AI can follow",
    intro: "A good coaching rule names the situation, the action, the exceptions and the reason, in plain language. Write it as “When…, do…, unless…, because…”, cite where it comes from, and test it on scenarios you did not use to write it.",
    keyword: "how to write coaching rules for AI",
    sections: [
      {
        id: "format",
        heading: "The format",
        steps: [
          {
            title: "When",
            body: "The situation, as a subscriber would describe it or as their logs show it."
          },
          {
            title: "Do",
            body: "The specific action, with numbers where you use them."
          },
          {
            title: "Unless",
            body: "The exceptions that change your answer."
          },
          {
            title: "Because",
            body: "Your reason, so the Brain can tell similar situations apart."
          }
        ]
      },
      {
        id: "example",
        heading: "Examples",
        cards: [
          {
            title: "Progression",
            label: "Illustrative",
            body: "When a client completes every set with three or more reps in reserve for two sessions, add 2.5 kg to that lift, unless they reported poor sleep that week, because load should follow evidence of recovery."
          },
          {
            title: "Missed session",
            label: "Illustrative",
            body: "When a subscriber misses a session, move it to the next free day, unless that puts two hard sessions in a row, because recovery between hard sessions matters more than the calendar."
          },
          {
            title: "Deload",
            label: "Illustrative",
            body: "When logged effort rises for three sessions at the same load, reduce volume by a third for one week, unless a competition is within two weeks, because fatigue hides progress."
          },
          {
            title: "Calorie target",
            label: "Illustrative",
            body: "When weekly check-ins show no change for three weeks, flag the calorie target for review instead of cutting further, unless the subscriber says they did not follow the plan, because adherence comes before adjustment."
          }
        ]
      },
      {
        id: "good",
        heading: "What makes a rule work",
        bullets: [
          "It names a situation the Brain can recognise from what subscribers say or log.",
          "It uses your numbers: loads, sets and days, not “a bit more”.",
          "It says what stops it: the exceptions are where your judgment lives.",
          "It gives the reason, so similar but different cases can be told apart.",
          "It cites where it comes from: your interview, a document or a case."
        ]
      },
      {
        id: "mistakes",
        heading: "Common mistakes",
        bullets: [
          "Rules that only restate a principle, such as “progress gradually”, without saying what to do.",
          "Two rules that give different answers to the same situation: resolve the conflict and keep one.",
          "Rules that try to handle pain or medical issues: those always come to you, enforced in code, so write rules for training decisions.",
          "Rules with no exceptions: almost every coaching decision has an “unless”."
        ]
      },
      {
        id: "sources",
        heading: "Where rules come from",
        body: [
          "You can write rules directly, confirm rules drafted from your coaching interview, or import your own documents and review the extracted text privately before anything is used. When two sources disagree, you decide which wins. Every rule keeps its source, so you can see why the Brain did what it did."
        ]
      },
      {
        id: "first-rules",
        heading: "Your first ten rules",
        bullets: [
          "Progression on your main lifts or sessions.",
          "Missed and moved sessions.",
          "Deloads and easy weeks.",
          "Exercise swaps you allow.",
          "Limits for the equipment a subscriber has.",
          "Where rest days go.",
          "How beginners and experienced subscribers start.",
          "Travel weeks.",
          "How to respond to weekly check-ins.",
          "What should always come to you."
        ]
      },
      {
        id: "test",
        heading: "Test with held-out scenarios",
        body: [
          "Write situations you did not use while writing the rules, with the answer you expect, including cases that should come to you. {APP_NAME} requires at least 20 before a Brain can be published.",
          "A good set covers your most common decisions, the edges where an exception applies, and situations outside what you taught, where the right answer is to hand the decision to you."
        ]
      },
      {
        id: "corrections",
        heading: "Corrections become teaching",
        body: [
          "Once live, the Brain hands you anything below your confidence threshold. When you approve or correct it, the correction is recorded with its reason and becomes teaching; the next release is evaluated against your scenarios before it goes live, and you can roll back to an earlier release at any time."
        ]
      }
    ],
    faqs: [
      {
        q: "How many rules do I need?",
        a: "Start with the decisions you make most often. Anything not covered is handed to you, and your answers become new teaching."
      },
      {
        q: "What does the Brain do with a situation I never taught?",
        a: "It hands it to you with a draft instead of acting. Your answer becomes teaching for the next release."
      },
      {
        q: "Do rules replace my programmes?",
        a: "No. You can still write programme templates yourself; rules decide how each subscriber’s plan adapts."
      }
    ],
    related: [
      "/trainer-brain",
      "/demo",
      "/guides/instagram-followers-to-clients"
    ]
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
