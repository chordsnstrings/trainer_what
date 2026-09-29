"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Field } from "./field";
import { NumberStepper, StickyActionBar } from "./phone-ui";
import { PlanIntakeNotice } from "./brain-plans";

/**
 * The coaching profile questions (/app/intake) as a phone step-by-step flow
 * (docs/features/member-screens.md): one short step at a time, Back and
 * Next in the sticky action bar, and Save on the last step. Account
 * security stays in Profile and settings. Every step stays mounted (only
 * the current one is shown), so the form sends all answers at the end.
 */
export const INTAKE_STEPS = [
  { id: "about", title: "About you" },
  { id: "goal", title: "Your goal" },
  { id: "week", title: "Your training week" },
  { id: "limits", title: "Anything your coach should know" },
] as const;

const EXPERIENCE = [
  ["beginner", "Beginner", "New to training, or back after a long break"],
  ["intermediate", "Intermediate", "Training regularly for 6 months or more"],
  ["advanced", "Advanced", "Several years of structured training"],
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
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const last = INTAKE_STEPS.length - 1;
  const answered = !!intake?.goal;
  /** Checks the current step's fields and shows the browser's hint. */
  const stepValid = () => {
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
  const go = (next: number) => {
    setError("");
    setStep(next);
    // The new step's heading, for keyboard and screen reader users.
    requestAnimationFrame(() =>
      form.current
        ?.querySelector<HTMLElement>(`[data-step="${next}"] h2`)
        ?.focus(),
    );
    window.scrollTo({ top: 0 });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      setSaved(true);
      await onSaved?.();
    } catch (e: any) {
      setError(
        e.status === 423 || e.status === 409
          ? "Your coach is reviewing your training right now. Try again in a little while."
          : "Your answers were not saved. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (saved)
    return (
      <section className="card intake-done" role="status">
        <h1>Thank you</h1>
        <p>
          Your coach has your answers. Your plan appears on Today as soon as it
          is ready, and you can change these answers at any time.
        </p>
        <Link className="button" href="/app">
          Back to Today
        </Link>
      </section>
    );
  return (
    <div className="member-intake">
      <header className="page-heading">
        <p className="eyebrow">
          Step {step + 1} of {INTAKE_STEPS.length}
        </p>
        <h1>Your coaching profile</h1>
        <div
          className="intake-progress"
          role="progressbar"
          aria-label="Coaching profile progress"
          aria-valuemin={1}
          aria-valuemax={INTAKE_STEPS.length}
          aria-valuenow={step + 1}
        >
          {INTAKE_STEPS.map((s, i) => (
            <span key={s.id} className={i <= step ? "is-done" : undefined} />
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
      >
        <fieldset data-step={0} hidden={step !== 0}>
          <h2 tabIndex={-1}>{INTAKE_STEPS[0].title}</h2>
          <p className="muted">
            {answered
              ? "Check your answers and change anything that is different now."
              : "A few questions so your coach can plan training that fits you. It takes about two minutes."}
          </p>
          <Field label="Your age">
            <input
              type="number"
              name="age"
              inputMode="numeric"
              min={18}
              max={100}
              defaultValue={intake?.age}
              required
              enterKeyHint="next"
              autoComplete="off"
            />
          </Field>
          <small>You need to be 18 or over for coaching here.</small>
        </fieldset>
        <fieldset data-step={1} hidden={step !== 1}>
          <h2 tabIndex={-1}>{INTAKE_STEPS[1].title}</h2>
          <Field label="What would you like to achieve?">
            <textarea
              name="goal"
              defaultValue={intake?.goal}
              required
              minLength={3}
              maxLength={1000}
              rows={3}
              placeholder="For example: get stronger and move without back pain"
              enterKeyHint="next"
            />
          </Field>
          <p className="field-legend" id="intake-experience">
            Your training experience
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
                  defaultChecked={(intake?.experience ?? "beginner") === value}
                  required
                />
                <strong>{label}</strong>
                <span className="muted"> · {detail}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset data-step={2} hidden={step !== 2}>
          <h2 tabIndex={-1}>{INTAKE_STEPS[2].title}</h2>
          <NumberStepper
            label="Days you can train each week"
            name="days"
            defaultValue={intake?.daysPerWeek ?? 3}
            min={1}
            max={7}
          />
          <Field label="Equipment you can use">
            <textarea
              name="equipment"
              defaultValue={intake?.equipment}
              maxLength={1000}
              rows={3}
              placeholder="For example: a gym, or dumbbells and a bench at home"
            />
          </Field>
        </fieldset>
        <fieldset data-step={3} hidden={step !== 3}>
          <h2 tabIndex={-1}>{INTAKE_STEPS[3].title}</h2>
          <Field label="Injuries, pain or health limits (optional)">
            <textarea
              name="limitations"
              defaultValue={intake?.limitations}
              maxLength={2000}
              rows={4}
              placeholder="Leave empty if there is nothing to add"
            />
          </Field>
          <PlanIntakeNotice />
          <label>
            <input type="checkbox" name="consent" required />I agree that my
            coach may use these answers for my coaching, and I understand that
            digital coaching does not replace medical care.
          </label>
        </fieldset>
      </form>
      {/* Back and Next in thumb reach; Save on the last step. */}
      <StickyActionBar
        label="Coaching profile steps"
        note={`Next: ${step < last ? INTAKE_STEPS[step + 1].title : "save your answers"}`}
      >
        <div className="intake-actions">
          {step > 0 && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => go(step - 1)}
            >
              Back
            </button>
          )}
          <button
            type="submit"
            form="intake-form"
            className="button"
            disabled={busy}
          >
            {step < last ? "Next" : busy ? "Saving…" : "Save coaching profile"}
          </button>
        </div>
      </StickyActionBar>
    </div>
  );
}
