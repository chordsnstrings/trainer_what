/**
 * Today's one queue (docs/features/trainer-workspace.md, "Today"): the
 * inbox's items, rule suggestions from the coach's own edits, and the next
 * setup step, in one order. Safety first, then setup, then by urgency and
 * whoever has waited longest. Items the coach moved to "Later today" go to
 * the end, in the order they were moved. Pure, so it is unit tested.
 */
import type { InboxItem } from "./workspace-inbox";

export type RuleSuggestion = {
  id: string;
  version: number;
  source: "edits" | "edit" | "rejection";
  target: "rule" | "nutrition";
  rule: { title?: string; directive?: string; condition?: string; category?: string } | null;
  why: string;
  example: string | null;
  evidence: unknown[];
  createdAt: string;
};
export type SetupSummary = {
  steps: { key: string; label: string; minutes: number; status: string }[];
  progress: { done: number; total: number; percent: number; minutesLeft: number };
  resumeStep: string | null;
};
export type QueueEntry =
  | { key: string; kind: "inbox"; urgency: number; at: string; item: InboxItem }
  | { key: string; kind: "rule"; urgency: number; at: string; suggestion: RuleSuggestion }
  | { key: string; kind: "setup"; urgency: number; at: string; setup: SetupSummary };

/** Setup sits right after safety items: the coach's AI cannot coach until it is done. */
export const SETUP_URGENCY = 0.5;
/** A rule suggestion waits like a plan does. */
export const RULE_URGENCY = 3;

export function buildQueue(
  inbox: InboxItem[],
  rules: RuleSuggestion[],
  setup: SetupSummary | null,
  later: string[] = [],
): QueueEntry[] {
  const entries: QueueEntry[] = [
    ...inbox.map((item) => ({ key: item.id, kind: "inbox" as const, urgency: item.urgency, at: item.createdAt, item })),
    ...rules.map((suggestion) => ({
      key: `rule:${suggestion.id}`,
      kind: "rule" as const,
      urgency: RULE_URGENCY,
      at: suggestion.createdAt,
      suggestion,
    })),
    ...(setup && setup.progress.done < setup.progress.total
      ? [{ key: "setup", kind: "setup" as const, urgency: SETUP_URGENCY, at: "", setup }]
      : []),
  ];
  const ordered = entries.sort(
    (a, b) =>
      a.urgency - b.urgency ||
      (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) ||
      a.key.localeCompare(b.key),
  );
  const moved = later.filter((key) => ordered.some((e) => e.key === key));
  return [
    ...ordered.filter((e) => !moved.includes(e.key)),
    ...moved.map((key) => ordered.find((e) => e.key === key)!),
  ];
}

/** The entry shown in Up next: the one pinned (shown, or picked by the coach), else the first. */
export function focusOf(queue: QueueEntry[], picked: string | null): QueueEntry | null {
  return (picked && queue.find((e) => e.key === picked)) || queue[0] || null;
}

/** What a queue row says, in plain words. */
export function entryTitle(entry: QueueEntry): string {
  if (entry.kind === "inbox") return entry.item.title;
  if (entry.kind === "rule") return "Make this a rule?";
  const next = entry.setup.steps.find((s) => s.key === entry.setup.resumeStep) ?? entry.setup.steps.find((s) => s.status !== "done");
  return next ? `Finish setup: ${next.label}` : "Finish setup";
}

/** An inbox item the coach can finish now. A session that has not ended yet
 * waits in the queue (its card links to Bookings) but is not a decision until
 * attendance can be recorded. */
export function isDecision(item: InboxItem): boolean {
  return !(item.type === "booking" && !item.actions.includes("attended"));
}

/** Decisions waiting, for the header sentence (setup is not a decision). */
export function decisionsWaiting(queue: QueueEntry[]): number {
  return queue.filter((e) => e.kind === "rule" || (e.kind === "inbox" && isDecision(e.item))).length;
}

/** A safety report or paused training: it never waits behind other work. */
export const isSafety = (e: QueueEntry): boolean => e.kind === "inbox" && e.item.type === "safety";

/**
 * An inbox item that came in after the coach started on `focus` (its key is
 * not in `seen`) and should not wait silently behind it: any safety report,
 * or anything more urgent. First in queue order; the card on screen stays.
 */
export function arrivalAhead(visible: QueueEntry[], focus: QueueEntry | null, seen: readonly string[]): QueueEntry | null {
  if (!focus) return null;
  const known = new Set(seen);
  return (
    visible.find(
      (e) => e.key !== focus.key && !known.has(e.key) && e.kind === "inbox" && (isSafety(e) || e.urgency < focus.urgency),
    ) ?? null
  );
}
