// The proof atoms of the phase 1 pages (PLAYBOOK C0 "Status" and "Proof
// components"): status that follows the platform's own flags (the "Not on
// yet" chips, the "Live today / Not on yet" panel and its one-line strip),
// the labels that mark sources, samples and estimates, the Never sheet and
// the micro line under a primary call to action. Server-only with no hooks;
// the lists live in packages/contracts/src/marketing-proof.ts and the
// styles in app/marketing-proof.css (prefix mk-pf-).
import Link from "next/link";
import { ArrowRight, Check, Lock, Minus } from "lucide-react";
import type { ReactNode } from "react";
import {
  NEVER_LIST,
  NEVER_NOTE,
  STATUS_ITEMS,
  sourceById,
  type StatusGate,
} from "@trainer/contracts";
import type { PublicPlatform } from "./platform";

/** Whether every gate is on for this platform; no gates is always on. */
export function gatesOn(platform: PublicPlatform, gates: readonly StatusGate[] = []): boolean {
  return gates.every((gate) =>
    gate === "registration" ? platform.registrationOpen : platform.availability[gate] === true,
  );
}

function PfChip({ tone, children }: { tone: "live" | "soon" | "estimate"; children: ReactNode }) {
  return <span className={"mk-pf-chip mk-pf-" + tone}>{children}</span>;
}

/** "Not on yet" (or "Not on yet: subscriber payments") while `on` is false; nothing once it is on. */
export function NotOnYet({ on, what }: { on: boolean; what?: string }) {
  if (on) return null;
  return <PfChip tone="soon">{what ? `Not on yet: ${what}` : "Not on yet"}</PfChip>;
}

/** A status that follows a flag: its label while on ("Live", "Optional tier"), "Not on yet" while off. */
export function StatusChip({ on, label = "Live" }: { on: boolean; label?: string }) {
  return on ? <PfChip tone="live">{label}</PfChip> : <PfChip tone="soon">Not on yet</PfChip>;
}

/**
 * "Live today / Not on yet" from STATUS_ITEMS and the platform's flags: an
 * item is live once every gate it waits for is on. The panel carries an id
 * (default "status") for the "What works today" links.
 */
export function StatusPanel({
  platform,
  id = "status",
  headingLevel = 3,
  title = "What works today",
}: {
  platform: PublicPlatform;
  id?: string;
  headingLevel?: 2 | 3 | 4;
  title?: string;
}) {
  const H = (["h2", "h3", "h4"] as const)[headingLevel - 2];
  const live = STATUS_ITEMS.filter((item) => gatesOn(platform, item.gates));
  const off = STATUS_ITEMS.filter((item) => !gatesOn(platform, item.gates));
  return (
    <div className="mk-pf-status" id={id} role="group" aria-labelledby={id + "-title"}>
      <p className="mk-pf-status-title" id={id + "-title"}>
        {title}
      </p>
      <div className="mk-pf-status-cols">
        <div className="mk-pf-status-col mk-pf-status-live">
          <H>Live today</H>
          <ul>
            {live.map((item) => (
              <li key={item.text}>
                <Check size={16} aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
        {off.length > 0 && (
          <div className="mk-pf-status-col mk-pf-status-soon">
            <H>Not on yet</H>
            <ul>
              {off.map((item) => (
                <li key={item.text}>
                  <Minus size={16} aria-hidden="true" />
                  <span>{item.offText ?? item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One line under a hero, before any AED figure: which of subscriber
 * payments and payouts is not on yet, with a link to the status panel, or
 * that both are live.
 */
export function StatusStrip({ platform, href = "#status" }: { platform: PublicPlatform; href?: string }) {
  const { payments, payouts } = platform.availability;
  if (payments && payouts)
    return (
      <p className="mk-pf-strip mk-pf-strip-live">
        <Check size={18} aria-hidden="true" />
        <span>Subscriber payments and payouts are live.</span>
      </p>
    );
  const off = !payments && !payouts ? "Subscriber payments and payouts are" : !payments ? "Subscriber payments are" : "Payouts are";
  return (
    <p className="mk-pf-strip">
      <Minus size={18} aria-hidden="true" />
      <span>
        {`${off} not on yet. `}
        <a href={href}>What works today</a>
      </span>
    </p>
  );
}

/**
 * "Source →" to the source's entry on /methodology, beside a market figure.
 * A figure without a published source gets no badge and does not ship, so
 * an unknown id throws.
 */
export function SourceBadge({ id, label = "Source" }: { id: string; label?: string }) {
  const source = sourceById(id);
  if (!source) throw new Error(`SourceBadge: no source "${id}" in MARKETING_SOURCES`);
  return (
    <Link
      className="mk-pf-src"
      href={"/methodology#" + id}
      aria-label={`${label}: ${source.publisher}, ${source.title} (methodology)`}
    >
      {label}
      <ArrowRight size={12} aria-hidden="true" />
    </Link>
  );
}

/**
 * What your AI never does, as a sheet: each NEVER_LIST line after "Never",
 * then NEVER_NOTE. Unsigned: there is no founder note.
 */
export function NeverSheet({
  title = "What your AI will never do",
  headingLevel = 3,
  id,
}: {
  title?: string;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="mk-pf-never">
      <H className="mk-pf-never-title" id={id}>
        {title}
      </H>
      <ol className="mk-pf-never-list">
        {NEVER_LIST.map((line) => (
          <li key={line}>
            <span className="mk-pf-never-word">Never</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
      <p className="mk-pf-never-note">
        <Lock size={16} aria-hidden="true" />
        <span>{NEVER_NOTE}</span>
      </p>
    </div>
  );
}

/** Marks sample data and scripted mock-ups ("Sample trainer · scripted" unless told otherwise). */
export function SampleLabel({ text = "Sample trainer · scripted" }: { text?: string }) {
  return (
    <span className="mk-pf-sample">
      <span className="mk-pf-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Beside every estimate. */
export function EstimateLabel() {
  return <PfChip tone="estimate">Estimate, not a promise</PfChip>;
}

/**
 * The line under a primary call to action. While registration is closed it
 * promises no date and no email; `short` is the bare "Free to join".
 */
export function CtaMicro({
  registrationOpen,
  short = false,
  className = "mk-pf-micro",
}: {
  registrationOpen: boolean;
  short?: boolean;
  className?: string;
}) {
  const text = short
    ? "Free to join"
    : registrationOpen
      ? "Free to join · Nothing to pay upfront · Nothing goes live until you publish"
      : "Free to join · We’ll tell you here when sign-ups reopen";
  return <p className={className}>{text}</p>;
}
