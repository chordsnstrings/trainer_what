"use client";
import {
  FinancePolicyConsole,
  FinanceAutomationConsole,
} from "./finance-completion";
import { PrivacyOperations } from "./privacy-operations";
import { FinanceOperations } from "./finance-operations";
import { PlatformCostControls } from "./platform-costs";
import { GovernanceLinks } from "./governance-shared";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Settings, Shield, Link2 } from "lucide-react";
import { money } from "@trainer/domain";
import {
  type More,
  LoadMore,
  api,
  Empty,
  Badge,
  Card,
  Heading,
  type ViewProps,
  total,
} from "./workspace-ui";
import { Workout } from "./workspace-training";
import { Exceptions } from "./workspace-messages";
export function Analytics({ state, records, more }: ViewProps) {
  const completed = total(
      state,
      "completedWorkouts",
      records("workout").filter((w) => w.status === "completed").length,
    ),
    count = total(state, "sets", state.sets.length),
    volume = total(
      state,
      "setVolumeKg",
      state.sets.reduce((sum, s) => sum + s.data.reps * s.data.loadKg, 0),
    );
  return (
    <>
      <Heading
        eyebrow="PROGRESS WITH EVIDENCE"
        title="See what is actually changing."
        detail="These numbers come from recorded activity. More useful history arrives with each real session."
      />
      <div className="stats-grid">
        <Card className="stat">
          <span className="small-label">Completed workouts</span>
          <strong>{completed}</strong>
        </Card>
        <Card className="stat">
          <span className="small-label">Recorded sets</span>
          <strong>{count}</strong>
        </Card>
        <Card className="stat">
          <span className="small-label">Recorded volume</span>
          <strong>
            {volume.toLocaleString()}
            <small> kg</small>
          </strong>
        </Card>
        <Card className="stat">
          <span className="small-label">Active subscriptions</span>
          <strong>
            {total(
              state,
              "activeSubscriptions",
              state.subscriptions.filter((s) => s.status === "active").length,
            )}
          </strong>
        </Card>
      </div>
      <Card>
        <h2>Workout history</h2>
        {records("workout").length ? (
          records("workout").map((w) => (
            <div className="list-row" key={w.id}>
              <div>
                <strong>{w.data.program?.title ?? "Workout"}</strong>
                <p className="muted">
                  {new Date(w.created_at).toLocaleString()}
                </p>
              </div>
              <Badge>{w.status.replaceAll("_", " ")}</Badge>
            </div>
          ))
        ) : (
          <Empty
            title="A baseline starts with the first session"
            detail="Log workouts consistently to build a useful picture of progress."
          />
        )}
        <LoadMore
          more={more}
          collection="records"
          kind="workout"
          label="Load older workouts"
        />
      </Card>

    </>
  );
}
export function AdminNotFound() {
  return (
    <Card>
      <h1>Choose an operations screen</h1>
      <p className="muted">
        This address does not identify a platform operations screen.
      </p>
      <Link className="text-link" href="/admin">
        Open platform operations
      </Link>
    </Card>
  );
}
export function Admin({ state, finance = false }: ViewProps & { finance?: boolean }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loadingMore, setLoadingMore] = useState(false);
  const financeRole = ["admin", "finance"].includes(state.user.platformRole);
  useEffect(() => {
    api("/admin/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  // Workspaces arrive a page at a time; each page is inspected (and audited)
  // only when an operator asks for it.
  async function loadMoreWorkspaces() {
    if (!data?.cursor) return;
    setLoadingMore(true);
    try {
      const next = await api(
        `/admin/overview?cursor=${encodeURIComponent(data.cursor)}`,
      );
      setData((current: any) => ({
        ...next,
        tenants: [
          ...current.tenants,
          ...next.tenants.filter(
            (t: any) => !current.tenants.some((c: any) => c.id === t.id),
          ),
        ],
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  const moreWorkspaces = data?.hasMore ? (
    <div className="button-row load-more">
      <button
        type="button"
        className="button secondary"
        disabled={loadingMore}
        onClick={() => void loadMoreWorkspaces()}
      >
        {loadingMore ? "Loading…" : "Load more workspaces"}
      </button>
    </div>
  ) : null;
  const openCount = (t: any) => t.openExceptions ?? t.exceptions.length;
  if (finance)
    return (
      <>
        <Heading
          eyebrow="PLATFORM FINANCE"
          title="Payments and payouts."
          detail="Charges, refunds, trainer balances, payouts and reconciliation. Every workspace inspection is audited."
        />
        {!financeRole ? (
          <div className="notice error" role="alert">
            Platform finance access is required for this screen.
          </div>
        ) : error ? (
          <div className="notice error">{error}</div>
        ) : data ? (
          <>
            <PlatformCostControls />
            <FinancePolicyConsole tenants={data.tenants} />
            <FinanceAutomationConsole tenants={data.tenants} />
            <FinanceOperations tenants={data.tenants} />
            {moreWorkspaces}
          </>
        ) : (
          <p>Loading platform finance…</p>
        )}
      </>
    );
  return (
    <>
      <Heading
        eyebrow="PLATFORM OPERATIONS"
        title="An accountable view of the platform."
        detail="Financial totals, open exceptions and provider readiness. Every workspace inspection is audited."
      />
      {state.user.platformRole === "admin" && (
        <nav className="ps-admin-links" aria-label="Superadmin tools">
          <Link href="/admin/settings">
            <Settings size={15} />
            Settings & API connections
          </Link>
          <Link href="/admin/account-security">
            <Shield size={15} />
            Account security
          </Link>
          <Link href="/admin/integration-operations">
            <Link2 size={15} />
            Voice & domain operations
          </Link>
        </nav>
      )}
      <GovernanceLinks platformRole={state.user.platformRole} />
      {error && <div className="notice error">{error}</div>}
      {data ? (
        <>
          {["admin", "finance"].includes(state.user.platformRole) && (
            <FinanceOperations tenants={data.tenants} />
          )}
          {state.user.platformRole === "admin" && (
            <PrivacyOperations tenants={data.tenants} />
          )}
          <div className="stats-grid">
            <Card className="stat">
              <span className="small-label">Trainer workspaces</span>
              <strong>{data.totals?.workspaces ?? data.tenants.length}</strong>
            </Card>
            <Card className="stat">
              <span className="small-label">Published</span>
              <strong>
                {data.totals?.published ??
                  data.tenants.filter((t: any) => t.published).length}
              </strong>
            </Card>
            <Card className="stat">
              <span className="small-label">
                Open exceptions
                {data.hasMore ? ` (${data.tenants.length} loaded)` : ""}
              </span>
              <strong>
                {data.tenants.reduce(
                  (s: number, t: any) => s + openCount(t),
                  0,
                )}
              </strong>
            </Card>
            <Card className="stat">
              <span className="small-label">
                Trainer liabilities
                {data.hasMore ? ` (${data.tenants.length} loaded)` : ""}
              </span>
              <strong>
                {money(
                  data.tenants.reduce(
                    (s: number, t: any) => s + (t.finance?.earnedMinor ?? 0),
                    0,
                  ),
                )}
              </strong>
            </Card>
          </div>
          <Card>
            <h2>Trainer workspaces</h2>
            <div
              className="table-wrap"
              role="region"
              aria-label="Trainer workspaces"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Trainer</th>
                    <th>Status</th>
                    <th>Payable</th>
                    {financeRole && (
                      <>
                        <th>Commission (all time)</th>
                        <th>Charged back (all time)</th>
                        <th>AI cost (USD, all time)</th>
                        <th>Voice cost (USD, all time)</th>
                      </>
                    )}
                    <th>Exceptions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tenants.map((t: any) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.name}</strong>
                        <small>{t.slug}</small>
                      </td>
                      <td>
                        <Badge>{t.published ? "Published" : "Private"}</Badge>
                      </td>
                      <td>
                        {t.finance
                          ? money(t.finance.earnedMinor)
                          : "Restricted"}
                      </td>
                      {financeRole && (
                        <>
                          <td>
                            {t.finance ? money(t.finance.commissionMinor) : "—"}
                          </td>
                          <td>
                            {t.finance
                              ? money(
                                  -(t.finance.accounts?.platform_cost_recovery ?? 0),
                                )
                              : "—"}
                          </td>
                          {(["ai", "voice"] as const).map((kind) => {
                            const c = t.costSummary?.[kind];
                            return (
                              <td key={kind}>
                                {(c?.costUsd ?? 0).toFixed(4)}
                                {c?.estimatedUsd > 0 && (
                                  <small> {c.estimatedUsd.toFixed(4)} estimated</small>
                                )}
                                {c?.unpriced > 0 && (
                                  <small> {c.unpriced} unpriced</small>
                                )}
                              </td>
                            );
                          })}
                        </>
                      )}
                      <td>{openCount(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {moreWorkspaces}
          </Card>
        </>
      ) : (
        !error && <p>Loading platform evidence…</p>
      )}
    </>
  );
}
