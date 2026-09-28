// Server-rendered product showcase for the marketing site: the complete
// capability inventory, the tool categories it replaces, illustrative
// renders of real screens (sample data, labelled as such) and the
// "everything included" strip on /features. Counts come from the registry.
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  Pause,
  UserRound,
} from "lucide-react";
import {
  CAPABILITY_COUNT,
  FEATURE_MATRIX,
  REPLACES,
  type AvailabilityKey,
  type Capability,
} from "@trainer/contracts";
import {
  aedWhole as aed,
  estimateEarnings,
} from "../../../../packages/domain/src/marketing-calculators";
import type { PublicPlatform } from "./platform";

/** "Available soon" while a provider it needs is off; otherwise its offering. */
export function capabilityChip(
  item: Capability,
  availability: Record<AvailabilityKey, boolean>,
) {
  const soon = (item.availability ?? []).some((key) => !availability[key]);
  return soon
    ? { label: "Available soon", tone: "amber" }
    : { label: item.offering ?? "Included", tone: item.offering ? "" : "green" };
}

export function FeatureMatrix({
  platform,
  t,
}: {
  platform: PublicPlatform;
  t: (s: string) => string;
}) {
  return (
    <section className="mk-section" id="all-capabilities" aria-labelledby="all-capabilities-h">
      <h2 id="all-capabilities-h">All {CAPABILITY_COUNT} capabilities</h2>
      <p className="mk-body">
        One workspace runs the whole coaching business, in{" "}
        {FEATURE_MATRIX.length} areas. “Available soon” marks items waiting for
        an outside provider; everything else is in every workspace.
      </p>
      <nav className="mk-matrix-index" aria-label="Capability areas">
        {FEATURE_MATRIX.map((group) => (
          <a key={group.id} href={"#cap-" + group.id}>
            {t(group.title)} <span className="muted">({group.items.length})</span>
          </a>
        ))}
      </nav>
      <div className="mk-matrix">
        {FEATURE_MATRIX.map((group) => (
          <section
            key={group.id}
            id={"cap-" + group.id}
            className="mk-matrix-group"
            aria-labelledby={"cap-" + group.id + "-h"}
          >
            <header>
              <h3 id={"cap-" + group.id + "-h"}>{t(group.title)}</h3>
              <span className="small-label">{group.audience}</span>
            </header>
            <ul>
              {group.items.map((item) => {
                const chip = capabilityChip(item, platform.availability);
                return (
                  <li key={item.name}>
                    <div>
                      <strong>{t(item.name)}</strong>
                      <span className="muted">{t(item.detail)}</span>
                    </div>
                    <span className={"badge " + chip.tone}>{chip.label}</span>
                  </li>
                );
              })}
            </ul>
            {group.page && (
              <Link className="text-link" href={group.page}>
                More about {t(group.title).toLowerCase()}{" "}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

export function Replaces({ t }: { t: (s: string) => string }) {
  return (
    <section className="mk-section" id="replaces" aria-labelledby="replaces-h">
      <h2 id="replaces-h">The {REPLACES.length} tools it replaces</h2>
      <p className="mk-body">
        Many trainers stitch a business together from separate subscriptions.
        Here is what each one becomes inside {t("{APP_NAME}")}.
      </p>
      <div className="mk-table-wrap">
        <table className="mk-table">
          <caption>Tool categories and what replaces them</caption>
          <thead>
            <tr>
              <th scope="col">Instead of</th>
              <th scope="col">In {t("{APP_NAME}")}</th>
            </tr>
          </thead>
          <tbody>
            {REPLACES.map((r) => (
              <tr key={r.tool}>
                <td>{r.tool}</td>
                <td>{t(r.instead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The four illustrative screens (sample data; the layout of real screens). */
export function ProductScreens({ t }: { t: (s: string) => string }) {
  const e = estimateEarnings({
    subscribers: 150,
    billing: "monthly",
    workoutPriceAed: 199,
    programmeMonths: 1,
    nutritionSharePct: 0,
    nutritionPriceAed: 0,
    voiceSharePct: 0,
    voicePriceAed: 0,
    sessionsPerMonth: 0,
    sessionPriceAed: 0,
    yourSessionRateAed: 250,
  });
  return (
    <section className="mk-section" id="screens" aria-labelledby="screens-h">
      <h2 id="screens-h">Inside the product</h2>
      <p className="mk-body">
        Four screens, drawn with sample data: your review queue, your
        subscriber’s day, the workout logger and your statement.
      </p>
      <div className="mk-screens">
        <figure className="mk-screen">
          <div className="mk-device" aria-hidden="true">
            <p className="mk-screen-title">Exceptions</p>
            <div className="mk-queue-item">
              <span className="badge amber">
                <UserRound size={12} /> Below your threshold
              </span>
              <strong>Hotel gym for two weeks</strong>
              <span>Draft plan with dumbbells to 20 kg. Approve or correct.</span>
              <span className="mk-fake-buttons">
                <span className="mk-fake-button">Approve</span>
                <span className="mk-fake-button ghost">Correct</span>
              </span>
            </div>
            <div className="mk-queue-item">
              <span className="badge red">
                <Pause size={12} /> Safety hold
              </span>
              <strong>“My knee hurts when I squat”</strong>
              <span>Workout paused. Training resumes when you decide.</span>
            </div>
            <div className="mk-queue-item done">
              <span className="badge green">
                <CheckCircle size={12} /> Applied automatically
              </span>
              <strong>Squat 60 → 62.5 kg</strong>
              <span>Your rule: two easy sessions at 3+ reps in reserve.</span>
            </div>
          </div>
          <figcaption>
            <strong>Your review queue.</strong> Confident changes are applied
            and logged; drafts below your threshold and safety holds come to you.
          </figcaption>
        </figure>
        <figure className="mk-screen">
          <div className="mk-device" aria-hidden="true">
            <p className="mk-screen-title">Today</p>
            <p className="mk-screen-sub">Week 3 · Day 2 · Lower body A</p>
            <ul className="mk-plan">
              <li>
                <strong>Back squat</strong>
                <span>4 × 6 · 62.5 kg · 120s rest</span>
              </li>
              <li>
                <strong>Romanian deadlift</strong>
                <span>3 × 8 · 50 kg · 90s rest</span>
              </li>
              <li>
                <strong>Walking lunge</strong>
                <span>3 × 10 each side · 60s rest</span>
              </li>
              <li>
                <strong>Plank</strong>
                <span>3 × 40s · 45s rest</span>
              </li>
            </ul>
            <span className="mk-fake-button wide">Start guided session</span>
            <p className="mk-screen-note">
              <Check size={12} /> Squat increased: two easy sessions in a row.
            </p>
          </div>
          <figcaption>
            <strong>Your subscriber’s day.</strong> A dated plan in your method,
            with the reason for every change in plain language.
          </figcaption>
        </figure>
        <figure className="mk-screen">
          <div className="mk-device" aria-hidden="true">
            <p className="mk-screen-title">Back squat · set 3 of 4</p>
            <table className="mk-sets">
              <tbody>
                <tr>
                  <td>1</td>
                  <td>62.5 kg</td>
                  <td>6 reps</td>
                  <td>RIR 3</td>
                  <td>
                    <Check size={12} />
                  </td>
                </tr>
                <tr>
                  <td>2</td>
                  <td>62.5 kg</td>
                  <td>6 reps</td>
                  <td>RIR 3</td>
                  <td>
                    <Check size={12} />
                  </td>
                </tr>
                <tr className="current">
                  <td>3</td>
                  <td>62.5 kg</td>
                  <td>— reps</td>
                  <td>RIR —</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <div className="mk-timer">
              <Clock size={16} />
              <strong>1:24</strong>
              <span>rest remaining</span>
            </div>
            <span className="mk-fake-button danger">
              <AlertCircle size={12} /> Report pain
            </span>
            <p className="mk-screen-note">Saved offline · syncs when you reconnect</p>
          </div>
          <figcaption>
            <strong>The workout logger.</strong> Reps, load and effort per set,
            a rest timer, offline saving, and pain reporting in one tap.
          </figcaption>
        </figure>
        <figure className="mk-screen">
          <div className="mk-device" aria-hidden="true">
            <p className="mk-screen-title">Monthly statement</p>
            <p className="mk-screen-sub">150 subscribers at AED 199</p>
            <dl className="mk-statement">
              <div>
                <dt>Gross subscriptions</dt>
                <dd>{aed(e.subscriptionMonthlyMinor)}</dd>
              </div>
              <div>
                <dt>Commission 25% · subscribers 1–100</dt>
                <dd>−{aed(e.bands[0].commissionMinor)}</dd>
              </div>
              <div>
                <dt>Commission 20% · subscribers 101–150</dt>
                <dd>−{aed(e.bands[1].commissionMinor)}</dd>
              </div>
              <div>
                <dt>Payment processing</dt>
                <dd>itemised</dd>
              </div>
              <div>
                <dt>AI usage at cost</dt>
                <dd>itemised</dd>
              </div>
              <div className="total">
                <dt>Before processing and AI usage</dt>
                <dd>{aed(e.beforeOtherCostsMinor)}</dd>
              </div>
            </dl>
            <p className="mk-screen-note">Paid monthly to your UAE IBAN</p>
          </div>
          <figcaption>
            <strong>Your statement.</strong> Gross to net with commission by
            band; the amounts are the same arithmetic as the pricing example.
          </figcaption>
        </figure>
      </div>
      <p className="fine-print muted">
        Illustrations with sample data, not a live account; your screens show
        your own brand, subscribers and figures.
      </p>
    </section>
  );
}

/**
 * /features: two figures about the product itself, counted from the
 * registry, as a paper strip with ink figures. Each jumps to its section
 * lower on the page. Counts of marketing pages (guides, specialties) are
 * not product value and are not shown.
 */
export function IncludedStrip({ t }: { t: (s: string) => string }) {
  const stats: Array<[number, string, string]> = [
    [CAPABILITY_COUNT, "capabilities in one workspace", "/features#all-capabilities"],
    [REPLACES.length, "separate tools it replaces", "/features#replaces"],
  ];
  return (
    <section className="mk-section mk-included-strip" aria-labelledby="included-h">
      <h2 id="included-h">{t("Everything included in {APP_NAME}")}</h2>
      <ul className="mk-included">
        {stats.map(([n, label, href]) => (
          <li key={label}>
            <Link href={href}>
              <strong>{n}</strong>
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
