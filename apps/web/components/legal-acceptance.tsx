"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useT } from "../lib/i18n/react";

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

/** Asked when the status cannot be read: all three, and the API decides. */
const ASK_ALL: LegalStatus = {
  joiningOpen: true,
  documents: [
    { key: "terms", published: true },
    { key: "privacy", published: true },
    { key: "ai-disclosure", published: true },
  ],
};
/**
 * Loads the legal status once (null while it loads). If it cannot be read,
 * the form asks for all three documents and the API decides, so a failed
 * request never lets someone skip an acceptance the API requires.
 */
export function useLegalStatus(): LegalStatus | null {
  const [status, setStatus] = useState<LegalStatus | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/v1/public/legal-status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (!active) return;
        setStatus(
          value && Array.isArray(value.documents)
            ? (value as LegalStatus)
            : ASK_ALL,
        );
      })
      .catch(() => {
        if (active) setStatus(ASK_ALL);
      });
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
  /**
   * The status is still loading: no box to tick yet and the main action
   * waits (never a "tick the box above" with no box on screen).
   */
  loading?: true;
};
/** What the form shows for a status (null: still loading). */
export function legalPlan(status: LegalStatus | null): LegalPlan {
  if (!status) return { open: true, ask: [], pending: [], loading: true };
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
  return !plan.loading && plan.open && (plan.ask.length === 0 || ticked);
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
  const t = useT("join");
  if (!plan.open) return null;
  const nameOf = (key: LegalKey) =>
    t(
      key === "terms"
        ? "termsOfService"
        : key === "privacy"
          ? "privacyPolicy"
          : "aiDisclosure",
    );
  const links: ReactNode[] = plan.ask.map((key, i) => (
    <span key={key}>
      {i > 0 && (i === plan.ask.length - 1 ? t("and") : t("listComma"))}
      <Link href={LEGAL_PATHS[key]} target="_blank" rel="noopener">
        {nameOf(key)}
      </Link>
    </span>
  ));
  // Documents still being approved are not mentioned: nobody is asked to
  // accept them, and their status is the platform's business, not the
  // joiner's.
  if (!plan.ask.length) return null;
  const [before, after] = t.template("accept").split("{links}");
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
        <span>
          {before}
          {links}
          {after}
        </span>
      </label>
    </>
  );
}

/** Shown instead of a joining form's acceptance while joining is closed. */
export function JoiningClosedNote({ until }: { until?: string }) {
  const t = useT("join");
  return (
    <p className="notice" role="status">
      {t("closedNote")}
      {until ? t("closedUntil", { date: until }) : t("closedLater")}
    </p>
  );
}
