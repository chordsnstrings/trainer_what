// The home page as the owner designed it (25 October 2026: "exact copy of
// the HTML"). The markup, classes (with the tyh- prefix that keeps them
// apart from the app's own) and copy follow the supplied file; its styles
// are app/home-design.css and its script is home-design-runtime.tsx.
// Figures that the code already knows (capability count, commission bands,
// follower scenarios) are computed, so they match the calculators.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  BRAND_ASSETS,
  CAPABILITY_COUNT,
  brandText,
  jsonLdScript,
  usesBrandIdentity,
  type MarketingPage,
} from "@trainer/contracts";
import { BANDS } from "@trainer/domain";
import {
  DEFAULT_FOLLOWER_INPUTS,
  displayCount,
  estimateFollowerConversion,
} from "../../../../packages/domain/src/marketing-calculators";
import { claimCta } from "./frame";
import { HomeDesignRuntime } from "./home-design-runtime";
import { MARKETING_MOTION } from "./motion-mode";
import type { PublicPlatform } from "./platform";

/** The page's own icons, drawn as in the design. */
function Icon({ d, width = "1.8", children }: { d?: string; width?: string; children?: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}
const Arrow = () => <Icon d="M7 17L17 7M9 7h8v8" width="2" />;
const Tick = () => <Icon d="M5 12.5l4.2 4.2L19 7" width="2.4" />;

const NAV: Array<[string, string]> = [
  ["#how", "How it works"],
  ["#platform", "Platform"],
  ["#earnings", "Earnings"],
  ["#pricing", "Pricing"],
  ["#faq", "FAQ"],
];

type Decision = {
  kind: string;
  chip: "ok" | "err" | "warn";
  label: string;
  final: string;
  message: ReactNode;
  note: string;
  actions?: boolean;
};
const DECISIONS: Decision[] = [
  {
    kind: "Progression rule",
    chip: "ok",
    label: "Applied automatically",
    final: "",
    message: (
      <>
        Squat <s>60 kg</s> → <b>62.5 kg</b>
      </>
    ),
    note: "Rule: “Add 2.5 kg after two easy sessions.” · Confident: applies your rule",
  },
  {
    kind: "Missed session",
    chip: "ok",
    label: "Rescheduled",
    final: "",
    message: (
      <>
        Tuesday’s session moved to <b>Thursday</b>
      </>
    ),
    note: "Handled from your rules",
  },
  {
    kind: "Knee pain during squats",
    chip: "err",
    label: "Paused · sent to you",
    final: "",
    message: (
      <>
        Workout <b>paused</b> until you review it
      </>
    ),
    note: "Pain and red flags always go to you",
  },
  {
    kind: "Hotel gym for two weeks",
    chip: "warn",
    label: "Waiting for you",
    final: "Approved",
    message: (
      <>
        Dumbbell plan drafted, <b>up to 20 kg</b>
      </>
    ),
    note: "Below your trainer threshold, so it asks you",
    actions: true,
  },
];

const HOW = (name: string) => [
  {
    title: "You teach",
    body: "Add your methods, rules and programmes.",
    ui: <span className="tyh-ui-rule">Add 2.5 kg after two easy sessions.</span>,
  },
  {
    title: `${name} learns`,
    body: "Your coaching, applied to every day, with confidence checks. It asks you when it is unsure.",
    ui: <span className="tyh-chip tyh-ok">Confident: applies your rule</span>,
  },
  {
    title: "Subscribers train",
    body: "Daily sessions, next-week progressions and an optional voice-led add-on.",
    ui: (
      <span className="tyh-ui-ses">
        <b>Lower body</b>
        <small>Squat · 4 × 6 · 62.5 kg</small>
        <em>Voice-led session · add-on</em>
      </span>
    ),
  },
];

const PARTS = [
  {
    icon: (
      <Icon d="M9 4a3 3 0 00-3 3v1a3 3 0 00-2 5 3 3 0 002 4 3 3 0 006 1V4.5A2.5 2.5 0 009 4zM15 4a3 3 0 013 3v1a3 3 0 012 5 3 3 0 01-2 4 3 3 0 01-6 1" />
    ),
    title: "The Brain",
    body: "Learns your method, is tested before release, hands uncertain decisions to you and improves from your corrections.",
    items: ["Rules in plain language", "Coaching cases and examples", "Evaluation before release", "Your confidence threshold"],
    link: ["/trainer-brain", "Trainer Brain"],
  },
  {
    icon: (
      <Icon>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0113 0" />
        <path d="M16 4.5a3.5 3.5 0 010 7M21.5 20a6 6 0 00-4-5.6" />
      </Icon>
    ),
    title: "Subscriber experience",
    body: "What your clients use every day.",
    items: ["Dated, personalised plans", "Guided sessions and set logging", "Offline in the gym", "One-tap pain report"],
    link: ["/features/subscriber-app", "Subscriber app"],
  },
  {
    icon: (
      <Icon>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M3 10h18M16 15h2" />
      </Icon>
    ),
    title: "Your business",
    body: "Your brand, prices and payouts.",
    items: ["Website and your own domain", "Your price in AED, trials and codes", "Monthly statement", "Monthly UAE payouts"],
    link: ["/features/payments-and-payouts", "Payments and payouts"],
  },
  {
    icon: (
      <Icon>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 018 0v3" />
      </Icon>
    ),
    title: "Trust",
    body: "Safety and privacy by design.",
    items: ["Safety rules enforced in code", "Clear AI disclosure", "Workspace isolation", "Team roles"],
    link: ["/features/safety", "Safety"],
  },
] as const;

const ADDONS = [
  {
    href: "/features/nutrition",
    icon: <Icon d="M7 3v8a3 3 0 006 0V3M10 11v10M17 3c-2 2-2 6 0 8v10" />,
    title: "Nutrition",
    body: "Meal plans, recipes, grocery lists and a food diary, as an optional tier.",
  },
  {
    href: "/features/voice-coach",
    icon: (
      <Icon>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0014 0M12 18v3" />
      </Icon>
    ),
    title: "Voice coach",
    body: "Sessions narrated in your verified voice, with subscriber consent.",
  },
  {
    href: "/features/bookings",
    icon: (
      <Icon>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </Icon>
    ),
    title: "Bookings",
    body: "Paid one-to-one and group sessions in AED, with cancellation rules.",
  },
  {
    href: "/features/progress-and-client-twin",
    icon: <Icon d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    title: "Progress and Client Twin",
    body: "One view of each subscriber’s progress and coaching context.",
  },
];

const GUARDS = [
  {
    icon: (
      <Icon>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </Icon>
    ),
    title: "It asks you when unsure",
    body: "Uncertain cases come to you instead of being guessed.",
  },
  {
    icon: (
      <Icon>
        <path d="M12 3l10 18H2z" />
        <path d="M12 10v5M12 18h.01" />
      </Icon>
    ),
    title: "Pain pauses the workout",
    body: "The workout pauses and you are alerted until you review it.",
  },
  {
    icon: (
      <Icon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0116 0" />
      </Icon>
    ),
    title: "Take over any time",
    body: "Choose what runs on its own. Take over any subscriber, any time.",
  },
  {
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="12" r="2.5" />
        <path d="M14 10h4M14 14h3" />
      </Icon>
    ),
    title: "Clearly labelled as AI",
    body: "Subscribers see an AI coach trained by you. Human review is shown when it happens.",
  },
];

const SPECIALTIES: Array<[string, string]> = [
  ["/for-trainers/weight-loss", "Weight loss"],
  ["/for-trainers/strength", "Strength"],
  ["/for-trainers/muscle-gain", "Muscle gain"],
  ["/for-trainers/pre-postnatal", "Pre and postnatal"],
];
const GUIDES: Array<[string, string]> = [
  ["/guides/writing-coaching-rules", "Writing coaching rules"],
  ["/guides/instagram-followers-to-clients", "Turning Instagram followers into clients"],
  ["/guides/pricing-online-coaching-uae", "Pricing online coaching in the UAE"],
  ["/guides/uae-advertiser-permit", "The UAE advertiser permit"],
];

const FOOTER: Array<[string, Array<[string, string]>]> = [
  [
    "Product",
    [
      ["/how-it-works", "How it works"],
      ["/trainer-brain", "Trainer Brain"],
      ["/features", "Features"],
      ["/demo", "Demo"],
      ["/security-and-privacy", "Security and privacy"],
    ],
  ],
  [
    "Features",
    [
      ["/features/ai-training-plans", "AI training plans"],
      ["/features/subscriber-app", "Subscriber app"],
      ["/features/website-and-domain", "Website and domain"],
      ["/features/nutrition", "Nutrition"],
      ["/features/voice-coach", "Voice coach"],
      ["/features/bookings", "Bookings"],
      ["/features/chat-and-digital-coach", "Chat and digital coach"],
      ["/features/progress-and-client-twin", "Progress and Client Twin"],
      ["/features/payments-and-payouts", "Payments and payouts"],
      ["/features/safety", "Safety"],
      ["/features/team", "Team"],
    ],
  ],
  [
    "For trainers",
    [
      ["/for-trainers", "By specialty"],
      ["/uae", "In the UAE"],
      ["/get-started", "Get started"],
      ["/guides", "Guides"],
    ],
  ],
  [
    "Pricing and tools",
    [
      ["/pricing", "Pricing"],
      ["/earnings-calculator", "Earnings calculator"],
      ["/follower-calculator", "Follower calculator"],
    ],
  ],
  [
    "Company",
    [
      ["/faq", "FAQ"],
      ["/about", "About"],
      ["/methodology", "Methodology"],
      ["/coaches", "Find a coach"],
      ["/terms", "Terms"],
      ["/privacy", "Privacy"],
      ["/ai-disclosure", "Digital coaching disclosure"],
    ],
  ],
];

/** "First 100", "101 – 300", ... from the commission bands. */
function bandRanges() {
  let from = 1;
  return BANDS.map((band, i) => {
    const to = from + band.count - 1;
    const label =
      i === 0
        ? `First ${band.count.toLocaleString("en-US")}`
        : band.count === Infinity
          ? `${from.toLocaleString("en-US")} +`
          : `${from.toLocaleString("en-US")} – ${to.toLocaleString("en-US")}`;
    from = to + 1;
    return { rate: band.bps / 100, label };
  });
}
/** The calculator's band labels: "1–100", "101–300", "301–1,000", "1,001+". */
function bandShortRanges() {
  let from = 1;
  return BANDS.map((band) => {
    const to = from + band.count - 1;
    const label =
      band.count === Infinity
        ? `${from.toLocaleString("en-US")}+`
        : `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")}`;
    from = to + 1;
    return { rate: band.bps / 100, label };
  });
}

/** Lockup as in the design for the trainsyou brand; the name otherwise. */
function Lockup({ name }: { name: string }) {
  return usesBrandIdentity(name) ? (
    <img src={BRAND_ASSETS.lockupPace} alt={name} width={480} height={95} />
  ) : (
    <b>{name}</b>
  );
}

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

export function HomeDesign({
  page,
  platform,
  jsonLd,
}: {
  page: MarketingPage;
  platform: PublicPlatform;
  jsonLd: unknown;
}) {
  const name = platform.name;
  const t = (s: string) => brandText(s, name, platform.followerModel);
  // The design's sign-up buttons; while registration is closed they offer
  // early access instead (frame.tsx claimCta).
  const claim = claimCta(platform.registrationOpen);
  const signup = claim.href;
  const open = platform.registrationOpen;
  const teach = open ? "Teach your AI — free" : claim.label;
  const h1 = t(page.h1);
  const mark = page.h1Highlight ? t(page.h1Highlight) : "";
  const lead = h1.slice(0, h1.length - mark.length).trimEnd();
  const facts = page.sections.find((s) => s.id === "facts")?.table?.rows ?? [];
  // Instead of each tool: what the workspace gives.
  const tools = page.sections.find((s) => s.id === "tools")?.table?.rows ?? [];
  const bands = bandRanges();
  const shortBands = bandShortRanges();
  const first = bands[0].rate,
    last = bands[bands.length - 1].rate;
  const followers = estimateFollowerConversion(DEFAULT_FOLLOWER_INPUTS, platform.followerModel).scenarios;
  const count = (n: number) => {
    const c = displayCount(n);
    return c === null ? "< 1" : whole(c);
  };
  const scenarios: Array<[string, keyof typeof followers]> = [
    ["Cautious", "cautious"],
    ["Typical", "typical"],
    ["Strong case", "strong"],
  ];
  // The calculator's starting example (the design's 250 AED and 40).
  const price = 250,
    subscribers = 40;
  const fee = (subscribers * price * BANDS[0].bps) / 10000;
  return (
    <div className="tyh" id="tyh" data-mk-motion={MARKETING_MOTION} suppressHydrationWarning>
      {/* Before the first paint, as the design's <html class="js">. */}
      <script dangerouslySetInnerHTML={{ __html: 'document.getElementById("tyh").classList.add("tyh-js")' }} />
      <a className="tyh-skip" href="#main">
        Skip to content
      </a>
      <header className="tyh-nav" id="nav">
        <div className="tyh-nav-in">
          <a href="#top" className="tyh-lockup" aria-label={`${name} home`}>
            <Lockup name={name} />
          </a>
          <nav className="tyh-nl" aria-label="Main">
            {NAV.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="tyh-nr">
            <Link className="tyh-hm tyh-nlog" data-login="" href="/login">
              Sign in
            </Link>
            <Link className="tyh-btn tyh-b-pace tyh-sm" data-signup="" data-cta="nav" href={signup}>
              {open ? (
                <>
                  Teach your AI<span className="tyh-nfree"> — free</span>
                </>
              ) : (
                claim.label
              )}
            </Link>
            <button
              className="tyh-ib tyh-burger"
              id="burger"
              type="button"
              aria-label="Menu"
              aria-expanded="false"
              aria-controls="mm"
            >
              <Icon d="M4 7h16M4 12h16M4 17h16" />
            </button>
          </div>
        </div>
      </header>
      <div className="tyh-mm" id="mm">
        {NAV.map(([href, label]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
        <Link data-login="" href="/login">
          Sign in
        </Link>
        <Link className="tyh-btn tyh-b-pace" data-signup="" data-cta="menu" href={signup}>
          {teach}
        </Link>
      </div>
      <main id="main">
        <section className="tyh-hero" id="top" aria-labelledby="h1">
          <div className="tyh-wrap tyh-hero-in">
            <div className="tyh-hero-t">
              <p className="tyh-kick">
                <i className="tyh-pdot"></i>
                {t(page.eyebrow)}
              </p>
              <h1 id="h1" className="tyh-h1">
                {lead}
                <br />
                <span className="tyh-mark">{mark}</span>
              </h1>
              <p className="tyh-lead">{t(page.lede ?? "")}</p>
              <div className="tyh-ctas">
                <Link className="tyh-btn tyh-b-pace" data-signup="" data-cta="hero" href={signup}>
                  {teach}
                </Link>
                <Link className="tyh-lnk" data-cta="sec-hero" href="/how-it-works" target="_blank" rel="noopener">
                  See how it works <Arrow />
                </Link>
              </div>
              <p className="tyh-micro">
                <Icon d="M5 12.5l4.5 4.5L19 7.5" width="2.4" />
                Guided setup · Nothing goes live until you publish · No subscription fee
              </p>
              <ul className="tyh-tags">
                {["Free to join", "No upfront cost", "Built for UAE trainers"].map((tag) => (
                  <li key={tag}>
                    <Tick />
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
            <div className="tyh-feed-wrap">
              <div className="tyh-feed" aria-label="Sample: decisions your AI makes from your rules">
                <div className="tyh-feed-h">
                  <div>
                    <span className="tyh-lab">Your AI today</span>
                    <b>4 decisions from your rules</b>
                  </div>
                  <span className="tyh-hp-s">Sample interface</span>
                </div>
                <ol className="tyh-fds" id="fds">
                  {DECISIONS.map((d, i) => (
                    <li className="tyh-fd" data-i={i} key={d.kind}>
                      <div className="tyh-fd-top">
                        <span className="tyh-fd-k">{d.kind}</span>
                        <span className={`tyh-chip tyh-${d.chip}`} data-final={d.final}>
                          {d.label}
                        </span>
                      </div>
                      <p className="tyh-fd-m">{d.message}</p>
                      <p className="tyh-fd-n">{d.note}</p>
                      {d.actions && (
                        <div className="tyh-fd-act">
                          <span className="tyh-mini tyh-on" id="apprBtn">
                            Approve
                          </span>
                          <span className="tyh-mini">Correct</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <button className="tyh-replay" id="replay" type="button">
                  <Arrow />
                  Replay
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="tyh-stats" aria-label={`${name} in numbers`}>
          <div className="tyh-wrap">
            <ul className="tyh-sxs">
              <li className="tyh-sx tyh-rv">
                <b className="tyh-num" data-count="0">
                  0
                </b>
                <span className="tyh-sx-u">AED to join</span>
                <p>Joining, your site and app, and teaching your AI are free.</p>
              </li>
              <li className="tyh-sx tyh-rv">
                <b className="tyh-num" data-count={CAPABILITY_COUNT}>
                  {CAPABILITY_COUNT}
                </b>
                <span className="tyh-sx-u">capabilities</span>
                <p>In one workspace, under your own name.</p>
              </li>
              <li className="tyh-sx tyh-rv">
                <b className="tyh-num" data-count={tools.length}>
                  {tools.length}
                </b>
                <span className="tyh-sx-u">tools replaced</span>
                <p>Website, bookings, payments, app, meals, chat, spreadsheets.</p>
              </li>
              <li className="tyh-sx tyh-rv">
                <b className="tyh-num" data-count={`${first}→${last}`}>
                  {`${first}→${last}`}
                </b>
                <span className="tyh-sx-u">% commission</span>
                <p>Only when subscribers pay. It drops as you grow.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="tyh-what" id="what" aria-labelledby="what-h">
          <div className="tyh-wrap tyh-what-in tyh-rv">
            <h2 id="what-h" className="tyh-lab-h">
              {`What is ${name}?`}
            </h2>
            <p>{t(page.intro)}</p>
          </div>
        </section>

        <section className="tyh-glance" id="facts" aria-labelledby="gl-h">
          <div className="tyh-wrap">
            <h2 id="gl-h" className="tyh-lab-h">
              {`${name} at a glance`}
            </h2>
            <dl className="tyh-gl">
              {facts.map(([term, detail]) => (
                <div className="tyh-gl-i tyh-rv" key={term}>
                  <dt>{t(term)}</dt>
                  <dd>{t(detail)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <section className="tyh-how" id="how" aria-labelledby="how-h">
          <div className="tyh-wrap">
            <div className="tyh-sec-row">
              <div>
                <p className="tyh-kick">How it works</p>
                <h2 id="how-h" className="tyh-h2">
                  You teach. It learns.
                  <br />
                  They train.
                </h2>
              </div>
              <p className="tyh-sub">Your AI asks you when it is unsure, and pain or red flags always go to you.</p>
            </div>
            <ol className="tyh-hws">
              {HOW(name).map((step, i) => (
                <li className="tyh-hw tyh-rv" key={step.title}>
                  <span className="tyh-hw-n tyh-num">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div className="tyh-hw-ui">{step.ui}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="tyh-tools" id="tools" aria-labelledby="tools-h">
          <div className="tyh-wrap tyh-tools-in">
            <div className="tyh-tools-t">
              <p className="tyh-kick">One workspace</p>
              <h2 id="tools-h" className="tyh-h2">
                Stop paying for
                <br />
                <span className="tyh-mark">{`${tools.length} separate tools.`}</span>
              </h2>
              <p className="tyh-sub">Everything you need to run online coaching, under your own name.</p>
              <div className="tyh-ctas">
                <Link className="tyh-btn tyh-b-pace" data-signup="" data-cta="tools" href={signup}>
                  {teach}
                </Link>
                <Link className="tyh-lnk" data-cta="sec-tools" href="/features" target="_blank" rel="noopener">
                  All features <Arrow />
                </Link>
              </div>
            </div>
            <ul className="tyh-tls" id="tls">
              {tools.map(([tool, instead]) => (
                <li className="tyh-tl" key={tool}>
                  <span className="tyh-tl-old">
                    <s>{tool}</s>
                  </span>
                  <span className="tyh-tl-ar">
                    <Arrow />
                  </span>
                  <span className="tyh-tl-new">{instead}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="tyh-platform" id="platform" aria-labelledby="pf-h">
          <div className="tyh-wrap">
            <div className="tyh-sec-row">
              <div>
                <p className="tyh-kick">The platform</p>
                <h2 id="pf-h" className="tyh-h2">
                  Four parts. One platform.
                </h2>
              </div>
              <p className="tyh-sub">
                {`${CAPABILITY_COUNT} capabilities across your AI, your subscribers’ app, your business and trust.`}
              </p>
            </div>
            <ul className="tyh-pts">
              {PARTS.map((part) => (
                <li className="tyh-pt tyh-rv" key={part.title}>
                  <span className="tyh-pt-i">{part.icon}</span>
                  <h3>{part.title}</h3>
                  <p>{part.body}</p>
                  <ul>
                    {part.items.map((item) => (
                      <li key={item}>
                        <Tick />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Link className="tyh-pt-l" href={part.link[0]} target="_blank" rel="noopener">
                    {`${part.link[1]} `}
                    <Arrow />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="tyh-ads">
              {ADDONS.map((addon) => (
                <Link className="tyh-ad tyh-rv" href={addon.href} target="_blank" rel="noopener" key={addon.href}>
                  <span className="tyh-ad-i">{addon.icon}</span>
                  <b>{addon.title}</b>
                  <span>{addon.body}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="tyh-earn" id="earnings" aria-labelledby="earn-h">
          <div className="tyh-wrap">
            <div className="tyh-sec-row">
              <div>
                <p className="tyh-kick">Earnings</p>
                <h2 id="earn-h" className="tyh-h2">
                  See what you could keep.
                </h2>
              </div>
              <p className="tyh-sub">
                {`Set your price and subscriber count, or see what ${name}’s follower calculator estimates from an Instagram audience.`}
              </p>
            </div>
            <div className="tyh-earn-g">
              <div className="tyh-calc" id="calc" role="group" aria-labelledby="calc-h">
                <div className="tyh-calc-head">
                  <h3 id="calc-h">Estimate your monthly take-home</h3>
                  <span className="tyh-tag">Example values · change them</span>
                </div>
                <div className="tyh-fld">
                  <div className="tyh-fld-top">
                    <label htmlFor="priceR">Your monthly price per subscriber</label>
                    <span className="tyh-fld-in">
                      <input
                        id="priceN"
                        type="number"
                        inputMode="numeric"
                        min="50"
                        max="2000"
                        step="10"
                        defaultValue={price}
                        aria-label="Monthly price in AED"
                      />
                      <em>AED</em>
                    </span>
                  </div>
                  <input
                    id="priceR"
                    type="range"
                    min="50"
                    max="2000"
                    step="10"
                    defaultValue={price}
                    aria-describedby="priceHint"
                  />
                  <small id="priceHint">You set this yourself.</small>
                </div>
                <div className="tyh-fld">
                  <div className="tyh-fld-top">
                    <label htmlFor="subsR">Paying subscribers</label>
                    <span className="tyh-fld-in">
                      <input
                        id="subsN"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="2000"
                        step="1"
                        defaultValue={subscribers}
                        aria-label="Number of paying subscribers"
                      />
                    </span>
                  </div>
                  <input id="subsR" type="range" min="1" max="2000" step="1" defaultValue={subscribers} />
                </div>
                <div className="tyh-res" aria-live="polite">
                  <div className="tyh-res-main">
                    <small>You keep, per month</small>
                    <b>
                      <span id="keep" className="tyh-num">
                        {whole(price * subscribers - fee)}
                      </span>{" "}
                      <em>AED</em>
                    </b>
                  </div>
                  <dl className="tyh-res-rows">
                    <div>
                      <dt>Subscribers pay</dt>
                      <dd>
                        <span id="gross" className="tyh-num">
                          {whole(price * subscribers)}
                        </span>
                        {" AED"}
                      </dd>
                    </div>
                    <div>
                      <dt>{`${name} commission`}</dt>
                      <dd>
                        <span id="fee" className="tyh-num">
                          {whole(fee)}
                        </span>
                        {" AED "}
                        <span className="tyh-muted">
                          (
                          <span id="rate" className="tyh-num">
                            {first.toFixed(1)}
                          </span>
                          % overall)
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <div className="tyh-bands" id="bands" aria-label="Commission by subscriber band">
                    {shortBands.map((band, i) => (
                      <div className="tyh-band" data-b={i} key={band.label}>
                        <span className="tyh-bl">{band.label}</span>
                        <span className="tyh-bt">
                          <i></i>
                        </span>
                        <span className="tyh-bp tyh-num">{band.rate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="tyh-calc-note">
                  Estimate from the commission bands only. Each rate applies only to subscribers in its band. Not a
                  promise of earnings.
                </p>
                <Link className="tyh-btn tyh-b-pace tyh-wide" data-signup="" data-cta="calculator" href={signup}>
                  {open ? "Start free at this price" : claim.label}
                </Link>
              </div>
              <div className="tyh-fol tyh-rv">
                <div className="tyh-calc-head">
                  <h3>From followers to subscribers</h3>
                  <span className="tyh-tag">Estimates, not promises</span>
                </div>
                <p className="tyh-fol-p">{`Three scenarios from ${name}’s follower calculator methodology.`}</p>
                <div className="tyh-tbl-s">
                  <table className="tyh-ft-t">
                    <caption className="tyh-sr">Follower calculator scenarios</caption>
                    <thead>
                      <tr>
                        <th scope="col">Scenario</th>
                        <th scope="col">First-month subscribers</th>
                        <th scope="col">Active after 12 months</th>
                        <th scope="col">Sign-ups over 12 months</th>
                        <th scope="col">AED / month at month 12</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map(([label, key]) => {
                        const s = followers[key];
                        return (
                          <tr key={key}>
                            <th scope="row">{label}</th>
                            <td className="tyh-num">{count(s.month1New)}</td>
                            <td className="tyh-num">{count(s.activeMonth12)}</td>
                            <td className="tyh-num">{count(s.signups12)}</td>
                            <td className="tyh-num">{whole(s.revenueMonth12Minor / 100)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="tyh-fol-n">
                  {`Assumes ${DEFAULT_FOLLOWER_INPUTS.yearlyCancelPct}% yearly cancellations. Trials, discounts, refunds, failed payments and platform commission are excluded. The strong case is a best case, not a typical result.`}
                </p>
                <Link
                  className="tyh-btn tyh-b-out"
                  href="/follower-calculator"
                  target="_blank"
                  rel="noopener"
                  data-cta="follower-calc"
                >
                  Try it with your followers
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="tyh-control" id="control" aria-labelledby="ctl-h">
          <div className="tyh-wrap tyh-ctl-in">
            <div>
              <p className="tyh-kick">You stay in charge</p>
              <h2 id="ctl-h" className="tyh-h2">
                It coaches.
                <br />
                You decide.
              </h2>
              <p className="tyh-sub">Choose what runs on its own. Take over any subscriber at any time.</p>
              <div className="tyh-ctas">
                <Link className="tyh-btn tyh-b-pace" data-signup="" data-cta="control" href={signup}>
                  {teach}
                </Link>
                <Link className="tyh-lnk" data-cta="sec-control" href="/trainer-brain" target="_blank" rel="noopener">
                  How your AI decides <Arrow />
                </Link>
              </div>
            </div>
            <ul className="tyh-gds">
              {GUARDS.map((guard) => (
                <li className="tyh-gd tyh-rv" key={guard.title}>
                  <span className="tyh-gd-i">{guard.icon}</span>
                  <div>
                    <h3>{guard.title}</h3>
                    <p>{guard.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="tyh-pricing" id="pricing" aria-labelledby="pr-h">
          <div className="tyh-wrap tyh-pr-in">
            <div>
              <p className="tyh-kick">Pricing</p>
              <h2 id="pr-h" className="tyh-h2">
                Free to start.
                <br />
                <span className="tyh-mark">Our share falls as you grow.</span>
              </h2>
              <ul className="tyh-pr-free">
                {["Joining", "Your coaching site and app", "Teaching your AI"].map((item) => (
                  <li key={item}>
                    <Tick />
                    {item}
                  </li>
                ))}
                <li className="tyh-m">Custom domain · optional</li>
              </ul>
            </div>
            <div className="tyh-bands-v tyh-rv">
              {bands.map((band) => (
                <div className="tyh-bv" style={{ "--h": `${(band.rate / first) * 100}%` } as CSSProperties} key={band.label}>
                  <b className="tyh-num">{band.rate}%</b>
                  <i></i>
                  <span>{band.label}</span>
                </div>
              ))}
              <p className="tyh-bv-n">
                Commission per paying subscriber. Each rate applies only to subscribers in its band. Priced in AED.
                You set your own price.
              </p>
            </div>
          </div>
        </section>

        <section className="tyh-spec" aria-labelledby="sp-h">
          <div className="tyh-wrap tyh-spec-in">
            <div>
              <p className="tyh-kick">Built for your specialty</p>
              <h2 id="sp-h" className="tyh-h2">
                Whatever you coach.
              </h2>
              <div className="tyh-sps">
                {SPECIALTIES.map(([href, label]) => (
                  <Link className="tyh-sp" href={href} target="_blank" rel="noopener" key={href}>
                    {label}
                    <Arrow />
                  </Link>
                ))}
              </div>
            </div>
            <ul className="tyh-gus">
              {GUIDES.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} target="_blank" rel="noopener">
                    <span>Guide</span>
                    <b>{label}</b>
                    <Arrow />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="tyh-faq" id="faq" aria-labelledby="faq-h">
          <div className="tyh-wrap tyh-faq-in">
            <div>
              <p className="tyh-kick">FAQ</p>
              <h2 id="faq-h" className="tyh-h2">
                Questions.
              </h2>
              <p className="tyh-sub">
                {"More in the "}
                <Link className="tyh-ul" href="/faq" target="_blank" rel="noopener">
                  full FAQ
                </Link>
                .
              </p>
            </div>
            <div className="tyh-qas">
              {page.faqs.map((faq) => (
                <details className="tyh-qa" key={faq.q}>
                  <summary>
                    <span>{t(faq.q)}</span>
                    <i></i>
                  </summary>
                  <p>{t(faq.a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="tyh-end" aria-labelledby="end-h">
          <div className="tyh-wrap">
            <div className="tyh-end-box">
              <div>
                <h2 id="end-h" className="tyh-h2">
                  {/* The brand line, for the trainsyou brand (as on every page's closing panel). */}
                  {usesBrandIdentity(name) ? (
                    <>
                      Your coaching.
                      <br />
                      Beyond your hours.
                    </>
                  ) : (
                    "Ready to teach your AI?"
                  )}
                </h2>
                <p className="tyh-sub">Free to set up. No subscription fee. Nothing goes live until you publish.</p>
              </div>
              <div className="tyh-ctas">
                <Link className="tyh-btn tyh-b-pace" data-signup="" data-cta="end" href={signup}>
                  {teach}
                </Link>
                <Link className="tyh-lnk" data-cta="sec-end" href="/how-it-works" target="_blank" rel="noopener">
                  See how it works <Arrow />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <div className="tyh-mbar" id="mbar">
        <span>Free to set up</span>
        <Link className="tyh-btn tyh-b-pace tyh-sm" data-signup="" data-cta="sticky-mobile" href={signup}>
          {open ? "Teach your AI" : claim.label}
        </Link>
      </div>
      <footer>
        <div className="tyh-wrap">
          <div className="tyh-ft-top">
            <div className="tyh-ft-b">
              <a href="#top" className="tyh-lockup tyh-ft-lk" aria-label={`${name} home`}>
                <Lockup name={name} />
              </a>
              <p>Trainer-led AI coaching platform for personal trainers. Built for the UAE, priced in AED.</p>
            </div>
            <div className="tyh-fcs">
              {FOOTER.map(([heading, links]) => (
                <div className="tyh-fc" key={heading}>
                  <h3>{heading}</h3>
                  <ul>
                    {links.map(([href, label]) => (
                      <li key={href}>
                        <Link href={href}>{label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <p className="tyh-cr">
            {"© "}
            <span id="yr" className="tyh-num">
              {new Date().getFullYear()}
            </span>
            {` ${name}. Earnings and follower figures are estimates, not promises. Coaching is not medical advice. `}
            {/* Not in the design: the analytics consent's preferences open
                only from a footer control (components/acquisition.tsx), so a
                visitor can change or withdraw their answer here too. */}
            <button type="button" className="tyh-prefs" data-analytics-preferences="">
              Analytics preferences
            </button>
          </p>
        </div>
      </footer>
      <HomeDesignRuntime bands={BANDS.map((band) => [band.count, band.bps / 10000])} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
    </div>
  );
}
