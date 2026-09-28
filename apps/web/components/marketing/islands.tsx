"use client";
// Small interactive islands inside the server-rendered marketing pages, also
// reused in the trainer workspace (follower calculator). Pure arithmetic lives
// in packages/domain/src/marketing-calculators.ts.
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import {
  DEFAULT_EARNINGS_INPUTS,
  EARNINGS_LIMITS,
  aedWhole,
  FOLLOWER_LIMITS,
  displayRange,
  estimateEarnings,
  estimateFollowerConversion,
  type EarningsInputs,
  type FollowerModelAssumptions,
} from "../../../../packages/domain/src/marketing-calculators";

const aed = aedWhole;
const whole = (n: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n);
const pct = (n: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(n) + "%";
const range = (r: { low: number; high: number }, format = whole) =>
  r.low === r.high ? format(r.low) : `${format(r.low)}–${format(r.high)}`;

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
  initial?: {
    followers?: number;
    linkStoriesPerMonth?: number;
    priceAed?: number;
    engagementRatePct?: number | null;
  };
  compact?: boolean;
  headingLevel?: 2 | 3;
  addressTemplate?: string;
  claimHref?: string;
  claimLabel?: string;
  /** Shown when the numbers came from a connected Instagram account. */
  measured?: string;
}) {
  const [followers, setFollowers] = useState<number | "">(
      initial?.followers ?? 5000,
    ),
    [stories, setStories] = useState<number | "">(
      initial?.linkStoriesPerMonth ?? 8,
    ),
    [price, setPrice] = useState<number | "">(initial?.priceAed ?? 199),
    [engagement, setEngagement] = useState<number | "">(
      initial?.engagementRatePct ?? "",
    );
  const inputs = {
    followers: num(followers),
    linkStoriesPerMonth: num(stories),
    priceAed: num(price, 1),
    engagementRatePct: engagement === "" ? null : num(engagement),
  };
  const estimate = useMemo(
    () => estimateFollowerConversion(inputs, model),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followers, stories, price, engagement, model],
  );
  const more = useMemo(
    () =>
      estimateFollowerConversion(
        { ...inputs, linkStoriesPerMonth: inputs.linkStoriesPerMonth + 4 },
        model,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followers, stories, price, engagement, model],
  );
  const subs = displayRange(estimate.subscribers),
    year = displayRange(estimate.twelveMonthSubscribers),
    moreSubs = displayRange(more.subscribers);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const tier = model.tiers[estimate.tierIndex];
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
            label="Stories with your link each month"
            value={stories}
            onChange={setStories}
            min={FOLLOWER_LIMITS.linkStoriesPerMonth[0]}
            max={FOLLOWER_LIMITS.linkStoriesPerMonth[1]}
            help="Two a week is 8 a month."
          />
          <NumberField
            label="Your monthly price"
            suffix="AED"
            value={price}
            onChange={setPrice}
            min={FOLLOWER_LIMITS.priceAed[0]}
            max={FOLLOWER_LIMITS.priceAed[1]}
          />
          {!compact && (
            <NumberField
              label="Engagement rate, optional"
              suffix="%"
              value={engagement}
              onChange={setEngagement}
              min={0}
              max={100}
              step={0.01}
              help="Average likes and comments per post, divided by followers. Leave blank if unsure."
            />
          )}
        </div>
        <div className="mk-result" aria-live="polite">
          <p className="eyebrow">ESTIMATE, NOT A PROMISE</p>
          <p className="mk-result-figure">
            {subs.high < 1 ? (
              <>Fewer than 1</>
            ) : (
              <>
                {range(subs)}
              </>
            )}
          </p>
          <p className="mk-result-label">
            new paying subscribers a month when you share your link
          </p>
          {subs.high >= 1 && (
            <p>
              About {range(displayRange({
                low: estimate.monthlyRevenueMinor.low / 100,
                high: estimate.monthlyRevenueMinor.high / 100,
              }), (n) => aed(n * 100))}{" "}
              a month in new subscriptions, and {range(year)} subscribers after
              twelve months of steady sharing, before cancellations.
            </p>
          )}
          <p className="mk-nudge">
            Followers who never see your offer can’t subscribe. With 4 more link
            Stories a month:{" "}
            <strong>
              {moreSubs.high < 1 ? "fewer than 1" : range(moreSubs)}
            </strong>{" "}
            a month.
          </p>
          {!compact && (
            <dl className="mk-funnel">
              <div>
                <dt>Story views with your link</dt>
                <dd>{range(displayRange(estimate.linkViews))}</dd>
              </div>
              <div>
                <dt>Visits to your page</dt>
                <dd>{range(displayRange(estimate.visits))}</dd>
              </div>
              <div>
                <dt>New paying subscribers</dt>
                <dd>{subs.high < 1 ? "< 1" : range(subs)}</dd>
              </div>
            </dl>
          )}
          {addressTemplate && !compact && (
            <AddressPreview
              template={addressTemplate}
              claimHref={claimHref}
              claimLabel={claimLabel}
            />
          )}
        </div>
      </div>
      <details className="mk-assumptions" open={!compact}>
        <summary>Assumptions (version {model.version})</summary>
        <ul>
          <li>
            Story reach for your tier: {pct(tier.reachLowPct)}–
            {pct(tier.reachHighPct)} of followers
            {estimate.engagementFactor !== 1 &&
              `, scaled ×${estimate.engagementFactor.toFixed(2)} by your engagement against the ${pct(model.engagementBenchmarkPct)} average`}
            .
          </li>
          <li>
            Link-sticker click-through: {pct(model.linkClickLowPct)}–
            {pct(model.linkClickHighPct)} of viewers (creator reports; no
            industry benchmark exists).
          </li>
          <li>
            Visit to paid subscriber: {pct(model.purchaseLowPct)}–
            {pct(model.purchaseHighPct)} (e-commerce benchmarks).
          </li>
          <li>Cancellations and refunds are not modelled.</li>
        </ul>
        <p className="fine-print">
          Estimates apply published averages to your inputs. They are not a
          prediction or promise of results; your content, audience, offer and
          price change the real number.{" "}
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
}: {
  template: string;
  claimHref?: string;
  claimLabel?: string;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const slug = slugFromName(name);
  const address = template.replace("{slug}", slug || "your-name");
  const href =
    slug && claimHref === "/signup"
      ? "/signup?slug=" + encodeURIComponent(slug)
      : claimHref;
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
