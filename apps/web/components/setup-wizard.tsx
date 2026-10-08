"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  ExternalLink,
  MessageCircle,
} from "lucide-react";
import { STRIPE_MIN_CHARGE_AED_MINOR } from "@trainer/contracts";
import { Meter } from "./phone-ui";
import dynamic from "next/dynamic";
import { confirmWorkspace } from "./workspace-feedback";
import { flushWorkspaceEdits, useSaveBeforeLeave, useWorkspaceValue } from "./workspace-continuity";
const WebsitePreview = dynamic(() => import("./coach-site").then(m => m.CoachWebsite), { loading: () => <p role="status">Loading your website preview…</p> });
import { AssistantPanel } from "./setup-assistant-panel";
import { BrainStep, KeepTraining, useTeach } from "./setup-brain";
import { OnboardingChat } from "./onboarding-chat";
import { useSearchParams } from "next/navigation";
import { setupApi } from "./setup-wizard-api";
import {
  KEEP_TRAINING,
  aboutFromDraft,
  pageFromDraft,
  planFromDraft,
  STATUS_WORDS,
  canSkip,
  checkStep,
  emirateLabel,
  goLiveGroups,
  hasChat,
  neighbours,
  priceMinor,
  setupHref,
  setupView,
  subdomainInput,
  subdomainLine,
  suggestedPlanName,
  timeLeft,
  type ApiError,
  type GoLiveCheck,
  type SetupStepKey,
  type SubdomainCheck,
  type WizardStep,
} from "./setup-wizard-model";

/**
 * The coach setup wizard (docs/features/setup-wizard.md): six steps, about
 * 15 minutes, one progress bar, save and continue later, Back and Skip for
 * later, prefilled answers, and on every step either the short form or a
 * chat with the setup assistant. After going live, "Keep training".
 */
type Setup = {
  steps: WizardStep[];
  progress: {
    done: number;
    total: number;
    percent: number;
    minutesLeft: number;
  };
  resumeStep: SetupStepKey;
  published: boolean;
  about: {
    values: Record<string, string | null>;
    version: number;
    specialties: Array<{ id: string; label: string }>;
    emirates: string[];
    fromEarlyAccess: boolean;
  };
  page: {
    brandReady: boolean;
    approved: boolean;
    approvalVersion: number;
    digest: string;
    issues: Array<{ field: string; issue: string }>;
    subdomain: {
      name: string;
      host: string | null;
      confirmed: boolean;
      version: number;
      live: boolean;
    };
  };
  brain: {
    minimum: { quiz: number; own: number };
    quizAnswered: number;
    ownCases: number;
    enoughCases: boolean;
    quizCompleted: boolean;
    confirmedRules: number;
    checked: boolean;
  };
  plan: {
    priced: boolean;
    plans: Array<{
      id: string;
      status: string;
      name: string;
      priceMinor: number;
      billing: string;
    }>;
  };
  goLive: {
    checks: GoLiveCheck[];
    ready: boolean;
    waitingOnTrainsyou: string[];
  };
  security: {
    authenticatorRequired: boolean;
    authenticatorEnrolled: boolean;
    hasPassword: boolean;
    verifiedRecently: boolean;
  };
  grow: Array<{
    key: string;
    label: string;
    done: boolean;
    href: string;
    note?: string;
    optional?: boolean;
  }>;
};
const BRAIN_CHANGED = "setup-brain-changed";
type Tenant = {
  name: string;
  slug: string;
  theme?: Record<string, any> | null;
};
type Draft = Record<string, unknown>;

export function SetupWizard({ path, tenant, onSaved }: { path: string; tenant: Tenant; onSaved: () => Promise<void> | void }) {
  const query = useSearchParams();
  const [details, setDetails] = useWorkspaceValue("coach:onboarding-details", false, true);
  const explicitDetails = query.get("details") === "1";
  const router = useRouter();
  const close = () => { setDetails(false); if (explicitDetails) router.replace(path); };
  if (details || explicitDetails) return <div className="onboarding-fallback"><button className="button secondary" type="button" onClick={close}><MessageCircle size={16} /> Back to conversation</button><SetupWizardDetails path={path} tenant={tenant} onSaved={onSaved} /></div>;
  return <OnboardingChat audience="coach" mode={setupView(path).keepTraining ? "teach" : "setup"} onSaved={onSaved} onDetails={() => setDetails(true)} />;
}

function SetupWizardDetails({
  path,
  tenant,
  onSaved,
}: {
  path: string;
  tenant: Tenant;
  onSaved: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null),
    [error, setError] = useState(""),
    [chat, setChat] = useState(false),
    [draft, setDraft] = useState<{ step: SetupStepKey; values: Draft } | null>(
      null,
    );
  const load = useCallback(async () => {
    try {
      setSetup(await setupApi("/setup"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const view = setupView(path);
  const saved = useCallback(async () => {
    await Promise.all([load(), onSaved()]);
  }, [load, onSaved]);
  const heading = useRef<HTMLHeadingElement>(null);
  const current: SetupStepKey | null =
    view.step ??
    (setup && !view.keepTraining && !setup.published ? setup.resumeStep : null);
  useEffect(() => {
    setChat(false);
    heading.current?.focus({ preventScroll: true });
  }, [current, view.keepTraining]);
  if (!setup)
    return error ? (
      <div className="notice error" role="alert">
        {error}{" "}
        <button type="button" className="text-link" onClick={() => void load()}>
          Try again
        </button>
      </div>
    ) : (
      <p className="muted">Loading your setup…</p>
    );
  if (!current)
    return (
      <div className="setup-wizard">
        <header className="setup-top">
          <p className="eyebrow">
            {setup.published ? "Your page is live" : "Before you go live"}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            Keep training
          </h1>
          <p className="muted">
            The more you teach, the more your Brain can do on its own. You stay
            in charge of every level.
          </p>
          {!setup.published && (
            <Link className="text-link" href={setupHref(setup.resumeStep)}>
              Back to setup
            </Link>
          )}
        </header>
        <KeepTraining grow={setup.grow} />
      </div>
    );
  const index = setup.steps.findIndex((s) => s.key === current);
  const step = setup.steps[index];
  const { previous, next } = neighbours(current);
  const skip = async () => {
    if (!canSkip(current) || !(await flushWorkspaceEdits())) return;
    try {
      const fresh = await setupApi("/setup");
      await setupApi(`/setup/${current}`, "PUT", {
        version: current === "about" ? fresh.about.version : fresh.steps.find((s: WizardStep) => s.key === current).version,
        values: current === "about" ? Object.fromEntries(Object.entries(fresh.about.values).filter(([, v]) => v != null)) : {},
        skip: true,
      });
      await load();
      router.push(setupHref(next ?? "live"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="setup-wizard">
      <header className="setup-top">
        <div className="setup-top-line">
          <p className="eyebrow">
            Step {index + 1} of {setup.steps.length}
          </p>
          <Link className="text-link" href="/trainer">
            Save and continue later
          </Link>
        </div>
        <h1 ref={heading} tabIndex={-1}>
          {step.label}
        </h1>
        <div className="setup-progress">
          <Meter
            value={setup.progress.percent}
            max={100}
            label="Setup progress"
            className="setup-meter"
            memoryKey="setup-progress"
          />
          <span>
            <Clock size={14} aria-hidden="true" /> {setup.progress.done} of{" "}
            {setup.progress.total} done · {timeLeft(setup.progress.minutesLeft)}
          </span>
        </div>
        <nav aria-label="Setup steps" className="setup-steps">
          <ol>
            {setup.steps.map((s, i) => (
              <li key={s.key} className={`is-${s.status}`}>
                <Link
                  href={setupHref(s.key)}
                  aria-current={s.key === current ? "step" : undefined}
                >
                  <span className="setup-step-mark" aria-hidden="true">
                    {s.status === "done" ? <Check size={13} /> : i + 1}
                  </span>
                  <span className="setup-step-text">
                    {s.label}
                    <small>{STATUS_WORDS[s.status]}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className={`setup-body${chat ? " has-chat" : ""}`}>
        <section className="setup-main" aria-labelledby="setup-step-title">
          <div className="setup-step-head">
            <h2 id="setup-step-title" className="sr-only">
              {step.label}
            </h2>
            {hasChat(current) && !chat && (
              <button
                type="button"
                className="button secondary setup-chat-open"
                onClick={() => setChat(true)}
              >
                <MessageCircle size={16} /> Chat with the assistant
              </button>
            )}
          </div>
          {current === "account" ? (
            <AccountStep setup={setup} />
          ) : current === "about" ? (
            <AboutStep
              setup={setup}
              draft={draft?.step === "about" ? draft.values : null}
              onSaved={saved}
            />
          ) : current === "page" ? (
            <PageStep
              setup={setup}
              tenant={tenant}
              draft={draft?.step === "page" ? draft.values : null}
              onSaved={saved}
            />
          ) : current === "brain" ? (
            <BrainStepFrame onSaved={saved} chat={() => setChat(true)} />
          ) : current === "plan" ? (
            <PlanStep
              setup={setup}
              draft={draft?.step === "plan" ? draft.values : null}
              onSaved={saved}
            />
          ) : (
            <LiveStep setup={setup} onSaved={saved} />
          )}
          <nav className="setup-actions" aria-label="Step actions">
            {previous ? (
              <Link className="button secondary" href={setupHref(previous)}>
                <ArrowLeft size={16} /> Back
              </Link>
            ) : (
              <span />
            )}
            <div className="button-row">
              {canSkip(current) && step.status !== "done" && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void skip()}
                >
                  Skip for later
                </button>
              )}
              {next && (
                <Link className="button" href={setupHref(next)}>
                  Continue <ArrowRight size={16} />
                </Link>
              )}
            </div>
          </nav>
        </section>
        {hasChat(current) && (
          <AssistantPanel
            key={current}
            step={current}
            open={chat}
            onClose={() => setChat(false)}
            onUseDraft={(values) =>
              setDraft({ step: current, values: { ...values, at: Date.now() } })
            }
            onTaught={() => {
              window.dispatchEvent(new Event(BRAIN_CHANGED));
              void saved();
            }}
          />
        )}
      </div>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return text ? (
    <p className="notice error" role="alert">
      {text}
    </p>
  ) : null;
}

// ------------------------------------------------------------ 1 account

function AccountStep({ setup }: { setup: Setup }) {
  const verified = setup.steps[0].status === "done";
  return (
    <div className="setup-panel">
      {verified ? (
        <p className="setup-done-line">
          <Check size={16} /> Your account is ready and your email is confirmed.
        </p>
      ) : (
        <p>
          Open the link we emailed you to confirm your address. You can keep
          going meanwhile; your page goes live once it is confirmed.
        </p>
      )}
      <p className="muted">
        Your profile saves as you type. Unfinished page and plan drafts stay in this tab until you save them.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ 2 about you

const ABOUT_FIELDS = [
  "name",
  "specialty",
  "audience",
  "emirate",
  "instagram",
  "programmeUrl",
] as const;
function AboutStep({
  setup,
  draft,
  onSaved,
}: {
  setup: Setup;
  draft: Draft | null;
  onSaved: () => Promise<void>;
}) {
  const start = () =>
    Object.fromEntries(
      ABOUT_FIELDS.map((k) => [k, String(setup.about.values[k] ?? "")]),
    ) as Record<(typeof ABOUT_FIELDS)[number], string>;
  const [answerDraft, setAnswerDraft, clearAnswerDraft] = useWorkspaceValue("setup:about", { values: start(), version: setup.about.version }, true),
    [status, setStatus] = useState("Your answers save as you type."),
    [stale, setStale] = useState(false),
    [problem, setProblem] = useState("");
  const values = answerDraft.values;
  const version = useRef(answerDraft.version),
    savedJson = useRef(JSON.stringify(start())),
    saving = useRef(false),
    latest = useRef(values);
  latest.current = values;
  const setValues = (next: typeof values | ((previous: typeof values) => typeof values)) => {
    const v = typeof next === "function" ? next(latest.current) : next;
    latest.current = v;
    setAnswerDraft({ values: v, version: version.current });
  };
  // Assistant draft: copied into the form once, then saved like typing
  // (reloads after each save must not copy it over later edits).
  const offered = useRef(setup.about);
  offered.current = setup.about;
  useEffect(() => {
    if (!draft) return;
    setValues((v) => ({ ...v, ...aboutFromDraft(draft, offered.current) }));
  }, [draft]);
  const pending = useRef<Promise<boolean> | null>(null);
  const persist = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current;
    const save = async () => {
      saving.current = true;
      try {
        do {
        while (savedJson.current !== JSON.stringify(latest.current)) {
          const snapshot = latest.current, json = JSON.stringify(snapshot);
          setStatus("Saving…");
          const out = await setupApi("/setup/about", "PUT", {
            version: version.current,
            values: { ...snapshot, ...(offered.current.values.programmeSourceId ? { programmeSourceId: offered.current.values.programmeSourceId } : {}) },
          });
          version.current = out.version;
          savedJson.current = json;
          setAnswerDraft({ values: latest.current, version: out.version });
        }
        await onSaved();
        } while (savedJson.current !== JSON.stringify(latest.current));
        clearAnswerDraft();
        setStale(false);
        setProblem("");
        setStatus("Saved. You can continue on another device.");
        return true;
      } catch (e) {
        const err = e as ApiError;
        setStale(err.code === "STALE_ONBOARDING");
        setProblem(err.code === "STALE_ONBOARDING"
          ? "These answers changed in another window. Your edits are still here. Reload the saved version before replacing it."
          : err.message);
        setStatus("Not saved. Your answers are still here.");
        return false;
      } finally { saving.current = false; pending.current = null; }
    };
    pending.current = save();
    return pending.current;
  }, [onSaved]);
  useSaveBeforeLeave(() => savedJson.current !== JSON.stringify(latest.current) || saving.current, persist);
  const leaveSave = useRef(persist);
  leaveSave.current = persist;
  useEffect(() => () => {
    if (savedJson.current !== JSON.stringify(latest.current)) void leaveSave.current();
  }, []);
  useEffect(() => {
    if (savedJson.current === JSON.stringify(values)) return;
    const timer = setTimeout(() => void persist(), 800);
    return () => clearTimeout(timer);
  }, [values, persist]);
  const reloadAnswers = async () => {
    if (!(await confirmWorkspace({ title: "Load saved answers?", detail: "Your unsaved answers will be replaced with the latest saved version.", confirm: "Load saved answers" }))) return;
    try {
      const fresh = await setupApi("/setup");
      const answers = Object.fromEntries(ABOUT_FIELDS.map(key => [key, String(fresh.about.values[key] ?? "")])) as typeof values;
      version.current = fresh.about.version;
      savedJson.current = JSON.stringify(answers);
      setValues(answers); clearAnswerDraft(); setStale(false); setProblem("");
      setStatus("Saved answers loaded."); await onSaved();
    } catch (error) { setProblem((error as Error).message); }
  };
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues({ ...values, [k]: e.target.value });
  return (
    <form
      className="setup-panel setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        void persist();
      }}
    >
      {setup.about.fromEarlyAccess && (
        <p className="muted">
          We filled in what you told us when you joined early access.
        </p>
      )}
      <label className="field">
        <span>Your name, as clients will see it</span>
        <input
          aria-label="Your name, as clients will see it"
          value={values.name}
          onChange={set("name")}
          autoComplete="name"
          maxLength={100}
          placeholder="First and last name"
        />
      </label>
      <label className="field">
        <span>Your specialty</span>
        <select
          aria-label="Your specialty"
          value={values.specialty}
          onChange={set("specialty")}
        >
          <option value="">Choose one</option>
          {setup.about.specialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Who you coach</span>
        <textarea
          aria-label="Who you coach"
          rows={3}
          value={values.audience}
          onChange={set("audience")}
          maxLength={500}
          placeholder="For example: busy parents who want to get strong at home"
        />
      </label>
      <div className="setup-form-row">
        <label className="field">
          <span>Where you coach</span>
          <select
            aria-label="Where you coach"
            value={values.emirate}
            onChange={set("emirate")}
          >
            <option value="">Choose one</option>
            {setup.about.emirates.map((id) => (
              <option key={id} value={id}>
                {emirateLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Instagram <span className="muted">(optional)</span>
          </span>
          <input
            aria-label="Instagram (optional)"
            value={values.instagram}
            onChange={set("instagram")}
            maxLength={31}
            placeholder="yourname"
            autoCapitalize="none"
          />
        </label>
      </div>
      <ProgrammeMaterial
        url={values.programmeUrl}
        onUrl={(programmeUrl) => setValues({ ...values, programmeUrl })}
      />
      <p className="muted" role="status">
        {status}
      </p>
      {problem && (stale ? <button type="button" className="button secondary" onClick={() => void reloadAnswers()}>Load saved answers</button> : <button type="button" className="button secondary" onClick={() => void persist()}>Retry saving</button>)}
      <Problem text={problem} />
    </form>
  );
}

/** Optional programme PDF or website: kept private until the coach reviews it. */
function ProgrammeMaterial({
  url,
  onUrl,
}: {
  url: string;
  onUrl: (url: string) => void;
}) {
  const [rights, setRights] = useState(false),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [problem, setProblem] = useState("");
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      await fn();
      setNote(done);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="setup-material">
      <legend>
        Your programme <span className="muted">(optional)</span>
      </legend>
      <p className="muted">
        A PDF or your website helps your Brain learn how you coach. It stays
        private, and you check what we read before anything uses it.
      </p>
      <label className="field">
        <span>Website link</span>
        <input
          aria-label="Website link"
          type="url"
          inputMode="url"
          value={url}
          maxLength={500}
          placeholder="https://yourname.com"
          onChange={(e) => onUrl(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Programme file (PDF, Word, Excel or text, up to 5 MB)</span>
        <input
          aria-label="Programme file (PDF, Word, Excel or text, up to 5 MB)"
          type="file"
          accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
          disabled={busy || !rights}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
              setProblem("This file is larger than 5 MB.");
              return;
            }
            void run(async () => {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const title = file.name
                .replace(/\.[^.]+$/, "")
                .trim()
                .slice(0, 120);
              let binary = "";
              for (let i = 0; i < bytes.length; i += 0x8000)
                binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
              await setupApi("/brain/documents", "POST", {
                fileName: file.name,
                contentBase64: btoa(binary),
                title: title.length >= 2 ? title : "My programme",
                rights: true,
              });
            }, "Uploaded. Check what we read in My Brain, Files, before it is used.");
          }}
        />
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={rights}
          onChange={(e) => setRights(e.target.checked)}
        />
        This is my own material and I may use it.
      </label>
      {url && (
        <button
          type="button"
          className="button secondary"
          disabled={busy || !rights}
          onClick={() =>
            void run(
              () =>
                setupApi("/setup-assistant/website", "POST", {
                  url,
                  rights: true,
                }),
              "We read your website. Check the text in My Brain, Files, before it is used.",
            )
          }
        >
          Read my website
        </button>
      )}
      {note && (
        <p className="notice success" role="status">
          {note}{" "}
          <Link className="text-link" href="/trainer/brain">
            Open My Brain
          </Link>
        </p>
      )}
      <Problem text={problem} />
    </fieldset>
  );
}

// ------------------------------------------------------------ 3 your page

function PageStep({
  setup,
  tenant,
  draft,
  onSaved,
}: {
  setup: Setup;
  tenant: Tenant;
  draft: Draft | null;
  onSaved: () => Promise<void>;
}) {
  const theme = tenant.theme ?? {};
  const [headline, setHeadline, clearHeadline] = useWorkspaceValue("setup:headline", String(theme.headline ?? ""), true),
    [bio, setBio, clearBio] = useWorkspaceValue("setup:bio", String(theme.bio ?? ""), true),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    if (!draft) return;
    const d = pageFromDraft(draft);
    if (d.headline) setHeadline(d.headline);
    if (d.bio) setBio(d.bio);
  }, [draft]);
  useEffect(() => {
    let active = true;
    void setupApi("/tenant/design-draft").then(saved => {
      if (!active || !saved?.data) return;
      setHeadline(current => current === String(theme.headline ?? "") ? String(saved.data.headline ?? current) : current);
      setBio(current => current === String(theme.bio ?? "") ? String(saved.data.bio ?? current) : current);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const specialty = setup.about.specialties.find(
    (s) => s.id === setup.about.values.specialty,
  )?.label;
  const name = String(setup.about.values.name || tenant.name || "");
  const changed =
    headline !== String(theme.headline ?? "") ||
    bio !== String(theme.bio ?? "");
  const run = async (fn: () => Promise<unknown>, done: string, clearText = false) => {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      await fn();
      if (clearText) { clearHeadline(); clearBio(); }
      setNote(done);
      await onSaved();
    } catch (e) {
      const err = e as ApiError;
      setProblem(
        err.code === "PREVIEW_CHANGED" || err.code === "STALE_ONBOARDING"
          ? "Your page changed since this loaded. It has been refreshed; check it and approve again."
          : err.message,
      );
      if (err.code === "PREVIEW_CHANGED" || err.code === "STALE_ONBOARDING")
        await onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup-page">
      <form
        className="setup-panel setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              setupApi("/tenant/brand", "PUT", {
                name: name.length >= 2 ? name : tenant.name,
                headline: headline.trim(),
                bio: bio.trim(),
                category: specialty ?? String(theme.category ?? ""),
                accent: /^#[0-9a-fA-F]{6}$/.test(String(theme.accent ?? ""))
                  ? theme.accent
                  : "#0F766E",
                expectedVersion: Number(theme.brandVersion ?? 0),
              }),
            "Saved to your page.", true,
          );
        }}
      >
        <h3>Your page text</h3>
        <label className="field">
          <span>Headline</span>
          <input
            disabled={busy}
            aria-label="Headline"
            value={headline}
            maxLength={160}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Strength coaching for busy parents in Dubai"
          />
        </label>
        <label className="field">
          <span>About you</span>
          <textarea
            disabled={busy}
            aria-label="About you"
            rows={5}
            value={bio}
            maxLength={2000}
            onChange={(e) => setBio(e.target.value)}
            placeholder="How you coach and who it is for, in a few sentences."
          />
          <small>
            No phone numbers, links or health claims; clients contact you
            through your page.
          </small>
        </label>
        <button
          className="button secondary"
          disabled={busy || !changed || !headline.trim() || !bio.trim()}
        >
          Save page text
        </button>
      </form>
      {changed && <p className="muted" role="status">Text draft kept on this device. Save page text to apply it.</p>}
      <section className="setup-panel setup-builder-entry">
        <div><h3>Your website</h3><p>Choose a starter, edit your pages and preview the site clients will see.</p></div>
        <Link className="button" href="/trainer/website?from=setup">Open website builder</Link>
      </section>
      <div className="setup-real-preview" aria-label="Your website draft preview"><WebsitePreview preview path="" /></div>
      <SubdomainPicker setup={setup} onSaved={onSaved} />
      <section className="setup-panel" aria-labelledby="page-approve">
        <h3 id="page-approve">Approve your page</h3>
        <p className="muted">Review the website above before approving. {setup.page.subdomain.host}</p>
        {setup.page.issues.length > 0 && (
          <ul className="setup-missing">
            {setup.page.issues.map((i) => (
              <li key={i.field + i.issue}>
                {i.issue === "medical_claim"
                  ? "Remove the health or medical claim"
                  : i.issue === "link"
                    ? "Remove the link"
                    : "Remove the contact details"}{" "}
                ({i.field.replace(/^theme\./, "").replaceAll(".", " ")}).
              </li>
            ))}
          </ul>
        )}
        {setup.page.approved ? (
          <p className="setup-done-line">
            <Check size={16} /> Approved. Changing what the public sees asks you
            again.
          </p>
        ) : (
          <button
            type="button"
            className="button"
            disabled={
              busy ||
              !setup.page.brandReady ||
              setup.page.issues.length > 0 ||
              changed
            }
            onClick={() =>
              void run(
                () =>
                  setupApi("/setup/page", "PUT", {
                    version: setup.page.approvalVersion,
                    values: { digest: setup.page.digest },
                  }),
                "Page approved.",
              )
            }
          >
            Approve my page
          </button>
        )}
        {!setup.page.brandReady && (
          <p className="muted">
            Add a headline and some text about you, and choose your specialty in
            About you.
          </p>
        )}
        <p>
          <Link className="text-link" href="/trainer/website/preview">
            Open the full preview <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </p>
      </section>
      {note && (
        <p className="notice success" role="status">
          {note}
        </p>
      )}
      <Problem text={problem} />
    </div>
  );
}

function SubdomainPicker({
  setup,
  onSaved,
}: {
  setup: Setup;
  onSaved: () => Promise<void>;
}) {
  const sub = setup.page.subdomain;
  const root =
    sub.host && sub.host.startsWith(sub.name + ".")
      ? sub.host.slice(sub.name.length + 1)
      : null;
  const [name, setName, clearNameDraft] = useWorkspaceValue("setup:address", sub.name, true),
    [check, setCheck] = useState<SubdomainCheck | null>(null),
    [checking, setChecking] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  const asked = useRef(0);
  useEffect(() => {
    if (!name) {
      setCheck(null);
      return;
    }
    const n = ++asked.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const out = await setupApi(
          "/setup/subdomain/check?name=" + encodeURIComponent(name),
        );
        if (n === asked.current) setCheck(out);
      } catch (e) {
        if (n === asked.current) setProblem((e as Error).message);
      } finally {
        if (n === asked.current) setChecking(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [name]);
  const line = subdomainLine(check, checking);
  const unchanged = name === sub.name;
  return (
    <form
      className="setup-panel setup-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setProblem("");
        try {
          await setupApi("/setup/subdomain", "PUT", {
            name,
            currentSlug: sub.name,
            version: sub.version,
          });
          clearNameDraft();
          await onSaved();
        } catch (err) {
          const x = err as ApiError;
          setProblem(
            x.code === "USE_WEB_ADDRESS" || x.code === "SLUG_CHANGED"
              ? x.message
              : x.message,
          );
          if (x.code === "SLUG_CHANGED") await onSaved();
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Your web address</h3>
      <p className="muted">
        Your page opens here once you go live. Pick something short, like your
        name.
      </p>
      <label className="field">
        <span>Address</span>
        <div className="input-affix setup-address">
          <input
            aria-label="Address"
            value={name}
            onChange={(e) => setName(subdomainInput(e.target.value))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="setup-address-line"
          />
          <span>.{root ?? "trainsyou.com"}</span>
        </div>
      </label>
      <p
        id="setup-address-line"
        className={`setup-address-line is-${line?.tone ?? "muted"}`}
        role="status"
      >
        {line?.text ?? ""}
      </p>
      {check && !check.available && (check.suggestions?.length ?? 0) > 0 && (
        <div className="setup-suggestions">
          <span className="muted">Free instead:</span>
          {check.suggestions!.map((s) => (
            <button
              key={s}
              type="button"
              className="setup-chip"
              onClick={() => setName(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {sub.confirmed && unchanged ? (
        <p className="setup-done-line">
          <Check size={16} /> Reserved for you.
        </p>
      ) : (
        <button
          className="button secondary"
          disabled={
            busy || checking || !check || !(check.available || check.current)
          }
        >
          {unchanged ? "Keep this address" : "Reserve this address"}
        </button>
      )}
      {setup.published && (
        <p className="muted">
          Your page is live, so address changes happen in{" "}
          <Link className="text-link" href="/trainer/domains">
            Web address
          </Link>
          ; the old address keeps forwarding.
        </p>
      )}
      <Problem text={problem} />
    </form>
  );
}

// ------------------------------------------------------------ 4 brain

function BrainStepFrame({
  onSaved,
  chat,
}: {
  onSaved: () => Promise<void>;
  chat: () => void;
}) {
  const teachState = useTeach();
  const { reload } = teachState;
  // Rules drafted in the chat show up here without a page reload.
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener(BRAIN_CHANGED, again);
    return () => window.removeEventListener(BRAIN_CHANGED, again);
  }, [reload]);
  return (
    <div className="setup-panel">
      <p>
        Your Brain drafts replies the way you would. Teach it three ways:
        approve its rules, answer a short quiz, and write a few client questions
        of your own. It starts in <strong>Waits for me</strong>: nothing reaches
        a client until you approve it.
      </p>
      <p>
        <button type="button" className="text-link" onClick={chat}>
          Prefer to talk it through? Chat with the assistant.
        </button>
      </p>
      <BrainStep teachState={teachState} onDone={onSaved} />
    </div>
  );
}

// ------------------------------------------------------------ 5 plan

function PlanStep({
  setup,
  draft,
  onSaved,
}: {
  setup: Setup;
  draft: Draft | null;
  onSaved: () => Promise<void>;
}) {
  const specialty = setup.about.specialties.find(
    (s) => s.id === setup.about.values.specialty,
  )?.label;
  const [name, setName, clearName] = useWorkspaceValue("setup:plan:name", suggestedPlanName(String(setup.about.values.name ?? ""), specialty), true),
    [description, setDescription, clearDescription] = useWorkspaceValue("setup:plan:description", "", true),
    [price, setPrice, clearPrice] = useWorkspaceValue("setup:plan:price", "", true),
    [billing, setBilling, clearBilling] = useWorkspaceValue<"monthly" | "upfront">("setup:plan:billing", "monthly", true),
    [days, setDays, clearDays] = useWorkspaceValue("setup:plan:days", "84", true),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    if (!draft) return;
    const d = planFromDraft(draft);
    if (d.name) setName(d.name);
    if (d.description) setDescription(d.description);
    if (d.price) setPrice(d.price);
    if (d.billing) setBilling(d.billing);
    if (d.days) setDays(d.days);
  }, [draft]);
  const minor = priceMinor(price);
  const tooLow = minor !== null && minor < STRIPE_MIN_CHARGE_AED_MINOR;
  const live = setup.plan.plans.filter((p) => p.status !== "archived");
  return (
    <div className="setup-plan">
      {live.length > 0 && (
        <section className="setup-panel" aria-labelledby="plan-list">
          <h3 id="plan-list">Your plans</h3>
          <ul className="setup-plans">
            {live.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                <span>
                  AED {(p.priceMinor / 100).toLocaleString("en-AE")}
                  {p.billing === "upfront" ? " once" : " a month"}
                </span>
              </li>
            ))}
          </ul>
          <Link className="text-link" href="/trainer/finance">
            Change plans in Earnings and plans
          </Link>
        </section>
      )}
      <form
        className="setup-panel setup-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (minor === null || tooLow) return;
          setBusy(true);
          setProblem("");
          setNote("");
          try {
            await setupApi("/products", "POST", {
              name: name.trim(),
              description: description.trim(),
              priceMinor: minor,
              billing,
              programmeDays: billing === "upfront" ? Number(days) : null,
            });
            setNote("Plan saved.");
            setPrice("");
            [clearName, clearDescription, clearPrice, clearBilling, clearDays].forEach(clear => clear());
            await onSaved();
          } catch (err) {
            setProblem((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>{live.length ? "Add another plan" : "Your first plan"}</h3>
        <p className="muted">Unfinished details stay on this device. Save plan when ready.</p>
        <label className="field">
          <span>Plan name</span>
          <input
            aria-label="Plan name"
            value={name}
            minLength={2}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            What clients get <span className="muted">(optional)</span>
          </span>
          <textarea
            aria-label="What clients get (optional)"
            rows={3}
            maxLength={1500}
            value={description}
            placeholder="For example: a weekly plan, check-ins in chat and form reviews."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <fieldset className="setup-choice">
          <legend>How clients pay</legend>
          <label className="check-field">
            <input
              type="radio"
              name="billing"
              checked={billing === "monthly"}
              onChange={() => setBilling("monthly")}
            />
            Every month
          </label>
          <label className="check-field">
            <input
              type="radio"
              name="billing"
              checked={billing === "upfront"}
              onChange={() => setBilling("upfront")}
            />
            Once, for a fixed programme
          </label>
        </fieldset>
        <div className="setup-form-row">
          <label className="field">
            <span>Price (AED{billing === "monthly" ? " a month" : ""})</span>
            <input
              aria-label={`Price (AED${billing === "monthly" ? " a month" : ""})`}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Your price"
              aria-invalid={price !== "" && (minor === null || tooLow)}
            />
            {tooLow && (
              <small>
                The lowest price is AED {STRIPE_MIN_CHARGE_AED_MINOR / 100}.
              </small>
            )}
          </label>
          {billing === "upfront" && (
            <label className="field">
              <span>Programme length (days)</span>
              <input
                aria-label="Programme length (days)"
                type="number"
                min={7}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </label>
          )}
        </div>
        <p className="muted">
          Clients pay through trainsyou. Your bank details are asked at your
          first payout, not now.
        </p>
        <button
          className="button"
          disabled={busy || minor === null || tooLow || name.trim().length < 2}
        >
          Save plan
        </button>
        {note && (
          <p className="notice success" role="status">
            {note}
          </p>
        )}
        <Problem text={problem} />
      </form>
    </div>
  );
}

// ------------------------------------------------------------ 6 go live

function LiveStep({
  setup,
  onSaved,
}: {
  setup: Setup;
  onSaved: () => Promise<void>;
}) {
  const groups = useMemo(
    () => goLiveGroups(setup.goLive.checks),
    [setup.goLive.checks],
  );
  const [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [mfa, setMfa] = useState(false),
    [done, setDone] = useState<{ url: string | null } | null>(null);
  const goLive = async () => {
    setBusy(true);
    setProblem("");
    try {
      const out = await setupApi("/setup/go-live", "POST", {});
      setDone({ url: out.url ?? null });
      setMfa(false);
      await onSaved();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "MFA_STEP_UP") setMfa(true);
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (setup.published || done)
    return (
      <div className="setup-panel setup-live-done">
        <p className="setup-done-line">
          <Check size={18} /> Your page is live. Your Brain is in Waits for me:
          it drafts, you approve.
        </p>
        {(done?.url || setup.page.subdomain.host) && (
          <p>
            <a
              className="text-link"
              href={done?.url ?? "https://" + setup.page.subdomain.host}
              target="_blank"
              rel="noreferrer"
            >
              {done?.url ?? "https://" + setup.page.subdomain.host}{" "}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </p>
        )}
        <Link className="button" href={setupHref(KEEP_TRAINING)}>
          Keep training your Brain
        </Link>
      </div>
    );
  return (
    <div className="setup-panel">
      <p>We check these automatically. Fix anything open, then go live.</p>
      <ul className="setup-go-checks">
        {groups.coach.map((c) => {
          const fix = checkStep(c.key);
          return (
            <li key={c.key} className={c.ok ? "is-ok" : "is-open"}>
              <span className="setup-check-mark" aria-hidden="true">
                {c.ok ? <Check size={14} /> : "!"}
              </span>
              <span>
                {c.label}
                {!c.ok && c.reason && <small>{c.reason}</small>}
              </span>
              {!c.ok && fix && (
                <Link className="text-link" href={setupHref(fix)}>
                  Fix
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {groups.trainsyou.length > 0 && (
        <p className="setup-waiting">
          <Clock size={16} aria-hidden="true" /> Waiting on trainsyou:{" "}
          {groups.trainsyou.map((c) => c.label.toLowerCase()).join(", ")}. We
          will email you when it is done.
        </p>
      )}
      {mfa && (
        <Authenticator
          security={setup.security}
          onVerified={() => void goLive()}
        />
      )}
      <button
        type="button"
        className="button"
        disabled={busy || !setup.goLive.ready}
        onClick={() => void goLive()}
      >
        {busy ? "Going live…" : "Go live"}
      </button>
      {!setup.goLive.ready && (
        <p className="muted">
          {groups.open.length
            ? `${groups.open.length} thing${groups.open.length === 1 ? "" : "s"} to finish first.`
            : "Waiting on trainsyou before your page can go live."}
        </p>
      )}
      {!mfa && <Problem text={problem} />}
    </div>
  );
}

/** The authenticator, asked right here instead of on another screen. */
function Authenticator({
  security,
  onVerified,
}: {
  security: Setup["security"];
  onVerified: () => void;
}) {
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [enrol, setEnrol] = useState<{ secret: string; uri: string } | null>(null),
    [recovery, setRecovery] = useState<string[] | null>(null),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    try {
      await fn();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!security.hasPassword)
    return (
      <div className="setup-mfa">
        <p>
          Going live needs an authenticator app, and setting one up needs a
          password.{" "}
          <Link className="text-link" href="/trainer/settings">
            Set a password
          </Link>
          , then come back here.
        </p>
      </div>
    );
  if (recovery)
    return (
      <div className="setup-mfa">
        <p>
          <strong>Save these recovery codes privately.</strong> Each one gets
          you back in if you lose your phone. They are shown once.
        </p>
        <ul className="setup-codes">
          {recovery.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button type="button" className="button" onClick={onVerified}>
          I saved them. Go live
        </button>
      </div>
    );
  const codeField = (
    <label className="field">
      <span>6-digit code from your authenticator app</span>
      <input
        aria-label="6-digit code from your authenticator app"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
    </label>
  );
  const passwordField = (
    <label className="field">
      <span>Your password</span>
      <input
        aria-label="Your password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
    </label>
  );
  if (security.authenticatorEnrolled)
    return (
      <form
        className="setup-mfa"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await setupApi("/auth/mfa/verify", "POST", { password, code });
            onVerified();
          });
        }}
      >
        <p>Confirm it is you to go live.</p>
        {passwordField}
        {codeField}
        <button
          className="button"
          disabled={busy || code.length !== 6 || !password}
        >
          Confirm and go live
        </button>
        <Problem text={problem} />
      </form>
    );
  return enrol ? (
    <form
      className="setup-mfa"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const out = await setupApi("/auth/mfa/confirm", "POST", { code });
          setRecovery(out.recoveryCodes ?? []);
        });
      }}
    >
      <p>
        Add trainsyou to your authenticator app with this key, or{" "}
        <a className="text-link" href={enrol.uri}>
          open it on this phone
        </a>
        .
      </p>
      <p className="setup-secret">
        <code>{enrol.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
      </p>
      {codeField}
      <button className="button" disabled={busy || code.length !== 6}>
        Turn on and continue
      </button>
      <Problem text={problem} />
    </form>
  ) : (
    <form
      className="setup-mfa"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          setEnrol(await setupApi("/auth/mfa/enroll", "POST", { password }));
        });
      }}
    >
      <p>
        Going live needs an authenticator app (such as Google Authenticator or
        1Password). It keeps your page and earnings safe. Set it up here.
      </p>
      {passwordField}
      <button className="button" disabled={busy || !password}>
        Set up my authenticator
      </button>
      <Problem text={problem} />
    </form>
  );
}

/** An older checklist address opens the matching wizard step. */
export function SetupRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <p className="muted">Opening your setup…</p>;
}
