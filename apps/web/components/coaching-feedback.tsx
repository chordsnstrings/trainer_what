"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

async function api(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "The coaching review could not be saved");
  return data;
}
const label = (value: string) => value.replaceAll("_", " ");
function Field({
  label: title,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function ExceptionCorrection({
  exceptionId,
  onChange,
}: {
  exceptionId: string;
  onChange?: () => void | Promise<void>;
}) {
  const [data, setData] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [actionId, setActionId] = useState(""),
    [requestKey, setRequestKey] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const d = await api(`/exceptions/${exceptionId}/correction`);
      setData(d);
      setMessage(d.original.data.message ?? "");
      setActionId(
        d.context.actions.some((a: any) => a.id === d.original.data.actionId)
          ? d.original.data.actionId
          : "",
      );
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const facts = data?.context.facts;
  return (
    <section aria-label="Correct the coaching decision">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        {data ? "Refresh current context" : "Correct this decision"}
      </button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            try {
              await api(`/exceptions/${exceptionId}/corrections`, "POST", {
                requestKey,
                exceptionVersion: data.exception.version,
                decisionVersion: data.original.version,
                contextToken: data.context.contextToken,
                actionId: actionId || null,
                message,
                explanation: f.get("explanation"),
                reviewed: f.get("reviewed") === "on",
              });
              setData(undefined);
              window.dispatchEvent(new Event("coaching-feedback-updated"));
              await onChange?.();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Review against the current client context</h3>
          {data.original.data.request && (
            <p>
              <strong>Client request:</strong> {data.original.data.request}
            </p>
          )}
          <p>
            {label(facts.profile.experience)} · {facts.profile.daysPerWeek}{" "}
            training days · {facts.profile.equipment}
          </p>
          <p>
            Limitations: {facts.profile.limitations || "None reported"}.{" "}
            {facts.program
              ? `Current program: ${facts.program.title}.`
              : "No assigned program."}{" "}
            {facts.nextSession &&
              `Next planned session: ${facts.nextSession.date}.`}
          </p>
          <p className="muted">
            Your original proposal stays in the review history. This correction
            sends a separate reviewed response and prepares a private teaching
            draft.
          </p>
          <Field label="Preferred action">
            <select
              value={actionId}
              onChange={(e) => {
                setActionId(e.target.value);
                const chosen = data.context.actions.find(
                  (a: any) => a.id === e.target.value,
                );
                if (chosen) setMessage(chosen.data.response);
              }}
            >
              <option value="">
                Send my reviewed message without a plan change
              </option>
              {data.context.actions.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {label(a.data.type)}: {a.data.title}
                </option>
              ))}
            </select>
          </Field>
          {!data.context.actions.length && (
            <p className="muted">
              No evaluated routine action currently matches this request. You
              can send a reviewed message here and make plan changes in
              Training.
            </p>
          )}
          <Field label="Message the client will receive">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              minLength={3}
              maxLength={4000}
              rows={4}
            />
          </Field>
          <Field label="Why this decision or meaning should change">
            <textarea name="explanation" maxLength={4000} rows={3} />
          </Field>
          <p className="muted">
            Explain meaningful changes in at least 10 characters. Punctuation
            and capitalization edits do not need an explanation.
          </p>
          <label className="check-field">
            <input type="checkbox" name="reviewed" required />I reviewed the
            current context, chosen action and client message.
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy
              ? "Saving correction…"
              : "Send correction and prepare teaching draft"}
          </button>
        </form>
      )}
    </section>
  );
}

const teachingFields = [
  [
    "scenario",
    "Describe a general situation without identifying the client",
    10,
    3000,
  ],
  ["recommendation", "Preferred recommendation", 10, 3000],
  ["reason", "Why this is the better recommendation", 10, 3000],
  ["alternatives", "Alternatives you would consider", 0, 2000],
  ["changeWhen", "Conditions that would change your recommendation", 10, 2000],
  [
    "escalateWhen",
    "When to involve the trainer or an appropriate professional",
    10,
    2000,
  ],
] as const;
const emptyHistoryFilters = {
  q: "",
  learningValue: "",
  category: "",
  subscriberId: "",
};
export function CoachingFeedbackQueue({ owner }: { owner: boolean }) {
  const [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [detail, setDetail] = useState<any>(),
    [draftDirty, setDraftDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [filters, setFilters] = useState(emptyHistoryFilters),
    [searchFields, setSearchFields] = useState(emptyHistoryFilters),
    [clientName, setClientName] = useState(""),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState("");
  const historyRequest = useRef(0),
    historyAbort = useRef<AbortController | null>(null);
  const load = useCallback(
    async (before?: string) => {
      const request = ++historyRequest.current;
      historyAbort.current?.abort();
      const controller = new AbortController();
      historyAbort.current = controller;
      setHistoryLoading(true);
      setHistoryError("");
      if (!before) {
        setRows([]);
        setNext(null);
      }
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });
      if (before) query.set("before", before);
      try {
        const data = await api(
          "/coaching/feedback?" + query.toString(),
          "GET",
          undefined,
          controller.signal,
        );
        if (request !== historyRequest.current) return;
        setRows((old) =>
          before
            ? [
                ...old,
                ...data.items.filter(
                  (item: any) => !old.some((row) => row.id === item.id),
                ),
              ]
            : data.items,
        );
        setNext(data.next);
      } catch (e) {
        if (request === historyRequest.current && !controller.signal.aborted)
          setHistoryError((e as Error).message);
      } finally {
        if (request === historyRequest.current) setHistoryLoading(false);
      }
    },
    [filters],
  );
  useEffect(() => {
    const reload = () => {
      void load();
    };
    reload();
    window.addEventListener("coaching-feedback-updated", reload);
    return () => {
      window.removeEventListener("coaching-feedback-updated", reload);
      ++historyRequest.current;
      historyAbort.current?.abort();
    };
  }, [load]);
  function search(value: typeof emptyHistoryFilters) {
    // Invalidate synchronously: a previous page cannot arrive between the
    // user's reset/search action and the effect for the new filters.
    ++historyRequest.current;
    historyAbort.current?.abort();
    setRows([]);
    setNext(null);
    setHistoryError("");
    setDetail(undefined);
    setError("");
    setNotice("");
    setDraftDirty(false);
    const selected = { ...value, q: value.q.trim() };
    setSearchFields(selected);
    setFilters(selected);
  }
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (detail)
        setDetail(await api(`/coaching/feedback/${detail.correction.id}`));
      await load();
      setDraftDirty(false);
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = detail?.correction,
    draft = detail?.draft,
    regression = detail?.regression;
  return (
    <section className="card" aria-label="Learn from coaching corrections">
      <h2>Learn from your corrections</h2>
      <p className="muted">
        Turn a reviewed correction into a reusable teaching case. Confirm it
        explicitly, then link independent checks before considering any coaching
        release.
      </p>
      <form
        aria-label="Search coaching history"
        onSubmit={(event) => {
          event.preventDefault();
          search(searchFields);
        }}
      >
        <Field label="Search corrections and outcome notes">
          <input
            type="search"
            name="q"
            maxLength={200}
            value={searchFields.q}
            placeholder="Request, preferred response, original response or reason"
            onChange={(event) =>
              setSearchFields({ ...searchFields, q: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Change type">
            <select
              name="learningValue"
              value={searchFields.learningValue}
              onChange={(event) =>
                setSearchFields({
                  ...searchFields,
                  learningValue: event.target.value,
                })
              }
            >
              <option value="">All corrections</option>
              <option value="meaningful">Meaningful changes</option>
              <option value="cosmetic">Cosmetic changes</option>
              <option value="decision">Decision changes</option>
              <option value="meaning">Meaning changes</option>
            </select>
          </Field>
          <Field label="Coaching category">
            <select
              name="category"
              value={searchFields.category}
              onChange={(event) =>
                setSearchFields({
                  ...searchFields,
                  category: event.target.value,
                })
              }
            >
              <option value="">All categories</option>
              {[
                "message",
                "program_build",
                "progression",
                "substitution",
                "schedule",
              ].map((category) => (
                <option key={category} value={category}>
                  {label(category)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {filters.subscriberId && (
          <p>Client: {clientName || "Selected client"}</p>
        )}
        <div className="button-row">
          <button className="button secondary" type="submit" disabled={busy}>
            Search history
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setClientName("");
              search(emptyHistoryFilters);
            }}
          >
            Reset history search
          </button>
        </div>
      </form>
      <p className="muted">
        Matches whole words, newest corrections first. Searching history does
        not approve a case for learning.
      </p>
      {historyError && (
        <div className="notice" role="alert">
          <p>{historyError}</p>
          <button
            type="button"
            className="button secondary"
            disabled={historyLoading}
            onClick={() => void load()}
          >
            Retry history
          </button>
        </div>
      )}
      {historyLoading && <p role="status">Loading coaching history…</p>}
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
      {!rows.length && !historyLoading && !historyError && (
        <p role="status">
          {Object.values(filters).some(Boolean)
            ? "No corrections match these filters. Try different words or reset the search."
            : "Your reviewed corrections will appear here."}
        </p>
      )}
      <div aria-label="Coaching history results" aria-busy={historyLoading}>
        {rows.map((row) => (
          <article key={row.id}>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              aria-expanded={detail?.correction.id === row.id}
              data-testid={`coaching-history-open-${row.id}`}
              onClick={async () => {
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  setDetail(await api(`/coaching/feedback/${row.id}`));
                  setDraftDirty(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {row.clientName || "Client"} · {label(row.data.category)} ·{" "}
              {new Date(row.created_at).toLocaleDateString()}
            </button>
            <p>
              {String(row.data.request || row.data.preferred.message).slice(
                0,
                240,
              )}
            </p>
            <p className="muted">
              {label(row.data.learningValue)} change · {row.outcomeCount}{" "}
              outcome note(s)
            </p>
            {row.matchedOutcome && (
              <p>
                <strong>Matching outcome:</strong> {row.matchedOutcome}
              </p>
            )}
            {!filters.subscriberId && row.owner_user_id && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setClientName(row.clientName || "Selected client");
                  search({ ...filters, subscriberId: row.owner_user_id });
                }}
              >
                Only this client's history
              </button>
            )}
          </article>
        ))}
      </div>
      {next && (
        <button
          className="button secondary"
          type="button"
          disabled={busy || historyLoading}
          onClick={() => void load(next)}
        >
          Load more corrections
        </button>
      )}
      {detail && (
        <div key={c.id}>
          <h3>Rejected and preferred decisions</h3>
          <p>
            <strong>Original:</strong>{" "}
            {label(c.data.rejected.type ?? "message")} ·{" "}
            {c.data.rejected.message}
          </p>
          <p>
            <strong>Preferred:</strong> {label(c.data.preferred.type)} ·{" "}
            {c.data.preferred.message}
          </p>
          <p>
            <strong>Reason:</strong>{" "}
            {c.data.explanation ??
              "Cosmetic wording edit; explanation was optional."}
          </p>
          <p className="muted">
            Changed:{" "}
            {c.data.semanticDiff.map((d: any) => label(d.field)).join(", ")}.
            Confidence before correction:{" "}
            {c.data.confidenceBeforeCorrection ?? "not provided"}.
          </p>
          {draft.status === "draft" ? (
            <>
              <h3>Review the teaching draft</h3>
              <p className="muted">
                Remove names, contact details and identifying facts. Keep the
                deciding conditions. This draft is not used by the digital coach
                until the owner confirms it.
              </p>
              <form
                key={`${draft.id}:${draft.version}`}
                onChange={() => setDraftDirty(true)}
                onSubmit={(event) => {
                  event.preventDefault();
                  const f = new FormData(event.currentTarget);
                  void run(
                    () =>
                      api(`/coaching/feedback/${c.id}/teaching-draft`, "POST", {
                        version: draft.version,
                        teaching: {
                          category: draft.data.category,
                          ...Object.fromEntries(
                            teachingFields.map(([key]) => [key, f.get(key)]),
                          ),
                          outcomeContext:
                            String(f.get("outcomeContext") ?? "").trim() ||
                            undefined,
                        },
                        outcomeIds: f.getAll("outcome"),
                      }),
                    "Teaching draft saved for review",
                  );
                }}
              >
                {teachingFields.map(([key, title, min, max]) => (
                  <Field key={key} label={title}>
                    <textarea
                      name={key}
                      defaultValue={draft.data[key] ?? ""}
                      required={min > 0}
                      minLength={min || undefined}
                      maxLength={max}
                      rows={3}
                    />
                  </Field>
                ))}
                <Field label="Reviewed outcome context (optional)">
                  <textarea
                    name="outcomeContext"
                    defaultValue={draft.data.outcomeContext ?? ""}
                    minLength={10}
                    maxLength={2000}
                    rows={3}
                    placeholder="Describe the general starting situation, what was tried and what happened. Remove names and identifying details."
                  />
                </Field>
                <p className="muted">
                  Write your own deidentified summary and select its supporting
                  outcomes. Outcome notes and client records are kept separate
                  from teaching. Describe observations without assuming the
                  correction caused the result.
                </p>
                {detail.outcomes.map((outcome: any) => (
                  <label className="check-field" key={outcome.id}>
                    <input
                      type="checkbox"
                      name="outcome"
                      value={outcome.id}
                      defaultChecked={
                        draft.data.reviewedOutcomeRefs?.some(
                          (ref: any) => ref.id === outcome.id,
                        ) ?? false
                      }
                    />
                    {outcome.data.note || "Linked outcome evidence"} ·{" "}
                    {new Date(outcome.created_at).toLocaleDateString()}
                  </label>
                ))}
                <button
                  className="button secondary"
                  type="submit"
                  disabled={busy}
                >
                  Save reviewed draft
                </button>
              </form>
              {owner ? (
                <form
                  key={`review:${draft.id}:${draft.version}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const f = new FormData(event.currentTarget);
                    void run(
                      () =>
                        api(
                          `/coaching/feedback/${c.id}/confirm-teaching`,
                          "POST",
                          {
                            version: draft.version,
                            reviewed: true,
                            clientDetailsRemoved: f.get("anonymized") === "on",
                            outcomeContextReviewed: draft.data.outcomeContext
                              ? f.get("outcomeReviewed") === "on"
                              : undefined,
                          },
                        ),
                      "Teaching confirmed. Evaluate the changed coaching material before activating a release.",
                    );
                  }}
                >
                  <label className="check-field">
                    <input type="checkbox" name="anonymized" required />I
                    reviewed the saved draft, removed identifying client details
                    and approve this teaching case.
                  </label>
                  {draft.data.outcomeContext && (
                    <label className="check-field">
                      <input type="checkbox" name="outcomeReviewed" required />I
                      reviewed this deidentified outcome summary against the
                      selected evidence and approve its use as a teaching
                      example.
                    </label>
                  )}
                  {draftDirty && (
                    <p className="muted">
                      Save your draft changes before confirming.
                    </p>
                  )}
                  <button
                    className="button"
                    type="submit"
                    disabled={busy || draftDirty}
                  >
                    Confirm saved teaching case
                  </button>
                </form>
              ) : (
                <p className="muted">
                  The trainer owner must confirm the saved draft.
                </p>
              )}
            </>
          ) : (
            <>
              <p>Teaching draft: {label(draft.status)}.</p>
              {draft.data.outcomeContext && (
                <p>
                  <strong>Reviewed outcome:</strong> {draft.data.outcomeContext}
                </p>
              )}
              {draft.status === "confirmed" && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api(
                          `/coaching/feedback/${c.id}/teaching-draft/revise`,
                          "POST",
                          { version: draft.version },
                        ),
                      "Revision prepared. Review any outcome summary and confirm the saved teaching before running fresh checks.",
                    )
                  }
                >
                  Revise teaching or add reviewed outcomes
                </button>
              )}
            </>
          )}
          {owner && regression && (
            <>
              <h3>Independent regression checks</h3>
              <p>
                Readiness: <strong>{label(regression.state)}</strong>.
              </p>
              <p className="muted">
                Held-out prompts stay in the independent-check workspace. A
                copied or renamed teaching example cannot qualify. Passing
                checks does not activate a release.
              </p>
              <div className="button-row">
                <a className="button secondary" href="/trainer/brain/checks">
                  Create and run independent checks
                </a>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {}, "Readiness refreshed")
                  }
                >
                  Refresh readiness
                </button>
              </div>
              {draft.status === "confirmed" &&
                regression.scenarios.length > 0 && (
                  <form
                    key={`${draft.id}:${draft.version}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const f = new FormData(event.currentTarget);
                      void run(
                        () =>
                          api(`/coaching/feedback/${c.id}/regression`, "POST", {
                            version: draft.version,
                            scenarioIds: f.getAll("scenario"),
                            independent: f.get("independent") === "on",
                          }),
                        "Independent checks linked",
                      );
                    }}
                  >
                    {regression.scenarios.map((scenario: any) => (
                      <label className="check-field" key={scenario.id}>
                        <input
                          type="checkbox"
                          name="scenario"
                          value={scenario.id}
                          defaultChecked={scenario.linked}
                        />
                        {label(scenario.category)} check ·{" "}
                        {new Date(scenario.createdAt).toLocaleString()}
                      </label>
                    ))}
                    <label className="check-field">
                      <input name="independent" type="checkbox" required />
                      These checks independently test the judgment in this
                      correction.
                    </label>
                    <button className="button" type="submit" disabled={busy}>
                      Link independent checks
                    </button>
                  </form>
                )}
              {regression.ready && (
                <a className="button secondary" href="/trainer/brain/autonomy">
                  Review release activation separately
                </a>
              )}
            </>
          )}
          <h3>Follow-up evidence</h3>
          <p className="muted">
            Link this client's later workout, progress measurement, check-in or
            conversation record to document what happened after the correction.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              void run(
                () =>
                  api(`/coaching/feedback/${c.id}/outcomes`, "POST", {
                    recordIds: f.getAll("evidence"),
                    note: f.get("note"),
                  }),
                "Follow-up evidence recorded",
              );
            }}
          >
            {detail.outcomeOptions.length ? (
              detail.outcomeOptions.map((evidence: any) => (
                <label className="check-field" key={evidence.id}>
                  <input type="checkbox" name="evidence" value={evidence.id} />
                  {label(evidence.kind)}: {evidence.title} ·{" "}
                  {new Date(evidence.created_at).toLocaleString()}
                </label>
              ))
            ) : (
              <p>No later client evidence is available yet.</p>
            )}
            <Field label="Observed outcome">
              <textarea name="note" maxLength={2000} rows={2} />
            </Field>
            <button
              className="button secondary"
              type="submit"
              disabled={busy || !detail.outcomeOptions.length}
            >
              Record outcome evidence
            </button>
          </form>
          {detail.outcomes.map((outcome: any) => (
            <p key={outcome.id}>
              {outcome.data.note || "Outcome evidence linked"} ·{" "}
              {outcome.data.references.length} record(s)
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
