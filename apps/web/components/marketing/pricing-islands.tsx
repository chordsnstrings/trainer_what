"use client";
// The two calculators on /pricing (pages/pricing.tsx): concept B's blended
// share slider and its take-home tile (docs/marketing-revamp-2026-10-26/
// phase1/PLAN.md WP6). Every figure is the ledger's own arithmetic,
// estimateEarnings in packages/domain with the compact calculator's rule:
// one monthly price, no nutrition, voice or sessions. The page passes the
// limits and the starting values, so the server-rendered numbers are the
// ones the page shows before any input. Readouts sit in fixed-width slots
// with tabular numerals (app/marketing-pricing.css), so a changing value
// never moves the layout, and each calculator has one polite live region
// that reads the result once input pauses.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_EARNINGS_INPUTS,
  aedWhole as aed,
  estimateEarnings,
  type EarningsBand,
} from "../../../../packages/domain/src/marketing-calculators";
import { MOTION, useSettle, type SettleTarget } from "./motion";

const whole = (n: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n);
/** Our share to one decimal ("21.7%"), from the estimate's own percentage. */
export const sharePct = (pct: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 }).format(pct) + "%";

/** The compact calculator's rule: one monthly price, no nutrition, voice or sessions. */
export const takeHome = (subscribers: number, priceAed: number, sessionRateAed = 0) =>
  estimateEarnings({
    ...DEFAULT_EARNINGS_INPUTS,
    subscribers,
    billing: "monthly",
    workoutPriceAed: priceAed,
    nutritionSharePct: 0,
    voiceSharePct: 0,
    sessionsPerMonth: 0,
    yourSessionRateAed: sessionRateAed,
  });

/** How full each band is at `n` subscribers; the open last band fills up to `max`. */
export function bandFills(bands: EarningsBand[], n: number, max: number): number[] {
  return bands.map((band) => {
    const size = (band.to ?? max) - band.from + 1;
    return Math.min(1, Math.max(0, (n - band.from + 1) / size));
  });
}

/** A changed readout settles once input pauses, as the other calculators' do. */
const SETTLE: SettleTarget[] = [
  {
    selector: ".mk-pr-out",
    duration: MOTION.fast,
    keyframes: [
      { opacity: 0.55, translate: "0 4px" },
      { opacity: 1, translate: "0 0" },
    ],
  },
];

/**
 * The live region's text: `say` replaces it 500ms after the last call, so
 * a screen reader hears the result once, not every step of a drag. Empty
 * until the visitor changes something.
 */
function useLiveText() {
  const [said, setSaid] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = (text: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaid(text), 500);
  };
  return [said, say] as const;
}

function Range({
  label,
  value,
  min,
  max,
  shown,
  valueText,
  ends,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** The value as the label row shows it ("AED 199"). */
  shown: string;
  valueText: string;
  /** The labels under either end of the track, if any. */
  ends?: [string, string];
  onChange: (value: number) => void;
}) {
  const id = useId();
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="mk-pr-range">
      <div className="mk-pr-range-top">
        <label htmlFor={id}>{label}</label>
        {/* The slider announces its own value (aria-valuetext). */}
        <span className="mk-pr-figure mk-pr-out" aria-hidden="true">
          {shown}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--pr-fill": fill + "%" } as CSSProperties}
      />
      {ends && (
        <div className="mk-pr-ends" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The four bands as a meter, each with its share and its subscribers.
 * Decorative: the readouts and the live region carry the numbers.
 */
function BandMeter({ bands, n, max }: { bands: EarningsBand[]; n: number; max: number }) {
  const fills = bandFills(bands, n, max);
  return (
    <ol className="mk-pr-meter" aria-hidden="true">
      {bands.map((band, i) => (
        <li key={band.from}>
          <span className="mk-pr-meter-track">
            <span style={{ "--pr-fill": fills[i] } as CSSProperties} />
          </span>
          <b>{band.ratePct}%</b>
          <span>
            {band.to === null ? `${whole(band.from)}+` : `${whole(band.from)}–${whole(band.to)}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * How our share falls: a subscriber count from 1 to `max`, jumps to a few
 * counts, and the share overall on an axis from the first band's rate to
 * the last. The share is the same at any whole-dirham price (each band's
 * rate of it is exact), so one price stands for all.
 */
export function ShareSlider({
  priceAed,
  max,
  initial,
  jumps,
}: {
  priceAed: number;
  max: number;
  initial: number;
  jumps: number[];
}) {
  const [n, setN] = useState(initial);
  const [said, say] = useLiveText();
  const share = (count: number) => takeHome(count, priceAed).effectiveCommissionPct;
  const e = takeHome(n, priceAed);
  const first = e.bands[0].ratePct,
    last = e.bands.at(-1)!.ratePct;
  const position = Math.min(100, Math.max(0, ((first - e.effectiveCommissionPct) / (first - last)) * 100));
  const set = (count: number) => {
    setN(count);
    say(`${whole(count)} paying subscribers: our share is ${sharePct(share(count))} overall.`);
  };
  const root = useRef<HTMLDivElement>(null);
  useSettle(root, SETTLE, 150);
  return (
    <div className="mk-pr-calc" ref={root}>
      <Range
        label="Paying subscribers"
        value={n}
        min={1}
        max={max}
        shown={whole(n)}
        valueText={`${whole(n)} subscribers`}
        ends={["1", whole(max)]}
        onChange={set}
      />
      <div className="mk-pr-jumps" role="group" aria-label="Jump to a subscriber count">
        {jumps.map((count) => (
          <button key={count} type="button" onClick={() => set(count)}>
            {whole(count)}
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> subscribers: </span>
            {sharePct(share(count))}
          </button>
        ))}
      </div>
      <p className="mk-pr-read">
        Our share overall<span className="sr-only">: {sharePct(e.effectiveCommissionPct)}</span>
      </p>
      <div className="mk-pr-axis" aria-hidden="true" style={{ "--pr-pos": position } as CSSProperties}>
        <span className="mk-pr-axis-line" />
        <span className="mk-pr-marker">
          <b>
            <span className="mk-pr-out">{sharePct(e.effectiveCommissionPct)}</span>
          </b>
          <i />
        </span>
      </div>
      <div className="mk-pr-ends" aria-hidden="true">
        <span>{first}%</span>
        <span>{last}%</span>
      </div>
      <BandMeter bands={e.bands} n={n} max={max} />
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/**
 * What you keep: your monthly price (from the membership minimum) and your
 * paying subscribers in; subscriptions, our share and what you keep before
 * card processing and other costs out, with the same amount in sessions at
 * your usual rate.
 */
export function TakeHome({
  minPriceAed,
  maxPriceAed,
  initialPrice,
  initialSubscribers,
  maxSubscribers,
  sessionRateAed,
}: {
  minPriceAed: number;
  maxPriceAed: number;
  initialPrice: number;
  initialSubscribers: number;
  maxSubscribers: number;
  sessionRateAed: number;
}) {
  const [price, setPrice] = useState(initialPrice);
  const [n, setN] = useState(initialSubscribers);
  const [said, say] = useLiveText();
  const e = takeHome(n, price, sessionRateAed);
  const update = (count: number, priceAed: number) => {
    setN(count);
    setPrice(priceAed);
    const r = takeHome(count, priceAed, sessionRateAed);
    say(
      `You keep ${aed(r.beforeOtherCostsMinor)} a month before card processing and other costs, from ${whole(count)} subscribers at AED ${whole(priceAed)}. Our share is ${sharePct(r.effectiveCommissionPct)} overall.`,
    );
  };
  const root = useRef<HTMLDivElement>(null);
  useSettle(root, SETTLE, 150);
  return (
    <div className="mk-pr-calc" ref={root}>
      <div className="mk-pr-inputs">
        <Range
          label="Your price a month"
          value={price}
          min={minPriceAed}
          max={maxPriceAed}
          shown={"AED " + whole(price)}
          valueText={`AED ${whole(price)} a month`}
          onChange={(value) => update(n, value)}
        />
        <Range
          label="Paying subscribers"
          value={n}
          min={1}
          max={maxSubscribers}
          shown={whole(n)}
          valueText={`${whole(n)} subscribers`}
          onChange={(value) => update(value, price)}
        />
      </div>
      <dl className="mk-pr-rows">
        <div>
          <dt>Subscriptions a month</dt>
          <dd className="mk-pr-out">{aed(e.subscriptionMonthlyMinor)}</dd>
        </div>
        <div>
          <dt>
            Our share, <span className="mk-pr-slot mk-pr-out">{sharePct(e.effectiveCommissionPct)}</span> overall
          </dt>
          <dd className="mk-pr-out">−{aed(e.commissionMinor)}</dd>
        </div>
      </dl>
      <div className="mk-pr-keep">
        <p>
          <span>You keep</span>
          <span>before card processing and other costs</span>
        </p>
        <p className="mk-pr-keep-figure mk-pr-out">{aed(e.beforeOtherCostsMinor)}</p>
      </div>
      <BandMeter bands={e.bands} n={n} max={maxSubscribers} />
      {e.equivalentSessions !== null && (
        <p className="mk-pr-fine">
          About <span className="mk-pr-slot mk-pr-out">{whole(e.equivalentSessions)}</span> sessions at AED{" "}
          {whole(sessionRateAed)}, every month.
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
