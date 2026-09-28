// The complete capability inventory shown on /features (and counted on the
// home page). Describe only what the platform does: every entry maps to
// shipped code (see docs/features). Items that need an outside provider name
// it in `availability`, so the page shows "Available soon" until the Super
// admin enables that provider. {APP_NAME} is replaced when rendered.
import type { AvailabilityKey } from "./marketing.ts";

export type Capability = {
  name: string;
  detail: string;
  availability?: AvailabilityKey[];
  /** "Optional tier" or "Add-on"; everything else is included. */
  offering?: "Optional tier" | "Add-on";
};
export type CapabilityGroup = {
  id: string;
  title: string;
  /** Who uses it: the trainer, the subscriber, or both. */
  audience: "You" | "Your subscribers" | "You and your subscribers";
  /** The feature page that explains this group, when there is one. */
  page?: string;
  items: Capability[];
};

const model: AvailabilityKey[] = ["model"];
const paid: AvailabilityKey[] = ["payments"];
const nutrition = { availability: ["nutrition"] as AvailabilityKey[], offering: "Optional tier" as const };
const voice = { availability: ["voice"] as AvailabilityKey[], offering: "Add-on" as const };

export const FEATURE_MATRIX: CapabilityGroup[] = [
  {
    id: "brain",
    title: "Your Trainer Brain",
    audience: "You",
    page: "/trainer-brain",
    items: [
      { name: "Guided coaching interview", detail: "Explain what you recommend, why, the alternatives and what changes your answer." },
      { name: "Rules in plain language", detail: "Confirm, edit or reject each rule; every rule keeps its source.", availability: model },
      { name: "Coaching cases and examples", detail: "Teach real decisions, not just principles." },
      { name: "Your own documents", detail: "Import your material and review the extracted text privately before it is used.", availability: model },
      { name: "Conflict resolution", detail: "When two sources disagree, you decide which rule wins.", availability: model },
      { name: "Held-out test scenarios", detail: "At least 20 situations with the answer you expect, written before launch." },
      { name: "Evaluation before release", detail: "Every version is tested against your scenarios before it can go live.", availability: model },
      { name: "Versioned releases and rollback", detail: "Publish a version, compare it, and roll back at any time.", availability: model },
      { name: "Your confidence threshold", detail: "You choose which routine changes run automatically; the rest comes to you.", availability: model },
      { name: "Learning from corrections", detail: "Your approvals, corrections and subscriber outcomes become teaching for the next release.", availability: model },
    ],
  },
  {
    id: "training",
    title: "Plans and workouts",
    audience: "You and your subscribers",
    page: "/features/ai-training-plans",
    items: [
      { name: "A personalised, dated plan", detail: "Built by your Brain from each subscriber’s goals, schedule, experience and equipment.", availability: model },
      { name: "Adapts as they train", detail: "Progressions, missed sessions and swaps follow your confirmed rules.", availability: model },
      { name: "Hand-off when unsure", detail: "Low-confidence decisions come to you as a draft to approve or correct.", availability: model },
      { name: "Programme templates", detail: "Write programmes yourself with the exercise library and assign them." },
      { name: "Automatic calendar", detail: "Assigned programmes are scheduled by date, with rest days kept." },
      { name: "Move or skip a session", detail: "Subscribers reschedule within your rules." },
      { name: "Guided session", detail: "Exercise cues, sets, targets and rest timers, one step at a time.", availability: paid },
      { name: "Set logging", detail: "Reps, load, effort and notes for every set, with corrections kept in history.", availability: paid },
      { name: "Approved swaps", detail: "Subscribers can swap only to alternatives you approved.", availability: paid },
      { name: "Offline in the gym", detail: "A workout opened online keeps working offline and syncs later.", availability: paid },
      { name: "One-tap pain report", detail: "Pauses the workout and alerts you straight away." },
      { name: "Workout reminders", detail: "Reminders, programme-ready and missed-session messages.", availability: paid },
    ],
  },
  {
    id: "nutrition",
    title: "Nutrition tier",
    audience: "You and your subscribers",
    page: "/features/nutrition",
    items: [
      { name: "Weekly meal plans", detail: "Built from your recipes, rules and each subscriber’s targets and preferences.", ...nutrition },
      { name: "Recipe options and swaps", detail: "Only the swaps your teaching allows.", ...nutrition },
      { name: "Grocery lists", detail: "A consolidated shopping list for the week.", ...nutrition },
      { name: "Pantry and leftovers", detail: "Plans that use what the subscriber already has.", ...nutrition },
      { name: "Food diary", detail: "With favourites, copied meals and corrections.", ...nutrition },
      { name: "Meal photo estimates", detail: "Foods and portions estimated from a photo, confirmed by the subscriber.", ...nutrition },
      { name: "Barcode lookup", detail: "Packaged foods read by barcode, confirmed before logging.", ...nutrition },
      { name: "Weekly check-ins", detail: "Progress against the targets you set.", ...nutrition },
      { name: "Your nutrition teaching", detail: "Cases, recipes and calorie methods, evaluated before release.", ...nutrition },
      { name: "Exceptions queue", detail: "Decisions outside your rules come to you.", ...nutrition },
    ],
  },
  {
    id: "voice",
    title: "Voice add-on",
    audience: "You and your subscribers",
    page: "/features/voice-coach",
    items: [
      { name: "Sessions in your own voice", detail: "Cues, sets and rest, voiced from your own verified voice.", ...voice },
      { name: "Verified and consented", detail: "Identity verification and your separate, recorded consent, which you can withdraw.", ...voice },
      { name: "Usage on your statement", detail: "Voice usage cost is passed through and itemised.", ...voice },
    ],
  },
  {
    id: "coaching",
    title: "Chat, progress and data",
    audience: "You and your subscribers",
    page: "/features/chat-and-digital-coach",
    items: [
      { name: "Private chat with you", detail: "One thread per subscriber, with photo and PDF attachments." },
      { name: "Labelled digital coach", detail: "Answers from your published teaching and is always labelled as digital.", availability: [...model, ...paid] },
      { name: "Personal takeover", detail: "Take over a subscriber and the digital coach steps back." },
      { name: "Scheduled follow-ups", detail: "Check-in messages sent when you plan them.", availability: paid },
      { name: "Client Twin", detail: "Goals, preferences and history in one coaching context, each with its date and source." },
      { name: "Progress page", detail: "Completed sessions, training volume and best loads per exercise." },
      { name: "Apple Health import", detail: "Subscribers can import an Apple Health export." },
      { name: "WHOOP connection", detail: "Shared only with the subscriber’s permission and your policy.", availability: ["whoop"] },
      { name: "Amazfit / Zepp connection", detail: "Shared only with the subscriber’s permission and your policy.", availability: ["zepp"] },
      { name: "Notifications and quiet hours", detail: "An in-app inbox with preferences." },
    ],
  },
  {
    id: "bookings",
    title: "Bookings",
    audience: "You and your subscribers",
    page: "/features/bookings",
    items: [
      { name: "Session slots", detail: "One-off or weekly slots with capacity." },
      { name: "Paid one-to-one sessions", detail: "Card payment in AED at booking.", availability: paid },
      { name: "Cancellation rules", detail: "Your window decides refunds automatically.", availability: paid },
      { name: "Attendance and no-shows", detail: "Tracked per booking.", availability: paid },
      { name: "Calendar export", detail: "Bookings in the subscriber’s own calendar." },
    ],
  },
  {
    id: "brand",
    title: "Your brand, website and app",
    audience: "You",
    page: "/features/website-and-domain",
    items: [
      { name: "Design Studio", detail: "Your name, headline, biography, colours and logo." },
      { name: "Coaching website", detail: "Pages, photo galleries and a contact form whose messages reach your inbox." },
      { name: "Private preview", detail: "See every change before it is public." },
      { name: "Your coaching address", detail: "Reserved the moment you sign up." },
      { name: "Your own domain, bought for you", detail: "Bought and renewed automatically, with the cost on your statement.", availability: ["customDomains"] },
      { name: "Connect a domain you own", detail: "Point an existing domain at your website.", availability: ["customDomains"] },
      { name: "Installable app", detail: "Subscribers add your app to their home screen with your name and icon." },
      { name: "Search titles and descriptions", detail: "Set how your pages appear in search results." },
      { name: "Coach directory listing", detail: "Optional: appear in the public directory of coaches." },
      { name: "Arabic-ready layout", detail: "Right-to-left pages for Arabic." },
    ],
  },
  {
    id: "money",
    title: "Offers, payments and payouts",
    audience: "You",
    page: "/features/payments-and-payouts",
    items: [
      { name: "Two tiers", detail: "Workout, or workout and nutrition, each at your price." },
      { name: "Your price in AED", detail: "With the programme length you choose.", availability: paid },
      { name: "Monthly or upfront billing", detail: "Bill the whole programme upfront, or month by month.", availability: paid },
      { name: "Trials and promotion codes", detail: "Free trial days and codes when you want them.", availability: paid },
      { name: "Card checkout", detail: "Through Stripe, with receipts and billing history for subscribers.", availability: paid },
      { name: "Refund decisions", detail: "Requests you approve or decline, reconciled with the payment provider.", availability: paid },
      { name: "Transparent commission", detail: "Marginal bands of 25%, 20%, 15% and 10%; AI usage at cost." },
      { name: "Monthly statement", detail: "From gross revenue to net, every cost itemised." },
      { name: "Ledger export", detail: "Your ledger as a CSV file." },
      { name: "Monthly payouts", detail: "To a verified UAE IBAN.", availability: ["payouts"] },
    ],
  },
  {
    id: "growth",
    title: "Growth",
    audience: "You",
    page: "/follower-calculator",
    items: [
      { name: "Follower calculator", detail: "A strong case (a best case, not typical) with cautious and typical scenarios, from cited benchmarks and stated assumptions, with every assumption shown." },
      { name: "Connect Instagram", detail: "Professional accounts fill the calculator with real numbers; access is not kept.", availability: ["instagram"] },
      { name: "Tagged share links", detail: "Links for your bio and Stories, so you see which ones bring visitors." },
      { name: "Consented visitor sources", detail: "Where visitors came from, only when they allowed analytics." },
      { name: "Invite links", detail: "Invite subscribers you already coach." },
      { name: "Website inquiries", detail: "Contact-form messages in one inbox." },
    ],
  },
  {
    id: "trust",
    title: "Safety, privacy and team",
    audience: "You and your subscribers",
    page: "/features/safety",
    items: [
      { name: "Safety floor in code", detail: "Pain, pregnancy and red flags pause training and come to you, whatever the settings." },
      { name: "Your own red flags", detail: "Add terms that also pause training, and topics that come to you for review." },
      { name: "Escalation", detail: "Unreviewed safety holds escalate until someone decides." },
      { name: "AI disclosure", detail: "Accepted when subscribers join; digital replies are always labelled." },
      { name: "Workspace isolation", detail: "Every workspace is separated at the database layer." },
      { name: "Strong sign-in", detail: "Authenticator apps, passkeys and recovery codes." },
      { name: "Team roles", detail: "Staff coaches without finance access; finance without coaching data." },
      { name: "Consent choices", detail: "Separate choices for coaching data, marketing and analytics." },
      { name: "Export and deletion", detail: "Trainers and subscribers can download their data and request deletion." },
    ],
  },
];

/** Generic tool categories one workspace replaces. Never a competitor's name. */
export const REPLACES: Array<{ tool: string; instead: string }> = [
  { tool: "A website builder", instead: "Your coaching website, galleries, contact form and address, from the Design Studio." },
  { tool: "A booking tool", instead: "Session slots, paid bookings, cancellation rules and calendar export." },
  { tool: "A payment set-up and invoicing", instead: "Card checkout in AED, trials, promotions, refunds, statements and payouts." },
  { tool: "A client training app", instead: "A branded app with day-by-day plans, set logging, rest timers and offline mode." },
  { tool: "A meal-planning app", instead: "The optional nutrition tier: meal plans, recipes, grocery lists and a food diary." },
  { tool: "A client messaging app", instead: "Private chat, attachments, scheduled follow-ups and a labelled digital coach." },
  { tool: "Programme spreadsheets", instead: "Templates, an exercise library, automatic scheduling and progress tracking." },
];

export const CAPABILITY_COUNT = FEATURE_MATRIX.reduce(
  (sum, group) => sum + group.items.length,
  0,
);
