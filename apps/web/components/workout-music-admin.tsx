"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, Heading } from "./workspace-ui";
type Data = {
  enabled: boolean;
  target: number;
  playlists: Array<{ id: string; name: string }>;
  tracks: Array<{
    id: string;
    playlist: string;
    title: string;
    duration: number;
    status: string;
    review_note?: string;
  }>;
  jobs: Array<{
    id: string;
    playlist: string;
    slot: number;
    status: string;
    task_id?: string;
    error?: string;
    credit_limit: number;
    credits_before?: number;
    credits_after?: number;
  }>;
};
export function WorkoutMusicAdmin() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [credits, setCredits] = useState<number | null>(null),
    [selected, setSelected] = useState("flow");
  const intent = useRef<{ key: string; signature: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api("/admin/music"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>, message: string) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="music-admin stack">
      <Heading
        title="Workout music library"
        detail="Eight instrumental playlists. At least 30 distinct, approved songs in each. Generation uses account credits once; workout playback makes no generation calls."
      />
      <p>
        <Link href="/admin/settings">Music API settings</Link>
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p role="status">Loading library…</p>
      ) : (
        <>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  async () =>
                    setCredits((await api("/admin/music/credits")).credits),
                  "Credit balance checked. No generation.",
                )
              }
            >
              Check credits
            </button>
            <button className="button secondary" onClick={() => void load()}>
              Refresh
            </button>
            {credits !== null && <span>{credits} credits available</span>}
          </div>
          <div className="music-catalogue-grid">
            {data.playlists.map((p) => {
              const approved = data.tracks.filter(
                (t) => t.playlist === p.id && t.status === "approved",
              ).length;
              return (
                <button
                  key={p.id}
                  className="card music-playlist-choice"
                  aria-pressed={selected === p.id}
                  onClick={() => setSelected(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span>
                    {approved} / {data.target} approved
                  </span>
                  <span>
                    {
                      data.tracks.filter(
                        (t) => t.playlist === p.id && t.status === "review",
                      ).length
                    }{" "}
                    awaiting review
                  </span>
                </button>
              );
            })}
          </div>
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const requests = Number(form.get("requests"));
              const signature = selected + ":" + requests;
              if (intent.current?.signature !== signature)
                intent.current = { key: crypto.randomUUID(), signature };
              void act(
                () =>
                  api("/admin/music/generate", "POST", {
                    requestId: intent.current!.key,
                    playlist: selected,
                    requests,
                  }),
                "Batch queued. The worker will store tracks for review.",
              ).then((ok) => {
                if (ok) intent.current = null;
              });
            }}
          >
            <h2>
              Generate for {data.playlists.find((p) => p.id === selected)?.name}
            </h2>
            <p className="muted">
              Start with one request per genre. Review those outputs before
              filling the playlist. A request may return several versions. The
              configured daily budget and available credits limit every batch.
              No automatic top-up or retry of an unknown submission.
            </p>
            <label>
              Generation requests
              <input
                type="number"
                name="requests"
                min="1"
                max="15"
                defaultValue="1"
                required
              />
            </label>
            <button className="button" disabled={busy || !data.enabled}>
              {busy ? "Working…" : "Queue generation"}
            </button>
            {!data.enabled && (
              <p className="muted">
                Generation is disabled in Music API settings.
              </p>
            )}
          </form>
          <details className="card">
            <summary>Import already-generated music</summary>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const file = new FormData(e.currentTarget).get(
                  "manifest",
                ) as File;
                void act(async () => {
                  if (!file || file.size > 65536)
                    throw new Error(
                      "Choose a task manifest smaller than 64 KB.",
                    );
                  const manifest = JSON.parse(await file.text());
                  await api("/admin/music/import", "POST", {
                    tasks: manifest.tasks,
                  });
                }, "Existing tasks queued for verification and download. No generation credits spent.");
              }}
            >
              <p className="muted">
                Upload the task manifest from the catalogue build. Repeating an
                import is safe. The worker verifies instrumental requests and
                saves permanent audio for review.
              </p>
              <label>
                Task manifest
                <input
                  name="manifest"
                  type="file"
                  accept="application/json,.json"
                  required
                />
              </label>
              <button className="button secondary" disabled={busy}>
                Import existing tasks
              </button>
            </form>
          </details>
          <h2>Review tracks</h2>
          {!data.tracks.some((t) => t.playlist === selected) && (
            <p className="muted">No generated tracks yet.</p>
          )}
          {data.tracks
            .filter((t) => t.playlist === selected)
            .map((t) => (
              <form
                className="card stack"
                key={t.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const status =
                    (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                      "value",
                    ) ?? "approved";
                  void act(
                    () =>
                      api(`/admin/music/${t.id}/review`, "POST", {
                        status,
                        note: String(f.get("note") ?? ""),
                        ...(f.get("instrumental")
                          ? { instrumental: true }
                          : {}),
                      }),
                    "Track review saved.",
                  );
                }}
              >
                <div className="card-heading">
                  <h3>{t.title}</h3>
                  <span className="badge">
                    {t.status} · {Math.round(Number(t.duration))}s
                  </span>
                </div>
                <audio
                  controls
                  preload="none"
                  src={`/api/v1/admin/music/${t.id}/audio`}
                />
                <label className="voice-check">
                  <input type="checkbox" name="instrumental" />I checked for
                  vocals, harsh clipping, abrupt silence and distracting
                  changes.
                </label>
                <label>
                  Review note
                  <input
                    name="note"
                    required
                    minLength={3}
                    maxLength={600}
                    defaultValue={t.review_note ?? ""}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    type="submit"
                    value="approved"
                    disabled={busy}
                  >
                    Approve
                  </button>
                  <button
                    className="button secondary"
                    type="submit"
                    value="rejected"
                    disabled={busy}
                  >
                    Reject
                  </button>
                </div>
              </form>
            ))}
          <details>
            <summary>Generation jobs · {data.jobs.length}</summary>
            <div className="stack">
              {data.jobs
                .filter((j) => j.playlist === selected)
                .map((j) => (
                  <div className="card stack" key={j.id}>
                    <p>
                      {j.playlist} #{j.slot + 1} · {j.status} · {j.credit_limit}{" "}
                      credits reserved
                    </p>
                    {j.task_id && (
                      <p>
                        Provider task: <code>{j.task_id}</code>
                      </p>
                    )}
                    {j.error && <p role="status">{j.error}</p>}
                    {j.credits_before != null && j.credits_after != null && (
                      <p>
                        Account balance: {j.credits_before} → {j.credits_after}{" "}
                        credits. Other account activity can affect this
                        difference.
                      </p>
                    )}
                    {j.status === "queued" && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              api(
                                `/admin/music/jobs/${j.id}/reconcile`,
                                "POST",
                                { cancel: true },
                              ),
                            "Unsent job cancelled.",
                          )
                        }
                      >
                        Cancel unsent job
                      </button>
                    )}
                    {["unknown", "failed"].includes(j.status) && (
                      <form
                        className="stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const taskId = String(
                            new FormData(e.currentTarget).get("taskId") ?? "",
                          );
                          void act(
                            () =>
                              api(
                                `/admin/music/jobs/${j.id}/reconcile`,
                                "POST",
                                { taskId },
                              ),
                            "Provider task attached for reconciliation. No generation request sent.",
                          );
                        }}
                      >
                        <label>
                          Existing provider task ID
                          <input
                            name="taskId"
                            required
                            maxLength={200}
                            defaultValue={j.task_id ?? ""}
                          />
                        </label>
                        <button className="button secondary" disabled={busy}>
                          Reconcile existing task
                        </button>
                      </form>
                    )}
                  </div>
                ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
