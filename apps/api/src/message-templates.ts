import type { Tx } from "@trainer/db";

/**
 * Message kinds that published notification templates can drive. Each kind
 * names the template key its sender passes to notifyUser. The sender's own
 * copy is the built-in fallback, used whenever no template is published.
 * Variables are data: they are substituted in one pass (a value is never
 * expanded again) and HTML-escaped for the email HTML part.
 */
export const TEMPLATE_VARIABLES = [
  "name",
  "coach",
  "link",
  "date",
  "message",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
/** English is the base key; another locale uses `<key>--<locale>`. */
export const TEMPLATE_LOCALES = ["en", "ar"] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

export type MessageKind = {
  kind: string;
  templateKey: string;
  /** `operator` is platform staff, notified in their administration workspace. */
  audience: "trainer" | "member" | "trainer or member" | "operator";
  category: "safety" | "account" | "booking" | "workout" | "coaching";
  /**
   * Critical copy always keeps the built-in text after the template text.
   * Derived from the category exactly as notifyUser decides at send time.
   */
  critical: boolean;
  description: string;
  sample: { title: string; body: string; href: string };
};
/** Safety and account messages are critical; notifyUser applies the same rule. */
export const criticalCategory = (category: string) =>
  category === "safety" || category === "account";
const kind = (
  templateKey: string,
  audience: MessageKind["audience"],
  category: MessageKind["category"],
  description: string,
  sample: MessageKind["sample"],
): MessageKind => ({
  kind: templateKey.replace(/-v\d+$/, ""),
  templateKey,
  audience,
  category,
  critical: criticalCategory(category),
  description,
  sample,
});
// Lifecycle keys carry the scheduler's message version (lifecycle-messages.ts VERSION).
const lifecycle = (
  trigger: string,
  audience: MessageKind["audience"],
  category: MessageKind["category"],
  title: string,
  body: string,
  href: string,
) =>
  kind(
    `lifecycle-${trigger}-v1`,
    audience,
    category,
    `Lifecycle message: ${trigger.replaceAll("-", " ")}`,
    { title, body, href },
  );
export const MESSAGE_KINDS: readonly MessageKind[] = Object.freeze([
  kind(
    "coaching-message",
    "trainer or member",
    "coaching",
    "A new message in a coaching conversation",
    {
      title: "You have a new coaching message",
      body: "Open your coaching conversation to read the new message.",
      href: "/app/chat",
    },
  ),
  kind(
    "booking-reminder",
    "member",
    "booking",
    "Reminder before a booked session",
    {
      title: "Your coaching session is coming up",
      body: "Strength session starts at 2026-10-01T06:00:00.000Z. Open your bookings for the time in your time zone.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-reserved",
    "member",
    "booking",
    "A member reserved a coaching session",
    {
      title: "Session reserved",
      body: "Strength session is reserved. View your session time and cancellation policy in bookings.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-changed",
    "member",
    "booking",
    "The coach changed a booked session",
    {
      title: "Session updated",
      body: "Strength session has changed. Check the date, time and location in your bookings.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-canceled",
    "member",
    "booking",
    "A booked session was canceled",
    {
      title: "Session canceled",
      body: "Strength session has been canceled. Any payment refund is tracked separately.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-canceled-by-coach",
    "member",
    "booking",
    "The coach canceled a session slot that had a booking",
    {
      title: "Coach canceled session",
      body: "Strength session was canceled by your coach. Any payment refund is tracked separately.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-payment-confirmed",
    "member",
    "booking",
    "A paid session's payment is confirmed and the session is reserved",
    {
      title: "Your paid coaching session is confirmed",
      body: "Your payment is confirmed and your coaching session is reserved. Open your bookings for its current details.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-payment-compensation",
    "member",
    "booking",
    "A paid session could not be reserved after payment",
    {
      title: "Your session payment needs a refund",
      body: "The original session could not be reserved after payment. A refund review has been opened; check your booking for the latest status.",
      href: "/app/bookings",
    },
  ),
  kind(
    "booking-refund",
    "member",
    "booking",
    "The payment provider confirmed a session refund",
    {
      title: "Your session refund is confirmed",
      body: "The payment provider confirmed the refund for your canceled coaching session. Open your booking for the details.",
      href: "/app/bookings",
    },
  ),
  kind(
    "workout-reminder",
    "member",
    "workout",
    "Reminder for a planned training day",
    {
      title: "Your training is planned for today",
      body: "Upper body is planned for 2026-10-01. Your coach's current prescription is ready in your program.",
      href: "/app/program",
    },
  ),
  kind(
    "training-safety-alert",
    "trainer",
    "safety",
    "A client's training was paused after a safety report",
    {
      title: "A client needs a safety review",
      body: "Training has been paused after a safety report. Open your exceptions to review the report and explicitly resume or end the session.",
      href: "/trainer/exceptions",
    },
  ),
  kind(
    "training-paused",
    "member",
    "safety",
    "Tells a member their training is paused for review",
    {
      title: "Your training is paused",
      body: "Stop this training session. Your trainer needs to review the safety report before training can resume. Contact local emergency services if you need urgent help.",
      href: "/app/chat",
    },
  ),
  kind(
    "training-hold-resumed",
    "member",
    "safety",
    "The trainer resumed a paused training session",
    {
      title: "Your trainer reviewed the training hold",
      body: "Your trainer has resumed your session. Read their instructions in your coaching conversation before continuing.",
      href: "/app/chat",
    },
  ),
  kind(
    "training-hold-ended",
    "member",
    "safety",
    "The trainer ended a paused training session",
    {
      title: "Your trainer reviewed the training hold",
      body: "Your trainer has ended the paused session. Read their instructions in your coaching conversation before your next workout.",
      href: "/app/chat",
    },
  ),
  kind(
    "safety-review-overdue",
    "trainer",
    "safety",
    "A safety or personal review passed the published policy deadline",
    {
      title: "A safety review is overdue",
      body: "A client's safety review passed its review deadline. Open your exceptions and review it now; the platform safety team can see overdue reviews.",
      href: "/trainer/exceptions",
    },
  ),
  kind(
    "policy-review",
    "trainer",
    "coaching",
    "The safety policy routed a client's question to personal review",
    {
      title: "A client question needs your personal review",
      body: "The platform safety policy routed a coaching question to you instead of an automatic response. Open your exceptions to reply personally.",
      href: "/trainer/exceptions",
    },
  ),
  kind(
    "coaching-followup-review",
    "trainer",
    "coaching",
    "A scheduled follow-up could not be sent and needs the trainer",
    {
      title: "A scheduled follow-up needs your review",
      body: "The client is no longer a member of this workspace. Review and reschedule it from the client's conversation.",
      href: "/trainer/messages",
    },
  ),
  kind(
    "coaching-followup",
    "member",
    "coaching",
    "A trainer's scheduled follow-up message was delivered",
    {
      title: "Your coach sent a follow-up",
      body: "Open your coaching conversation to read the scheduled message from your trainer.",
      href: "/app/chat",
    },
  ),
  kind(
    "brain-plan-ready",
    "member",
    "coaching",
    "The trainer's Brain delivered a new training plan",
    {
      title: "Your training plan is ready",
      body: "Your trainer's Brain prepared your plan from your profile. Open Training to see today's session and the weeks ahead.",
      href: "/app/program",
    },
  ),
  kind(
    "brain-plan-adjusted",
    "member",
    "coaching",
    "The Brain adjusted next week's planned sessions",
    {
      title: "Next week's training was adjusted",
      body: "Your trainer's Brain adjusted next week's sessions from how this week went. Open Training to see them.",
      href: "/app/program",
    },
  ),
  kind(
    "brain-plan-withdrawn",
    "member",
    "coaching",
    "The trainer withdrew a delivered plan to revise it",
    {
      title: "Your trainer is revising your plan",
      body: "Your trainer reviewed your plan and is preparing a revised one. Your completed sessions are kept.",
      href: "/app/program",
    },
  ),
  kind(
    "brain-plan-review",
    "trainer",
    "coaching",
    "A Brain plan or weekly adjustment needs the trainer's review",
    {
      title: "A plan needs your review",
      body: "Your Brain prepared a plan it is not confident about, or one the safety rules send to you. Review, edit or reject it.",
      href: "/trainer/brain/plans",
    },
  ),
  kind(
    "website-inquiry",
    "trainer",
    "coaching",
    "A visitor sent a message through the coach's website",
    {
      title: "New website inquiry",
      body: "Someone contacted you through your coaching website. Open your website inquiries to read the message and reply.",
      href: "/trainer/website",
    },
  ),
  kind(
    "nutrition-review",
    "trainer",
    "coaching",
    "A nutrition request needs the coach's review",
    {
      title: "A nutrition plan needs your review",
      body: "A client's nutrition request could not be safely completed within the current plan. Open nutrition exceptions to review the details; their existing valid plan is preserved.",
      href: "/trainer/nutrition/exceptions",
    },
  ),
  kind(
    "retention-review-v1",
    "trainer",
    "coaching",
    "Recorded cancellations met the trainer's saved threshold",
    {
      title: "Review your recorded membership cancellations",
      body: "Your saved cancellation threshold is met by current recorded billing evidence. Review the business summary and its source records.",
      href: "/trainer/analytics#retention",
    },
  ),
  kind(
    "brain-import-review-v1",
    "trainer",
    "coaching",
    "Uploaded teaching material is ready for review",
    {
      title: "Your uploaded material is ready for review",
      body: "Extraction is complete. Review the material and remove identifying details before approving it for your coaching knowledge.",
      href: "/trainer/brain/knowledge",
    },
  ),
  kind(
    "brain-compilation-review-v1",
    "trainer",
    "coaching",
    "Draft coaching rules are ready for review",
    {
      title: "Your draft coaching rules are ready",
      body: "Compilation produced 3 draft rules and 1 potential conflict. Review the proposals and resolve conflicts before publishing.",
      href: "/trainer/brain/knowledge",
    },
  ),
  kind(
    "follower-joined",
    "trainer",
    "coaching",
    "A new follower joined through an invitation or the coaching website",
    {
      title: "A new follower joined",
      body: "Layla joined your coaching space through your invitation. Open their profile to welcome them and assign a program.",
      href: "/trainer/subscribers",
    },
  ),
  kind(
    "membership-exit-team",
    "trainer",
    "coaching",
    "A subscriber ended their membership",
    {
      title: "A subscriber left",
      body: "Layla ended their membership. Their note: “Taking a break over the summer.”",
      href: "/trainer/subscribers",
    },
  ),
  kind(
    "complimentary-granted",
    "member",
    "coaching",
    "The coach gave a follower complimentary access",
    {
      title: "Your coach gave you complimentary access",
      body: "Workout + nutrition coaching is included until 1 November 2026. No payment is needed for this access.",
      href: "/app/membership",
    },
  ),
  kind(
    "complimentary-ending",
    "member",
    "coaching",
    "A follower's complimentary access ends in a few days",
    {
      title: "Your complimentary access ends soon",
      body: "The complimentary coaching access from your coach ends on 1 November 2026. Your membership page shows your options to continue.",
      href: "/app/membership",
    },
  ),
  kind(
    "programme-ending",
    "member",
    "coaching",
    "An upfront programme ends in a few days",
    {
      title: "Your programme ends soon",
      body: "Your programme ends in a few days. Open your membership to continue with the next one.",
      href: "/app/membership",
    },
  ),
  kind(
    "programme-ended",
    "member",
    "coaching",
    "An upfront programme reached the end of its paid access",
    {
      title: "Your programme is complete",
      body: "You finished your programme. Open your membership to start the next one when you are ready.",
      href: "/app/membership",
    },
  ),
  kind(
    "programme-next-block",
    "member",
    "coaching",
    "A new block of a monthly programme started",
    {
      // Generic on purpose: a published template replaces the sender's text
      // (which names the block and its length) for every block.
      title: "A new block of your programme has started",
      body: "A new block of your programme started. Today shows where you are and what comes next.",
      href: "/app",
    },
  ),
  kind(
    "complimentary-ended",
    "member",
    "coaching",
    "A follower's complimentary access was ended or reached its end date",
    {
      title: "Your complimentary access has ended",
      body: "The complimentary coaching access from your coach ended on 1 November 2026. Your membership page shows your current options.",
      href: "/app/membership",
    },
  ),
  kind(
    "complimentary-team-ended",
    "trainer",
    "coaching",
    "A follower's complimentary access reached its end date",
    {
      title: "Complimentary access ended",
      body: "Layla's complimentary access reached its end date. Grant it again or invite them to a paid plan from Subscribers.",
      href: "/trainer/subscribers",
    },
  ),
  kind(
    "complimentary-platform-ended",
    "trainer",
    "coaching",
    "Platform operations ended a complimentary grant in the workspace",
    {
      title: "Platform operations ended a complimentary grant",
      body: "A complimentary access grant in your workspace was ended by platform operations. Open your subscribers to review current access.",
      href: "/trainer/subscribers",
    },
  ),
  kind(
    "healthkit-paired",
    "member",
    "account",
    "A device was paired for Apple Health sync",
    {
      title: "Apple Health sync connected",
      body: "“Layla's iPhone” can now send Apple Health data to your coaching workspace. If you did not pair this device, disconnect it in Connections.",
      href: "/app/wearables",
    },
  ),
  kind(
    "workspace-suspended",
    "trainer",
    "account",
    "The platform team suspended the coaching workspace",
    {
      title: "Your coaching workspace is suspended",
      body: "The platform team suspended this workspace. Members cannot use coaching, plans or bookings, the public website and joining are offline, and payouts are held. Billing is not cancelled. Contact platform support to resolve this.",
      href: "/trainer",
    },
  ),
  kind(
    "workspace-reinstated",
    "trainer",
    "account",
    "The platform team reinstated a suspended coaching workspace",
    {
      title: "Your coaching workspace is active again",
      body: "The platform team reinstated this workspace. Coaching, bookings, the public website and joining are available again, and held payouts return to finance review.",
      href: "/trainer",
    },
  ),
  kind(
    "platform-alert",
    "operator",
    "account",
    "An open platform alert for operators in their scope",
    {
      title: "Warning: Failed or blocked jobs in Coach Omar & Co",
      body: "2 job(s) failed or are blocked for review (email). Review them in the jobs view before any retry.\n\nReview it in the operator alert inbox.",
      href: "/admin/alerts",
    },
  ),
  // Web addresses (docs/features/web-addresses.md): the trainer's own domain.
  kind(
    "web-address-live",
    "trainer",
    "account",
    "A bought domain now serves the coaching website",
    {
      title: "Your website is live on your own domain",
      body: "https://laylastrength.com now shows your coaching website and member app sign-in. Your domain renews every year at USD 24.99; the next renewal is before 2027-09-28. Note: the renewal is USD 5.00 more a year than the first year.",
      href: "/trainer/domains",
    },
  ),
  kind(
    "web-address-renewed",
    "trainer",
    "account",
    "The yearly domain renewal completed",
    {
      title: "Your domain was renewed",
      body: "laylastrength.com is renewed until 2028-09-28. Nothing else is needed.",
      href: "/trainer/domains",
    },
  ),
  kind(
    "web-address-renewal-failed",
    "trainer",
    "account",
    "The yearly domain renewal payment failed",
    {
      title: "Your domain renewal payment failed",
      body: "We could not charge the yearly renewal of USD 24.99 for laylastrength.com. Update your card in Stripe before 2027-09-28; Stripe retries the payment automatically. If it is not paid, laylastrength.com stops working and your website stays available at https://layla.trainsyou.com. Note: the renewal is USD 5.00 more a year than the first year.",
      href: "/trainer/domains",
    },
  ),
  kind(
    "web-address-renewal-upcoming",
    "trainer",
    "account",
    "The yearly domain renewal is charged in two weeks",
    {
      title: "Your domain renews soon",
      body: "On 2027-08-29 we charge USD 24.99 to your card for another year of laylastrength.com, renewed automatically. Note: the renewal is USD 5.00 more a year than the first year. You can turn renewal off in Web address before that date.",
      href: "/trainer/domains",
    },
  ),
  kind(
    "web-address-renewal-reminder",
    "trainer",
    "account",
    "A domain expires soon without a paid renewal",
    {
      title: "Your domain expires in 7 days",
      body: "The yearly renewal of USD 24.99 for laylastrength.com has not been charged yet. We charge your card before 2027-09-28; make sure it is up to date. Note: the renewal is USD 5.00 more a year than the first year.",
      href: "/trainer/domains",
    },
  ),
  kind(
    "web-address-lapsed",
    "trainer",
    "account",
    "A domain expired and the website moved back to its subdomain",
    {
      title: "Your domain has expired",
      body: "laylastrength.com was not renewed and no longer shows your website. Your website and member sign-in stay available at https://layla.trainsyou.com. You can buy a domain again from Web address.",
      href: "/trainer/domains",
    },
  ),
  kind(
    "web-address-refunded",
    "trainer",
    "account",
    "A paid domain could not be registered and was refunded",
    {
      title: "We could not register your domain",
      body: "laylastrength.com could not be registered: The name was registered by someone else before the purchase completed. Your payment has been refunded to your card. Your website stays available at its current address.",
      href: "/trainer/domains",
    },
  ),
  lifecycle(
    "publish-ready",
    "trainer",
    "coaching",
    "Your coaching space is ready to publish",
    "Your current setup passes the launch checks. Review your preview and publish when you are ready.",
    "/trainer/onboarding/publish",
  ),
  lifecycle(
    "onboarding",
    "trainer",
    "coaching",
    "Continue setting up your coaching space",
    "Your saved setup is ready to continue. Open the next required step.",
    "/trainer/onboarding",
  ),
  lifecycle(
    "interview",
    "trainer",
    "coaching",
    "Continue your coaching interview",
    "Your saved answers are available. Add the recommendations, reasons and limits you use in your coaching.",
    "/trainer/brain/teaching",
  ),
  lifecycle(
    "payout-setup",
    "trainer",
    "coaching",
    "Complete your payout setup",
    "Review your UAE payout account setup and its current status. You can continue setting up your coaching space while this is pending.",
    "/trainer/onboarding/payout",
  ),
  lifecycle(
    "paid-milestone",
    "trainer",
    "coaching",
    "Your first paid member is here",
    "Confirmed subscription payments and current membership access support this milestone. Your ledger shows the payment and payout details.",
    "/trainer/finance",
  ),
  lifecycle(
    "review-queue",
    "trainer",
    "coaching",
    "Your coaching review queue needs attention",
    "Several coaching decisions are awaiting your review. Open the queue to review their current priority and status.",
    "/trainer/exceptions",
  ),
  lifecycle(
    "intake",
    "member",
    "coaching",
    "Complete your coaching intake",
    "Your payment is recorded. Complete your intake so your coach has the information needed to prepare your program.",
    "/app/intake",
  ),
  lifecycle(
    "program-ready",
    "member",
    "workout",
    "Your program is ready",
    "Your assigned program and training schedule are available. Open your program to review the plan and start a session when you are ready.",
    "/app/program",
  ),
  lifecycle(
    "workout-complete",
    "member",
    "workout",
    "Your completed workout is saved",
    "Your session is recorded. Review it and your next planned training in the app.",
    "/app/program",
  ),
  lifecycle(
    "block-complete",
    "member",
    "workout",
    "Your training block is complete",
    "All 12 planned sessions have recorded completions. Open your coaching context to review the schedule evidence and discuss your next block.",
    "/app/twin",
  ),
  lifecycle(
    "workout-missed",
    "member",
    "workout",
    "Review a past planned session",
    "A planned training date has passed without a recorded completion. Open your program to review the session and reschedule if needed.",
    "/app/program",
  ),
  lifecycle(
    "wearable-attention",
    "member",
    "coaching",
    "Your wearable connection needs attention",
    "Your wearable connection has an unresolved synchronization issue. Open integrations to review its status and reconnect.",
    "/app/wearables",
  ),
  lifecycle(
    "payment-failed",
    "member",
    "account",
    "Your subscription payment needs attention",
    "A subscription payment failed. Open your membership to review payment recovery, current access and any applicable grace period.",
    "/app/membership",
  ),
  lifecycle(
    "cancel-scheduled",
    "member",
    "account",
    "Your subscription cancellation is confirmed",
    "Renewal is scheduled to stop at the end of your current billing period. Your membership shows the confirmed final access date.",
    "/app/membership",
  ),
  lifecycle(
    "refund",
    "member",
    "account",
    "Your refund request has an update",
    "Your refund request has a confirmed update. Open your membership to review it.",
    "/app/membership",
  ),
  lifecycle(
    "payout-paid",
    "trainer",
    "account",
    "Your payout is confirmed",
    "Your payout has a confirmed bank reference. Open finance to review its ledger details and statement.",
    "/trainer/finance",
  ),
]);
const byKey = new Map(MESSAGE_KINDS.map((k) => [k.templateKey, k]));

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/** Splits `<key>--<locale>`; English is always the unsuffixed base key. */
export function parseTemplateDocumentKey(key: string) {
  const match = /^(.+?)(?:--([a-z]{2}))?$/.exec(key);
  const base = match?.[1] ?? key,
    locale = (match?.[2] ?? "en") as TemplateLocale;
  return { base, locale, kind: byKey.get(base) ?? null };
}
export const messageKindForKey = (key: string | undefined | null) =>
  key ? (byKey.get(parseTemplateDocumentKey(key).base) ?? null) : null;

const variablePattern = /\{\{\s*(name|coach|link|date|message)\s*\}\}/g;
/** Throws a client error for keys or variables a sender could never render. */
export function assertNotificationDocument(
  key: string,
  title: string,
  content: string,
) {
  const parsed = parseTemplateDocumentKey(key);
  if (!parsed.kind)
    throw fail(
      400,
      "TEMPLATE_KEY",
      "Use a registered message key; see the message kinds list.",
    );
  if (!TEMPLATE_LOCALES.includes(parsed.locale) || key.endsWith("--en"))
    throw fail(
      400,
      "TEMPLATE_LOCALE",
      "English uses the plain key; add --ar for Arabic.",
    );
  for (const text of [title, content]) {
    const leftover = text.replace(variablePattern, "");
    if (/\{\{|\}\}/.test(leftover))
      throw fail(
        400,
        "TEMPLATE_VARIABLE",
        "Use only name, link, coach, date, and message template variables.",
      );
  }
  return parsed;
}

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** One pass: substituted values are never scanned for variables again. */
export const fillTemplate = (
  source: string,
  values: Record<TemplateVariable, string>,
) =>
  source.replace(variablePattern, (_m, key: TemplateVariable) => values[key]);
const singleLine = (value: string) =>
  value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();

export type PublishedTemplate = {
  key: string;
  version: number;
  title: string;
  body: string;
  locale: TemplateLocale;
};
export type TemplatePin = {
  kind: string | null;
  key: string;
  version: number | null;
  locale: TemplateLocale;
  requestedLocale: TemplateLocale;
  source: "published" | "built_in";
};
export type RenderedMessage = {
  title: string;
  body: string;
  emailText: string;
  emailHtml: string;
};
/**
 * Renders in-app and email copy. Critical copy keeps the sender's built-in
 * text intact after any template text. The HTML part escapes the fully
 * substituted text, which escapes both template fragments and every value.
 */
export function renderMessage(input: {
  template: Pick<PublishedTemplate, "title" | "body" | "locale"> | null;
  builtIn: { title: string; body: string };
  values: { name: string; coach: string; date: string };
  href: string;
  appUrl: string;
  critical: boolean;
}): RenderedMessage {
  const body = input.builtIn.body.slice(0, 4000),
    url = input.href ? input.appUrl.replace(/\/+$/, "") + input.href : "";
  const compose = (link: string) => {
    if (!input.template) return body;
    const expanded = fillTemplate(input.template.body, {
      ...input.values,
      link,
      message: body,
    });
    return input.critical
      ? body.length >= 3998
        ? body
        : expanded.slice(0, 3998 - body.length) + "\n\n" + body
      : expanded.slice(0, 4000);
  };
  const title = singleLine(
    input.template
      ? fillTemplate(input.template.title, {
          ...input.values,
          link: input.href,
          message: singleLine(body),
        })
      : input.builtIn.title,
  ).slice(0, 160);
  const inApp = compose(input.href),
    email = compose(url),
    locale = input.template?.locale ?? "en";
  const emailHtml =
    `<div lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}" style="font-family:Arial,sans-serif;line-height:1.5">` +
    `<p>${escapeHtml(email).replace(/\n/g, "<br>\n")}</p>` +
    (url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : "") +
    "</div>";
  return {
    title: title || singleLine(input.builtIn.title).slice(0, 160),
    body: inApp,
    emailText: email + (url ? `\n\n${url}` : ""),
    emailHtml,
  };
}

/** Requested locale first, then English, then the caller's built-in copy. */
export async function resolvePublishedTemplate(
  tx: Tx,
  templateKey: string,
  requested: TemplateLocale,
): Promise<PublishedTemplate | null> {
  const candidates: Array<[string, TemplateLocale]> =
    requested === "en"
      ? [[templateKey, "en"]]
      : [
          [`${templateKey}--${requested}`, requested],
          [templateKey, "en"],
        ];
  for (const [key, locale] of candidates) {
    const [row] = await tx.query<{ value: any }>(
      "SELECT published_notification_template($1) AS value",
      [key],
    );
    if (row?.value)
      return {
        key: row.value.key,
        version: row.value.version,
        title: row.value.title,
        body: row.value.body,
        locale,
      };
  }
  return null;
}
/** Tenant transactions cannot read tenants; a scoped helper returns only this workspace's name. */
export async function workspaceName(tx: Tx) {
  const [row] = await tx.query<{ name: string | null }>(
    "SELECT notification_workspace_name() AS name",
  );
  return row?.name || "Your coach";
}
export const localDate = (timeZone: string, now = new Date()) => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

export const samplePreviewValues = (now = new Date()) => ({
  name: "Layla <Sample>",
  coach: "Coach Omar & Co",
  date: localDate("Asia/Dubai", now),
});
/** Admin preview with sample data; nothing is stored or sent. */
export function previewTemplate(
  input: { key: string; title: string; content: string },
  appUrl: string,
  now = new Date(),
) {
  const parsed = assertNotificationDocument(
    input.key,
    input.title,
    input.content,
  );
  const k = parsed.kind!;
  const rendered = renderMessage({
    template: {
      title: input.title,
      body: input.content,
      locale: parsed.locale,
    },
    builtIn: k.sample,
    values: samplePreviewValues(now),
    href: k.sample.href,
    appUrl,
    critical: k.critical,
  });
  const builtIn = renderMessage({
    template: null,
    builtIn: k.sample,
    values: samplePreviewValues(now),
    href: k.sample.href,
    appUrl,
    critical: k.critical,
  });
  return {
    kind: k,
    locale: parsed.locale,
    sampleValues: {
      ...samplePreviewValues(now),
      link: k.sample.href,
      message: k.sample.body,
    },
    inApp: { title: rendered.title, body: rendered.body },
    email: {
      subject: rendered.title,
      text: rendered.emailText,
      html: rendered.emailHtml,
    },
    builtIn: { title: builtIn.title, body: builtIn.body },
    push: {
      // Neutral: member apps carry their trainer's brand (public/sw.js).
      title: "Coaching update",
      body: "You have an update. Open the app to view your inbox.",
      note: "Device notifications never carry message content; the device shows this fixed notice.",
    },
  };
}
