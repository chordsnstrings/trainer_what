"use client";
// The Facebook Page estimate on /trainer/growth, shown only while Connect
// Facebook is available to the workspace (approved by Meta's review, or listed
// for testing before it); no public page shows it until the owner signs the
// figures off. Pure arithmetic lives in
// packages/domain/src/facebook-calculator.ts. Visit to paid and cancellations
// are the follower (Instagram) model's, so it takes the platform's follower
// model. Built from the follower calculator's fields and classes (islands.tsx).
// A Page's first month is usually fewer than 1, so the headline is active
// subscribers after 12 months, the figure the levers are kept for.
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  DEFAULT_FACEBOOK_INPUTS,
  DEFAULT_FACEBOOK_MODEL,
  FACEBOOK_LIMITS,
  estimateFacebookConversion,
  facebookLevers,
  type FacebookInputs,
  type FacebookInputsUsed,
  type FacebookLeverId,
  type FacebookModelAssumptions,
  type FacebookRateKey,
} from "../../../../packages/domain/src/facebook-calculator";
import {
  FOLLOWER_SCENARIOS,
  displayCount,
  followerModelAdjustments,
  type FollowerModelAssumptions,
  type FollowerScenario,
} from "../../../../packages/domain/src/marketing-calculators";
import {
  CheckField,
  NumberField,
  SCENARIO_LABEL,
  aed,
  countLabel,
  gainLabel,
  num,
  pct,
  whole,
} from "./islands";

/** "a, b and c" */
const andList = (items: string[]) =>
  `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** Facebook Page follower to paying subscriber estimate, with its assumptions. */
export function FacebookCalculator({
  model = DEFAULT_FACEBOOK_MODEL,
  followerModel,
  initial,
  measured,
  methodology = true,
}: {
  model?: FacebookModelAssumptions;
  /** The platform's follower model: its visit-to-paid rates are shared. */
  followerModel: FollowerModelAssumptions;
  initial?: Partial<FacebookInputs>;
  /** Shown when the numbers came from a connected Facebook Page. */
  measured?: string;
  /**
   * Whether /methodology publishes this estimate's section and sources: false
   * while testing before Meta's review (it shows them only once approved).
   */
  methodology?: boolean;
}) {
  const D = DEFAULT_FACEBOOK_INPUTS,
    L = FACEBOOK_LIMITS;
  const start = <K extends keyof FacebookInputs>(key: K) =>
    (initial?.[key] ?? D[key]) as FacebookInputsUsed[K];
  const optionalStart = (value: number | null) => (value === null ? "" : value);
  const [followers, setFollowers] = useState<number | "">(start("followers")),
    [price, setPrice] = useState<number | "">(start("priceAed")),
    [posts, setPosts] = useState<number | "">(start("linkPostsPerMonth")),
    [reels, setReels] = useState<number | "">(start("ctaReelsPerMonth")),
    [keywordDms, setKeywordDms] = useState<boolean>(start("keywordDms")),
    [cancel, setCancel] = useState<number | "">(start("yearlyCancelPct")),
    [visits, setVisits] = useState<number | "">(
      optionalStart(start("pageVisitsPerMonth")),
    ),
    [viewers, setViewers] = useState<number | "">(
      optionalStart(start("linkPostViewers")),
    ),
    [engagement, setEngagement] = useState<number | "">(
      optionalStart(start("engagementRatePct")),
    );
  const optionalValue = (value: number | "") =>
    value === "" ? null : num(value);
  const inputs: FacebookInputs = {
    followers: num(followers),
    priceAed: num(price, 1),
    linkPostsPerMonth: num(posts),
    ctaReelsPerMonth: num(reels),
    keywordDms,
    yearlyCancelPct: num(cancel, D.yearlyCancelPct),
    pageVisitsPerMonth: optionalValue(visits),
    linkPostViewers: optionalValue(viewers),
    engagementRatePct: optionalValue(engagement),
  };
  const key = JSON.stringify(inputs);
  const estimate = useMemo(
    () => estimateFacebookConversion(inputs, model, followerModel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, model, followerModel],
  );
  const levers = useMemo(
    () => facebookLevers(inputs, model, followerModel, "strong"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, model, followerModel],
  );
  const used = estimate.inputs,
    strong = estimate.scenarios.strong;
  const tier = model.tiers[estimate.tierIndex];
  const first = displayCount(strong.month1New),
    active = displayCount(strong.activeMonth12),
    signups = displayCount(strong.signups12);
  const cancelText = `${pct(used.yearlyCancelPct)} yearly cancellations`;
  // "Weekly sharing" only when the inputs share weekly (4 or more a month).
  const weekly =
    used.linkPostsPerMonth >= 4 ||
    (used.keywordDms && used.ctaReelsPerMonth >= 4);
  const growing = strong.activeByMonth[11] > strong.activeByMonth[10] + 1e-9;
  const keywordReels = used.keywordDms && used.ctaReelsPerMonth > 0;
  const factor = estimate.engagementFactor;
  // What your engagement scales: your own link-post viewers replace ours.
  const scaled =
    used.linkPostViewers === null
      ? keywordReels
        ? "the link-post audience and Reel comments are"
        : "the link-post audience is"
      : keywordReels
        ? "Reel comments are"
        : "";
  const rates = model.scenarios;
  const rateList = (key: FacebookRateKey) =>
    andList(FOLLOWER_SCENARIOS.map((s) => pct(rates[s][key])));
  const people = (pick: (s: FollowerScenario) => number) =>
    andList(FOLLOWER_SCENARIOS.map((s) => whole(Math.round(pick(s)))));
  const paidList = andList(
    FOLLOWER_SCENARIOS.map((s) => pct(followerModel.scenarios[s].paidPct)),
  );
  // Shared with the Instagram estimate, so an operator change shows here too.
  const paidAdjusted = followerModelAdjustments(followerModel).some((a) =>
    a.field.endsWith(".paidPct"),
  );
  const leverText = (id: FacebookLeverId) => {
    switch (id) {
      case "pageLink":
        return {
          title:
            "Your Page link (action button or website), per 1,000 Page visits a month",
          why: "Your Page’s link reaches people your posts miss.",
        };
      case "keywordReels":
        return {
          title: keywordReels
            ? "4 more keyword Reels a month"
            : "A comment keyword that sends your link by Messenger, on 4 Reels a month",
          why: "Reels reach people who don’t follow your Page.",
        };
      case "moreLinkPosts":
        return {
          title: "4 more posts with your link a month",
          why: "More chances for the same followers to tap. If Meta limits your Page to 2 link posts a month, use keyword Reels instead.",
        };
    }
  };
  return (
    <section
      className="mk-calculator card"
      aria-label="Facebook Page calculator"
    >
      <div className="mk-calculator-grid">
        <div>
          <h2>Your numbers for Facebook</h2>
          {measured && <p className="badge green">{measured}</p>}
          <NumberField
            label="Facebook Page followers"
            value={followers}
            onChange={setFollowers}
            min={L.followers[0]}
            max={L.followers[1]}
          />
          <NumberField
            label="Your monthly price"
            suffix="AED"
            value={price}
            onChange={setPrice}
            min={L.priceAed[0]}
            max={L.priceAed[1]}
          />
          <NumberField
            label="Posts with your link each month"
            value={posts}
            onChange={setPosts}
            min={L.linkPostsPerMonth[0]}
            max={L.linkPostsPerMonth[1]}
            help="One a week is 4. Meta is testing a limit of 2 link posts a month for some Pages without Meta Verified. Links in comments don’t count."
          />
          <NumberField
            label="Reels with a call to action each month"
            value={reels}
            onChange={setReels}
            min={L.ctaReelsPerMonth[0]}
            max={L.ctaReelsPerMonth[1]}
          />
          <CheckField
            label="A comment keyword sends your link by Messenger"
            checked={keywordDms}
            onChange={setKeywordDms}
            help="Without it, those Reels count only through the Page visits you enter."
          />
          <NumberField
            label="Members who cancel per year"
            suffix="%"
            value={cancel}
            onChange={setCancel}
            min={L.yearlyCancelPct[0]}
            max={L.yearlyCancelPct[1]}
            help="5 to 80. We assume 30% unless you know yours."
          />
          <details className="mk-optional">
            <summary>Your own numbers (optional)</summary>
            <NumberField
              label="Facebook Page visits each month"
              value={visits}
              onChange={setVisits}
              min={L.pageVisitsPerMonth[0]}
              max={L.pageVisitsPerMonth[1]}
              help="From Meta Business Suite Insights (“Visits”, last 28 days). Your Page link is counted only when you enter this."
            />
            <NumberField
              label="Average viewers of your link posts"
              value={viewers}
              onChange={setViewers}
              min={L.linkPostViewers[0]}
              max={L.linkPostViewers[1]}
              help="Each link post’s “Viewers” in Insights (older screens say “Reach”). Replaces our guess of how many people see your link posts, up to your followers."
            />
            <NumberField
              label="Engagement rate"
              suffix="%"
              value={engagement}
              onChange={setEngagement}
              min={L.engagementRatePct[0]}
              max={L.engagementRatePct[1]}
              step={0.01}
              help="Average reactions, comments and shares per post, divided by followers. Leave blank if unsure."
            />
          </details>
        </div>
        <div className="mk-result" aria-live="polite">
          <p className="eyebrow">ESTIMATE, NOT A PROMISE</p>
          <p className="mk-scenario">
            <span className="badge green">Strong case</span>{" "}
            {weekly
              ? "an engaged, growing Page and weekly sharing"
              : "an engaged, growing Page"}
          </p>
          <p className="mk-result-figure">
            {active === null ? "Fewer than 1" : <>Up to {whole(active)}</>}
          </p>
          <p className="mk-result-label">
            {active === null || active === 1
              ? "active subscriber"
              : "active subscribers"}{" "}
            after 12 months, after {cancelText}
            {active !== null && growing && ", and still growing"}
          </p>
          <ul className="mk-headline">
            <li>
              {first === null ? (
                <>Fewer than 1 new paying subscriber in your first month</>
              ) : (
                <>
                  Up to <strong>{whole(first)}</strong> new paying{" "}
                  {first === 1 ? "subscriber" : "subscribers"} in your first
                  month
                </>
              )}
            </li>
            <li>
              {strong.revenueMonth12Minor > 0 && "Up to "}
              <strong>{aed(strong.revenueMonth12Minor)}</strong> a month at your
              price, before platform commission
            </li>
            <li>
              {signups === null ? (
                <>Fewer than 1 sign-up over 12 months</>
              ) : (
                <>
                  Up to {whole(signups)}{" "}
                  {signups === 1 ? "sign-up" : "sign-ups"} over 12 months,
                  before cancellations
                </>
              )}
            </li>
          </ul>
          <p className="fine-print">
            A best case for an engaged, growing Page, not a typical result and
            not a promise. The cautious and typical results are under How we
            estimate.
          </p>
          <p className="fine-print">
            Facebook shows a Page’s posts to few of its followers, so this is
            far lower than an Instagram estimate at the same follower count. The
            figures are averages for brand Pages, not fitness trainers. Don’t
            add the two estimates together: many people follow you on both.
          </p>
        </div>
      </div>
      <section
        className="mk-levers"
        aria-label="What raises your Facebook number"
      >
        <h3>What raises your Facebook number</h3>
        <p className="muted">
          Strong case, one change at a time, against your numbers above.
        </p>
        <ul>
          {levers.map((lever) => {
            const text = leverText(lever.id);
            return (
              <li key={lever.id}>
                <strong>{text.title}</strong>
                <span>
                  {gainLabel(lever.month1New)} in your first month,{" "}
                  {gainLabel(lever.activeMonth12)} active after 12 months
                  {lever.revenueMonth12Minor > 0 &&
                    ` (+${aed(lever.revenueMonth12Minor)} a month)`}
                  .
                </span>
                <span className="muted">{text.why}</span>
              </li>
            );
          })}
          <li>
            <strong>Enter your link posts’ average viewers</strong>
            <span>
              {used.linkPostViewers === null
                ? `The strong case assumes about ${whole(Math.round(strong.linkPostViewers))} people see each link post.`
                : `Using your ${whole(used.linkPostViewers)} viewers in every scenario.`}
            </span>
            <span className="muted">
              Your own number replaces our biggest guess.
            </span>
          </li>
        </ul>
      </section>
      <details className="mk-assumptions" open>
        <summary>How we estimate (assumptions version {model.version})</summary>
        <div className="mk-table-wrap">
          <table className="mk-table mk-scenarios">
            <caption>
              Three scenarios at your numbers; the headline is the strong case
            </caption>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">First month</th>
                <th scope="col">Active after 12 months</th>
                <th scope="col">Sign-ups over 12 months</th>
                <th scope="col">A month at month 12</th>
              </tr>
            </thead>
            <tbody>
              {FOLLOWER_SCENARIOS.map((s) => {
                const r = estimate.scenarios[s];
                return (
                  <tr key={s}>
                    <th scope="row">{SCENARIO_LABEL[s]}</th>
                    <td>{countLabel(r.month1New)}</td>
                    <td>{countLabel(r.activeMonth12)}</td>
                    <td>{countLabel(r.signups12)}</td>
                    <td>{aed(r.revenueMonth12Minor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul>
          <li>
            People who see your link posts:{" "}
            {used.linkPostViewers !== null
              ? `your ${whole(used.linkPostViewers)} average viewers, the same people each post, in every scenario.`
              : `about ${people((s) => estimate.scenarios[s].linkPostViewers)} (cautious, typical, strong), the same people each post. An average post reaches ${pct(tier.postReachPct)} of followers on Pages your size, and a post with a link ${rateList("linkPostRelativeReachPct")} of that${factor !== 1 ? `, scaled ×${factor.toFixed(2)} by your engagement` : ""}; never fewer than a Page at the top of a smaller tier.`}{" "}
            Reach by Page size is measured on brand Pages (Socialinsider,
            January 2025–August 2026); Pages under 1,000 followers use the
            1,000–5,000 figure and Pages above 1 million the 100,000–1 million
            figure. The link share is our division of reach by post format.
            Meta: 98.9% of US Feed views in Q2 2026 were of posts without a
            link. [Measured; our assumption]
          </li>
          <li>
            Engagement:{" "}
            {used.engagementRatePct === null
              ? `not entered, so your Page counts as average for its size (${pct(estimate.engagementBenchmarkPct)} reactions, comments and shares per post, divided by followers)`
              : `your ${pct(used.engagementRatePct)} against the ${pct(estimate.engagementBenchmarkPct)} average for Pages your size`}
            {factor !== 1 &&
              scaled &&
              `, so ${scaled} scaled ×${factor.toFixed(2)}`}
            . Scaling is at most ×{model.engagementFactorMax} either way. The
            averages are Facebook Reels engagement by Page size, scaled to all
            post formats. [Measured on brand Pages; proxy; our assumption]
          </li>
          <li>
            Link click: {rateList("linkClickPct")} of the people who see a link
            post tap it, each post. Typical and strong are publishers’ average
            and highest organic Facebook click-through (Echobox, 2020–21);
            cautious is our assumption, and no benchmark exists for brand or
            creator Pages. The same people see each link post, so a viewer’s
            chance of a visit in a month is 1 − (1 − rate)^posts. [Proxy; our
            assumption]
          </li>
          {keywordReels && (
            <li>
              Keyword Reels: one Reel reaches about{" "}
              {people((s) => estimate.scenarios[s].reelViewers)} people (
              {rateList("reelRelativeReachPct")} of an average post, our
              division of reach by format). About{" "}
              {pct(model.reelCommentsPerViewPct)} of viewers comment (two
              sources combined), about twice as many with a comment call to
              action (measured on Instagram), and {rateList("dmOpenPct")} of
              commenters open the link your Page sends by Messenger (vendor
              claims about Instagram DMs). A Page may send one private reply per
              comment, within 7 days. Cautious counts Reel viewers inside your
              link-post audience; typical and strong count each Reel’s
              commenters afresh, as Reels reach people who don’t follow your
              Page. [Measured on brand Pages; proxy; vendor claims; our
              assumption]
            </li>
          )}
          {used.pageVisitsPerMonth !== null && (
            <li>
              Page link: {rateList("pageLinkClickPct")} of monthly Page visitors
              tap your action button or website: the link-in-bio rule of thumb,
              used as a proxy. [Rule of thumb; proxy]
            </li>
          )}
          <li>
            New people each month: {rateList("audienceRenewalPct")} of each
            audience is new to your link every month (new followers, and people
            Facebook starts showing your posts to), so sign-ups keep coming
            after your first viewers have decided. Cautious keeps the same
            people all year; typical is about the follower growth measured on
            brand Pages; strong is our assumption for a growing Page. [Measured
            growth; our assumption]
          </li>
          <li>
            Visit to paid subscriber: {paidList} of the people who visit, the
            same rates as your Instagram estimate: a luxury-retail purchase
            rate, then the median and upper quartile of Health &amp; Fitness app
            downloads that turn paid within 35 days. These may overstate, and no
            published benchmark exists for coaching subscriptions. [Measured;
            used as a proxy]
          </li>
          <li>
            Cancellations: {pct(used.yearlyCancelPct)} a year, about{" "}
            {pct(Math.round(estimate.monthlyCancelPct * 100) / 100)} a month, in
            every scenario, as in your Instagram estimate. 30% is our default
            assumption; subscription apps often lose more after the first month.
            [Your input; default is an owner assumption]
          </li>
          <li>
            Not counted: Stories, Groups, links in comments, posts without your
            link, and ads or boosted posts. No published benchmark covers them,
            and Instagram Stories shared to Facebook would count the same people
            twice. Trials, discounts, refunds, failed payments and platform
            commission are not included either.
          </li>
          <li>
            Since December 2025 Meta has been testing a limit of 2 link posts a
            month for some Pages without Meta Verified. Links in comments are
            not affected, and we can’t tell whether your Page is in the test.
          </li>
          <li>
            These are averages for brand Pages with 1,000 to 1 million
            followers, not fitness trainers. Meta’s reach is itself an estimate,
            and Meta replaced impressions with views in 2025, so Insights
            numbers from before and after may not match.
          </li>
          {paidAdjusted && (
            <li>
              The visit-to-paid rates were adjusted by the platform operator and
              differ from the cited sources
              {followerModel.changeNote ? `: ${followerModel.changeNote}` : "."}
            </li>
          )}
        </ul>
        <p className="fine-print">
          Estimates apply published averages and our stated assumptions to your
          inputs. They are not a prediction or promise of results, and you may
          get fewer subscribers than the cautious figure; your content,
          audience, offer and price change the real number.{" "}
          {methodology ? (
            <Link href="/methodology#facebook-assumptions">
              Sources and methodology
            </Link>
          ) : (
            "Its sources and methodology are published when this estimate goes live."
          )}
        </p>
      </details>
    </section>
  );
}
