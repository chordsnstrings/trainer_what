"use client";
// Small interactive islands inside the server-rendered marketing pages, also
// reused in the trainer workspace (follower calculator). Pure arithmetic lives
// in packages/domain/src/marketing-calculators.ts. The follower calculator
// headlines the strong case; cautious and typical sit under How we estimate.
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import {
  DEFAULT_EARNINGS_INPUTS,
  DEFAULT_FOLLOWER_INPUTS,
  EARNINGS_LIMITS,
  aedWhole,
  FOLLOWER_LIMITS,
  FOLLOWER_SCENARIOS,
  displayCount,
  estimateEarnings,
  estimateFollowerConversion,
  followerLevers,
  followerModelAdjustments,
  type EarningsInputs,
  type FollowerInputs,
  type FollowerInputsUsed,
  type FollowerLeverId,
  type FollowerModelAssumptions,
  type FollowerRateKey,
  type FollowerScenario,
} from "../../../../packages/domain/src/marketing-calculators";

/** Early access keeps the visitor's numbers: they travel in the address. */
export function withEarlyAccessContext(
  href: string,
  context: Record<string, string | number | undefined | null>,
): string {
  if (!href.startsWith("/get-started")) return href;
  const [path, hash = "early-access"] = href.split("#");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(context))
    if (value !== undefined && value !== null && String(value) !== "")
      params.set(key, String(value).slice(0, 80));
  const query = params.toString();
  return path.split("?")[0] + (query ? "?" + query : "") + "#" + hash;
}

const aed = aedWhole;
const whole = (n: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n);
const pct = (n: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(n) + "%";

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  help,
  suffix,
}: {
  label: string;
  value: number | "";
  onChange: (value: number | "") => void;
  min: number;
  max: number;
  step?: number;
  help?: string;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className="field mk-field">
      <label htmlFor={id}>
        {label}
        {suffix && <span className="muted"> ({suffix})</span>}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={help ? id + "-help" : undefined}
        onChange={(e) =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
      />
      {help && (
        <small id={id + "-help"} className="muted">
          {help}
        </small>
      )}
    </div>
  );
}
const num = (value: number | "", fallback = 0) =>
  value === "" || !Number.isFinite(value) ? fallback : value;

function CheckField({
  label,
  checked,
  onChange,
  help,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
}) {
  const id = useId();
  return (
    <div className="field mk-field mk-check">
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={help ? id + "-help" : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {help && (
        <small id={id + "-help"} className="muted">
          {help}
        </small>
      )}
    </div>
  );
}

const countLabel = (n: number) => {
  const count = displayCount(n);
  return count === null ? "fewer than 1" : whole(count);
};
/** A lever's gain: one decimal below 10, so small gains are not shown as 0. */
const gainLabel = (n: number) =>
  n < 0.05 ? "about the same" : n < 10 ? `+${n.toFixed(1)}` : `+${whole(Math.round(n))}`;
const SCENARIO_LABEL: Record<FollowerScenario, string> = {
  cautious: "Cautious",
  typical: "Typical",
  strong: "Strong case",
};

/** Instagram follower to paying subscriber estimate, with its assumptions. */
export function FollowerCalculator({
  model,
  initial,
  compact = false,
  headingLevel = 2,
  addressTemplate,
  claimHref = "/signup",
  claimLabel = "Claim your link",
  measured,
}: {
  model: FollowerModelAssumptions;
  initial?: Partial<FollowerInputs>;
  compact?: boolean;
  headingLevel?: 2 | 3;
  addressTemplate?: string;
  claimHref?: string;
  claimLabel?: string;
  /** Shown when the numbers came from a connected Instagram account. */
  measured?: string;
}) {
  const D = DEFAULT_FOLLOWER_INPUTS;
  const start = <K extends keyof FollowerInputs>(key: K) =>
    (initial?.[key] ?? D[key]) as FollowerInputsUsed[K];
  const optionalStart = (value: number | null) => (value === null ? "" : value);
  const [followers, setFollowers] = useState<number | "">(start("followers")),
    [price, setPrice] = useState<number | "">(start("priceAed")),
    [stories, setStories] = useState<number | "">(start("linkStoriesPerMonth")),
    [reels, setReels] = useState<number | "">(start("ctaReelsPerMonth")),
    [keywordDms, setKeywordDms] = useState<boolean>(start("keywordDms")),
    [cancel, setCancel] = useState<number | "">(start("yearlyCancelPct")),
    [visits, setVisits] = useState<number | "">(
      optionalStart(start("profileVisitsPerMonth")),
    ),
    [members, setMembers] = useState<number | "">(
      optionalStart(start("broadcastMembers")),
    ),
    [links, setLinks] = useState<number | "">(start("broadcastLinksPerMonth")),
    [views, setViews] = useState<number | "">(optionalStart(start("storyViews"))),
    [engagement, setEngagement] = useState<number | "">(
      optionalStart(start("engagementRatePct")),
    );
  const optionalValue = (value: number | "") => (value === "" ? null : num(value));
  const inputs: FollowerInputs = {
    followers: num(followers),
    priceAed: num(price, 1),
    linkStoriesPerMonth: num(stories),
    ctaReelsPerMonth: num(reels),
    keywordDms,
    yearlyCancelPct: num(cancel, D.yearlyCancelPct),
    profileVisitsPerMonth: optionalValue(visits),
    broadcastMembers: optionalValue(members),
    broadcastLinksPerMonth: num(links),
    storyViews: optionalValue(views),
    engagementRatePct: optionalValue(engagement),
  };
  const key = JSON.stringify(inputs);
  const estimate = useMemo(
    () => estimateFollowerConversion(inputs, model),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, model],
  );
  const levers = useMemo(
    () => (compact ? [] : followerLevers(inputs, model, "strong")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, model, compact],
  );
  const used = estimate.inputs,
    strong = estimate.scenarios.strong;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const SubHeading = headingLevel === 2 ? "h3" : "h4";
  const tier = model.tiers[estimate.tierIndex];
  const adjusted = followerModelAdjustments(model).length > 0;
  const first = displayCount(strong.month1New),
    active = displayCount(strong.activeMonth12);
  const cancelText = `${pct(used.yearlyCancelPct)} yearly cancellations`;
  const context = {
    followers: used.followers,
    stories: used.linkStoriesPerMonth,
    price: used.priceAed,
    estimate: `${Math.floor(estimate.scenarios.cautious.month1New + 1e-9)}-${first ?? 0}`,
  };
  const leverText = (id: FollowerLeverId) => {
    switch (id) {
      case "bioLink":
        return {
          title: "Bio link to your page, per 1,000 profile visits a month",
          why: "Your bio link reaches people your Stories miss.",
        };
      case "keywordReels":
        return used.keywordDms && used.ctaReelsPerMonth > 0
          ? {
              title: "4 more Reels a month with a comment keyword",
              why: "Reels reach people who don’t watch your Stories.",
            }
          : {
              title: "A comment keyword that sends your link by DM, on 4 Reels a month",
              why: "Reels reach people who don’t watch your Stories.",
            };
      case "moreStories":
        return {
          title: "4 more link Stories a month",
          why: "The same viewers get another chance to tap, so they subscribe sooner, not in greater numbers.",
        };
      case "broadcast":
        return used.broadcastMembers
          ? {
              title: "300 more broadcast channel members",
              why: "Members mostly already watch your Stories.",
            }
          : {
              title: `A broadcast channel with 300 members and ${used.broadcastLinksPerMonth || 4} link messages a month`,
              why: "Members mostly already watch your Stories.",
            };
    }
  };
  const scenarioPct = (key: "storyPct", s: FollowerScenario) => pct(tier[key][s]);
  const rates = model.scenarios;
  const rateList = (key: FollowerRateKey) =>
    `${pct(rates.cautious[key])}, ${pct(rates.typical[key])} and ${pct(rates.strong[key])}`;
  return (
    <section className="mk-calculator card" aria-label="Follower calculator">
      <div className="mk-calculator-grid">
        <div>
          <Heading>Your numbers</Heading>
          {measured && <p className="badge green">{measured}</p>}
          <NumberField
            label="Instagram followers"
            value={followers}
            onChange={setFollowers}
            min={FOLLOWER_LIMITS.followers[0]}
            max={FOLLOWER_LIMITS.followers[1]}
          />
          <NumberField
            label="Your monthly price"
            suffix="AED"
            value={price}
            onChange={setPrice}
            min={FOLLOWER_LIMITS.priceAed[0]}
            max={FOLLOWER_LIMITS.priceAed[1]}
          />
          <NumberField
            label="Stories with your link each month"
            value={stories}
            onChange={setStories}
            min={FOLLOWER_LIMITS.linkStoriesPerMonth[0]}
            max={FOLLOWER_LIMITS.linkStoriesPerMonth[1]}
            help="Two a week is 8 a month."
          />
          {!compact && (
            <>
              <NumberField
                label="Reels or posts with a call to action each month"
                value={reels}
                onChange={setReels}
                min={FOLLOWER_LIMITS.ctaReelsPerMonth[0]}
                max={FOLLOWER_LIMITS.ctaReelsPerMonth[1]}
              />
              <CheckField
                label="A comment keyword sends your link by DM"
                checked={keywordDms}
                onChange={setKeywordDms}
                help="Without it, those posts count only through visits to your bio link."
              />
              <NumberField
                label="Members who cancel per year"
                suffix="%"
                value={cancel}
                onChange={setCancel}
                min={FOLLOWER_LIMITS.yearlyCancelPct[0]}
                max={FOLLOWER_LIMITS.yearlyCancelPct[1]}
                help="5 to 80. We assume 30% unless you know yours."
              />
              <details className="mk-optional">
                <summary>Your own numbers (optional)</summary>
                <NumberField
                  label="Profile visits each month"
                  value={visits}
                  onChange={setVisits}
                  min={FOLLOWER_LIMITS.profileVisitsPerMonth[0]}
                  max={FOLLOWER_LIMITS.profileVisitsPerMonth[1]}
                  help="From Instagram Insights. Your bio link is counted only when you enter this."
                />
                <NumberField
                  label="Broadcast channel members"
                  value={members}
                  onChange={setMembers}
                  min={FOLLOWER_LIMITS.broadcastMembers[0]}
                  max={FOLLOWER_LIMITS.broadcastMembers[1]}
                />
                <NumberField
                  label="Link messages in your channel each month"
                  value={links}
                  onChange={setLinks}
                  min={FOLLOWER_LIMITS.broadcastLinksPerMonth[0]}
                  max={FOLLOWER_LIMITS.broadcastLinksPerMonth[1]}
                />
                <NumberField
                  label="Average Story views"
                  value={views}
                  onChange={setViews}
                  min={FOLLOWER_LIMITS.storyViews[0]}
                  max={FOLLOWER_LIMITS.storyViews[1]}
                  help="From Instagram Insights. Replaces our guess of how many people see your Stories."
                />
                <NumberField
                  label="Engagement rate"
                  suffix="%"
                  value={engagement}
                  onChange={setEngagement}
                  min={0}
                  max={100}
                  step={0.01}
                  help="Average likes and comments per post, divided by followers. Leave blank if unsure."
                />
              </details>
            </>
          )}
        </div>
        <div className="mk-result" aria-live="polite">
          <p className="eyebrow">ESTIMATE, NOT A PROMISE</p>
          <p className="mk-scenario">
            <span className="badge green">Strong case</span>{" "}
            an engaged audience and weekly sharing
          </p>
          <p className="mk-result-figure">
            {first === null ? "Fewer than 1" : <>Up to {whole(first)}</>}
          </p>
          <p className="mk-result-label">
            {first === null || first === 1
              ? "new paying subscriber in your first month"
              : "new paying subscribers in your first month"}
          </p>
          <ul className="mk-headline">
            <li>
              {active === null ? (
                <>
                  Fewer than 1 active subscriber after 12 months, after{" "}
                  {cancelText}
                </>
              ) : (
                <>
                  About <strong>{whole(active)}</strong> active subscribers
                  after 12 months, after {cancelText}
                </>
              )}
            </li>
            <li>
              <strong>{aed(strong.revenueMonth12Minor)}</strong> a month at
              your price, before platform commission
            </li>
            <li>
              {countLabel(strong.signups12)} sign-ups over 12 months, before
              cancellations
            </li>
          </ul>
          <p className="fine-print">
            A best case for an engaged audience, not a typical result. The
            cautious and typical results are under How we estimate.
          </p>
          {addressTemplate && !compact && (
            <AddressPreview
              template={addressTemplate}
              claimHref={claimHref}
              claimLabel={claimLabel}
              context={context}
            />
          )}
          {!addressTemplate && !compact && claimHref.startsWith("/get-started") && (
            <Link
              className="button"
              href={withEarlyAccessContext(claimHref, context)}
            >
              {claimLabel}
            </Link>
          )}
        </div>
      </div>
      {!compact && (
        <section className="mk-levers" aria-label="What raises your number">
          <SubHeading>What raises your number</SubHeading>
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
                    {gainLabel(lever.signups12)} sign-ups over 12 months.
                  </span>
                  <span className="muted">{text.why}</span>
                </li>
              );
            })}
            <li>
              <strong>Enter your average Story views</strong>
              <span>
                {used.storyViews === null
                  ? `The strong case assumes about ${whole(Math.round(strong.storyViewers))} people see your Stories each month.`
                  : `Using your ${whole(used.storyViews)} Story views in every scenario.`}
              </span>
              <span className="muted">
                Your own number replaces our biggest guess.
              </span>
            </li>
          </ul>
        </section>
      )}
      <details className="mk-assumptions" open={!compact}>
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
            People who see your Stories each month:{" "}
            {used.storyViews !== null
              ? `your ${whole(used.storyViews)} average Story views, in every scenario`
              : `about ${FOLLOWER_SCENARIOS.map((s) => whole(Math.round(estimate.scenarios[s].storyViewers))).join(", ").replace(/, ([^,]*)$/, " and $1")} (cautious, typical, strong): ${scenarioPct("storyPct", "cautious")}, ${scenarioPct("storyPct", "typical")} and ${scenarioPct("storyPct", "strong")} of followers for your tier, and never fewer than an account at the top of a smaller tier`}
            {used.storyViews === null &&
              estimate.engagementFactor !== 1 &&
              `, scaled ×${estimate.engagementFactor.toFixed(2)} by your engagement against the ${pct(model.engagementBenchmarkPct)} average`}
            . Cautious and typical are measured on brand accounts; the strong
            case uses the reach of a six-frame Story sequence up to 10,000
            followers and vendor guidance above. [Measured; vendor guidance]
          </li>
          <li>
            Link-sticker click: {rateList("linkClickPct")} per viewer per link
            Story. Creators report 1–5%; no industry benchmark exists. The same
            people watch each Story, so the chance of a visit is
            1 − (1 − rate)^Stories, which levels off. [Creator reports]
          </li>
          {used.keywordDms && used.ctaReelsPerMonth > 0 && (
            <li>
              Keyword Reels: Reel reach and comments per view by tier, about
              twice the usual comments with a comment call to action, and{" "}
              {rateList("dmOpenPct")} of commenters open the DM link. Cautious
              counts Reel viewers inside your Story audience. [Measured on brand
              accounts; DM rates are vendor claims]
            </li>
          )}
          {used.profileVisitsPerMonth !== null && (
            <li>
              Bio link: {rateList("bioClickPct")} of monthly profile visitors.
              [Rule of thumb]
            </li>
          )}
          {!!used.broadcastMembers && (
            <li>
              Broadcast channel: {rateList("broadcastClickPct")} of members per
              link message; email benchmarks stand in. [Proxy]
            </li>
          )}
          <li>
            Visit to paid subscriber: {rateList("paidPct")} of the people who
            visit: a luxury-retail purchase rate, the Health &amp; Fitness app
            median and the median for apps where people pay before they start.
            No published benchmark exists for coaching subscriptions. [Measured;
            used as a proxy]
          </li>
          <li>
            Cancellations: {pct(used.yearlyCancelPct)} a year, about{" "}
            {pct(Math.round(estimate.monthlyCancelPct * 100) / 100)} a month, in
            every scenario. 30% is our default assumption; subscription apps
            often lose more after the first month. [Your input; default is an
            owner assumption]
          </li>
          <li>
            Strong case: per link Story, {pct(rates.strong.linkClickPct)} tap
            and {pct(rates.strong.paidPct)} of them pay, about{" "}
            {pct(Math.round(rates.strong.linkClickPct * rates.strong.paidPct) / 100)}{" "}
            of viewers. That is the low end of a creator example (roughly
            0.5–1.5% of 100,000 YouTube viewers buying a USD 20 plan) and in
            line with creators’ rule of thumb that 1–3% of an engaged audience
            buys over time. [Creator example, owner-supplied; rule of thumb]
          </li>
          <li>
            New followers, trials, discounts, refunds, failed payments and
            platform commission are not included.
          </li>
          {adjusted && (
            <li>
              Some values were adjusted by the platform operator and differ from
              the cited sources
              {model.changeNote ? `: ${model.changeNote}` : "."}
            </li>
          )}
        </ul>
        <p className="fine-print">
          Estimates apply published averages and creator examples to your
          inputs. They are not a prediction or promise of results, and you may
          get fewer subscribers than the cautious figure; your content,
          audience, offer and price change the real number.{" "}
          <Link href="/methodology">Sources and methodology</Link>
        </p>
      </details>
    </section>
  );
}

/** Live preview of the coaching address a name would get. */
export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : "";
}
export function AddressPreview({
  template,
  claimHref = "/signup",
  claimLabel = "Claim this address",
  context = {},
}: {
  template: string;
  claimHref?: string;
  claimLabel?: string;
  /** Calculator numbers carried to early access. */
  context?: Record<string, string | number>;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const slug = slugFromName(name);
  const address = template.replace("{slug}", slug || "your-name");
  const href =
    slug && claimHref === "/signup"
      ? "/signup?slug=" + encodeURIComponent(slug)
      : withEarlyAccessContext(claimHref, {
          ...context,
          name: name.trim() || undefined,
          slug: slug || undefined,
        });
  return (
    <div className="mk-address">
      <label htmlFor={id}>Your coaching name</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder="e.g. Layla Strength"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />
      <p className="mk-address-preview" aria-live="polite">
        <span className="ltr-data">{address}</span>
      </p>
      <Link className="button" href={href}>
        {claimLabel}
      </Link>
    </div>
  );
}

/** Monthly earnings estimate with commission by band. */
export function EarningsCalculator({ compact = false }: { compact?: boolean }) {
  const [v, setV] = useState<Record<keyof EarningsInputs, number | "" | string>>(
    { ...DEFAULT_EARNINGS_INPUTS },
  );
  const set = (key: keyof EarningsInputs) => (value: number | "" | string) =>
    setV((current) => ({ ...current, [key]: value }));
  const n = (key: keyof EarningsInputs) =>
    num(v[key] as number | "", Number(DEFAULT_EARNINGS_INPUTS[key]) || 0);
  const upfront = v.billing === "upfront";
  const inputs: EarningsInputs = {
    subscribers: n("subscribers"),
    billing: upfront ? "upfront" : "monthly",
    workoutPriceAed: n("workoutPriceAed"),
    programmeMonths: n("programmeMonths"),
    nutritionSharePct: compact ? 0 : n("nutritionSharePct"),
    nutritionPriceAed: n("nutritionPriceAed"),
    voiceSharePct: compact ? 0 : n("voiceSharePct"),
    voicePriceAed: n("voicePriceAed"),
    sessionsPerMonth: compact ? 0 : n("sessionsPerMonth"),
    sessionPriceAed: n("sessionPriceAed"),
    yourSessionRateAed: n("yourSessionRateAed"),
  };
  const e = estimateEarnings(inputs);
  const billingId = useId();
  return (
    <section className="mk-calculator card" aria-label="Earnings calculator">
      <div className="mk-calculator-grid">
        <div>
          <h2>Your offer</h2>
          <NumberField
            label="Paying subscribers"
            value={v.subscribers as number | ""}
            onChange={set("subscribers")}
            min={EARNINGS_LIMITS.subscribers[0]}
            max={EARNINGS_LIMITS.subscribers[1]}
          />
          {!compact && (
            <div className="field mk-field">
              <label htmlFor={billingId}>Billing</label>
              <select
                id={billingId}
                value={upfront ? "upfront" : "monthly"}
                onChange={(e) => set("billing")(e.target.value)}
              >
                <option value="monthly">Monthly</option>
                <option value="upfront">Upfront for the whole programme</option>
              </select>
            </div>
          )}
          <NumberField
            label={upfront ? "Workout programme price" : "Workout price per month"}
            suffix="AED"
            value={v.workoutPriceAed as number | ""}
            onChange={set("workoutPriceAed")}
            min={0}
            max={EARNINGS_LIMITS.priceAed[1]}
          />
          {upfront && (
            <NumberField
              label="Programme length"
              suffix="months"
              value={v.programmeMonths as number | ""}
              onChange={set("programmeMonths")}
              min={EARNINGS_LIMITS.programmeMonths[0]}
              max={EARNINGS_LIMITS.programmeMonths[1]}
            />
          )}
          {!compact && (
            <>
              <NumberField
                label="Subscribers on workout + nutrition"
                suffix="%"
                value={v.nutritionSharePct as number | ""}
                onChange={set("nutritionSharePct")}
                min={0}
                max={100}
              />
              <NumberField
                label={
                  upfront
                    ? "Workout + nutrition programme price"
                    : "Workout + nutrition price per month"
                }
                suffix="AED"
                value={v.nutritionPriceAed as number | ""}
                onChange={set("nutritionPriceAed")}
                min={0}
                max={EARNINGS_LIMITS.priceAed[1]}
              />
              <NumberField
                label="Subscribers adding your voice coach"
                suffix="%"
                value={v.voiceSharePct as number | ""}
                onChange={set("voiceSharePct")}
                min={0}
                max={100}
              />
              <NumberField
                label="Voice add-on per month"
                suffix="AED"
                value={v.voicePriceAed as number | ""}
                onChange={set("voicePriceAed")}
                min={0}
                max={EARNINGS_LIMITS.priceAed[1]}
              />
              <NumberField
                label="Paid one-to-one sessions each month"
                value={v.sessionsPerMonth as number | ""}
                onChange={set("sessionsPerMonth")}
                min={0}
                max={EARNINGS_LIMITS.sessionsPerMonth[1]}
              />
              <NumberField
                label="Price per session"
                suffix="AED"
                value={v.sessionPriceAed as number | ""}
                onChange={set("sessionPriceAed")}
                min={0}
                max={EARNINGS_LIMITS.priceAed[1]}
              />
            </>
          )}
          <NumberField
            label="Your usual in-person rate per session"
            suffix="AED"
            value={v.yourSessionRateAed as number | ""}
            onChange={set("yourSessionRateAed")}
            min={0}
            max={EARNINGS_LIMITS.priceAed[1]}
          />
        </div>
        <div className="mk-result" aria-live="polite">
          <p className="eyebrow">ILLUSTRATIVE ARITHMETIC</p>
          <p className="mk-result-figure">{aed(e.beforeOtherCostsMinor)}</p>
          <p className="mk-result-label">
            a month before other costs and tax
          </p>
          {e.equivalentSessions !== null && (
            <p className="mk-nudge">
              That is about <strong>{whole(e.equivalentSessions)}</strong>{" "}
              sessions a month at your usual rate.
            </p>
          )}
          <dl className="mk-funnel">
            <div>
              <dt>Subscriptions{upfront ? " (monthly equivalent)" : ""}</dt>
              <dd>{aed(e.subscriptionMonthlyMinor)}</dd>
            </div>
            <div>
              <dt>Commission ({pct(e.effectiveCommissionPct)} overall)</dt>
              <dd>−{aed(e.commissionMinor)}</dd>
            </div>
            {!compact && (
              <div>
                <dt>One-to-one sessions</dt>
                <dd>{aed(e.sessionsMonthlyMinor)}</dd>
              </div>
            )}
          </dl>
          <table className="mk-table mk-bands">
            <caption>Commission by band</caption>
            <thead>
              <tr>
                <th scope="col">Subscribers</th>
                <th scope="col">Rate</th>
                <th scope="col">Commission</th>
              </tr>
            </thead>
            <tbody>
              {e.bands.map((band) => (
                <tr key={band.from}>
                  <td>
                    {band.to === null
                      ? `Above ${whole(band.from - 1)}`
                      : `${whole(band.from)}–${whole(band.to)}`}{" "}
                    <span className="muted">({whole(band.subscribers)})</span>
                  </td>
                  <td>{band.ratePct}%</td>
                  <td>{aed(band.commissionMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="fine-print mk-disclaimer">
        Not an earnings promise. Excludes payment processing, AI usage at cost,
        voice usage, your own domain, refunds, disputes, any booking fee in
        your finance policy, and tax.{" "}
        <Link href="/methodology">Assumptions</Link>
      </p>
    </section>
  );
}

/** Four scripted decisions, one shown at a time. */
export function DemoScenarios({
  scenarios,
}: {
  scenarios: Array<{ title: string; label: string; body: string }>;
}) {
  const [selected, setSelected] = useState(0);
  const base = useId();
  return (
    <div className="mk-demo">
      <div className="mk-demo-tabs" role="tablist" aria-label="Sample decisions">
        {scenarios.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-controls={`${base}-panel-${i}`}
            aria-selected={i === selected}
            className={"button " + (i === selected ? "" : "secondary")}
            onClick={() => setSelected(i)}
          >
            {s.title}
          </button>
        ))}
      </div>
      {scenarios.map((s, i) => (
        <section
          key={s.title}
          role="tabpanel"
          id={`${base}-panel-${i}`}
          aria-labelledby={`${base}-tab-${i}`}
          hidden={i !== selected}
          className="card mk-demo-panel"
        >
          <span className="badge green">{s.label}</span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </section>
      ))}
    </div>
  );
}

const EMIRATES: Array<[string, string]> = [
  ["abu_dhabi", "Abu Dhabi"],
  ["dubai", "Dubai"],
  ["sharjah", "Sharjah"],
  ["ajman", "Ajman"],
  ["umm_al_quwain", "Umm Al Quwain"],
  ["ras_al_khaimah", "Ras Al Khaimah"],
  ["fujairah", "Fujairah"],
  ["outside_uae", "Outside the UAE"],
];
/** The calculator numbers and address carried in from another page. */
function earlyAccessContext(search: string) {
  const q = new URLSearchParams(search);
  const int = (key: string, max: number) => {
    const n = Number(q.get(key));
    return q.get(key) !== null && Number.isInteger(n) && n >= 0 && n <= max
      ? n
      : null;
  };
  const [low, high] = (q.get("estimate") ?? "").split("-").map(Number);
  const stories = int("stories", 60),
    price = int("price", 10_000);
  return {
    name: (q.get("name") ?? "").slice(0, 120),
    slug: /^[a-z][a-z0-9-]{2,39}$/.test(q.get("slug") ?? "") ? q.get("slug")! : "",
    followers: int("followers", 10_000_000),
    estimate:
      stories !== null &&
      price !== null &&
      price >= 1 &&
      Number.isInteger(low) &&
      Number.isInteger(high) &&
      low >= 0 &&
      low <= high
        ? { stories, price, low, high }
        : null,
  };
}
/** Consented early-access request while trainer registration is closed. */
export function EarlyAccessForm({
  appName,
  supportEmail,
  specialties,
}: {
  appName: string;
  supportEmail: string | null;
  specialties: Array<{ id: string; label: string }>;
}) {
  const base = useId();
  const [context, setContext] = useState<ReturnType<typeof earlyAccessContext>>({
    name: "",
    slug: "",
    followers: null,
    estimate: null,
  });
  const [startedAt, setStartedAt] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    setContext(earlyAccessContext(window.location.search));
    setStartedAt(Date.now());
  }, []);
  const summary = [
    context.slug && `Address: ${context.slug}`,
    context.followers !== null && `Followers: ${context.followers}`,
    context.estimate &&
      `Follower estimate: ${context.estimate.low}-${context.estimate.high} in the first month (${context.estimate.stories} link Stories, AED ${context.estimate.price})`,
  ]
    .filter(Boolean)
    .join("\n");
  const mailto = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent("Early access")}&body=${encodeURIComponent(
        `Name: ${context.name}\nInstagram: \n${summary}`,
      )}`
    : null;
  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    const followers = String(f.get("followers") ?? "").trim();
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/v1/public/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(f.get("name") ?? ""),
          email: String(f.get("email") ?? ""),
          instagram: String(f.get("instagram") ?? ""),
          specialty: String(f.get("specialty") ?? ""),
          emirate: String(f.get("emirate") ?? ""),
          followers: followers === "" ? null : Math.round(Number(followers)),
          estimate: context.estimate,
          slug: context.slug,
          consent: f.get("consent") === "on",
          website: String(f.get("website") ?? ""),
          startedAt,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? "Your request could not be sent.");
      }
      setState("sent");
    } catch (e) {
      setState("failed");
      setError((e as Error).message);
    }
  }
  if (state === "sent")
    return (
      <div className="mk-early-done" role="status">
        <p className="mk-body">
          <strong>Thank you.</strong> Your request is on the early access list.
          We will email you when trainer registration opens.
        </p>
      </div>
    );
  return (
    <form
      className="mk-early-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      {(context.estimate || context.slug) && (
        <p className="mk-early-context">
          We will keep what you worked out:{" "}
          {context.slug && (
            <>
              the address <span className="ltr-data">{context.slug}</span>
              {context.estimate ? " and " : "."}
            </>
          )}
          {context.estimate &&
            `a first-month estimate of ${context.estimate.low}-${context.estimate.high} subscribers at AED ${context.estimate.price}.`}
        </p>
      )}
      <div className="mk-early-grid">
        <div className="field mk-field">
          <label htmlFor={base + "-name"}>Your name</label>
          <input
            id={base + "-name"}
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            defaultValue={context.name}
            key={"name-" + context.name}
          />
        </div>
        <div className="field mk-field">
          <label htmlFor={base + "-email"}>Email</label>
          <input
            id={base + "-email"}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className="ltr-data"
          />
        </div>
        <div className="field mk-field">
          <label htmlFor={base + "-ig"}>
            Instagram handle <span className="muted">(optional)</span>
          </label>
          <input
            id={base + "-ig"}
            name="instagram"
            maxLength={31}
            autoComplete="off"
            placeholder="@yourname"
            className="ltr-data"
          />
        </div>
        <div className="field mk-field">
          <label htmlFor={base + "-followers"}>
            Instagram followers <span className="muted">(optional)</span>
          </label>
          <input
            id={base + "-followers"}
            name="followers"
            type="number"
            min={0}
            max={10_000_000}
            inputMode="numeric"
            defaultValue={context.followers ?? ""}
            key={"followers-" + context.followers}
          />
        </div>
        <div className="field mk-field">
          <label htmlFor={base + "-specialty"}>
            Main specialty <span className="muted">(optional)</span>
          </label>
          <select id={base + "-specialty"} name="specialty" defaultValue="">
            <option value="">Choose one</option>
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field mk-field">
          <label htmlFor={base + "-emirate"}>
            Where you coach <span className="muted">(optional)</span>
          </label>
          <select id={base + "-emirate"} name="emirate" defaultValue="">
            <option value="">Choose one</option>
            {EMIRATES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mk-honeypot" aria-hidden="true">
        <label htmlFor={base + "-website"}>Leave this empty</label>
        <input
          id={base + "-website"}
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <label className="mk-consent">
        <input type="checkbox" name="consent" required />
        <span>
          I agree that {appName} may keep these details, and the estimate
          above, to contact me about early access. I can ask for them to be
          deleted at any time.
        </span>
      </label>
      <div className="button-row">
        <button className="button large" disabled={state === "sending" || !startedAt}>
          {state === "sending" ? "Sending…" : "Join early access"}
        </button>
        {mailto && (
          <a className="text-link" href={mailto}>
            Or email us instead
          </a>
        )}
      </div>
      {state === "failed" && (
        <p className="notice" role="alert">
          {error}
          {mailto ? " You can also email us; your numbers are already in the message." : ""}
        </p>
      )}
    </form>
  );
}
