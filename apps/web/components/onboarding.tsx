"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { money } from "@trainer/domain";
async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1/onboarding" + path, {
    method: body ? "PUT" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message);
  return data;
}
function IdentityForm({ step, onSaved }: { step: any; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({
      country: "AE",
      ...step.values,
    }),
    [notice, setNotice] = useState("Changes save automatically."),
    [error, setError] = useState(false);
  const latest = useRef(draft),
    saved = useRef(JSON.stringify(draft)),
    version = useRef(step.version),
    saving = useRef(false),
    blocked = useRef(false);
  latest.current = draft;
  const persist = useCallback(async () => {
    if (saving.current || blocked.current) return;
    saving.current = true;
    try {
      while (saved.current !== JSON.stringify(latest.current)) {
        setNotice("Saving…");
        const values = { ...latest.current },
          json = JSON.stringify(values);
        const result = await request("/identity", {
          version: version.current,
          values,
        });
        version.current = result.version;
        saved.current = json;
        onSaved();
      }
      setNotice("Saved. You can continue on another device.");
    } catch (e) {
      blocked.current = true;
      setError(true);
      setNotice(
        (e as Error).message +
          " Your current text remains here. Reload to review the saved version.",
      );
    } finally {
      saving.current = false;
    }
  }, [onSaved]);
  useEffect(() => {
    if (saved.current === JSON.stringify(draft)) return;
    const timer = setTimeout(() => void persist(), 700);
    return () => clearTimeout(timer);
  }, [draft, persist]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void persist();
      }}
    >
      <div className="form-grid">
        {[
          ["businessName", "Business or trade name"],
          ["publicName", "Public coach name"],
          ["city", "City"],
          ["category", "Coaching specialty"],
          ["audience", "Who you coach"],
        ].map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              value={draft[key] ?? ""}
              maxLength={key === "audience" ? 500 : 100}
              required
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="field">
          <span>Country</span>
          <input value="United Arab Emirates" readOnly />
        </label>
      </div>
      <p className="muted">
        Licence status: not requested. Licence collection is a separate later
        workflow.
      </p>
      <p role="status" className={error ? "notice" : "muted"}>
        {notice}
      </p>
      <button className="button" disabled={error}>
        Save now
      </button>
      {error && (
        <button
          className="button secondary"
          type="button"
          onClick={() => location.reload()}
        >
          Reload saved version
        </button>
      )}
    </form>
  );
}
export function Onboarding({
  stepKey,
  revision,
  children,
}: {
  stepKey: string;
  revision: string;
  children?: ReactNode;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    void request("")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh, revision]);
  const step = data?.steps.find((s: any) => s.key === stepKey);
  async function save(values: unknown, defer = false) {
    setBusy(true);
    setError("");
    try {
      await request("/" + stepKey, { version: step.version, values, defer });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="notice" role="status">
        {error || "Loading your setup…"}
      </div>
    );
  if (!step)
    return (
      <div className="notice">
        Choose a setup step below.{" "}
        <Link href={"/trainer/onboarding/" + data.resumeStep}>
          Resume setup
        </Link>
      </div>
    );
  const index = data.steps.findIndex((s: any) => s.key === stepKey),
    next = data.steps[index + 1];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            YOUR COACHING BUSINESS · STEP {index + 1} OF {data.steps.length}
          </p>
          <h1>{step.label}</h1>
          <p>{step.description}</p>
        </div>
        <span className="badge">
          {data.steps.filter((s: any) => s.status === "complete").length} /{" "}
          {data.steps.length}
          complete
        </span>
      </div>
      <nav className="onboarding-steps" aria-label="Setup steps">
        {data.steps.map((s: any, i: number) => (
          <Link
            key={s.key}
            href={"/trainer/onboarding/" + s.key}
            aria-current={s.key === stepKey ? "step" : undefined}
          >
            <span>
              {i + 1}. {s.label}
            </span>
            <small>{s.status.replaceAll("_", " ")}</small>
          </Link>
        ))}
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {step.blocker && <p className="notice">{step.blocker}</p>}
      <section className="card">
        {stepKey === "identity" ? (
          <IdentityForm step={step} onSaved={refresh} />
        ) : stepKey === "account" ? (
          <>
            <p>
              Your reserved workspace: <strong>{data.reservedSlug}</strong>.
              Currency: AED. Timezone: Asia/Dubai.
            </p>
            <Link className="button secondary" href="/trainer/settings">
              Account security and email verification
            </Link>
          </>
        ) : stepKey === "brain-intro" ? (
          <>
            <p>
              Your Brain is a versioned set of coaching rules, supporting
              material and evaluated examples. You review extracted rules and
              each proposed response. Subscribers see when guidance is digital.
              Corrections preserve their reason and evidence.
            </p>
            <p>
              Offering workout + nutrition? Teach your nutrition approach
              through client cases. Qualified routine meal plans run
              automatically, with an exception queue for decisions outside your
              rules. <Link href="/trainer/nutrition">Set up nutrition</Link>
            </p>
            <p>
              Use only source material you have permission to use. Imported
              wearable data remains outside model prompts unless its rights
              explicitly permit that use.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void save({ understood: true })}
            >
              {step.status === "complete"
                ? "Understanding recorded"
                : "I understand how my Brain works"}
            </button>
          </>
        ) : stepKey === "wearables" ? (
          <>
            <p>
              Apple export imports are available. WHOOP and Zepp connections
              need approved adapters and provider access. No connection is
              implied by this choice.
            </p>
            <label className="field">
              <span>My coaching data policy</span>
              <select
                defaultValue={step.values.policy ?? "none"}
                onChange={(e) => void save({ policy: e.target.value })}
              >
                <option value="none">No wearable imports</option>
                <option value="permitted_imports">
                  Allow permitted manual imports
                </option>
              </select>
            </label>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void save({ policy: step.values.policy ?? "none" })
              }
            >
              Save policy
            </button>
          </>
        ) : stepKey === "voice" ? (
          <>
            <p>
              Voice setup is optional. Deferring it does not prevent text
              coaching.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void save({}, true)}
            >
              Defer voice setup
            </button>
          </>
        ) : stepKey === "domain" ? (
          <>
            <p>
              Your reserved slug is <strong>{data.reservedSlug}</strong>.
            </p>
            <p>
              After publication, your storefront is available at{" "}
              <code>{data.storefrontPath}</code>. Custom domains and subdomain
              DNS require deployment configuration; no domain has been
              purchased.
            </p>
          </>
        ) : stepKey === "preview" ? (
          <>
            <div className="storefront-preview">
              <p className="eyebrow">SUBSCRIBER PREVIEW</p>
              <h2>{data.preview.name}</h2>
              <h3>{data.preview.theme.headline || "Add your headline"}</h3>
              <p>{data.preview.theme.bio || "Add your coaching biography."}</p>
              <p>{data.preview.digitalDisclosure}</p>
              {data.preview.products.map((p: any) => (
                <div className="list-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <p>{p.description}</p>
                  </div>
                  <span>
                    {money(p.priceMinor)} / month · {p.status}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted">
              This preview does not create a charge. Changes to your brand,
              offer, Brain release or legal version require another review.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void save({})}
            >
              I have reviewed this preview
            </button>
          </>
        ) : stepKey === "publish" ? (
          <>
            {data.gates.length ? (
              <ul>
                {data.gates.map((g: any) => (
                  <li key={g.key}>
                    <strong>{g.label}:</strong> {g.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Your current setup meets the configured publishing gates.</p>
            )}
            <button
              className="button"
              disabled={busy || !data.readyToPublish}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await fetch("/api/v1/tenant/publish", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                  });
                  const result = await r.json();
                  if (!r.ok) throw new Error(result.message);
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Publish storefront
            </button>
            {step.status === "complete" && (
              <Link href={data.storefrontPath} className="text-button">
                Open storefront
              </Link>
            )}
          </>
        ) : (
          (children ?? (
            <p>Open the matching workspace section to complete this step.</p>
          ))
        )}
      </section>
      <div className="onboarding-actions">
        <button className="button secondary" onClick={refresh}>
          Refresh readiness
        </button>
        {next && (
          <Link className="button" href={"/trainer/onboarding/" + next.key}>
            Continue to {next.label}
          </Link>
        )}
      </div>
    </>
  );
}
