import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";

/**
 * The trainer's one inbox (docs/features/trainer-workspace.md): everything
 * that waits on the coach, merged from the existing queues and sorted by
 * urgency. Read-only; every action on a card uses the queue's own endpoint
 * (exceptions, training holds, plan reviews, support, bookings, messages), so
 * the safety checks on those endpoints stay the only way anything is sent.
 */
export type InboxType =
  | "safety"
  | "reply_draft"
  | "question"
  | "support"
  | "chat"
  | "plan_draft"
  | "followup"
  | "booking";
export type InboxAction =
  | "approve"
  | "edit_send"
  | "reject"
  | "reply"
  | "open_chat"
  | "review"
  | "attended"
  | "no_show";
export type InboxItem = {
  /** Stable across reloads: `${type}:${recordId}`. */
  id: string;
  type: InboxType;
  /** 0 is the most urgent. Ties go to whoever has waited longest. */
  urgency: number;
  recordId: string;
  version: number | null;
  clientId: string | null;
  clientName: string | null;
  title: string;
  preview: string;
  /** The Brain's draft reply, for reply drafts only. */
  draft: string | null;
  createdAt: string;
  actions: InboxAction[];
  /** Where "Open" goes in the trainer workspace. */
  href: string;
};
export type ChatSummary = {
  clientId: string;
  clientName: string | null;
  lastText: string;
  lastAuthor: string;
  lastAt: string;
  /** The client wrote last: the conversation waits for a reply. */
  awaitingReply: boolean;
};

const URGENCY: Record<InboxType, number> = {
  safety: 0,
  reply_draft: 1,
  question: 2,
  support: 2,
  chat: 2,
  plan_draft: 3,
  followup: 3,
  booking: 4,
};
const LIMIT = 100;
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function coach(req: FastifyRequest): Actor {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (!["owner", "staff"].includes(req.identity.role))
    throw fail(403, "TRAINER_REQUIRED", "Trainer access required");
  return req.identity;
}
const clip = (text: unknown, n = 280) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const iso = (v: unknown) => new Date(v as string).toISOString();

/** The latest message per client, newest conversation first. */
export async function chatSummaries(
  tx: Tx,
  a: Actor,
  limit = 200,
): Promise<ChatSummary[]> {
  const rows = await tx.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (r.owner_user_id) r.owner_user_id AS client_id,
         u.name AS client_name, r.data->>'text' AS text,
         r.data->>'author' AS author, r.created_at
       FROM records r
       JOIN memberships m ON m.user_id=r.owner_user_id AND m.tenant_id=$1 AND m.role='subscriber'
       LEFT JOIN users u ON u.id=r.owner_user_id
       WHERE r.kind='message'
       ORDER BY r.owner_user_id, r.created_at DESC, r.id DESC
     ) latest ORDER BY created_at DESC LIMIT $2`,
    [a.tenantId, limit],
  );
  return rows.map((r) => ({
    clientId: r.client_id,
    clientName: r.client_name ?? null,
    lastText: clip(r.text, 160),
    lastAuthor: r.author ?? "",
    lastAt: iso(r.created_at),
    awaitingReply: r.author === "subscriber",
  }));
}

export async function inboxItems(tx: Tx, a: Actor): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  const names = new Map<string, string>(
    (
      await tx.query(
        "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.role='subscriber'",
        [a.tenantId],
      )
    ).map((m) => [m.id, m.name]),
  );
  const client = (userId: string | null) =>
    userId && names.has(userId) ? userId : null;
  const push = (
    item: Omit<InboxItem, "id" | "urgency" | "clientName"> & {
      urgency?: number;
    },
  ) =>
    items.push({
      ...item,
      id: `${item.type}:${item.recordId}`,
      urgency: item.urgency ?? URGENCY[item.type],
      clientName: item.clientId ? (names.get(item.clientId) ?? null) : null,
    });

  // Paused training (a pain or red-flag report). Resuming needs the hold's
  // own review, so the card only opens it.
  const holds = await tx.query(
    "SELECT id,version,owner_user_id,data,created_at FROM records WHERE kind='training_hold' AND status='active' ORDER BY created_at LIMIT $1",
    [LIMIT],
  );
  const held = new Set<string>();
  for (const h of holds) {
    held.add(h.owner_user_id);
    push({
      type: "safety",
      recordId: h.id,
      version: h.version,
      clientId: client(h.owner_user_id),
      title: "Training paused: a safety report",
      preview: clip(h.data?.reason),
      draft: null,
      createdAt: iso(h.created_at),
      actions: ["review", "open_chat"],
      href: "/trainer/exceptions",
    });
  }

  // Needs-you items: Brain drafts held for review, questions for the coach
  // personally, and safety reports without an active hold.
  const open = await tx.query(
    "SELECT id,version,owner_user_id,data,created_at FROM records WHERE kind='exception' AND status='open' ORDER BY created_at LIMIT $1",
    [LIMIT],
  );
  const decisionIds = open
    .map((e) => e.data?.decisionId)
    .filter((v): v is string => typeof v === "string");
  const drafts = new Map<string, string>(
    decisionIds.length
      ? (
          await tx.query(
            "SELECT id,data->>'message' AS message FROM records WHERE kind='decision' AND id=ANY($1::uuid[])",
            [decisionIds],
          )
        ).map((d) => [d.id, d.message ?? ""])
      : [],
  );
  const waiting = new Set<string>();
  for (const e of open) {
    const clientId = client(e.data?.subscriberId ?? e.owner_user_id);
    if (clientId) waiting.add(clientId);
    const question = clip(e.data?.description);
    if (e.data?.category === "safety") {
      // A hold already shows this report.
      if (clientId && held.has(clientId)) continue;
      push({
        type: "safety",
        recordId: e.id,
        version: e.version,
        clientId,
        title: "Safety report",
        preview: question,
        draft: null,
        createdAt: iso(e.created_at),
        actions: ["reply", "open_chat"],
        href: "/trainer/exceptions",
      });
    } else if (e.data?.decisionId && drafts.has(e.data.decisionId)) {
      push({
        type: "reply_draft",
        recordId: e.id,
        version: e.version,
        clientId,
        title: "Your Brain drafted a reply",
        preview: question,
        draft: drafts.get(e.data.decisionId) || null,
        createdAt: iso(e.created_at),
        actions: ["approve", "edit_send", "reject", "open_chat"],
        href: "/trainer/exceptions",
      });
    } else {
      push({
        type: "question",
        recordId: e.id,
        version: e.version,
        clientId,
        title: "Waiting for your reply",
        preview: question,
        draft: null,
        createdAt: iso(e.created_at),
        actions: ["reply", "reject", "open_chat"],
        href: "/trainer/exceptions",
      });
    }
  }

  // Support conversations where the member wrote last.
  const support = await tx.query(
    "SELECT id,version,owner_user_id,data,created_at,updated_at FROM records WHERE kind='support' AND status='open' ORDER BY updated_at LIMIT $1",
    [LIMIT],
  );
  for (const s of support) {
    const last = (s.data?.messages ?? []).at(-1);
    if (!last || last.authorId !== s.owner_user_id) continue;
    push({
      type: "support",
      recordId: s.id,
      version: s.version,
      clientId: client(s.owner_user_id),
      title: "Support: " + clip(s.data?.subject, 90),
      preview: clip(last.text),
      draft: null,
      createdAt: iso(last.at ?? s.updated_at),
      actions: ["reply", "review"],
      href: "/trainer/support",
    });
  }

  // Chats where the client wrote last and nothing above already covers it.
  for (const c of await chatSummaries(tx, a)) {
    if (!c.awaitingReply || waiting.has(c.clientId) || held.has(c.clientId))
      continue;
    push({
      type: "chat",
      recordId: c.clientId,
      version: null,
      clientId: c.clientId,
      title: "New message",
      preview: c.lastText,
      draft: null,
      createdAt: c.lastAt,
      actions: ["reply", "open_chat"],
      href: `/trainer/messages/${c.clientId}`,
    });
  }

  // Plans the Brain drafted that wait for the coach.
  const plans = await tx.query(
    "SELECT id,version,owner_user_id,status,data,created_at FROM records WHERE kind='plan_generation' AND (status IN ('pending_review','failed') OR (status='delivered' AND data->'outcome'->>'spotCheck'='pending')) ORDER BY created_at LIMIT $1",
    [LIMIT],
  );
  for (const p of plans) {
    const adaptation = p.data?.type === "adaptation";
    push({
      type: "plan_draft",
      recordId: p.id,
      version: p.version,
      clientId: client(p.owner_user_id),
      title:
        p.status === "failed"
          ? "A plan could not be drafted"
          : p.status === "delivered"
            ? "Check a plan your Brain sent"
            : adaptation
              ? "Your Brain suggests a plan change"
              : "Your Brain drafted a plan",
      preview: clip(
        p.data?.plan?.title ??
          p.data?.summary ??
          p.data?.week?.summary ??
          p.data?.error ??
          "",
      ),
      draft: null,
      createdAt: iso(p.created_at),
      actions:
        p.status === "pending_review" && !adaptation
          ? ["approve", "review"]
          : ["review"],
      href: "/trainer/brain/plans",
    });
  }

  // Scheduled follow-ups that must be checked again before they go out.
  const followups = await tx.query(
    "SELECT id,version,owner_user_id,data,created_at FROM records WHERE kind='coaching_followup' AND status='review_required' ORDER BY created_at LIMIT $1",
    [LIMIT],
  );
  for (const f of followups) {
    const clientId = client(f.owner_user_id);
    push({
      type: "followup",
      recordId: f.id,
      version: f.version,
      clientId,
      title: "Check a scheduled message",
      preview: clip(f.data?.text),
      draft: null,
      createdAt: iso(f.created_at),
      actions: ["review"],
      href: clientId ? `/trainer/messages/${clientId}` : "/trainer/messages",
    });
  }

  // Sessions that ended without attendance recorded, and today's bookings.
  const bookings = await tx.query(
    `SELECT b.id,b.version,b.user_id,s.title,s.starts_at,s.ends_at
     FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id
     WHERE b.status='confirmed' AND s.starts_at<now()+interval '24 hours'
       AND s.ends_at>now()-interval '14 days' AND ($1='owner' OR s.trainer_id=$2)
     ORDER BY s.starts_at LIMIT $3`,
    [a.role, a.userId, LIMIT],
  );
  for (const b of bookings) {
    const ended = new Date(b.ends_at).getTime() <= Date.now();
    push({
      type: "booking",
      urgency: ended ? URGENCY.booking - 1 : URGENCY.booking,
      recordId: b.id,
      version: b.version,
      clientId: client(b.user_id),
      title: ended
        ? "Did they come? " + clip(b.title, 80)
        : "Coming up: " + clip(b.title, 80),
      preview: iso(b.starts_at),
      draft: null,
      createdAt: iso(b.starts_at),
      actions: ended ? ["attended", "no_show"] : ["review"],
      href: "/trainer/bookings",
    });
  }

  return items.sort(
    (x, y) =>
      x.urgency - y.urgency ||
      Date.parse(x.createdAt) - Date.parse(y.createdAt) ||
      x.id.localeCompare(y.id),
  );
}

export function registerTrainerInbox(app: FastifyInstance, db: Database) {
  app.get("/api/v1/trainer/inbox", async (req) => {
    const a = coach(req);
    return db.tenant(a, async (tx) => {
      const items = await inboxItems(tx, a);
      const byType: Partial<Record<InboxType, number>> = {};
      for (const i of items) byType[i.type] = (byType[i.type] ?? 0) + 1;
      return { items, counts: { total: items.length, byType } };
    });
  });
  app.get("/api/v1/trainer/chats", async (req) => {
    const a = coach(req);
    return db.tenant(a, async (tx) => ({
      chats: await chatSummaries(tx, a),
    }));
  });
}
