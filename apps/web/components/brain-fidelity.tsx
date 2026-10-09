"use client";
import { useEffect, useState } from "react";
import { Field } from "./field";

const dimensions = [
  ["decision", "Coaching decision"],
  ["wording", "Tone and wording"],
  ["context", "Use of conversation"],
] as const;
async function request(path = "", body?: unknown) {
  const response = await fetch("/api/v1/brain/fidelity" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.message ?? "This review could not be saved.");
  return value;
}

/** An optional review workspace, outside the normal message thread. */
export function BrainFidelity() {
  const [data, setData] = useState<any>(),
    [selected, setSelected] = useState(""),
    [runId, setRunId] = useState("");
  const [adding, setAdding] = useState(false),
    [exchanges, setExchanges] = useState(1),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = async () => {
    const next = await request();
    setData(next);
    return next;
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(fn: () => Promise<any>, message: string) {
    if (busy) return null;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      await load();
      setNotice(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const example = data?.cases.find((c: any) => c.id === selected);
  const runs = data?.runs.filter((r: any) => r.caseId === selected) ?? [];
  const run = runs.find((r: any) => r.id === runId) ?? runs[0];
  return (
    <section aria-label="Compare your coaching replies" aria-busy={busy}>
      <h2>Does it sound like you?</h2>
      <p>
        Write how you would answer an unfamiliar, made-up conversation. Compare
        your reply with your published Brain, then rate the decision, wording
        and use of context.
      </p>
      <p className="muted">
        Reply labels stay hidden until you save both ratings. You may recognise
        your own writing. These are your judgments of written chat, not an
        accuracy percentage or a check of voice calls.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status">
          Saving your review… Generating a reply may take a little longer.
        </p>
      )}
      {!data && !error && <p role="status">Loading your reviews…</p>}
      {data && (
        <>
          {!data.ready && (
            <p className="notice">
              Publish your checked Brain before generating a comparison. You can
              save situations now.
            </p>
          )}
          <div className="card">
            <h3>Your current Brain</h3>
            {!!data.summary.attempts && (
              <p className="muted">
                {data.summary.attempts} attempts ·{" "}
                {data.summary.awaitingRatings} awaiting ratings ·{" "}
                {data.summary.pending} unfinished · {data.summary.failed}{" "}
                withheld or failed
              </p>
            )}
            {data.summary.count ? (
              <>
                <p>
                  {data.summary.count} rated{" "}
                  {data.summary.count === 1 ? "situation" : "situations"} still
                  separate from teaching.
                </p>
                <dl>
                  {dimensions.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{data.summary[key]} / 5</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="muted">
                No ratings for the current Brain and model yet. Earlier reviews
                stay below.
              </p>
            )}
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setAdding(!adding)}
            >
              {adding ? "Close new situation" : "New situation"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void action(load, "Reviews refreshed")}
            >
              Refresh reviews
            </button>
          </div>
          {adding && (
            <form
              className="card"
              aria-label="New coaching situation"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = new FormData(form);
                void action(
                  () =>
                    request("/cases", {
                      title: f.get("title"),
                      turns: Array.from({ length: exchanges * 2 }, (_, i) => ({
                        author: i % 2 ? "trainer" : "subscriber",
                        text: f.get("turn" + i),
                      })),
                      request: f.get("request"),
                      referenceReply: f.get("referenceReply"),
                      referenceReason: f.get("referenceReason"),
                      expectHandover: f.get("handover") === "yes",
                      fictional: f.get("fictional") === "on",
                    }),
                  "Situation and your reference reply saved. Your answer will not be shown to the Brain.",
                ).then((saved) => {
                  if (saved) {
                    form.reset();
                    setAdding(false);
                    setSelected(saved.id);
                    setRunId("");
                  }
                });
              }}
            >
              <Field label="Situation name">
                <input
                  name="title"
                  required
                  minLength={3}
                  maxLength={100}
                  placeholder="A follow-up after a missed session"
                />
              </Field>
              <p className="muted">
                Use unfamiliar, fictional details. Keep these separate from
                teaching examples and practice questions. Keep all messages
                below within 2,400 characters.
              </p>
              {Array.from({ length: exchanges * 2 }, (_, i) => (
                <Field
                  key={i}
                  label={`${i % 2 ? "Your earlier reply" : "Subscriber's earlier message"} ${Math.floor(i / 2) + 1}`}
                >
                  <textarea
                    name={"turn" + i}
                    required
                    minLength={3}
                    maxLength={700}
                    rows={2}
                  />
                </Field>
              ))}
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={exchanges >= 3 || busy}
                  onClick={() => setExchanges((n) => n + 1)}
                >
                  Add an exchange
                </button>
                {exchanges > 1 && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setExchanges((n) => n - 1)}
                  >
                    Remove last exchange
                  </button>
                )}
              </div>
              <Field label="Subscriber's new message">
                <textarea
                  name="request"
                  required
                  minLength={5}
                  maxLength={1200}
                  rows={3}
                />
              </Field>
              <Field label="The exact reply you would send">
                <textarea
                  name="referenceReply"
                  required
                  minLength={3}
                  maxLength={2000}
                  rows={4}
                />
              </Field>
              <Field label="Why would you answer that way?">
                <textarea
                  name="referenceReason"
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={2}
                />
              </Field>
              <Field label="Should the digital coach hand this to you?">
                <select name="handover" required>
                  <option value="no">No, a supported reply is enough</option>
                  <option value="yes">
                    Yes, I should handle it personally
                  </option>
                </select>
              </Field>
              <label>
                <input type="checkbox" name="fictional" required /> This is a
                made-up situation with no real person's identifying details.
              </label>
              <button className="button" disabled={busy} type="submit">
                Save my reference reply
              </button>
            </form>
          )}
          {!!data.cases.length && (
            <Field label="Saved situation">
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setRunId("");
                }}
              >
                <option value="">Choose a situation</option>
                {data.cases.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.eligible ? "" : " · teaching or practice"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {example && (
            <>
              <div className="card">
                <h3>{example.title}</h3>
                {example.turns.map((t: any, i: number) => (
                  <p key={i}>
                    <strong>
                      {t.author === "subscriber" ? "Subscriber" : "You"}:
                    </strong>{" "}
                    {t.text}
                  </p>
                ))}
                <p>
                  <strong>New message:</strong> {example.request}
                </p>
                {!example.eligible && (
                  <p className="notice">
                    This situation is teaching or practice material. Its ratings
                    stay in the record and are excluded from the current
                    summary.
                  </p>
                )}
                <button
                  className="button"
                  disabled={busy || !data.ready || !example.eligible}
                  onClick={() =>
                    void action(
                      () => request(`/cases/${example.id}/runs`, {}),
                      "Comparison saved. Existing attempts are reused for the same Brain and model.",
                    ).then((r) => {
                      if (r) setRunId(r.id);
                    })
                  }
                >
                  Compare with current Brain
                </button>
                <p className="muted">
                  One AI reply per situation and Brain/model version. Your
                  reference reply and reasoning stay out of its request.
                </p>
              </div>
              {runs.length > 1 && (
                <Field label="Saved comparison">
                  <select
                    value={run?.id ?? ""}
                    onChange={(e) => setRunId(e.target.value)}
                  >
                    {runs.map((r: any, i: number) => (
                      <option key={r.id} value={r.id}>
                        {new Date(r.createdAt).toLocaleString()} ·{" "}
                        {r.status === "graded" ? "Rated" : "Not rated"} ·{" "}
                        {runs.length - i}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {run?.status === "generating" && (
                <p className="notice" role="status">
                  {run.interrupted
                    ? "This attempt was interrupted and needs operator review. It will not be sent again automatically."
                    : "This reply is still being prepared. Refresh reviews to check its saved result."}
                </p>
              )}
              {run?.status === "failed" && (
                <p className="notice" role="alert">
                  {run.failure}
                </p>
              )}
              {run && ["ready", "graded"].includes(run.status) && (
                <form
                  key={run.id + run.status}
                  aria-label="Rate both replies"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action(
                      () =>
                        request(`/runs/${run.id}/ratings`, {
                          scores: ["A", "B"].map((label) => ({
                            label,
                            ...Object.fromEntries(
                              dimensions.map(([key]) => [
                                key,
                                Number(f.get(label + key)),
                              ]),
                            ),
                          })),
                          note: f.get("note"),
                        }),
                      "Ratings saved. The reply sources are now revealed.",
                    );
                  }}
                >
                  <p className="muted">
                    Rate each dimension from 1 (poor match) to 5 (very close to
                    how you would coach). Save once; revealing the sources locks
                    the ratings.
                  </p>
                  <div className="two-columns">
                    {run.candidates.map((c: any) => (
                      <fieldset className="card" key={c.label}>
                        <legend>
                          Reply {c.label}
                          {c.source
                            ? c.source === "brain"
                              ? " · Your Brain"
                              : " · Your reference"
                            : ""}
                        </legend>
                        <p
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {c.reply}
                        </p>
                        {dimensions.map(([key, label]) => (
                          <Field
                            key={key}
                            label={`${label} — reply ${c.label}`}
                          >
                            <select
                              name={c.label + key}
                              required
                              disabled={busy || run.status === "graded"}
                              defaultValue={
                                run.rating?.scores.find(
                                  (s: any) => s.label === c.label,
                                )?.[key] ?? ""
                              }
                            >
                              <option value="">Choose a rating</option>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                  {n === 1
                                    ? " — Poor match"
                                    : n === 5
                                      ? " — Very close"
                                      : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                        ))}
                        {c.source && (
                          <>
                            <p className="muted">
                              {c.handover
                                ? "Hand to the trainer"
                                : "Reply within the taught method"}
                            </p>
                            <p>{c.reason}</p>
                          </>
                        )}
                      </fieldset>
                    ))}
                  </div>
                  <Field label="What felt right or wrong?">
                    <textarea
                      name="note"
                      maxLength={1000}
                      rows={2}
                      disabled={busy || run.status === "graded"}
                      defaultValue={run.rating?.note ?? ""}
                    />
                  </Field>
                  {run.status === "ready" && (
                    <button className="button" disabled={busy} type="submit">
                      Save ratings and reveal sources
                    </button>
                  )}
                </form>
              )}
              {run?.status === "graded" && (
                <>
                  <details className="card">
                    <summary>Review record</summary>
                    <p>
                      Written supervised chat · {run.receipt.model} · Brain{" "}
                      {run.receipt.releaseId}
                    </p>
                    <p>
                      Prompt {run.receipt.promptVersion} · {run.receipt.version}{" "}
                      · rated {new Date(run.gradedAt).toLocaleString()}
                    </p>
                    <p className="muted">
                      This used the published rules and communication style with
                      this fictional conversation. No real subscriber profile,
                      training log, message or voice was used.
                    </p>
                  </details>
                  {run.teachingId ? (
                    <p className="notice">
                      Correction saved as a teaching note. Review and compile it
                      in Brain review before publishing a new Brain.
                    </p>
                  ) : (
                    example.status === "held_out" && (
                      <details className="card">
                        <summary>Teach from this review</summary>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void action(
                              () =>
                                request(`/runs/${run.id}/teach`, {
                                  reply: f.get("reply"),
                                  reason: f.get("reason"),
                                  confirmed: f.get("confirmed") === "on",
                                }),
                              "Teaching note saved. This situation is retired from the evaluation set.",
                            );
                          }}
                        >
                          <Field label="Your corrected reply">
                            <textarea
                              name="reply"
                              required
                              minLength={3}
                              maxLength={2000}
                              rows={4}
                              defaultValue={
                                run.candidates.find(
                                  (c: any) => c.source === "trainer",
                                )?.reply ?? ""
                              }
                            />
                          </Field>
                          <Field label="The lesson to teach">
                            <textarea
                              name="reason"
                              required
                              minLength={3}
                              maxLength={1000}
                              rows={3}
                            />
                          </Field>
                          <label>
                            <input name="confirmed" type="checkbox" required />{" "}
                            Use this for teaching and remove it from the
                            evaluation set. Keep its earlier ratings as a
                            record.
                          </label>
                          <button
                            className="button"
                            disabled={busy}
                            type="submit"
                          >
                            Save as teaching
                          </button>
                        </form>
                      </details>
                    )
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
