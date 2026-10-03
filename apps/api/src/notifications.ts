import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  elevated,
  event,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { hasMemberAccess } from "./entitlements.ts";
import { CONSENT_WITHDRAWAL_VERSION, legalAcceptanceVersion } from "./legal.ts";
import { pushAvailable } from "../../../packages/providers/src/push.ts";
import {
  criticalCategory,
  localDate,
  messageKindForKey,
  renderMessage,
  resolvePublishedTemplate,
  workspaceName,
  type TemplatePin,
} from "./message-templates.ts";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
/** Follow the device, or always light or dark. */
export const appearanceSchema = z.enum(["system", "light", "dark"]);
export const notificationPreferencesSchema = z
  .object({
    email: z.boolean().default(true),
    bookings: z.boolean().default(true),
    workouts: z.boolean().default(true),
    marketing: z.boolean().default(false),
    // Website inquiry email/device alerts for workspace owners; in-app is always kept.
    inquiries: z.boolean().default(true),
    // Template locale; English copy is the fallback for any missing translation.
    language: z.enum(["en", "ar"]).default("en"),
    // The member app's appearance (docs/features/dark-mode.md): follow the
    // device, or always light or dark. Mirrored into a cookie by the app.
    theme: appearanceSchema.default("system"),
    quietStart: z.number().int().min(0).max(1439).default(1320),
    quietEnd: z.number().int().min(0).max(1439).default(480),
    timezone: z
      .string()
      .max(80)
      .default("Asia/Dubai")
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v }).format();
          return true;
        } catch {
          return false;
        }
      }, "Use a valid time zone"),
  })
  .strict();
type Preferences = z.infer<typeof notificationPreferencesSchema>;
type Category =
  "safety" | "account" | "booking" | "workout" | "coaching" | "marketing";
export type NotificationInput = {
  userId: string;
  category: Category;
  dedupeKey: string;
  title: string;
  body: string;
  href?: string;
  templateKey?: string;
  /** A preference-controlled topic inside the category (website inquiries). */
  topic?: "inquiry";
  // Some lifecycle confirmations belong in the private inbox only.
  email?: boolean;
  push?: boolean;
  // A confirmation about the member's own money (payment or refund). Its email
  // is still sent while the workspace is suspended (worker claimJob).
  transactional?: boolean;
  source?: Record<string, unknown>;
};
const critical = criticalCategory;
function enabled(
  p: Preferences,
  category: string,
  channel = "email",
  topic?: string,
) {
  return (
    critical(category) ||
    ((channel === "push" || p.email) &&
      (category !== "marketing" || p.marketing) &&
      (category !== "booking" || p.bookings) &&
      (category !== "workout" || p.workouts) &&
      (topic !== "inquiry" || p.inquiries))
  );
}
/**
 * Marketing permission is the latest versioned consent record. The
 * preference flag only mirrors it, so it can never grant marketing alone.
 */
export async function marketingConsent(tx: Tx, userId: string) {
  const [row] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='marketing' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  return row?.granted === true;
}
/** Resolve outside the tenant transaction; an error is raised only if a change needs it. */
export const marketingConsentVersion = (db: Database) =>
  legalAcceptanceVersion(db, "marketing").catch((e: Error) => e);
/**
 * Records a changed marketing choice in the consent history. Call it while
 * holding the member's notifications lock, before saving the mirror flag.
 */
export async function recordMarketingChoice(
  tx: Tx,
  a: Actor,
  granted: boolean,
  version: string | Error,
  source: string,
) {
  if ((await marketingConsent(tx, a.userId)) === granted) return false;
  const documentVersion = granted ? version : CONSENT_WITHDRAWAL_VERSION;
  if (documentVersion instanceof Error) throw documentVersion;
  await tx.query(
    "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'marketing',$4,$5)",
    [randomUUID(), a.tenantId, a.userId, documentVersion, granted],
  );
  await event(tx, a, "consent.changed", undefined, {
    type: "marketing",
    granted,
    source,
  });
  return true;
}
export function nextNotificationTime(p: Preferences, now = new Date()): Date {
  if (p.quietStart === p.quietEnd) return now;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: p.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const quiet = (time: Date) => {
    const parts = Object.fromEntries(
      fmt.formatToParts(time).map((v) => [v.type, v.value]),
    );
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    return p.quietStart < p.quietEnd
      ? minute >= p.quietStart && minute < p.quietEnd
      : minute >= p.quietStart || minute < p.quietEnd;
  };
  if (!quiet(now)) return now;
  for (let minute = 1; minute <= 1560; minute++) {
    const time = new Date(now.getTime() + minute * 60000);
    if (!quiet(time)) return time;
  }
  return new Date(now.getTime() + 26 * 3600000);
}
export async function notifyUser(tx: Tx, a: Actor, input: NotificationInput) {
  if (
    a.role === "subscriber" &&
    input.userId !== a.userId &&
    !["safety", "coaching"].includes(input.category)
  )
    throw fail(403, "NOTIFICATION_SCOPE", "This notification is not permitted");
  // The recipient's contact, preferences, consent and devices come from
  // notification_recipient() (migration 061) with the sender's own scope: a
  // follower may address themselves or, for safety and coaching notices, their
  // coaching team. No sender is raised to the owner role.
  const push = pushAvailable();
  const [target] = await tx.query(
    "SELECT permitted,email,name,role,preferences,marketing,devices FROM notification_recipient($1,$2,$3)",
    [input.userId, input.category, push?.keyId ?? null],
  );
  if (!target) return null;
  if (!target.permitted)
    throw fail(
      403,
      "NOTIFICATION_SCOPE",
      "A safety alert must go to your trainer",
    );
  {
    const p = notificationPreferencesSchema.parse(target.preferences ?? {});
    if (input.category === "marketing") p.marketing = target.marketing === true;
    const href = /^\/(app|trainer|admin)(\/|$)/.test(input.href ?? "")
      ? (input.href ?? "")
      : "";
    // A published template (requested locale, then English) drives in-app and
    // email copy; the sender's text is the built-in fallback. The pin records
    // exactly which version produced this notification.
    const template = input.templateKey
      ? await resolvePublishedTemplate(tx, input.templateKey, p.language)
      : null;
    const pin: TemplatePin | null = input.templateKey
      ? {
          kind: messageKindForKey(input.templateKey)?.kind ?? null,
          key: template?.key ?? input.templateKey,
          version: template?.version ?? null,
          locale: template?.locale ?? "en",
          requestedLocale: p.language,
          source: template ? "published" : "built_in",
        }
      : null;
    const message = renderMessage({
      template,
      builtIn: { title: input.title, body: input.body },
      values: {
        name: target.name,
        coach: template ? await workspaceName(tx) : "Your coach",
        date: localDate(p.timezone),
      },
      href,
      appUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
      critical: critical(input.category),
    });
    const title = message.title,
      rendered = message.body;
    const canEmail =
        input.email !== false &&
        enabled(p, input.category, "email", input.topic),
      notificationId = randomUUID();
    const [inserted] = await tx.query(
      "SELECT enqueue_notification($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id",
      [
        notificationId,
        input.userId,
        input.category,
        input.dedupeKey,
        title,
        rendered,
        href,
        canEmail ? "pending" : "suppressed",
        JSON.stringify({
          source: input.source ?? null,
          template: pin,
          ...(input.topic ? { topic: input.topic } : {}),
        }),
      ],
    );
    if (!inserted?.id) return null;
    const row = { id: inserted.id as string };
    if (canEmail) {
      const due = critical(input.category)
        ? new Date()
        : nextNotificationTime(p);
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,available_at) VALUES($1,$2,'email',$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          a.tenantId,
          `notification:${notificationId}`,
          JSON.stringify({
            notificationId,
            userId: input.userId,
            category: input.category,
            ...(input.transactional ? { transactional: true } : {}),
            to: target.email,
            subject: title,
            text: message.emailText,
            html: message.emailHtml,
            template: pin,
          }),
          due.toISOString(),
        ],
      );
    }
    // Explicit per-device consent; inbox-only lifecycle events remain inbox-only.
    if (
      push &&
      (input.push ?? input.email !== false) &&
      enabled(p, input.category, "push", input.topic)
    ) {
      const devices = ((target.devices ?? []) as string[]).map((id) => ({
        id,
      }));
      const due = critical(input.category)
        ? new Date()
        : nextNotificationTime(p);
      for (const device of devices)
        await tx.query(
          "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,available_at) VALUES($1,$2,'push',$3,$4,$5) ON CONFLICT DO NOTHING",
          [
            randomUUID(),
            a.tenantId,
            `push:${notificationId}:${device.id}`,
            JSON.stringify({
              notificationId,
              userId: input.userId,
              subscriptionId: device.id,
            }),
            due.toISOString(),
          ],
        );
    }
    return row;
  }
}
export async function notifyCoachingTeam(
  tx: Tx,
  a: Actor,
  input: Omit<NotificationInput, "userId">,
) {
  // Only the owner and staff user ids of the current workspace (migration 061).
  const trainers = await tx.query(
    "SELECT user_id FROM notification_team() AS t(user_id)",
  );
  for (const trainer of trainers)
    await notifyUser(tx, a, { ...input, userId: trainer.user_id });
}
export async function notificationDeliveryDecision(
  db: Database,
  tenantId: string,
  job: any,
  now = new Date(),
): Promise<{ allowed: boolean; due?: Date }> {
  // Invitation emails carry a join link: send only while that exact link is
  // still the invitation's current, pending link (joining.ts).
  if (job.data.invitationId) {
    const { invitationEmailCurrent } = await import("./joining.ts");
    return { allowed: await invitationEmailCurrent(db, tenantId, job, now) };
  }
  if (!job.data.notificationId) return { allowed: true };
  const decision = await db.tenant(
    elevated("worker", { tenantId, role: "owner" }),
    async (tx) => {
      const [n] = await tx.query(
        "SELECT * FROM notifications WHERE id=$1 AND user_id=$2",
        [job.data.notificationId, job.data.userId],
      );
      const push = job.kind === "push";
      if (
        !n ||
        (push ? !!n.read_at : ["sent", "suppressed"].includes(n.email_status))
      )
        return { allowed: false };
      const [m] = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [tenantId, job.data.userId],
      );
      if (!m) return { allowed: false };
      const [pref] = await tx.query(
          "SELECT data FROM notification_preferences WHERE user_id=$1",
          [job.data.userId],
        ),
        p = notificationPreferencesSchema.parse(pref?.data ?? {});
      if (n.category === "marketing")
        p.marketing = await marketingConsent(tx, job.data.userId);
      if (!enabled(p, n.category, push ? "push" : "email", n.data?.topic))
        return { allowed: false };
      const source = n.data.source;
      // An inquiry already handled (or erased) needs no delayed alert.
      if (source?.type === "website_inquiry") {
        const [inquiry] = await tx.query(
          "SELECT status FROM records WHERE id=$1 AND kind='website_inquiry'",
          [source.id],
        );
        if (inquiry?.status !== "open") return { allowed: false };
      }
      if (source?.type === "booking") {
        const [b] = await tx.query(
          "SELECT b.status,s.starts_at,s.status slot_status FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.id=$1 AND b.user_id=$2",
          [source.id, n.user_id],
        );
        if (
          !b ||
          b.status !== "confirmed" ||
          b.slot_status !== "open" ||
          new Date(b.starts_at).getTime() !== Date.parse(source.startsAt) ||
          new Date(b.starts_at) <= now
        )
          return { allowed: false };
      }
      if (source?.type === "workout") {
        const [r] = await tx.query(
          "SELECT status,data FROM records WHERE id=$1 AND kind='planned_session' AND owner_user_id=$2",
          [source.id, n.user_id],
        );
        if (
          !r ||
          r.status !== "planned" ||
          r.data.date !== source.date ||
          !(await hasMemberAccess(tx, n.user_id))
        )
          return { allowed: false };
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: r.data.timezone ?? "Asia/Dubai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(now);
        if (source.date < today) return { allowed: false };
      }
      if (source?.type === "brain_review") {
        const { brainReviewNotificationCurrent } =
          await import("./source-review-notifications.ts");
        if (
          !(await brainReviewNotificationCurrent(
            tx,
            tenantId,
            n.user_id,
            source,
            now,
          ))
        )
          return { allowed: false };
      }
      return {
        allowed: true,
        due: critical(n.category) ? now : nextNotificationTime(p, now),
        lifecycleSource: source?.type === "lifecycle" ? source : undefined,
        retentionSource: source?.type === "retention" ? source : undefined,
      };
    },
  );
  if (
    decision.allowed &&
    "lifecycleSource" in decision &&
    decision.lifecycleSource
  ) {
    const { lifecycleMessageCurrent } = await import("./lifecycle-messages.ts");
    if (
      !(await lifecycleMessageCurrent(
        db,
        tenantId,
        job.data.userId,
        decision.lifecycleSource,
        now,
      ))
    )
      return { allowed: false };
  }
  if (
    decision.allowed &&
    "retentionSource" in decision &&
    decision.retentionSource
  ) {
    const { retentionNotificationCurrent } = await import("./retention.ts");
    if (
      !(await retentionNotificationCurrent(
        db,
        tenantId,
        job.data.userId,
        decision.retentionSource,
        now,
      ))
    )
      return { allowed: false };
  }
  return {
    allowed: decision.allowed,
    ...("due" in decision ? { due: decision.due } : {}),
  };
}
export async function scheduleNotifications(db: Database, tenantId: string) {
  const a = elevated("worker", { tenantId, role: "owner" });
  await db.tenant(a, async (tx) => {
    const bookings = await tx.query(
      "SELECT b.id,b.user_id,s.title,s.starts_at FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.status='confirmed' AND s.status='open' AND s.starts_at>now() AND s.starts_at<=now()+interval '24 hours'",
    );
    for (const b of bookings)
      await notifyUser(tx, a, {
        userId: b.user_id,
        category: "booking",
        dedupeKey: `booking-reminder:${b.id}:${new Date(b.starts_at).toISOString()}`,
        title: "Your coaching session is coming up",
        body: `${b.title} starts at ${new Date(b.starts_at).toISOString()}. Open your bookings for the time in your time zone.`,
        href: "/app/bookings",
        templateKey: "booking-reminder",
        source: {
          type: "booking",
          id: b.id,
          startsAt: new Date(b.starts_at).toISOString(),
        },
      });
    const planned = await tx.query(
      "SELECT id,owner_user_id,data FROM records WHERE kind='planned_session' AND status='planned'",
    );
    for (const p of planned) {
      if (!(await hasMemberAccess(tx, p.owner_user_id))) continue;
      const timezone = p.data.timezone ?? "Asia/Dubai",
        fmt = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
      const today = fmt.format(new Date()),
        tomorrow = fmt.format(new Date(Date.now() + 24 * 3600000));
      if (![today, tomorrow].includes(p.data.date)) continue;
      await notifyUser(tx, a, {
        userId: p.owner_user_id,
        category: "workout",
        dedupeKey: `workout-reminder:${p.id}:${p.data.date}:${today}`,
        title:
          p.data.date === today
            ? "Your training is planned for today"
            : "Your next training day",
        body: `${p.data.label ?? "Your session"} is planned for ${p.data.date}. Your coach's current prescription is ready in your program.`,
        href: "/app/program",
        templateKey: "workout-reminder",
        source: { type: "workout", id: p.id, date: p.data.date },
      });
    }
  });
}
export function registerNotifications(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => Actor,
) {
  app.get("/api/v1/notifications/preferences", async (req) => {
    const a = identity(req);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT data,version FROM notification_preferences WHERE user_id=$1",
        [a.userId],
      );
      return {
        data: {
          ...notificationPreferencesSchema.parse(r?.data ?? {}),
          marketing: await marketingConsent(tx, a.userId),
        },
        version: r?.version ?? 0,
        // Only workspace owners receive website inquiries.
        options: { inquiries: a.role === "owner" },
      };
    });
  });
  app.put("/api/v1/notifications/preferences", async (req) => {
    const a = identity(req),
      b = z
        .object({
          version: z.number().int().min(0),
          data: notificationPreferencesSchema,
          // Read-only display hints from GET; accepted and ignored so a
          // client can send back what it read.
          options: z.object({ inquiries: z.boolean() }).strict().optional(),
        })
        .strict()
        .parse(req.body);
    const marketingVersion = await marketingConsentVersion(db);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":notifications:" + a.userId,
      ]);
      const [r] = await tx.query(
        "SELECT version FROM notification_preferences WHERE user_id=$1",
        [a.userId],
      );
      if ((r?.version ?? 0) !== b.version)
        throw fail(
          409,
          "PREFERENCES_CHANGED",
          "Your preferences changed. Reload before saving",
        );
      await recordMarketingChoice(
        tx,
        a,
        b.data.marketing,
        marketingVersion,
        "notification_preferences",
      );
      return (
        await tx.query(
          "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=excluded.data,version=notification_preferences.version+1,updated_at=now() RETURNING data,version",
          [a.tenantId, a.userId, JSON.stringify(b.data)],
        )
      )[0];
    });
  });
  // The appearance choice alone (Profile and settings > Display): merged
  // into the member's preferences in one statement, so it never needs the
  // version the notification form holds and never overwrites its fields.
  app.put("/api/v1/preferences/appearance", async (req) => {
    const a = identity(req),
      b = z.object({ theme: appearanceSchema }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":notifications:" + a.userId,
      ]);
      const [saved] = await tx.query(
        "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=notification_preferences.data||excluded.data,version=notification_preferences.version+1,updated_at=now() RETURNING data,version",
        [a.tenantId, a.userId, JSON.stringify({ theme: b.theme })],
      );
      return {
        data: {
          ...notificationPreferencesSchema.parse(saved.data ?? {}),
          marketing: await marketingConsent(tx, a.userId),
        },
        version: saved.version,
      };
    });
  });
  app.get("/api/v1/notifications", async (req) => {
    const a = identity(req),
      q = z
        .object({
          offset: z.coerce.number().int().min(0).default(0),
          // Keyset paging: the id of the last notification already shown.
          // Unlike an offset, a notice arriving between pages neither
          // repeats nor hides one.
          before: z.string().uuid().optional(),
        })
        .parse(req.query);
    return db.tenant(a, async (tx) => {
      if (q.before) {
        const [cursor] = await tx.query(
          "SELECT created_at,id FROM notifications WHERE id=$1 AND user_id=$2",
          [q.before, a.userId],
        );
        if (!cursor)
          throw fail(
            400,
            "INVALID_CURSOR",
            "This list position is not valid. Reload the list.",
          );
        // Compared inside the database, so the timestamp keeps full precision.
        return tx.query(
          "SELECT * FROM notifications WHERE user_id=$1 AND (created_at,id)<(SELECT created_at,id FROM notifications WHERE id=$2) ORDER BY created_at DESC,id DESC LIMIT 50",
          [a.userId, cursor.id],
        );
      }
      return tx.query(
        "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $2",
        [a.userId, q.offset],
      );
    });
  });
  app.post("/api/v1/notifications/:id/read", async (req) => {
    const a = identity(req);
    return db.tenant(a, async (tx) => {
      await tx.query(
        "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2",
        [
          z
            .string()
            .uuid()
            .parse((req.params as any).id),
          a.userId,
        ],
      );
      return { ok: true };
    });
  });
}
