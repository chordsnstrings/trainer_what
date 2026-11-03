// Followers and growth (/trainer/growth): Instagram's card keeps its
// behaviour, each Meta card says so while its connection is in pre-review test
// mode, and the Facebook Page card (next to Instagram's) and estimate appear
// only once GET /api/v1/trainer/facebook says the workspace may connect; Page
// numbers saved earlier stay removable after that. The Facebook arithmetic is
// tested in tests/marketing-facebook-calculator.test.ts; this file checks what
// the trainer reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_FOLLOWER_MODEL,
  aedWhole,
  displayCount,
  type FollowerModelAssumptions,
} from "../packages/domain/src/marketing-calculators.ts";
import {
  DEFAULT_FACEBOOK_INPUTS,
  estimateFacebookConversion,
  type FacebookScenarioEstimate,
} from "../packages/domain/src/facebook-calculator.ts";
import { FacebookCalculator } from "../apps/web/components/marketing/facebook-calculator.tsx";
import {
  FACEBOOK_OUTCOMES,
  FacebookPageCard,
  GrowthEstimatesView,
  INSTAGRAM_OUTCOMES,
  InstagramCard,
  TESTING_NOTE,
  TrainerGrowth,
  facebookSection,
  withoutFacebookFragment,
} from "../apps/web/components/trainer-growth.tsx";

const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
const aedText = (minor: number) => aedWhole(minor).replace(/\s/g, " ");
type CalculatorProps = Parameters<typeof FacebookCalculator>[0];
const calculator = (props: Partial<CalculatorProps> = {}) => {
  const html = renderToStaticMarkup(
    createElement(FacebookCalculator, { followerModel: DEFAULT_FOLLOWER_MODEL, ...props }),
  );
  return { html, text: decode(html) };
};
const noop = () => {};
const card = { notice: "", error: "", busy: false, connect: noop, remove: noop };
type Page = NonNullable<Parameters<typeof FacebookPageCard>[0]["state"]["snapshot"]>;
const PAGE: Page = {
  pageName: "Sara Fit",
  followers: 7000,
  pageLikes: 6900,
  engagementRatePct: 0.21,
  postsSampled: 12,
  pagesShared: 3,
  fetchedAt: "2026-11-03T08:00:00.000Z",
};
const facebook = (snapshot: Page | null, testing = false) => ({
  available: true,
  testing,
  snapshot,
  followerModel: DEFAULT_FOLLOWER_MODEL,
});
const FINE_PRINT =
  "We read your Page’s follower count and the reactions, comments and shares on up to 12 recent posts once, then discard the access. Only the numbers are saved, and you can remove them.";

test("Facebook estimate: the headline is active subscribers after 12 months in the strong case, with the honesty text", () => {
  const { html, text } = calculator();
  const e = estimateFacebookConversion(DEFAULT_FACEBOOK_INPUTS);
  const { cautious, typical, strong } = e.scenarios;
  // Defaults: 7,000 followers, AED 199, 4 link posts, 4 keyword Reels, 30% a year.
  for (const value of ["7000", "199", "4", "30"]) assert.match(html, new RegExp(`value="${value}"`));
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(text, /ESTIMATE, NOT A PROMISE/);
  assert.match(text, /Strong case an engaged, growing Page and weekly sharing/);
  // The domain's worked example: about 5 active after 12 months, AED 995.
  assert.equal(displayCount(strong.activeMonth12), 5);
  assert.equal(strong.revenueMonth12Minor, 99_500);
  assert.ok(text.includes("Up to 5 active subscribers after 12 months, after 30% yearly cancellations, and still growing"), text);
  const figure = html.match(/class="mk-result-figure">([^<]*(?:<!-- -->)?[^<]*)</)![1].replace(/<!-- -->/g, "");
  assert.equal(figure, "Up to 5");
  // The first month is below one person below about 15,000 followers.
  assert.ok(strong.month1New < 1);
  assert.ok(text.includes("Fewer than 1 new paying subscriber in your first month"), text);
  assert.ok(text.includes(`Up to ${aedText(99_500)} a month at your price, before platform commission`), text);
  assert.ok(text.includes(`Up to ${displayCount(strong.signups12)} sign-ups over 12 months, before cancellations`), text);
  assert.match(text, /A best case for an engaged, growing Page, not a typical result and not a promise/);
  // Facebook's honesty notes beside the figure.
  assert.ok(text.includes("Facebook shows a Page’s posts to few of its followers, so this is far lower than an Instagram estimate at the same follower count."), text);
  assert.ok(text.includes("The figures are averages for brand Pages, not fitness trainers."), text);
  assert.ok(text.includes("Don’t add the two estimates together: many people follow you on both."), text);
  // Cautious and typical appear only under How we estimate, with the version.
  const details = text.slice(text.indexOf("How we estimate ("));
  assert.match(details, /^How we estimate \(assumptions version 2026-11-03\)/);
  const count = (n: number) => displayCount(n) ?? "fewer than 1";
  const row = (name: string, r: FacebookScenarioEstimate) =>
    `${name} ${count(r.month1New)} ${count(r.activeMonth12)} ${count(r.signups12)} ${aedText(r.revenueMonth12Minor)}`;
  assert.ok(details.includes(row("Cautious", cautious)), details);
  assert.ok(details.includes(row("Typical", typical)), details);
  assert.ok(details.includes(row("Strong case", strong)), details);
  assert.ok(details.includes("Typical fewer than 1 2 2 " + aedText(39_800)), details);
  assert.ok(!text.slice(0, text.indexOf("How we estimate (")).includes("Typical"));
  // Levers (the domain's worked example), strong case, active after 12 months.
  assert.match(text, /What raises your Facebook number/);
  for (const line of [
    `Your Page link (action button or website), per 1,000 Page visits a month +1.9 in your first month, +17 active after 12 months (+${aedText(318_400)} a month). Your Page’s link reaches people your posts miss.`,
    `4 more keyword Reels a month +0.2 in your first month, +1.8 active after 12 months (+${aedText(19_900)} a month). Reels reach people who don’t follow your Page.`,
    `4 more posts with your link a month +0.4 in your first month, +1.1 active after 12 months (+${aedText(19_900)} a month). More chances for the same followers to tap. If Meta limits your Page to 2 link posts a month, use keyword Reels instead.`,
    "Enter your link posts’ average viewers The strong case assumes about 61 people see each link post. Your own number replaces our biggest guess.",
  ])
    assert.ok(text.includes(line), line);
  // How we estimate: reach for your tier, the shared paid rates and what is left out.
  for (const part of [
    "People who see your link posts: about 40, 61 and 61 (cautious, typical, strong), the same people each post. An average post reaches 3.4% of followers on Pages your size, and a post with a link 16.67%, 25.64% and 25.64% of that",
    "not entered, so your Page counts as average for its size (0.21% reactions, comments and shares per post, divided by followers)",
    "Link click: 1%, 2.5% and 2.8% of the people who see a link post tap it, each post.",
    "Keyword Reels: one Reel reaches about 109, 168 and 168 people (45.83%, 70.51% and 70.51% of an average post",
    "18%, 30% and 45% of commenters open the link your Page sends by Messenger",
    "New people each month: 0%, 1.5% and 8% of each audience is new to your link every month",
    "Visit to paid subscriber: 0.72%, 2.9% and 6.2% of the people who visit, the same rates as your Instagram estimate",
    "Cancellations: 30% a year, about 2.93% a month, in every scenario, as in your Instagram estimate.",
    "Not counted: Stories, Groups, links in comments, posts without your link, and ads or boosted posts.",
    "Since December 2025 Meta has been testing a limit of 2 link posts a month for some Pages without Meta Verified.",
    "These are averages for brand Pages with 1,000 to 1 million followers, not fitness trainers.",
  ])
    assert.ok(details.includes(part), part);
  // Every assumption carries its evidence label, as on Instagram.
  for (const label of [
    "[Measured; our assumption]",
    "[Measured on brand Pages; proxy; our assumption]",
    "[Proxy; our assumption]",
    "[Measured on brand Pages; proxy; vendor claims; our assumption]",
    "[Measured growth; our assumption]",
    "[Measured; used as a proxy]",
    "[Your input; default is an owner assumption]",
  ])
    assert.ok(details.includes(label), label);
  assert.doesNotMatch(text, /Page link: |adjusted by the platform operator/);
  // Labelled inputs with units, the optional group, live results.
  for (const label of [
    "Facebook Page followers",
    "Your monthly price (AED)",
    "Posts with your link each month",
    "Reels with a call to action each month",
    "A comment keyword sends your link by Messenger",
    "Members who cancel per year (%)",
    "Your own numbers (optional)",
    "Facebook Page visits each month",
    "Average viewers of your link posts",
    "Engagement rate (%)",
  ])
    assert.ok(text.includes(label), label);
  assert.ok(text.includes("One a week is 4. Meta is testing a limit of 2 link posts a month for some Pages without Meta Verified. Links in comments don’t count."));
  assert.ok(text.includes("Without it, those Reels count only through the Page visits you enter."));
  const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 9);
  for (const id of labels) assert.ok(html.includes(`id="${id}"`), id);
  for (const [, id] of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<div class="mk-result" aria-live="polite">/);
  assert.match(html, /<section class="mk-calculator card" aria-label="Facebook Page calculator">/);
  // Sources: /methodology's Facebook section once live. While testing before
  // Meta's review that section is not published, so there is no link.
  assert.match(html, /<a href="\/methodology#facebook-assumptions">Sources and methodology<\/a>/);
  assert.doesNotMatch(text, /sources and methodology are published when/);
  const testing = calculator({ methodology: false });
  assert.ok(testing.text.includes("your content, audience, offer and price change the real number. Its sources and methodology are published when this estimate goes live."), testing.text);
  assert.doesNotMatch(testing.html, /href="\/methodology/);
});

test("Facebook estimate: your Page's numbers, your own figures and the platform's visit-to-paid rates", () => {
  // Prefilled from a connected Page, with the engagement scaling explained.
  const page = calculator({
    initial: { followers: 20_000, engagementRatePct: 0.34 },
    measured: "From your Page Sara Fit",
  });
  assert.match(page.html, /<p class="badge green">From your Page Sara Fit<\/p>/);
  assert.match(page.html, /value="20000"/);
  assert.match(page.html, /value="0.34"/);
  assert.ok(page.text.includes("Engagement: your 0.34% against the 0.17% average for Pages your size, so the link-post audience and Reel comments are scaled ×2.00. Scaling is at most ×2 either way."), page.text);
  const strong = estimateFacebookConversion({ ...DEFAULT_FACEBOOK_INPUTS, followers: 20_000, engagementRatePct: 0.34 }).scenarios.strong;
  assert.ok(page.text.includes(`Up to ${displayCount(strong.activeMonth12)} active subscribers after 12 months`), page.text);
  assert.ok(page.text.includes(`Up to ${displayCount(strong.month1New)} new paying subscribers in your first month`), page.text);
  // Your own link-post viewers replace our guess in every scenario, at most your followers.
  const viewers = calculator({ initial: { linkPostViewers: 500, engagementRatePct: 0.42 } });
  assert.ok(viewers.text.includes("Using your 500 viewers in every scenario."));
  assert.ok(viewers.text.includes("People who see your link posts: your 500 average viewers, the same people each post, in every scenario."));
  assert.ok(viewers.text.includes("so Reel comments are scaled ×2.00"), viewers.text);
  assert.ok(calculator({ initial: { followers: 300, linkPostViewers: 5000 } }).text.includes("Using your 300 viewers in every scenario."));
  // Without the comment keyword: unticked, the keyword lever offered, no Reel item.
  const plain = calculator({ initial: { keywordDms: false, linkPostViewers: 500, engagementRatePct: 0.42 } });
  assert.doesNotMatch(plain.html, /type="checkbox"[^>]*checked=""/);
  assert.ok(plain.text.includes("A comment keyword that sends your link by Messenger, on 4 Reels a month"));
  assert.doesNotMatch(plain.text, /Keyword Reels: |scaled ×/);
  // Page visits turn on the Page-link channel.
  assert.ok(calculator({ initial: { pageVisitsPerMonth: 800 } }).text.includes("Page link: 1%, 2% and 3% of monthly Page visitors tap your action button or website: the link-in-bio rule of thumb, used as a proxy. [Rule of thumb; proxy]"));
  // A tiny Page never shows "Up to 0", and "fewer than 1" is valued at nothing.
  const tiny = calculator({ initial: { followers: 20 } }).text;
  assert.ok(tiny.includes("Fewer than 1 active subscriber after 12 months, after 30% yearly cancellations"), tiny);
  assert.match(tiny, /AED 0 a month at your price/);
  assert.doesNotMatch(tiny, /Up to AED 0|Up to 0|still growing/);
  // "Weekly sharing" only when the inputs share weekly.
  const quiet = calculator({ initial: { linkPostsPerMonth: 2, ctaReelsPerMonth: 0 } }).text;
  assert.match(quiet, /Strong case an engaged, growing Page Up to/);
  assert.doesNotMatch(quiet, /weekly sharing/);
  // Visit to paid is the platform's follower model: an operator change moves
  // the Facebook estimate too, and says so.
  const model: FollowerModelAssumptions = {
    ...DEFAULT_FOLLOWER_MODEL,
    version: "2026-11-03.1",
    scenarios: {
      ...DEFAULT_FOLLOWER_MODEL.scenarios,
      strong: { ...DEFAULT_FOLLOWER_MODEL.scenarios.strong, paidPct: 9 },
    },
    changeNote: "Operator trial data, October 2026",
  };
  const edited = calculator({ followerModel: model }).text;
  const active = displayCount(estimateFacebookConversion(DEFAULT_FACEBOOK_INPUTS, undefined, model).scenarios.strong.activeMonth12);
  assert.ok(active !== null && active > 5);
  assert.ok(edited.includes(`Up to ${active} active subscribers after 12 months`), edited);
  assert.ok(edited.includes("Visit to paid subscriber: 0.72%, 2.9% and 9% of the people who visit"));
  assert.ok(edited.includes("The visit-to-paid rates were adjusted by the platform operator and differ from the cited sources: Operator trial data, October 2026"));
});

test("connection cards: the testing note on each card while testing; Instagram's card is otherwise unchanged", () => {
  assert.equal(TESTING_NOTE, "Testing before Meta review: only people with a role on the Meta app can finish connecting.");
  const instagram = (state: Parameters<typeof InstagramCard>[0]["state"], extra = {}) =>
    renderToStaticMarkup(createElement(InstagramCard, { ...card, state, ...extra }));
  const testing = decode(instagram({ available: true, testing: true, snapshot: null, followerModel: DEFAULT_FOLLOWER_MODEL }));
  assert.ok(testing.includes(TESTING_NOTE));
  assert.ok(testing.includes("Connect an Instagram professional account to fill in your follower count and recent engagement, or type your numbers below. Testing before Meta review"), testing);
  assert.match(testing, /Connect Instagram/);
  // Approved, or not available: no testing note.
  const approved = decode(instagram({ available: true, testing: false, snapshot: null, followerModel: DEFAULT_FOLLOWER_MODEL }));
  assert.ok(!approved.includes(TESTING_NOTE));
  const off = instagram(null);
  assert.ok(!decode(off).includes(TESTING_NOTE));
  assert.match(decode(off), /Type your numbers below\. Connecting Instagram will be available once the platform enables it\./);
  assert.doesNotMatch(off, /<button/);
  // A saved snapshot: the numbers, refresh and remove, the fine print.
  const saved = instagram(
    {
      available: true,
      snapshot: { username: "sara.fit", followers: 12_000, engagementRatePct: 1.2, postsSampled: 12, fetchedAt: PAGE.fetchedAt },
      followerModel: DEFAULT_FOLLOWER_MODEL,
    },
    { notice: INSTAGRAM_OUTCOMES.connected, busy: true },
  );
  const savedText = decode(saved);
  assert.ok(savedText.includes("@sara.fit: 12,000 followers, 1.2% average engagement over 12 recent posts. Read on 03/11/2026."), savedText);
  assert.match(savedText, /Refresh from Instagram Remove saved numbers/);
  assert.ok(savedText.includes("We read your follower count and the likes and comments on up to 12 recent posts once, then discard the access. Only the numbers are saved, and you can remove them."));
  assert.match(saved, /<p class="notice" role="status">Instagram connected\./);
  assert.equal(saved.match(/<button type="button" class="button[^"]*" disabled=""/g)?.length, 2);
  assert.match(saved, /<section class="card" aria-labelledby="instagram-h"><h2 id="instagram-h">Your Instagram numbers<\/h2>/);

  // Facebook: the Page the numbers came from, the testing note, the fine print.
  const fb = (snapshot: Page | null, testing = false, extra = {}) =>
    renderToStaticMarkup(createElement(FacebookPageCard, { ...card, state: facebook(snapshot, testing), ...extra }));
  const shared = fb(PAGE, true, { error: "Facebook could not be reached." });
  const sharedText = decode(shared);
  assert.match(shared, /<section class="card" aria-labelledby="facebook-h"><h2 id="facebook-h">Your Facebook Page numbers<\/h2>/);
  assert.ok(sharedText.includes("From your Page Sara Fit (the Page with the most followers of the 3 you shared): 7,000 followers, 0.21% average engagement over 12 recent posts. Read on 03/11/2026."), sharedText);
  assert.ok(sharedText.includes(TESTING_NOTE));
  assert.match(sharedText, /Refresh from Facebook Remove saved numbers/);
  assert.ok(sharedText.includes(FINE_PRINT));
  assert.match(shared, /<p class="notice error" role="alert">Facebook could not be reached\.<\/p>/);
  // One Page shared: no "most followers" note; one post; no engagement known.
  const one = decode(fb({ ...PAGE, pagesShared: 1, postsSampled: 1 }));
  assert.ok(one.includes("From your Page Sara Fit: 7,000 followers, 0.21% average engagement over 1 recent post. Read on"), one);
  assert.doesNotMatch(one, /most followers/);
  assert.ok(!one.includes(TESTING_NOTE));
  const unknown = decode(fb({ ...PAGE, engagementRatePct: null, postsSampled: 0 }));
  assert.doesNotMatch(unknown, /average engagement/);
  // Not connected yet: connect only.
  const fresh = fb(null);
  assert.match(decode(fresh), /Connect the Facebook Page you share your coaching on to fill in its follower count and recent engagement, or type your numbers below\. Connect Facebook We read/);
  assert.doesNotMatch(fresh, /Remove saved numbers|Refresh from Facebook/);
  // Access lost (taken off the test list, approval withdrawn, connection
  // paused) with numbers saved: they stay removable, with no connect or
  // refresh button and no testing note.
  const lost = renderToStaticMarkup(
    createElement(FacebookPageCard, { ...card, state: { ...facebook(PAGE, true), available: false, testing: false } }),
  );
  assert.ok(decode(lost).includes("From your Page Sara Fit (the Page with the most followers of the 3 you shared): 7,000 followers"), decode(lost));
  assert.match(decode(lost), /Remove saved numbers/);
  assert.doesNotMatch(lost, /Connect Facebook|Refresh from Facebook/);
  assert.ok(!decode(lost).includes(TESTING_NOTE));
  assert.equal(lost.match(/<button/g)?.length, 1);
  // The Page name is Facebook's text: escaped, never markup.
  const named = fb({ ...PAGE, pageName: "<b>Gym & Co</b>" });
  assert.doesNotMatch(named, /<b>/);
  assert.match(named, /&lt;b&gt;Gym &amp; Co&lt;\/b&gt;/);
});

test("Facebook stays out of sight until the API says this workspace may connect", async () => {
  // The estimates as /trainer/growth shows them, from GET
  // /api/v1/trainer/instagram and /facebook.
  type View = Parameters<typeof GrowthEstimatesView>[0];
  const view = (facebookPart: Partial<View["facebook"]>, instagramPart: Partial<View["instagram"]> = {}) =>
    renderToStaticMarkup(
      createElement(GrowthEstimatesView, {
        instagram: { ...card, state: null, ...instagramPart },
        facebook: { ...card, state: null, ...facebookPart },
      }),
    );
  const instagram = {
    available: true,
    snapshot: { username: "sara.fit", followers: 12_000, engagementRatePct: 1.2, postsSampled: 12, fetchedAt: PAGE.fetchedAt },
    followerModel: DEFAULT_FOLLOWER_MODEL,
  };
  // First render, before either GET answers: Instagram's card alone.
  const loading = decode(view({}));
  assert.match(loading, /Your Instagram numbers/);
  assert.doesNotMatch(loading, /Facebook|Meta/);
  // The card only once the API says available; a refused or unreadable
  // workspace sees only the notice of a ?facebook= outcome it returned with,
  // or the numbers it saved earlier, to remove them.
  const on = { available: true },
    refused = { available: false };
  assert.equal(facebookSection(on, "", ""), "card");
  assert.equal(facebookSection(on, FACEBOOK_OUTCOMES.connected, ""), "card");
  assert.equal(facebookSection({ ...on, snapshot: PAGE }, "", ""), "card");
  assert.equal(facebookSection(refused, "", ""), null);
  assert.equal(facebookSection({ ...refused, snapshot: null }, "", ""), null);
  assert.equal(facebookSection(refused, FACEBOOK_OUTCOMES.unavailable, ""), "notice");
  assert.equal(facebookSection({ ...refused, snapshot: PAGE }, "", ""), "saved");
  assert.equal(facebookSection({ ...refused, snapshot: PAGE }, FACEBOOK_OUTCOMES.unavailable, ""), "saved");
  assert.equal(facebookSection(null, "", "Facebook could not be reached."), null);
  assert.equal(facebookSection(null, FACEBOOK_OUTCOMES.failed, "Facebook could not be reached."), "notice");
  assert.equal(facebookSection(null, FACEBOOK_OUTCOMES.connected, ""), null);
  // Refused with nothing saved: no Facebook at all.
  const none = decode(view({ state: { ...facebook(null), available: false } }));
  assert.match(none, /Your Instagram numbers/);
  assert.doesNotMatch(none, /Facebook|Meta/);
  // A refused workspace back from Facebook: the notice, after Instagram's card.
  const notice = view({ state: { ...facebook(null), available: false }, notice: FACEBOOK_OUTCOMES.unavailable });
  assert.match(notice, /Your Instagram numbers[\s\S]*<p class="notice" role="status">Connecting Facebook is not available yet\.<\/p>$/);
  // Access lost with numbers saved: the card to remove them, never the
  // estimate or a connect or refresh button.
  const saved = view({ state: { ...facebook(PAGE), available: false } }, { state: instagram });
  assert.match(decode(saved), /Your Facebook Page numbers From your Page Sara Fit/);
  assert.match(saved, /Remove saved numbers/);
  assert.doesNotMatch(saved, /Connect Facebook|Refresh from Facebook|Facebook Page calculator/);
  assert.match(saved, /aria-label="Follower calculator"/);
  // Available: Connect Facebook next to Connect Instagram, then the Instagram
  // estimate, then the Facebook one.
  const both = view({ state: facebook(PAGE, true) }, { state: instagram });
  const at = (pattern: string) => {
    const index = both.indexOf(pattern);
    assert.ok(index >= 0, pattern);
    return index;
  };
  const order = [
    at(">Your Instagram numbers</h2>"),
    at("Refresh from Instagram"),
    at(">Your Facebook Page numbers</h2>"),
    at("Refresh from Facebook"),
    at('aria-label="Follower calculator"'),
    at('aria-label="Facebook Page calculator"'),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // While testing, the Facebook estimate does not link to /methodology, whose
  // Facebook section waits for approval; once approved it does.
  assert.ok(decode(both).includes("Its sources and methodology are published when this estimate goes live."));
  assert.doesNotMatch(both, /facebook-assumptions/);
  assert.match(view({ state: facebook(PAGE) }), /href="\/methodology#facebook-assumptions"/);
  const growth = decode(renderToStaticMarkup(createElement(TrainerGrowth, { slug: "sara-fit", published: true })));
  assert.match(growth, /Explore a growth estimate .* Your Instagram numbers/);
  assert.doesNotMatch(growth, /Facebook|Meta/);
  // Only /trainer/growth shows it: the estimate's one importer in the web
  // app, and the "Share your link" setup step keeps Instagram only.
  const web = new URL("../apps/web/", import.meta.url);
  const component = new URL("components/marketing/facebook-calculator", web).href;
  const importers: string[] = [];
  for (const dir of ["app", "components"])
    for (const file of await readdir(new URL(dir + "/", web), { recursive: true })) {
      if (!/\.tsx?$/.test(file)) continue;
      const url = new URL(`${dir}/${file}`, web);
      for (const [, from] of (await readFile(url, "utf8")).matchAll(/from "(\.[^"]+)"/g))
        if (new URL(from, url).href.replace(/\.tsx$/, "") === component) importers.push(`${dir}/${file}`);
    }
  assert.deepEqual(importers, ["components/trainer-growth.tsx"]);
  const home = await readFile(new URL("components/workspace-home.tsx", web), "utf8");
  assert.match(home, /import \{ FollowerEstimate, ShareYourLink \} from "\.\/trainer-growth";/);
  assert.doesNotMatch(home, /Facebook/);
  // The public platform's fallback never claims Connect Facebook.
  const platform = await readFile(new URL("components/marketing/platform.ts", web), "utf8");
  assert.match(platform, /instagram: false,\s+facebook: false,/);
});

test("every Facebook callback outcome has a plain notice, and Facebook's \"#_=_\" is dropped from the address", async () => {
  // The callback's outcomes (apps/api/src/facebook.ts FacebookOutcome).
  const api = await readFile(new URL("../apps/api/src/facebook.ts", import.meta.url), "utf8");
  const union = api.match(/export type FacebookOutcome =([^;]+);/)![1];
  const outcomes = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(outcomes, [
    "busy",
    "connected",
    "declined",
    "expired",
    "failed",
    "no_page",
    "page_access_required",
    "permissions_required",
    "unavailable",
  ]);
  assert.deepEqual(Object.keys(FACEBOOK_OUTCOMES).sort(), outcomes);
  for (const [outcome, text] of Object.entries(FACEBOOK_OUTCOMES)) {
    assert.match(text, /^[A-Z][^_]*\.$/, outcome);
    assert.doesNotMatch(text, /\b(error|code|token|Graph|API)\b/i, outcome);
  }
  assert.match(FACEBOOK_OUTCOMES.no_page, /No Facebook Page was shared/);
  assert.match(FACEBOOK_OUTCOMES.page_access_required, /full control/);
  assert.match(FACEBOOK_OUTCOMES.busy, /Try again in a few minutes/);
  // Instagram's outcomes are unchanged.
  assert.deepEqual(Object.keys(INSTAGRAM_OUTCOMES).sort(), ["connected", "declined", "expired", "failed", "professional_required", "unavailable"]);
  // "#_=_" (Facebook's redirect habit) comes off; anything else stays.
  const back = "https://trainsyou.com/trainer/growth?facebook=connected";
  assert.equal(withoutFacebookFragment(back + "#_=_"), back);
  assert.equal(withoutFacebookFragment(back), null);
  assert.equal(withoutFacebookFragment(back + "#share"), null);
  assert.equal(withoutFacebookFragment(back + "#share#_=_"), back + "#share");
});
