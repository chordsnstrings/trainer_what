"use client";
import { useEffect, useState } from "react";
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1/brain" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? "Import request failed.");
  return data;
}
async function upload(file: File, title: string, retryOf?: string) {
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file under 5 MB.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Could not read the selected file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
  return request("/documents", "POST", {
    fileName: file.name,
    title,
    contentBase64: base64,
    rights: true,
    ...(retryOf ? { retryOf } : {}),
  });
}
export function KnowledgeImportReview({
  onApproved,
}: {
  onApproved?: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => request("/imports").then(setRows);
  useEffect(() => {
    void load().catch((e) => setNotice(e.message));
  }, []);
  async function act(fn: () => Promise<any>, approved = false) {
    setBusy(true);
    try {
      const result = await fn();
      await load();
      setNotice(
        approved
          ? "Reviewed teaching material added to your knowledge."
          : "Import updated.",
      );
      if (approved) await onApproved?.();
      return result;
    } catch (e) {
      setNotice((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Import and review your teaching material</h2>
      <p className="muted">
        PDF, Word, spreadsheets, CSV/TSV, structured program JSON, text,
        Markdown or an image of printed notes. Up to 5 MB and 60,000 extracted
        characters; at most 30 PDF pages, including six scanned pages. Images
        and scans use local English OCR.
      </p>
      <p className="muted">
        Uploads stay private for your review. Check wording and numbers, remove
        personal details, then approve the material for your AI. The original
        file is deleted after extraction.
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act(() => upload(f.get("file") as File, String(f.get("title"))));
        }}
      >
        <label className="field">
          <span>Source title</span>
          <input name="title" minLength={2} maxLength={120} required />
        </label>
        <label className="field">
          <span>File</span>
          <input
            name="file"
            type="file"
            accept=".pdf,.docx,.xlsx,.csv,.tsv,.json,.txt,.md,.jpg,.jpeg,.png,.webp"
            required
          />
        </label>
        <label className="check-field">
          <input type="checkbox" required />I have permission to use this
          material for my coaching AI.
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Processing…" : "Extract for private review"}
        </button>
      </form>
      <details>
        <summary>Program JSON format</summary>
        <p className="muted">
          Use a single program or a {'{ "programs": [...] }'} collection.
          Programs become reviewed teaching material and are not automatically
          assigned to clients.
        </p>
        <pre style={{ overflowX: "auto" }}>
          {JSON.stringify(
            {
              title: "Beginner strength",
              goal: "Build consistent technique",
              daysPerWeek: 3,
              exercises: [
                {
                  name: "Goblet squat",
                  sets: 3,
                  reps: 8,
                  restSeconds: 90,
                  loadKg: 12,
                  cue: "Use a comfortable range",
                },
              ],
            },
            null,
            2,
          )}
        </pre>
      </details>
      <h3>Your imports</h3>
      {!rows.length && <p className="muted">No imports yet.</p>}
      {rows.map((r) => (
        <details
          key={r.id + ":" + r.version}
          open={r.status === "needs_review"}
        >
          <summary>
            {r.data.title} · {r.status.replaceAll("_", " ")}
          </summary>
          <p className="muted">
            {r.data.fileName} · {r.data.extraction ?? "Awaiting extraction"}
            {r.data.rawDeletedAt ? " · original file deleted" : ""}
          </p>
          {(r.data.warnings ?? []).map((warning: string) => (
            <p className="notice" key={warning}>
              {warning}
            </p>
          ))}
          {r.status === "needs_review" && (
            <Review row={r} busy={busy} act={act} />
          )}{" "}
          {r.status === "failed" && (
            <p className="notice">
              {r.data.error?.message ??
                "Extraction failed. Select the original file to retry."}
            </p>
          )}
          {(r.status === "failed" ||
            (r.status === "processing" &&
              new Date(r.data.leaseUntil).getTime() < Date.now())) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(() =>
                  upload(f.get("file") as File, r.data.title, r.id),
                );
              }}
            >
              <label className="field">
                <span>Select the same original file to retry</span>
                <input type="file" name="file" required />
              </label>
              <label className="check-field">
                <input type="checkbox" required />I still have permission to use
                this material.
              </label>
              <button className="button secondary" disabled={busy}>
                Retry extraction
              </button>
            </form>
          )}
          {r.status === "processing" && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh processing status
            </button>
          )}
          {["processing", "needs_review", "failed"].includes(r.status) && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  request(`/imports/${r.id}`, "DELETE", {
                    revision: r.version,
                  }),
                )
              }
            >
              Discard this import
            </button>
          )}
          {r.status === "approved" && (
            <p>
              Reviewed text was added to your knowledge. The unreviewed
              extracted copy was removed.
            </p>
          )}
        </details>
      ))}
    </section>
  );
}
function Review({
  row,
  busy,
  act,
}: {
  row: any;
  busy: boolean;
  act: (fn: () => Promise<any>, approved?: boolean) => Promise<any>;
}) {
  const [text, setText] = useState(row.data.text);
  return (
    <>
      {row.data.privacyMatches?.length > 0 && (
        <div className="notice">
          <p>
            {row.data.privacyMatches.length} possible personal identifiers were
            detected. Review the suggestions and remove identifying details.
            Detection is only an aid; review the full text.
          </p>
          <ul>
            {Array.from(
              new Set(row.data.privacyMatches.map((m: any) => m.type)),
            ).map((type: any) => (
              <li key={type}>{type}</li>
            ))}
          </ul>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void act(() =>
                request(`/imports/${row.id}/redact`, "POST", {
                  revision: row.version,
                }),
              )
            }
          >
            Redact detected identifiers
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act(
            () =>
              request(`/imports/${row.id}/review`, "POST", {
                revision: row.version,
                title: f.get("title"),
                text,
                rights: true,
                privacyReviewed: true,
              }),
            true,
          );
        }}
      >
        <label className="field">
          <span>Reviewed title</span>
          <input
            name="title"
            defaultValue={row.data.title}
            minLength={2}
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>Teaching text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            minLength={10}
            maxLength={60000}
            required
          />
        </label>
        <label className="check-field">
          <input type="checkbox" required />I checked the extracted wording and
          numbers, removed unnecessary personal details, and have permission to
          use the reviewed text in my coaching AI.
        </label>
        <button className="button" disabled={busy}>
          Approve teaching material
        </button>
      </form>
    </>
  );
}
