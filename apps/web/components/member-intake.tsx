"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Field } from "./field";
import { DrawnCheck, NumberStepper, StickyActionBar } from "./phone-ui";
import { PlanIntakeNotice } from "./brain-plans";
import {
  DISTANCE,
  EASE,
  MOTION,
  inlineSign,
  meterKeyframes,
  playMotion,
} from "./motion";
import { useT } from "../lib/i18n/react";
import { useWorkspaceValue } from "./workspace-continuity";
import { unsavedMark } from "./pwa";

/**
 * The coaching profile questions (/app/intake) as a phone step-by-step flow
 * (docs/features/member-screens.md): one short step at a time, Back and
 * Next in the sticky action bar, and Save on the last step. Account
 * security stays in Profile and settings. Every step stays mounted (only
 * the current one is shown), so the form sends all answers at the end.
 *
 * In the member's language (docs/features/arabic.md). Motion
 * (docs/features/motion.md): the next step slides in from the inline end
 * (Back from the inline start, mirrored right to left), the progress
 * segment just reached grows from its start, and saving draws a check.
 */
export const INTAKE_STEPS = [
  { id: "about", title: "inStepAbout" },
  { id: "goal", title: "inStepGoal" },
  { id: "week", title: "inStepWeek" },
  { id: "limits", title: "inStepLimits" },
] as const;

const EXPERIENCE = [
  ["beginner", "beginner", "inBeginnerDetail"],
  ["intermediate", "intermediate", "inIntermediateDetail"],
  ["advanced", "advanced", "inAdvancedDetail"],
] as const;

async function saveIntake(body: unknown) {
  const r = await fetch("/api/v1/intake", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message), { status: r.status });
  return d;
}

export function MemberIntake({
  intake,
  onSaved,
}: {
  /** The member's saved answers, if any. */
  intake: any;
  onSaved?: () => Promise<void> | void;
}) {
  const t = useT("profile");
  const [busy, setBusy] = useWorkspaceValue("member-intake-saving", false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const answers = {
    age: String(intake?.age ?? ""), goal: intake?.goal ?? "",
    experience: intake?.experience ?? "beginner", days: intake?.daysPerWeek ?? 3,
    equipment: intake?.equipment ?? "", limitations: intake?.limitations ?? "",
  };
  const base = JSON.stringify(answers);
  const initial = { ...answers, base, step: 0 };
  const [stored, setStored, clearDraft] = useWorkspaceValue("member-intake", initial, true);
  // New saved answers take precedence over a draft of an older profile.
  const draft = stored.base === base ? stored : initial;
  const update = (patch: Partial<typeof initial>) => setStored(current => ({ ...(current.base === base ? current : initial), ...patch }));
  const step = Math.max(0, Math.min(INTAKE_STEPS.length - 1, draft.step));
  const form = useRef<HTMLFormElement>(null);
  const last = INTAKE_STEPS.length - 1;
  const answered = !!intake?.goal;
  /** Checks the current step's fields and shows the browser's hint. */
  const stepValid = () => {
    if (step === 2) {
      const days = form.current?.elements.namedItem("days") as HTMLInputElement | null;
      const value = Number(days?.value);
      days?.setCustomValidity(Number.isInteger(value) && value >= 1 && value <= 7 ? "" : t("inErrDays"));
    }
    const current = form.current?.querySelector<HTMLFieldSetElement>(
      `[data-step="${step}"]`,
    );
    if (!current) return true;
    for (const el of current.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select"))
      if (!el.checkValidity()) {
        el.reportValidity();
        return false;
      }
    return true;
  };
  const progress = useRef<HTMLDivElement>(null);
  const go = (next: number) => {
    const forward = next > step;
    setError("");
    update({ step: next });
    requestAnimationFrame(() => {
      const fieldset = form.current?.querySelector<HTMLElement>(
        `[data-step="${next}"]`,
      );
      // The new step's heading, for keyboard and screen reader users.
      fieldset?.querySelector<HTMLElement>("h2")?.focus();
      // Forward comes in from the inline end, Back from the inline start.
      const from = DISTANCE.md * inlineSign(fieldset) * (forward ? 1 : -1);
      playMotion(
        fieldset,
        [
          { opacity: 0, transform: `translateX(${from}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: MOTION.base, easing: EASE.out },
      );
      if (forward)
        playMotion(progress.current?.children[next], meterKeyframes(0, 1), {
          duration: MOTION.base,
          easing: EASE.out,
        });
    });
    window.scrollTo({ top: 0 });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!stepValid()) return;
    if (step < last) return go(step + 1);
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await saveIntake({
        age: Number(f.get("age")),
        goal: String(f.get("goal") ?? "").trim(),
        experience: f.get("experience"),
        daysPerWeek: Number(f.get("days")),
        equipment: String(f.get("equipment") ?? ""),
        limitations: String(f.get("limitations") ?? ""),
        consent: true,
      });
      clearDraft();
      setSaved(true);
      await onSaved?.();
    } catch (e: any) {
      setError(
        e.status === 423 || e.status === 409 ? t("inErrReview") : t("inErrSave"),
      );
    } finally {
      setBusy(false);
    }
  };
  if (saved)
    return (
      <section className="card intake-done" role="status">
        <DrawnCheck draw emphasis className="intake-done-check" />
        <h1>{t("inThanks")}</h1>
        <p>{t("inThanksText")}</p>
        <Link className="button" href="/app">
          {t("inBackToday")}
        </Link>
      </section>
    );
  return (
    <div className="member-intake">
      <header className="page-heading">
        <p className="eyebrow">
          {t("inStepOf", { step: step + 1, total: INTAKE_STEPS.length })}
        </p>
        <h1>{t("inTitle")}</h1>
        <div
          ref={progress}
          className="intake-progress"
          role="progressbar"
          aria-label={t("inProgress")}
          aria-valuemin={1}
          aria-valuemax={INTAKE_STEPS.length}
          aria-valuenow={step + 1}
        >
          {INTAKE_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={"motion-meter-fill" + (i <= step ? " is-done" : "")}
            />
          ))}
        </div>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <form
        id="intake-form"
        ref={form}
        className="card intake-form"
        onSubmit={(e) => void submit(e)}
        noValidate
        {...unsavedMark(JSON.stringify(draft) !== JSON.stringify(initial))}
      >
        <fieldset data-step={0} hidden={step !== 0} disabled={busy}>
          <h2 tabIndex={-1}>{t(INTAKE_STEPS[0].title)}</h2>
          <p className="muted">
            {answered ? t("inCheckAnswers") : t("inIntro")}
          </p>
          <Field label={t("inAge")}>
            <input
              type="number"
              name="age"
              inputMode="numeric"
              min={18}
              max={100}
              value={draft.age}
              onChange={e => update({ age: e.target.value })}
              required
              enterKeyHint="next"
              autoComplete="off"
            />
          </Field>
          <small>{t("inAgeNote")}</small>
        </fieldset>
        <fieldset data-step={1} hidden={step !== 1} disabled={busy}>
          <h2 tabIndex={-1}>{t(INTAKE_STEPS[1].title)}</h2>
          <Field label={t("inGoal")}>
            <textarea
              name="goal"
              value={draft.goal}
              onChange={e => update({ goal: e.target.value })}
              required
              minLength={3}
              maxLength={1000}
              rows={3}
              placeholder={t("inGoalPlaceholder")}
              enterKeyHint="next"
            />
          </Field>
          <p className="field-legend" id="intake-experience">
            {t("inExperience")}
          </p>
          <div
            className="intake-choices"
            role="radiogroup"
            aria-labelledby="intake-experience"
          >
            {EXPERIENCE.map(([value, label, detail]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="experience"
                  value={value}
                  checked={draft.experience === value}
                  onChange={() => update({ experience: value })}
                  required
                />
                <strong>{t(label)}</strong>
                <span className="muted"> · {t(detail)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset data-step={2} hidden={step !== 2} disabled={busy}>
          <h2 tabIndex={-1}>{t(INTAKE_STEPS[2].title)}</h2>
          <NumberStepper
            label={t("inDays")}
            name="days"
            key={base}
            defaultValue={draft.days}
            onValueChange={days => update({ days })}
            min={1}
            max={7}
          />
          <Field label={t("inEquipment")}>
            <textarea
              name="equipment"
              value={draft.equipment}
              onChange={e => update({ equipment: e.target.value })}
              maxLength={1000}
              rows={3}
              placeholder={t("inEquipmentPlaceholder")}
            />
          </Field>
        </fieldset>
        <fieldset data-step={3} hidden={step !== 3} disabled={busy}>
          <h2 tabIndex={-1}>{t(INTAKE_STEPS[3].title)}</h2>
          <Field label={t("inLimits")}>
            <textarea
              name="limitations"
              value={draft.limitations}
              onChange={e => update({ limitations: e.target.value })}
              maxLength={2000}
              rows={4}
              placeholder={t("inLimitsPlaceholder")}
            />
          </Field>
          <PlanIntakeNotice />
          <label>
            <input type="checkbox" name="consent" required />
            {t("inConsent")}
          </label>
        </fieldset>
      </form>
      {/* Back and Next in thumb reach; Save on the last step. */}
      <StickyActionBar
        label={t("inSteps")}
        note={t("inNext", {
          step:
            step < last ? t(INTAKE_STEPS[step + 1].title) : t("inSaveAnswers"),
        })}
      >
        <div className="intake-actions">
          {step > 0 && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => go(step - 1)}
            >
              {t("inBack")}
            </button>
          )}
          <button
            type="submit"
            form="intake-form"
            className="button"
            disabled={busy}
          >
            {step < last
              ? t("inNextButton")
              : busy
                ? t("inSaving")
                : t("saveProfile")}
          </button>
        </div>
      </StickyActionBar>
    </div>
  );
}
