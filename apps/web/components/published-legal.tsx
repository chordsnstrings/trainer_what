"use client";
import { useEffect, useState } from "react";
export function PublishedLegal({
  documentKey,
}: {
  documentKey: "terms" | "privacy" | "ai-disclosure";
}) {
  const [version, setVersion] = useState(""),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => setVersion(""), [documentKey]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void fetch(
      `/api/v1/public/documents/${documentKey}${version ? `?version=${version}` : ""}`,
    )
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.message ?? "Document unavailable.");
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [documentKey, version]);
  return (
    <main className="public-page">
      <a href="/">Home</a>
      <article className="card">
        <p className="eyebrow">PLATFORM DOCUMENT</p>
        <h1>
          {data?.document.title ??
            {
              terms: "Terms",
              privacy: "Privacy",
              "ai-disclosure": "AI disclosure",
            }[documentKey]}
        </h1>
        {error ? (
          <p className="notice" role="status">
            {error}
          </p>
        ) : !data ? (
          <p role="status">Loading approved document…</p>
        ) : (
          <>
            <label className="field">
              <span>Published version</span>
              <select
                value={version || String(data.document.version)}
                onChange={(e) => setVersion(e.target.value)}
              >
                {data.versions.map((v: any) => (
                  <option value={v.version} key={v.version}>
                    Version {v.version} · effective{" "}
                    {new Date(v.effective_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Version {data.document.version} · effective{" "}
              {new Date(data.document.effective_at).toLocaleString()}
            </p>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {data.document.content}
            </div>
          </>
        )}
      </article>
    </main>
  );
}
