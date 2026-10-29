"use client";
// The home walkthrough (pages/home.tsx; docs/marketing-revamp-2026-10-26/
// phase1/PLAN.md WP4): concept A's stepper over the eight /how-it-works
// steps, which the visitor moves through. ARIA tabs with a roving tabindex:
// Left and Right (mirrored right to left), Home and End move between the
// steps, and Previous and Next step through them. The server renders the
// first step; the other panels stay in the HTML, hidden. The rail's ink
// moves on a transform only (app/marketing-home.css).
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export type WalkStep = {
  title: string;
  body: string;
  /** A status chip (proof.tsx NotOnYet) shown in the tab and the panel. */
  flag?: ReactNode;
};

export function Walkthrough({ steps, label, id = "home-walk" }: { steps: WalkStep[]; label: string; id?: string }) {
  const [current, setCurrent] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const n = steps.length;
  const pad = (i: number) => String(i + 1).padStart(2, "0");
  const select = (i: number, focus = false) => {
    const next = Math.max(0, Math.min(n - 1, i));
    setCurrent(next);
    if (focus) tabs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const to = step ? (i + step + n) % n : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (to === null) return;
    event.preventDefault();
    select(to, true);
  };
  return (
    <div className="mk-hm-walk" id={id}>
      <div
        className="mk-hm-walk-rail"
        role="tablist"
        aria-label={label}
        style={{ "--n": n, "--k": current } as CSSProperties}
      >
        {steps.map((step, i) => (
          <button
            key={step.title}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-t${i}`}
            aria-controls={`${id}-p${i}`}
            aria-selected={i === current}
            tabIndex={i === current ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            <span className="mk-hm-walk-n">{pad(i)}</span>
            <span className="mk-hm-walk-t">{step.title}</span>
            {step.flag && <span className="mk-hm-walk-flag">{step.flag}</span>}
          </button>
        ))}
        <span className="mk-hm-walk-ink" aria-hidden="true" />
      </div>
      <div className="mk-hm-walk-body">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="mk-hm-walk-panel"
            role="tabpanel"
            id={`${id}-p${i}`}
            aria-labelledby={`${id}-t${i}`}
            tabIndex={0}
            hidden={i !== current}
          >
            <p className="mk-hm-walk-count">
              <span aria-hidden="true">
                {pad(i)}/{String(n).padStart(2, "0")}
              </span>
              <span className="sr-only">
                Step {i + 1} of {n}
              </span>
            </p>
            <h3>
              {step.title} {step.flag}
            </h3>
            <p>{step.body}</p>
          </div>
        ))}
        <div className="mk-hm-walk-nav">
          <button
            type="button"
            className="button secondary"
            aria-disabled={current === 0}
            onClick={() => current > 0 && select(current - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="button secondary"
            aria-disabled={current === n - 1}
            onClick={() => current < n - 1 && select(current + 1)}
          >
            Next step
          </button>
        </div>
      </div>
    </div>
  );
}
