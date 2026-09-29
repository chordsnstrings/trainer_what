"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

/**
 * What sign-up and joining forms ask a person to accept. The API decides it
 * the way it records the acceptance (GET /api/v1/public/legal-status,
 * apps/api/src/legal.ts): a form names only the published documents and
 * never asks anyone to accept one that is not published yet.
 */
export type LegalKey = "terms" | "privacy" | "ai-disclosure";
export type LegalStatus = {
  joiningOpen: boolean;
  documents: Array<{ key: LegalKey; published: boolean }>;
};
export const LEGAL_NAMES: Record<LegalKey, string> = {
  terms: "terms of service",
  privacy: "privacy policy",
  "ai-disclosure": "digital coaching disclosure",
};
/** The public pages that show each document. */
export const LEGAL_PATHS: Record<LegalKey, string> = {
  terms: "/terms",
  privacy: "/privacy",
  "ai-disclosure": "/ai-disclosure",
};
const ORDER: LegalKey[] = ["terms", "privacy", "ai-disclosure"];

/**
 * Loads the legal status once. While it loads, and if it cannot be read, the
 * form behaves as before (all three documents, API decides), so a failed
 * request never lets someone skip an acceptance the API requires.
 */
export function useLegalStatus(): LegalStatus | null {
  const [status, setStatus] = useState<LegalStatus | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/v1/public/legal-status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (active && value && Array.isArray(value.documents))
          setStatus(value as LegalStatus);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return status;
}

export type LegalPlan = {
  /** Joining can go ahead (false: the platform is still approving its terms). */
  open: boolean;
  /** Published documents the person is asked to accept, in reading order. */
  ask: LegalKey[];
  /** Documents that are not published yet, so nobody is asked to accept them. */
  pending: LegalKey[];
};
/** What the form shows for a status (null: not loaded, ask for all three). */
export function legalPlan(status: LegalStatus | null): LegalPlan {
  if (!status) return { open: true, ask: [...ORDER], pending: [] };
  const published = new Set(
    status.documents.filter((d) => d.published).map((d) => d.key),
  );
  return {
    open: status.joiningOpen,
    ask: ORDER.filter((key) => published.has(key)),
    pending: ORDER.filter((key) => !published.has(key)),
  };
}
/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]) {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
/** Whether the form may send `accepted: true` with this plan and tick. */
export function acceptanceGiven(plan: LegalPlan, ticked: boolean) {
  return plan.open && (plan.ask.length === 0 || ticked);
}

/**
 * The acceptance checkbox, naming and linking only published documents, or a
 * plain line when there is nothing to accept yet. Closed joining is shown by
 * the caller (it also disables the main action).
 */
export function LegalAcceptance({
  plan,
  checked,
  onChange,
  name,
}: {
  plan: LegalPlan;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Form field name, when the form reads the box through FormData. */
  name?: string;
}) {
  if (!plan.open) return null;
  const links: ReactNode[] = plan.ask.map((key, i) => (
    <span key={key}>
      {i > 0 && (i === plan.ask.length - 1 ? " and " : ", ")}
      <Link href={LEGAL_PATHS[key]} target="_blank" rel="noopener">
        {LEGAL_NAMES[key]}
      </Link>
    </span>
  ));
  const pendingNote = plan.pending.length > 0 && (
    <p className="legal-pending-note muted">
      The platform’s{" "}
      {listWords(plan.pending.map((key) => LEGAL_NAMES[key]))}{" "}
      {plan.pending.length === 1 ? "is" : "are"} not published yet, so you are
      not asked to accept {plan.pending.length === 1 ? "it" : "them"}.
    </p>
  );
  if (!plan.ask.length) return pendingNote || null;
  return (
    <>
      <label className="check-field legal-acceptance">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required
        />
        <span>I accept the {links}.</span>
      </label>
      {pendingNote}
    </>
  );
}

/** Shown instead of a joining form's acceptance while joining is closed. */
export function JoiningClosedNote({ until }: { until?: string }) {
  return (
    <p className="notice" role="status">
      Joining opens once the platform publishes its approved terms.
      {until ? ` Your invitation stays valid until ${until}.` : " Please try again later."}
    </p>
  );
}
