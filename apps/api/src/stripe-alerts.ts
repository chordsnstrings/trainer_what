import {
  registerPlatformAlertRule,
  fingerprintOf,
  type AlertCandidate,
} from "./platform-alerts.ts";
import { STRIPE_WEBHOOK_API_VERSIONS } from "@trainer/providers";

// Stripe webhook conditions for operators (docs/features/payments-stripe.md).
// Both rules read only event ids, types and API versions, never payloads.

registerPlatformAlertRule({
  id: "stripe.events_parked",
  description:
    "Stripe events that match nothing on this platform (a Payment Link, a Dashboard invoice, a refund of another charge) were acknowledged so Stripe stops retrying, and kept for review.",
  async evaluate({ db }) {
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT external_id,payload->>'type' AS type,created_at FROM provider_events WHERE provider='stripe' AND status='parked' ORDER BY created_at DESC LIMIT 20",
      ),
    );
    if (!rows.length) return [];
    const [total] = await db.system((tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM provider_events WHERE provider='stripe' AND status='parked'",
      ),
    );
    const latest = rows
      .slice(0, 5)
      .map((r: any) => `${r.type} ${r.external_id}`)
      .join(", ");
    return [
      {
        dedupeKey: "stripe.events_parked",
        fingerprint: fingerprintOf([total.n, rows[0].external_id]),
        severity: "warning",
        scope: ["finance"],
        title: "Stripe events matched nothing on the platform",
        detail: `${total.n} Stripe event(s) refer to objects this platform did not create, or whose platform record never arrived. They were acknowledged so Stripe stops retrying. Latest: ${latest}. Check them in the Stripe Dashboard; payments taken outside the platform are not in any trainer's ledger.`,
        data: { parked: total.n },
      } satisfies AlertCandidate,
    ];
  },
});

registerPlatformAlertRule({
  id: "stripe.webhook_api_version",
  description:
    "Stripe events of the last 7 days sent with an API version the event handling was not verified against (the endpoint follows the account default and it changed).",
  async evaluate({ db }) {
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT payload->>'api_version' AS version,count(*)::int AS n FROM provider_events WHERE provider='stripe' AND created_at>now()-interval '7 days' AND payload ? 'api_version' AND payload->>'api_version'<>ALL($1::text[]) GROUP BY 1 ORDER BY 1",
        [STRIPE_WEBHOOK_API_VERSIONS],
      ),
    );
    return rows.map(
      (r: any): AlertCandidate => ({
        dedupeKey: `stripe.webhook_api_version:${r.version}`,
        fingerprint: String(r.version),
        severity: "critical",
        scope: ["finance"],
        title: `Stripe webhooks arrive with API version ${r.version}`,
        detail: `${r.n} Stripe event(s) in the last 7 days used API version ${r.version}; payments were verified only against ${STRIPE_WEBHOOK_API_VERSIONS.join(" and ")}. Pin the webhook endpoint to ${STRIPE_WEBHOOK_API_VERSIONS[0]} (docs/features/payments-stripe.md) or verify the new version before relying on these events.`,
        data: { version: r.version, events: r.n },
      }),
    );
  },
});
