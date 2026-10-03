"use client";
import { promptWorkspace } from "./workspace-feedback";
import { useWorkspaceQuery } from "./workspace-continuity";
import { WorkspaceTabs } from "./workspace-ui";
import { Field } from "./field";
import { MemberAccessCard } from "./complimentary-access";
import { BillingHistory, TrainerFinanceTools } from "./finance-completion";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDate, formatMoney, humanize } from "../lib/format";
import { UpfrontMembership, VoiceAddOnCard } from "./programme-membership";
import { OfferForm, OfferTerms, OfferVoicePrice } from "./programme-offers";
import { useState, useEffect } from "react";
import { Download } from "lucide-react";
import { money } from "@trainer/domain";
import {
  LoadMore,
  api,
  Button,
  Empty,
  Badge,
  Card,
  Heading,
  type ViewProps,
} from "./workspace-ui";
import { Workout } from "./workspace-training";
export function Finance({ state, records, action, busy, path, more }: ViewProps) {
  const [promotionCode, setPromotionCode] = useState("");
  const [checkout, setCheckout] = useState<{
    status: string;
    url?: string;
  } | null>(null);
  const sub = state.user.role === "subscriber",
    subscription = state.subscriptions[0],
    membership =
      subscription &&
      !["canceled", "incomplete_expired"].includes(subscription.status)
        ? subscription
        : null;
  const [requested, setOffer] = useWorkspaceQuery("view", path.includes("products") ? "offers" : path.includes("payout") ? "payouts" : "overview");
  const offer = ["overview", "ledger", "offers", "refunds", "payouts"].includes(requested) ? requested : "overview";
  const mt = useT("membership"),
    locale = useLocale();
  return (
    <>
      <Heading
        eyebrow={sub ? mt("eyebrow") : "CLEAR NUMBERS. NO GUESSWORK."}
        title={sub ? mt("title") : "Your coaching, accounted for."}
        detail={
          sub
            ? mt("detail")
            : "Track the ledger from subscriber payments through to your monthly payout."
        }
        action={
          !sub ? (
            <a className="button secondary" href="/api/v1/finance/export">
              <Download size={16} />
              Export ledger
            </a>
          ) : undefined
        }
      />
      {!sub && <WorkspaceTabs label="Finance" items={[["overview", "Overview"], ["ledger", "Transactions"], ["offers", "Plans"], ["refunds", "Refunds"], ["payouts", "Payouts"]]} value={offer} onChange={setOffer} panelId="finance-panel" />}
      {!sub && offer === "payouts" && state.user.role === "owner" && <TrainerFinanceTools />}
      {sub ? (
        <>
          <MemberAccessCard />
          {!membership && (
            <Field label={mt("discountCode")}>
              <input
                value={promotionCode}
                maxLength={40}
                onChange={(e) => setPromotionCode(e.target.value)}
              />
            </Field>
          )}
          <Card>
            <h2>
              {membership ? mt("currentPlan") : mt("choosePlan")}
            </h2>
            {membership?.data?.billing === "upfront" ? (
              <UpfrontMembership
                membership={membership}
                offers={records("product")}
              />
            ) : membership ? (
              <>
                <div className="membership-price">
                  {formatMoney(membership.price_minor, locale)}
                  <span> {mt("perMonth")}</span>
                </div>
                <Badge>
                  {mt.dynamic(
                    `status_${membership.status}`,
                    humanize(membership.status),
                  )}
                </Badge>
                <p>
                  {membership.data?.modules?.includes("nutrition")
                    ? mt("workoutNutrition")
                    : mt("workoutOnly")}
                </p>
                {membership.data?.premiumVoice === true && (
                  <p>{mt("voiceIncluded")}</p>
                )}
                <p className="muted">
                  {mt(
                    membership.cancel_at_period_end
                      ? "accessContinues"
                      : "periodEnds",
                    {
                      date: formatDate(membership.period_end, {
                        locale,
                        fallback: "—",
                      }),
                    },
                  )}
                </p>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        api(
                          `/membership/${membership.cancel_at_period_end ? "reactivate" : "cancel"}`,
                          "POST",
                          {},
                        ),
                      membership.cancel_at_period_end
                        ? mt("renewalReactivated")
                        : mt("renewalStopped"),
                    )
                  }
                >
                  {membership.cancel_at_period_end
                    ? mt("reactivate")
                    : mt("cancelRenewal")}
                </Button>
              </>
            ) : (
              records("product")
                .filter((p) => p.status === "published")
                .map((p) => (
                  <div className="list-row" key={p.id}>
                    <div>
                      <h3>{p.data.name}</h3>
                      <p>{p.data.description}</p>
                      <OfferTerms data={p.data} />
                    </div>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            api("/payments/checkout", "POST", {
                              productId: p.id,
                              promotionCode,
                            }),
                          mt("openingCheckout"),
                        ).then((r) => {
                          if (r?.url) window.location.assign(r.url);
                        })
                      }
                    >
                      {p.data.billing === "upfront"
                        ? mt("buyProgramme")
                        : mt("joinPlan")}
                    </Button>
                  </div>
                ))
            )}
          </Card>
          <VoiceAddOnCard />
          <Card>
            <h2>{mt("checkoutStatus")}</h2>
            <p className="muted">{mt("checkoutText")}</p>
            <Button
              secondary
              disabled={busy}
              onClick={() => {
                setCheckout({ status: "checking" });
                void action(
                  () => api("/payments/checkout/reconcile", "POST", {}),
                  mt("checkoutChecked"),
                ).then((result) =>
                  setCheckout(result ?? { status: "unresolved" }),
                );
              }}
            >
              {checkout?.status === "checking"
                ? mt("checkingCheckout")
                : mt("checkCheckout")}
            </Button>
            {checkout && (
              <p role="status">
                {mt.dynamic(
                  `checkout_${checkout.status}`,
                  mt("checkout_unresolved"),
                )}
              </p>
            )}
            {checkout?.status === "open" && checkout.url && (
              <a className="button secondary" href={checkout.url}>
                {mt("continueCheckout")}
              </a>
            )}
          </Card>
          <BillingHistory />
        </>
      ) : (
        <div id="finance-panel" role="tabpanel" aria-label="Finance">
          {offer === "overview" && <>
          <div className="stats-grid">
            <Card className="stat">
              <span className="small-label">Trainer payable</span>
              <strong>
                <span dir="ltr">{money(state.finance?.earnedMinor ?? 0)}</span>
              </strong>
              <span className="muted">After booked adjustments</span>
            </Card>
            <Card className="stat">
              <span className="small-label">Allocated to payouts</span>
              <strong>
                <span dir="ltr">
                  {money(state.finance?.reservedMinor ?? 0)}
                </span>
              </strong>
              <span className="muted">Held or in progress</span>
            </Card>
            <Card className="stat">
              <span className="small-label">Available to allocate</span>
              <strong>
                <span dir="ltr">
                  {money(state.finance?.availableMinor ?? 0)}
                </span>
              </strong>
              <span className="muted">Funding and eligibility still apply</span>
            </Card>
            <Card className="stat">
              <span className="small-label">Platform commission</span>
              <strong>
                <span dir="ltr">
                  {money(state.finance?.commissionMinor ?? 0)}
                </span>
              </strong>
              <span className="muted">Marginal subscriber bands</span>
            </Card>
          </div>
          {!!state.usageStatements?.length && (
            <Card>
              <h2>AI Coach Service Fee</h2>
              <p className="muted">
                By the month it is for. A month&apos;s fee is posted after the
                month ends: it is on the next month&apos;s statement and is
                deducted from the payout for the month it is for.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">AI Coach Service Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.usageStatements.map((s) => {
                      const adjustments = Number(s.adjustments_minor ?? 0);
                      return (
                        <tr key={s.period}>
                          <td>{monthName(s.period)}</td>
                          <td>
                            <span dir="ltr">
                              {money(Number(s.charge_minor) + adjustments)}
                            </span>
                            {adjustments !== 0 && (
                              <span className="muted">
                                {" "}
                                (including an adjustment of{" "}
                                <span dir="ltr">{money(adjustments)}</span>)
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <LoadMore
                more={more}
                collection="usageStatements"
                label="Load earlier months"
              />
            </Card>
          )}
          </>}
          {offer === "offers" ? (
            <div className="two-columns">
              <Card>
                <h2>A clear offer</h2>
                <OfferForm
                  products={records("product")}
                  busy={busy}
                  action={action}
                />
              </Card>
              <div className="card-stack">
                {records("product").map((p) => (
                  <Card key={p.id}>
                    <Badge>{p.status}</Badge>
                    <h2>{p.data.name}</h2>
                    <p className="small-label">
                      {p.data.tier === "workout_nutrition"
                        ? "Workout + nutrition"
                        : "Workout only"}
                    </p>
                    <OfferTerms data={p.data} />
                    <p>{p.data.description}</p>
                    <OfferVoicePrice product={p} busy={busy} action={action} />
                    {p.status !== "published" && (
                      <Button
                        secondary
                        onClick={() =>
                          void action(
                            () => api(`/products/${p.id}/activate`, "POST", {}),
                            "Offer activated",
                          )
                        }
                      >
                        Activate with Stripe
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ) : offer === "refunds" ? (
            <Card>
              <h2>Refund requests</h2>
              {records("refund").length ? (
                records("refund").map((r) => (
                  <div className="refund-item" key={r.id}>
                    <Badge>{r.status}</Badge>
                    <h3>{money(r.data.amountMinor)}</h3>
                    <p>{r.data.reason}</p>
                    {["submitting", "submitted", "unknown"].includes(
                      r.status,
                    ) && (
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () =>
                              api(
                                "/refund-requests/" + r.id + "/reconcile",
                                "POST",
                                {},
                              ),
                            "Provider status reconciled",
                          )
                        }
                      >
                        Reconcile provider status
                      </Button>
                    )}
                    {r.status === "requested" && (
                      <div className="button-row">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                api(
                                  `/refund-requests/${r.id}/decision`,
                                  "POST",
                                  {
                                    approve: true,
                                    reason: "Approved by trainer",
                                  },
                                ),
                              "Refund approved",
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          secondary
                          disabled={busy}
                          onClick={async () => {
                            const reason = (await promptWorkspace("Reason for declining"));
                            if (reason)
                              void action(
                                () =>
                                  api(
                                    `/refund-requests/${r.id}/decision`,
                                    "POST",
                                    { approve: false, reason },
                                  ),
                                "Decision recorded",
                              );
                          }}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  title="No refund requests"
                  detail="Eligible subscriber requests will appear here for your decision."
                />
              )}
              <LoadMore
                more={more}
                collection="records"
                kind="refund"
                label="Load older refund requests"
              />
            </Card>
          ) : offer === "payouts" ? (
            <PayoutView
              state={state}
              records={records}
              action={action}
              busy={busy}
              path={path}
              more={more}
            />
          ) : offer === "ledger" ? (
            <Card>
              <div className="card-heading">
                <h2>Financial activity</h2>
                <Badge>Immutable ledger</Badge>
              </div>
              {state.journals?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Description</th>
                        <th scope="col">Gross</th>
                        <th scope="col">Commission</th>
                        <th scope="col">Deducted from your earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.journals.map((j) => {
                        // The AI Coach Service Fee (and its adjustments),
                        // Stripe's fee at settlement and other charges: what
                        // the entry takes from the trainer's earnings.
                        const key = String(j.source_key ?? "");
                        const fee =
                          key.startsWith("usage:") ||
                          key.startsWith("usage-adjustment:");
                        const deducted =
                          fee || key.startsWith("allocated-cost:")
                            ? (j.data?.amountMinor ?? null)
                            : key.startsWith("stripe-settlement:")
                              ? (j.data?.feeMinor ?? null)
                              : null;
                        return (
                          <tr key={j.id}>
                            <td>{new Date(j.created_at).toLocaleDateString()}</td>
                            <td>
                              {j.description}
                              {fee && j.data?.period
                                ? ` for ${monthName(j.data.period)}`
                                : ""}
                            </td>
                            <td>
                              <span dir="ltr">
                                {j.data.grossMinor
                                  ? money(j.data.grossMinor)
                                  : "—"}
                              </span>
                            </td>
                            <td>
                              <span dir="ltr">
                                {j.data.commissionMinor
                                  ? money(j.data.commissionMinor)
                                  : "—"}
                              </span>
                            </td>
                            <td>
                              <span dir="ltr">
                                {deducted === null ? "—" : money(Number(deducted))}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <LoadMore
                    more={more}
                    collection="journals"
                    label="Load earlier ledger entries"
                  />
                </div>
              ) : (
                <Empty
                  title="Every amount will have a source"
                  detail="Verified payment activity creates your ledger. No earnings are estimated into this balance."
                />
              )}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
/**
 * Stripe's fees and the AI Coach Service Fee deducted from the trainer's
 * earnings in each Dubai month (owner decision, 28 September 2026: Stripe
 * fees are paid by the trainer and shown plainly with each payout).
 */
export function usePayoutDeductions() {
  const [data, setData] = useState<{
    months: Record<string, any>;
    fees: Record<string, any>;
  }>({ months: {}, fees: {} });
  useEffect(() => {
    let live = true;
    void fetch("/api/v1/finance/deductions", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { months: [] }))
      .then((d) => {
        if (live)
          setData({
            months: Object.fromEntries(
              (d.months ?? []).map((m: any) => [m.month, m]),
            ),
            // A month's AI Coach Service Fee, by the month it is for.
            fees: Object.fromEntries(
              (d.aiCoachServiceFees ?? []).map((f: any) => [f.period, f]),
            ),
          });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return data;
}
/** "July 2026" for a YYYY-MM month. */
export function monthName(period: string) {
  return new Date(period + "-15T00:00:00Z").toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function PayoutView({ state, records, action, busy, more }: ViewProps) {
  const deductions = usePayoutDeductions();
  return (
    <div className="two-columns">
      <Card>
        <h2>Your payout destination</h2>
        {records("beneficiary").map((b) => (
          <div className="list-row" key={b.id}>
            <div>
              <strong>{b.data.name}</strong>
              <p>
                <span dir="ltr">{b.data.maskedIban}</span>
              </p>
            </div>
            <Badge>{b.status}</Badge>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            void action(
              () => api("/payout-beneficiaries", "POST", Object.fromEntries(f)),
              "Bank destination submitted for verification",
            ).then((r) => {
              if (r) form.reset();
            });
          }}
        >
          {[
            ["name", "Account holder"],
            ["iban", "UAE IBAN"],
            ["address", "Address"],
            ["city", "City"],
          ].map(([name, label]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                required
                autoComplete="off"
                dir={name === "iban" ? "ltr" : undefined}
              />
            </Field>
          ))}
          <p className="muted">
            Lean verifies the destination before it can receive a monthly
            payment.
          </p>
          <Button type="submit" disabled={busy}>
            Submit destination
          </Button>
        </form>
      </Card>
      <Card>
        <h2>Monthly payouts</h2>
        <form
          className="button-row"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api("/payout-runs/prepare", "POST", {
                  period: new FormData(e.currentTarget).get("period"),
                }),
              "Payout dry run prepared",
            );
          }}
        >
          <input
            type="month"
            name="period"
            aria-label="Payout period"
            required
            defaultValue={new Date().toISOString().slice(0, 7)}
          />
          <Button type="submit" secondary disabled={busy}>
            Prepare dry run
          </Button>
        </form>
        {state.payouts?.length ? (
          state.payouts.map((p) => (
            <div className="list-row" key={p.id}>
              <div>
                <strong>{money(p.amount_minor)}</strong>
                <p>{p.period}</p>
                {(deductions.months[p.period] || deductions.fees[p.period]) && (
                  <p className="muted">
                    {deductions.fees[p.period] && (
                      <>
                        AI Coach Service Fee for {monthName(p.period)}{" "}
                        <span dir="ltr">
                          {money(deductions.fees[p.period].feeMinor)}
                        </span>
                        {deductions.fees[p.period].adjustmentsMinor !== 0 && (
                          <>
                            {" "}
                            (adjusted later by{" "}
                            <span dir="ltr">
                              {money(deductions.fees[p.period].adjustmentsMinor)}
                            </span>
                            )
                          </>
                        )}
                        {deductions.months[p.period] && " · "}
                      </>
                    )}
                    {deductions.months[p.period] && (
                      <>
                        Stripe fees (paid by you) settled in{" "}
                        {monthName(p.period)}{" "}
                        <span dir="ltr">
                          {money(deductions.months[p.period].stripeFeesMinor)}
                        </span>
                        {deductions.months[p.period].otherChargesMinor > 0 && (
                          <>
                            {" "}
                            · Other charges in {monthName(p.period)}{" "}
                            <span dir="ltr">
                              {money(deductions.months[p.period].otherChargesMinor)}
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </p>
                )}
              </div>
              <Badge>{p.status}</Badge>
            </div>
          ))
        ) : (
          <Empty
            title="Payments, with a clear trail"
            detail="Monthly statements and confirmed bank outcomes will appear here."
          />
        )}
        <LoadMore
          more={more}
          collection="payouts"
          label="Load earlier payouts"
        />
      </Card>
    </div>
  );
}
