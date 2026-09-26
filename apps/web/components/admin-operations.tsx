"use client";
import { useEffect, useState } from "react";

const titles: Record<string, string> = {
  trainers: "Trainer workspaces",
  subscribers: "Subscriber accounts",
  brains: "Brain operations",
  safety: "Safety reviews",
  finops: "Usage and FinOps",
  wearables: "Wearable connections",
  domains: "Custom domains",
  infrastructure: "Job operations",
  support: "Support workbench",
  security: "Security and audit",
  acquisition: "Acquisition funnel",
  experiments: "Product experiments",
  configuration: "Published documents and templates",
};
async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? "The request failed.");
  return data;
}
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function Table({ rows, omit = [] }: { rows: any[]; omit?: string[] }) {
  if (!rows.length) return <p className="muted">No matching records.</p>;
  const columns = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r))),
  ).filter((k) => !omit.includes(k));
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            {columns.map((k) => (
              <th key={k} scope="col">
                {k.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((k) => (
                <td
                  key={k}
                  style={{
                    maxWidth: 360,
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {display(r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function TrainerAnalytics() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void request("/analytics/business")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR BUSINESS</p>
          <h1>Membership and revenue.</h1>
        </div>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="muted">{data.note}</p>
          <section className="card">
            <h2>Current subscriptions</h2>
            <Table rows={data.members} />
          </section>
          <section className="card">
            <h2>Member cohorts</h2>
            <Table rows={data.cohorts} />
          </section>
          <section className="card">
            <h2>Ledger by month (AED minor units)</h2>
            <Table rows={data.revenue} />
          </section>
        </>
      )}
    </>
  );
}
export function AdminOperations({
  path,
  platformRole,
}: {
  path: string;
  platformRole: string;
}) {
  const segments = path.split("/").filter(Boolean),
    view = segments[1] ?? "trainers";
  const [data, setData] = useState<any>(null),
    [tenant, setTenant] = useState(
      view === "trainers" && segments[2]
        ? segments[2]
        : typeof window !== "undefined"
          ? (new URLSearchParams(window.location.search).get("tenantId") ?? "")
          : "",
    ),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("legal"),
    [draft, setDraft] = useState<any>(null);
  const query = new URLSearchParams();
  if (tenant) query.set("tenantId", tenant);
  query.set("page", String(page));
  if (view === "subscribers" && segments[2]) query.set("userId", segments[2]);
  const load = () =>
    request("/admin/operations/" + view + "?" + query).then(setData);
  useEffect(() => {
    setData(null);
    void load().catch((e) => setNotice(e.message));
  }, [view, tenant, page]);
  async function act(url: string, body: unknown) {
    setBusy(true);
    try {
      const result = await request(url, body);
      await load();
      setNotice("Saved.");
      return result;
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!titles[view])
    return (
      <section className="card">
        <h1>Choose an operations view</h1>
        <p className="muted">
          This address does not identify an operations screen.
        </p>
        <a href="/admin/trainers">Open trainer workspaces</a>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM OPERATIONS · {platformRole}</p>
          <h1>{titles[view]}</h1>
          <p className="muted">
            Access is scoped to your operator role. Workspace reads and changes
            are audited.
          </p>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {data && (
        <>
          <nav className="button-row" aria-label="Operations views">
            {data.allowedViews.map((key: string) => (
              <a
                className="button secondary"
                aria-current={key === view ? "page" : undefined}
                href={"/admin/" + key}
                key={key}
              >
                {titles[key]}
              </a>
            ))}
          </nav>
          {![
            "configuration",
            "security",
            "acquisition",
            "experiments",
          ].includes(view) && (
            <section className="card">
              <label className="field">
                <span>Workspace</span>
                <select
                  value={tenant}
                  onChange={(e) => {
                    setTenant(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All workspaces</option>
                  {data.tenants.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <button
                  className="button secondary"
                  disabled={!data.hasMore}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </section>
          )}
          {view === "configuration" ? (
            <>
              <section className="card">
                <h2>Create a version</h2>
                <p className="muted">
                  Published text is immutable. Create a new version for later
                  changes. Legal text needs your qualified review before
                  publication.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const result = await act("/admin/documents", {
                      kind,
                      key: f.get("key"),
                      title: f.get("title"),
                      content: f.get("content"),
                    });
                    if (result) setDraft(result);
                  }}
                >
                  <label className="field">
                    <span>Document type</span>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="legal">Legal document</option>
                      <option value="notification">
                        Notification template
                      </option>
                      <option value="support_macro">Support macro</option>
                      <option value="safety">Safety policy</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>
                      Key{" "}
                      {kind === "legal"
                        ? "(terms, privacy, ai-disclosure)"
                        : "(lowercase words separated by hyphens)"}
                    </span>
                    <input
                      name="key"
                      required
                      pattern="[a-z0-9][a-z0-9-]{1,79}"
                    />
                  </label>
                  <label className="field">
                    <span>Title</span>
                    <input
                      name="title"
                      required
                      minLength={3}
                      maxLength={150}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Content{" "}
                      {kind === "notification"
                        ? "— variables: {{name}}, {{link}}, {{coach}}, {{date}}, {{message}}"
                        : ""}
                    </span>
                    <textarea
                      name="content"
                      rows={12}
                      required
                      minLength={5}
                      maxLength={60000}
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    Save new draft
                  </button>
                </form>
                {draft && <p>Draft version {draft.version} saved.</p>}
              </section>
              <section className="card">
                <h2>Version history</h2>
                {data.documents.map((d: any) => (
                  <details key={d.id}>
                    <summary>
                      {d.title} · {d.kind} / {d.key} · v{d.version} · {d.status}
                      {d.effective_at
                        ? " · " + new Date(d.effective_at).toLocaleString()
                        : ""}
                    </summary>
                    <p style={{ whiteSpace: "pre-wrap" }}>{d.content}</p>
                    {d.status === "draft" && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act(`/admin/documents/${d.id}/publish`, {
                            revision: d.revision,
                            effectiveAt: f.get("effectiveAt")
                              ? new Date(
                                  String(f.get("effectiveAt")),
                                ).toISOString()
                              : new Date().toISOString(),
                            reason: f.get("reason"),
                          });
                        }}
                      >
                        <label className="field">
                          <span>
                            Effective date (your local time; blank means now)
                          </span>
                          <input type="datetime-local" name="effectiveAt" />
                        </label>
                        <label className="field">
                          <span>Approval and review reference</span>
                          <input
                            name="reason"
                            required
                            minLength={10}
                            maxLength={1000}
                          />
                        </label>
                        <button className="button" disabled={busy}>
                          Publish this version
                        </button>
                      </form>
                    )}
                  </details>
                ))}
              </section>
            </>
          ) : view === "support" ? (
            <section className="card">
              <h2>Conversations</h2>
              {!data.rows.length && <p className="muted">No conversations.</p>}
              {data.rows.map((r: any) => (
                <details key={r.id}>
                  <summary>
                    {r.workspace} · {r.subject} · {r.status} ·{" "}
                    {Math.round(Number(r.age_hours))}h old
                  </summary>
                  <p>
                    {r.name} · {r.category}
                  </p>
                  {(r.messages ?? []).map((m: any, i: number) => (
                    <p key={i} style={{ whiteSpace: "pre-wrap" }}>
                      <strong>
                        {m.platformSupport
                          ? "Platform support"
                          : m.authorId === r.owner_user_id
                            ? r.name
                            : "Trainer"}
                      </strong>{" "}
                      · {new Date(m.at).toLocaleString()}
                      <br />
                      {m.text}
                    </p>
                  ))}
                  <SupportReply
                    key={r.id + ":" + r.version}
                    row={r}
                    macros={data.macros}
                    busy={busy}
                    act={act}
                  />
                </details>
              ))}
            </section>
          ) : view === "safety" ? (
            <section className="card">
              <p className="muted">
                Operator review records triage. The coach must resolve any
                training or nutrition hold through its governed workflow.
              </p>
              {!data.rows.length && <p>No safety cases.</p>}
              {data.rows.map((r: any) => (
                <details key={r.id}>
                  <summary>
                    {r.workspace} · {r.category ?? r.kind} · {r.status}
                  </summary>
                  <p>{r.reason}</p>
                  {r.operator_review && (
                    <p>Latest review: {r.operator_review.note}</p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void act(
                        `/admin/tenants/${r.tenant_id}/safety/${r.id}/review`,
                        {
                          revision: r.version,
                          note: f.get("note"),
                          priority: f.get("priority"),
                        },
                      );
                    }}
                  >
                    <label className="field">
                      <span>Priority</span>
                      <select name="priority">
                        <option value="routine">Routine</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Review notes</span>
                      <textarea
                        name="note"
                        required
                        minLength={10}
                        maxLength={2000}
                      />
                    </label>
                    <button className="button" disabled={busy}>
                      Save review
                    </button>
                  </form>
                </details>
              ))}
            </section>
          ) : view === "experiments" ? (
            <>
              <section className="card">
                <h2>Create an experiment</h2>
                <p className="muted">
                  Only consented landing or onboarding copy is eligible. Safety
                  decisions, health targeting, and prices are excluded.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("/admin/experiments", {
                      key: f.get("key"),
                      title: f.get("title"),
                      surface: f.get("surface"),
                      allocation: Number(f.get("allocation")),
                      variantA: f.get("variantA"),
                      variantB: f.get("variantB"),
                      metric: f.get("metric"),
                      guardrail: f.get("guardrail"),
                    });
                  }}
                >
                  {[
                    ["key", "Key"],
                    ["title", "Title"],
                    ["variantA", "Control copy"],
                    ["variantB", "Alternative copy"],
                  ].map(([name, label]) => (
                    <label className="field" key={name}>
                      <span>{label}</span>
                      <input
                        name={name}
                        required
                        minLength={name === "key" ? 2 : 3}
                        maxLength={name === "key" ? 80 : 150}
                      />
                    </label>
                  ))}
                  <label className="field">
                    <span>Surface</span>
                    <select name="surface">
                      <option value="landing">Landing</option>
                      <option value="onboarding">Onboarding</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Alternative allocation (%)</span>
                    <input
                      name="allocation"
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={25}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Metric</span>
                    <select name="metric">
                      <option value="signup">Trainer signups</option>
                      <option value="publish">Published workspaces</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Guardrail and stopping rule</span>
                    <textarea
                      name="guardrail"
                      minLength={10}
                      maxLength={2000}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    Save draft
                  </button>
                </form>
              </section>
              <section className="card">
                <h2>Experiments</h2>
                {data.rows.map((r: any) => (
                  <details key={r.id}>
                    <summary>
                      {r.title} · {r.status}
                    </summary>
                    <p>{r.guardrail}</p>
                    <p>{r.result}</p>
                    {["draft", "running"].includes(r.status) && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act(`/admin/experiments/${r.id}/transition`, {
                            revision: r.revision,
                            status: f.get("status"),
                            result: f.get("result"),
                          });
                        }}
                      >
                        <label className="field">
                          <span>Action</span>
                          <select name="status">
                            {r.status === "draft" ? (
                              <option value="running">Start</option>
                            ) : (
                              <>
                                <option value="stopped">
                                  Stop and roll back
                                </option>
                                <option value="completed">Complete</option>
                              </>
                            )}
                          </select>
                        </label>
                        <label className="field">
                          <span>Reason or measured result</span>
                          <textarea name="result" required minLength={10} />
                        </label>
                        <button className="button" disabled={busy}>
                          Apply
                        </button>
                      </form>
                    )}
                  </details>
                ))}
              </section>
            </>
          ) : (
            <section className="card">
              {view === "finops" && (
                <p className="muted">
                  Last 30 days. Provider cost is shown in USD; null cost remains
                  unresolved and is not treated as zero.
                </p>
              )}
              {view === "infrastructure" && (
                <p className="muted">
                  This is the application job queue. Host metrics and deploy
                  status require the deployment operator’s monitoring
                  integration.
                </p>
              )}
              {view === "acquisition" && (
                <p className="muted">
                  {data.summary.period} · {data.summary.attribution}
                </p>
              )}
              <Table rows={data.rows} />
              {view === "security" && (
                <>
                  <h2>Operator access</h2>
                  <Table rows={data.summary.operators ?? []} />
                </>
              )}
              {view === "trainers" &&
                data.rows.map((r: any) => (
                  <p key={r.id}>
                    <a href={`/admin/subscribers?tenantId=${r.id}`}>
                      {r.workspace}: subscriber accounts
                    </a>
                  </p>
                ))}
            </section>
          )}
          {view === "infrastructure" &&
            data.rows
              .filter(
                (r: any) =>
                  r.kind === "email" &&
                  ["blocked", "failed"].includes(r.status),
              )
              .map((r: any) => (
                <section className="card" key={r.id}>
                  <h2>Reconcile email delivery</h2>
                  <p>
                    {r.workspace} · {r.id}
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void act(
                        `/admin/tenants/${r.tenant_id}/email-jobs/${r.id}/reconcile`,
                        {
                          attempts: r.attempts,
                          outcome: f.get("outcome"),
                          evidenceReference: f.get("evidenceReference"),
                        },
                      );
                    }}
                  >
                    <label className="field">
                      <span>Verified provider outcome</span>
                      <select name="outcome">
                        <option value="delivered">Already delivered</option>
                        <option value="not_sent">
                          Confirmed not sent; retry same intent
                        </option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Provider evidence reference</span>
                      <input name="evidenceReference" required minLength={10} />
                    </label>
                    <button className="button" disabled={busy}>
                      Reconcile
                    </button>
                  </form>
                </section>
              ))}
        </>
      )}
    </>
  );
}
function SupportReply({
  row,
  macros,
  busy,
  act,
}: {
  row: any;
  macros: any[];
  busy: boolean;
  act: (path: string, body: unknown) => Promise<any>;
}) {
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void act(`/admin/tenants/${row.tenant_id}/support/${row.id}/reply`, {
          revision: row.version,
          message,
          resolve: f.get("resolve") === "on",
        });
      }}
    >
      <label className="field">
        <span>Insert reviewed macro</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const macro = macros.find((m) => m.key === e.target.value);
            if (macro) setMessage(macro.content);
          }}
        >
          <option value="">Choose a macro</option>
          {macros.map((m) => (
            <option value={m.key} key={m.key}>
              {m.title} · v{m.version}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Reply</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          maxLength={4000}
        />
      </label>
      <label className="check-field">
        <input type="checkbox" name="resolve" />
        Resolve this conversation
      </label>
      <button className="button" disabled={busy}>
        Send reply
      </button>
    </form>
  );
}
