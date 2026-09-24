"use client";
import Link from "next/link";
import { useState } from "react";
import { money, projectedCommission } from "@trainer/domain";
const examples = [
  {
    label: "A beginner asks for more",
    request: "I finished the first week. Can we make everything harder?",
    rule: "Progression follows evidence from completed sessions, with trainer review for material changes.",
    response:
      "The digital coach gathers your logged sessions and prepares a proposed progression for your trainer to review.",
    outcome: "Proposal awaits review",
  },
  {
    label: "A session was missed",
    request: "I missed yesterday. Should I do two sessions today?",
    rule: "Schedule changes respect the current program and the subscriber’s actual availability.",
    response:
      "The digital coach flags a schedule adjustment. Your trainer reviews the plan before an updated session is assigned.",
    outcome: "Schedule review",
  },
  {
    label: "New pain is reported",
    request: "This movement is causing new pain.",
    rule: "Safety takes precedence over progression, tone and completion targets.",
    response:
      "The workout pauses and the trainer receives a safety exception. Normal completion stays blocked until reviewed.",
    outcome: "Workout paused",
  },
];
export function MarketingPage({ path }: { path: string }) {
  const [example, setExample] = useState(0),
    [count, setCount] = useState(100),
    [price, setPrice] = useState(200);
  const gross = count * price * 100,
    fee = projectedCommission(count, price * 100);
  const current = examples[example];
  const heading =
    path === "/how-it-works"
      ? "Your method. A clearer coaching system."
      : path === "/demo"
        ? "See a coaching decision take shape."
        : path === "/pricing"
          ? "Know where every dirham goes."
          : "Clear answers before you begin.";
  return (
    <main className="public-section marketing-page">
      <p className="eyebrow">TRAINER BRAIN</p>
      <h1>{heading}</h1>
      {path === "/how-it-works" ? (
        <>
          <p className="marketing-intro">
            Bring your coaching knowledge, understand each subscriber’s context,
            and stay in control of what is delivered.
          </p>
          <div className="three-columns">
            {[
              [
                "01 · Trainer Brain",
                "Teach the reasoning behind your coaching. Import your material, answer interview questions, review proposed rules and test held-out scenarios.",
              ],
              [
                "02 · Client Twin",
                "See self-reported goals, logged training and permitted observations with dates, sources and coverage. Missing data remains unknown.",
              ],
              [
                "03 · Coach Runtime",
                "Digital guidance follows the released Brain and current client context. Proposed responses and programs stay in a trainer review queue. Safety holds interrupt normal workouts.",
              ],
            ].map(([title, text]) => (
              <section className="card" key={title}>
                <h2>{title}</h2>
                <p>{text}</p>
              </section>
            ))}
          </div>
          <section className="card">
            <h2>Control stays visible.</h2>
            <p>
              You can correct rules, inspect their source, roll back a release,
              take over a conversation and author programs directly. Subscriber
              permissions govern data use. Wearable-derived observations remain
              outside AI prompts in this build.
            </p>
            <Link href="/demo" className="button secondary">
              Explore a sample decision
            </Link>
          </section>
        </>
      ) : path === "/demo" ? (
        <>
          <p className="marketing-intro">
            An interactive, fictional example of the review process. These
            examples are scripted; no model or payment provider is called.
          </p>
          <div
            className="demo-options"
            role="group"
            aria-label="Choose a sample coaching request"
          >
            {examples.map((e, i) => (
              <button
                key={e.label}
                className={"button " + (i === example ? "" : "secondary")}
                aria-pressed={i === example}
                onClick={() => setExample(i)}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="two-columns">
            <section className="card">
              <p className="eyebrow">SUBSCRIBER REQUEST</p>
              <h2>{current.request}</h2>
              <h3>Trainer-confirmed rule</h3>
              <p>{current.rule}</p>
            </section>
            <section className="card" aria-live="polite">
              <span className="badge">{current.outcome}</span>
              <h2>The governed response</h2>
              <p>{current.response}</p>
              <p className="muted">
                Your production Brain uses your own confirmed sources and
                evaluated release. This sample does not assess an individual’s
                health or prescribe a workout.
              </p>
            </section>
          </div>
        </>
      ) : path === "/pricing" ? (
        <>
          <p className="marketing-intro">
            Platform commission uses marginal subscriber bands. Processing, AI
            usage and any separately approved services remain visible as their
            own charges.
          </p>
          <div className="two-columns">
            <section className="card">
              <h2>Explore the platform fee</h2>
              <label className="field">
                <span>Paying subscribers: {count}</span>
                <input
                  type="range"
                  min={0}
                  max={2000}
                  step={1}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>Monthly subscription price (AED)</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={price}
                  onChange={(e) =>
                    setPrice(
                      Math.max(
                        1,
                        Math.min(
                          10000,
                          Math.floor(Number(e.target.value) || 1),
                        ),
                      ),
                    )
                  }
                />
              </label>
              <dl className="pricing-totals">
                <div>
                  <dt>Illustrative gross collections</dt>
                  <dd>{money(gross)}</dd>
                </div>
                <div>
                  <dt>Platform commission</dt>
                  <dd>{money(fee)}</dd>
                </div>
                <div>
                  <dt>Before other charges and adjustments</dt>
                  <dd>{money(gross - fee)}</dd>
                </div>
              </dl>
              <p className="muted">
                Assumes one equal-priced subscription per paying subscriber.
                Excludes tax, processor fees, refunds, disputes, reserves, AI
                costs and optional services. This estimate is not a payout
                promise.
              </p>
            </section>
            <section className="card">
              <h2>Marginal commission bands</h2>
              <table>
                <thead>
                  <tr>
                    <th>Paid subscriber positions</th>
                    <th>Rate in that band</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["1–100", "25%"],
                    ["101–300", "20%"],
                    ["301–1,000", "15%"],
                    ["Above 1,000", "10%"],
                  ].map(([band, rate]) => (
                    <tr key={band}>
                      <td>{band}</td>
                      <td>{rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Reaching a new band changes the fee for that band’s subscribers.
                Earlier bands keep their own rate.
              </p>
              <h3>Provider costs are separate</h3>
              <p>
                Recorded AI usage is priced from the configured provider
                schedule. Unknown charges require reconciliation. AED usage
                charges require a reviewed exchange rate and fee schedule.
              </p>
            </section>
          </div>
        </>
      ) : (
        <>
          <p className="marketing-intro">
            What the current platform does, what you control, and which services
            need configuration before launch.
          </p>
          {[
            [
              "Will AI replace my judgment?",
              "You confirm the teaching rules and review generated responses and program changes. You can take over conversations and publish trainer-authored programs.",
            ],
            [
              "Can I start without a trade licence upload?",
              "Yes. Business setup, source material and Brain work can begin while licence collection is deferred. Financial and public-launch requirements are checked separately.",
            ],
            [
              "How does money move?",
              "The selected flow is Stripe collections, settlement into the company bank account, then Lean payouts to reviewed trainer destinations. Bank evidence and reconciliation determine paid status. Provider and account eligibility must be verified before live use.",
            ],
            [
              "Is cancellation the same as a refund?",
              "No. Renewal cancellation and refund requests are separate actions. Eligible refund requests enter the trainer’s review queue, and provider outcomes are reconciled. Final policy terms require operator review before launch.",
            ],
            [
              "What happens when a workout loses connection?",
              "An online-opened workout can be saved for offline reload. Set logs stay on that device and synchronize with stable event identifiers when the connection returns. The page shows when saving or sync is incomplete.",
            ],
            [
              "What can I connect today?",
              "Supported document imports and numeric Apple Health exports are implemented. WHOOP, Zepp, custom domains, synthetic voice and a native companion remain unavailable until their adapters and approvals are complete.",
            ],
            [
              "How are private sources and fitness records handled?",
              "Workspace and subscriber access rules scope stored data. Coaching consent and source permissions are checked. Export and reviewed local-erasure workflows are implemented; provider and backup erasure still require operational review.",
            ],
            [
              "Can I launch immediately?",
              "Launch requires an evaluated Brain release, offer, verified payout setup, reviewed preview and configured legal/payment gates. Production deployment and account-specific provider verification are still required.",
            ],
          ].map(([q, a]) => (
            <details className="card" key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </>
      )}
      <div className="marketing-cta">
        <Link href="/signup" className="button">
          Build my coaching Brain
        </Link>
        <Link href="/faq" className="text-button">
          More questions
        </Link>
      </div>
    </main>
  );
}
