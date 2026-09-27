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
      {!!step.links?.length && (
        <nav className="onboarding-actions" aria-label="Setup tools">
          {step.links.map((link: any) => (
            <Link className="button secondary" key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      )}
      {["interview", "knowledge", "scenarios", "readiness", "publish"].includes(
        stepKey,
      ) && (
        <section className="card" aria-label="Coaching readiness">
          <h2>Current coaching guidance</h2>
          <p>
            {data.teaching.confirmedRules} confirmed rules ·{" "}
            {data.teaching.coachingCases} coaching cases ·{" "}
            {data.teaching.actions} bounded actions
          </p>
          <p>
            {data.teaching.brainCurrent
              ? "Your published Brain matches its current rules and evaluation."
              : "Current guidance needs evaluation and publication."}
          </p>
          <p>
            {!data.teaching.modelReady
              ? "A coaching model connection is needed before digital responses are available."
              : data.teaching.runtime.current
                ? data.teaching.runtime.automatic
                  ? "Qualified routine actions run automatically. Exceptions go to you."
                  : "Shadow mode is active: proposed routine actions still need your review."
                : data.teaching.runtime.releaseId
                  ? "Automatic qualification is stale. New teaching, action limits or model settings need requalification."
                  : "Coaching responses currently need your review. Qualify bounded actions to enable automation."}
          </p>
        </section>
      )}
      {stepKey.startsWith("nutrition-") && data.teaching.nutrition && (
        <section className="card" aria-label="Nutrition readiness">
          <h2>Your nutrition teaching</h2>
          <p>
            {
              data.teaching.nutrition.coverage.filter((c: any) => c.taught > 0)
                .length
            }{" "}
            of {data.teaching.nutrition.coverage.length} decision areas taught ·{" "}
            {data.teaching.nutrition.calorieMethods} saved calorie methods
          </p>
          <p>
            Provide the recommendation, reasoning, alternatives, client
            conditions and limits. Calorie methods and client targets express
            your approach; the app does not choose a clinical formula for you.
          </p>
          {data.teaching.nutrition.questions.length > 0 && (
            <details>
              <summary>Next teaching questions</summary>
              <ul>
                {data.teaching.nutrition.questions.map((q: any) => (
                  <li key={q.key}>{q.prompt}</li>
                ))}
              </ul>
            </details>
          )}
          <p>
            Current case evaluation:{" "}
            {data.teaching.nutrition.evaluationCurrent ? "passed" : "needed"}.
            Sample week:{" "}
            {data.teaching.nutrition.previewCurrent ? "current" : "needed"}.
            Automatic delivery:{" "}
            {data.teaching.nutrition.ready ? "ready" : "not ready"}.
          </p>
          {stepKey === "nutrition-readiness" &&
            data.teaching.nutrition.gaps.length > 0 && (
              <ul>
                {data.teaching.nutrition.gaps.map((gap: string) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            )}
        </section>
      )}
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
              material and evaluated examples. You confirm your rules and action
              limits. Qualified routine actions can run automatically, while
              exceptions and unqualified responses need your review. Subscribers
              see when guidance is digital. Corrections keep their reason and
              evidence.
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
              Voice setup is optional. Record separate consent, submit your
              trainer voice and complete identity verification. The step becomes
              complete when verification, permission and provider approval are
              current.
            </p>
            <button
              className="button secondary"
              disabled={busy || step.status === "complete"}
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
              <code>{data.storefrontPath}</code>. Manage an owned domain and
              check its DNS and certificate status in Domains. The reserved
              address works independently of a custom domain.
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
            <section aria-label="Website and gallery preview">
              <h3>Your website and galleries</h3>
              <p>
                {data.preview.website.published
                  ? "Website content has been published."
                  : "Website content has not been published yet."}{" "}
                {data.preview.website.hasUnpublishedChanges
                  ? "The saved website draft has unpublished changes."
                  : ""}
              </p>
              {data.preview.website.draft && (
                <div>
                  <strong>Saved website draft</strong>
                  <p>
                    {data.preview.website.draft.headline ||
                      "No website headline saved."}
                  </p>
                  <p>{data.preview.website.draft.introduction}</p>
                </div>
              )}
              {data.preview.brandDraft && (
                <p>
                  A private app design draft is saved (version{" "}
                  {data.preview.brandDraft.version}). Review and apply it in
                  Design studio when ready.
                </p>
              )}
              <p>
                {data.preview.website.launchRequired
                  ? "Complete launch first, then publish your website draft in the website editor."
                  : "The website editor publishes its saved draft separately."}
              </p>
              <div className="onboarding-actions">
                <Link
                  className="button secondary"
                  href="/trainer/website/preview"
                >
                  Open private website preview
                </Link>
                <Link className="button secondary" href="/trainer/design">
                  Review app design
                </Link>
                <Link className="button secondary" href="/trainer/galleries">
                  Review photos and galleries
                </Link>
              </div>
              {data.preview.galleries.length > 0 ? (
                <ul>
                  {data.preview.galleries.map((g: any) => (
                    <li key={g.id}>
                      {g.title} · {g.photos.length} photos ·{" "}
                      {g.audience === "draft"
                        ? "private draft"
                        : g.audience === "both"
                          ? "website and client app"
                          : g.audience === "site"
                            ? "website"
                            : "client app"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No galleries saved yet.</p>
              )}
            </section>
            <section aria-label="Published legal documents">
              <h3>Current legal documents</h3>
              <ul>
                {data.preview.legal.documents.map((document: any) => (
                  <li key={document.key}>
                    {document.version === null ? (
                      `${document.title}: awaiting publication`
                    ) : (
                      <Link href={`/${document.key}`}>
                        {document.title} · version {document.version}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {!data.preview.legal.approved && (
                <p className="notice">
                  Operator approval of legal documents is pending.
                </p>
              )}
            </section>
            <p className="muted">
              This preview does not create a charge. Changes to saved teaching,
              action policies, nutrition methods, design, website, galleries,
              offers or effective legal documents require another review.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void save({ digest: data.previewDigest })}
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
