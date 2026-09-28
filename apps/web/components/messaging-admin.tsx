"use client";
import { useEffect, useState } from "react";

async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? "The request failed.");
  return data;
}
const wrap = {
  overflowWrap: "anywhere" as const,
  whiteSpace: "pre-wrap" as const,
};
const localeName: Record<string, string> = { en: "English", ar: "Arabic" };

/** Superadmin configuration: message kinds, template preview and the safety policy. */
export function MessagingConfiguration() {
  return (
    <>
      <MessageTemplates />
      <SafetyPolicyPanel />
    </>
  );
}

function MessageTemplates() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({ key: "", title: "", content: "" }),
    [preview, setPreview] = useState<any>(null);
  useEffect(() => {
    void request("/admin/notification-templates")
      .then((d) => {
        setData(d);
        const first = d.kinds[0];
        if (first)
          setForm({
            key: first.templateKey,
            title: first.sample.title,
            content: "Hello {{name}},\n\n{{message}}\n\n{{coach}}",
          });
      })
      .catch((e) => setError(e.message));
  }, []);
  const choose = (key: string) => {
    const base = key.replace(/--[a-z]{2}$/, "");
    const k = data?.kinds.find((x: any) => x.templateKey === base);
    setPreview(null);
    setForm({
      key,
      title: k?.sample.title ?? form.title,
      content: form.content,
    });
  };
  return (
    <>
      <section className="card" aria-labelledby="message-kinds-heading">
        <h2 id="message-kinds-heading">Message kinds and templates</h2>
        <p className="muted">
          A published notification template replaces the built-in wording of its
          message kind in the inbox and in email. Create it above as a
          notification template using the exact key; add <code>--ar</code> to
          the key for Arabic. Members who choose Arabic fall back to English,
          then to the built-in wording. Safety and account messages always keep
          the built-in instruction after the template text. Each sent message
          records the template version it used.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading message kinds…</p>}
        {data && (
          <>
            <p className="muted">
              Variables:{" "}
              {data.variables.map((v: string) => `{{${v}}}`).join(", ")}.{" "}
              {data.push}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Audience</th>
                    <th scope="col">Category</th>
                    {data.locales.map((l: string) => (
                      <th scope="col" key={l}>
                        {localeName[l] ?? l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.kinds.map((k: any) => (
                    <tr key={k.templateKey}>
                      <td style={wrap}>
                        <code>{k.templateKey}</code>
                        <small className="muted">{k.description}</small>
                      </td>
                      <td>{k.audience}</td>
                      <td>
                        {k.category}
                        {k.critical ? " · keeps built-in text" : ""}
                      </td>
                      {data.locales.map((l: string) => (
                        <td key={l}>
                          {k.published[l]
                            ? `v${k.published[l].version}`
                            : "Built-in"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.unregisteredPublished.length > 0 && (
              <p className="notice" role="status">
                Published templates with keys no sender uses:{" "}
                {data.unregisteredPublished
                  .map((r: any) => `${r.key} v${r.version}`)
                  .join(", ")}
              </p>
            )}
          </>
        )}
      </section>
      {data && (
        <section className="card" aria-labelledby="template-preview-heading">
          <h2 id="template-preview-heading">Preview a template</h2>
          <p className="muted">Sample data only. Nothing is saved or sent.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                setPreview(
                  await request("/admin/notification-templates/preview", form),
                );
              } catch (err) {
                setPreview(null);
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Message key</span>
              <select value={form.key} onChange={(e) => choose(e.target.value)}>
                {data.kinds.flatMap((k: any) =>
                  data.locales.map((l: string) => {
                    const key =
                      l === "en" ? k.templateKey : `${k.templateKey}--${l}`;
                    return (
                      <option key={key} value={key}>
                        {key} ({localeName[l] ?? l})
                      </option>
                    );
                  }),
                )}
              </select>
            </label>
            <label className="field">
              <span>Title</span>
              <input
                value={form.title}
                required
                minLength={3}
                maxLength={150}
                dir="auto"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Content</span>
              <textarea
                value={form.content}
                required
                minLength={5}
                maxLength={60000}
                rows={6}
                dir="auto"
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Rendering…" : "Preview with sample data"}
            </button>
          </form>
          {preview && (
            <div aria-live="polite">
              <h3>Inbox</h3>
              <p style={wrap} dir="auto">
                <strong>{preview.inApp.title}</strong>
                <br />
                {preview.inApp.body}
              </p>
              <h3>Email</h3>
              <p style={wrap} dir="auto">
                Subject: {preview.email.subject}
              </p>
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview.email.html}
                style={{
                  inlineSize: "100%",
                  blockSize: 220,
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                }}
              />
              <details>
                <summary>Plain-text email</summary>
                <p style={wrap} dir="auto">
                  {preview.email.text}
                </p>
              </details>
              <h3>Device notification</h3>
              <p>
                {preview.push.title}: {preview.push.body}
              </p>
              <p className="muted">{preview.push.note}</p>
              <details>
                <summary>Built-in wording used without a template</summary>
                <p style={wrap}>
                  <strong>{preview.builtIn.title}</strong>
                  <br />
                  {preview.builtIn.body}
                </p>
              </details>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function SafetyPolicyPanel() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(""),
    [check, setCheck] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void request("/admin/safety-policy")
      .then((d) => {
        setData(d);
        setDraft(JSON.stringify(d.example, null, 2));
      })
      .catch((e) => setError(e.message));
  }, []);
  const active = data?.active;
  return (
    <section className="card" aria-labelledby="safety-policy-heading">
      <h2 id="safety-policy-heading">Coaching safety policy</h2>
      <p className="muted">
        The published safety policy document with key{" "}
        <code>{data?.key ?? "coaching-safety-policy"}</code> adds red-flag
        terms, routes listed topics to the trainer&apos;s personal review and
        shortens review deadlines. It can never remove a built-in red flag,
        exempt a category or lengthen a deadline; drafts that try are refused.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {active && (
        <dl>
          <dt>In effect</dt>
          <dd>
            {active.version
              ? `Version ${active.version}`
              : "Built-in safety floor (no policy published)"}
          </dd>
          <dt>Training hold review deadline</dt>
          <dd>
            {active.holdReviewHours} hours (floor {active.floor.holdReviewHours}
            )
          </dd>
          <dt>Personal review deadline</dt>
          <dd>
            {active.personalReviewHours} hours (floor{" "}
            {active.floor.personalReviewHours})
          </dd>
          <dt>Additional red-flag terms</dt>
          <dd style={wrap}>{active.redFlagTerms.join(", ") || "None"}</dd>
          <dt>Personal review topics</dt>
          <dd style={wrap}>
            {[
              ...active.personalReviewCategories.map((c: any) => c.label),
              ...active.personalReviewTerms,
            ].join(", ") || "None"}
          </dd>
          {active.ignored.length > 0 && (
            <>
              <dt>Ignored instructions</dt>
              <dd className="notice" role="status">
                {active.ignored.join("; ")}
              </dd>
            </>
          )}
        </dl>
      )}
      {data && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setCheck(
                await request("/admin/safety-policy/check", { content: draft }),
              );
            } catch (err) {
              setCheck({ ok: false, errors: [(err as Error).message] });
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>
              Check a policy before saving it (categories:{" "}
              {data.categories.map((c: any) => c.key).join(", ")})
            </span>
            <textarea
              value={draft}
              rows={10}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Check policy
          </button>
          {check && (
            <p
              className={check.ok ? "notice success" : "notice error"}
              role="status"
            >
              {check.ok
                ? `Valid. Holds due within ${check.effective.holdReviewHours} hours; personal reviews within ${check.effective.personalReviewHours} hours.`
                : check.errors.join(" ")}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
