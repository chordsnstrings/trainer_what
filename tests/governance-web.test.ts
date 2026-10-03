import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminRoute } from "../apps/web/components/app-routes.ts";
import { classifyQueueFailure } from "../apps/web/components/offline-queue.ts";
import { WorkspaceGovernance } from "../apps/web/components/workspace-governance.tsx";
import { BusinessMetrics } from "../apps/web/components/business-metrics.tsx";
import { PlatformAlerts } from "../apps/web/components/platform-alerts.tsx";
import {
  WorkspaceSuspended,
  suspensionCopy,
} from "../apps/web/components/workspace-suspended.tsx";
import { SuspendedMemberBilling } from "../apps/web/components/suspended-member-billing.tsx";
import {
  GovernanceLinks,
  aed,
  percent,
} from "../apps/web/components/governance-shared.tsx";

const html = (component: any, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(component, props));

test("governance screens have admin routes instead of the not-found screen", () => {
  assert.equal(adminRoute("/admin/alerts"), "alerts");
  assert.equal(adminRoute("/admin/metrics/"), "metrics");
  assert.equal(adminRoute("/admin/governance"), "governance");
  assert.equal(adminRoute("/admin/governance/extra"), "not_found");
});

test("screens render their scoped initial state with accessible labels", () => {
  const finance = html(WorkspaceGovernance, { platformRole: "finance" });
  assert.match(finance, /Super admin or platform support access is required/);
  assert.match(finance, /role="alert"/);
  const support = html(WorkspaceGovernance, { platformRole: "support" });
  assert.match(support, /Trainer workspaces/);
  assert.doesNotMatch(support, /Account locks/, "locks are Super admin only");
  const admin = html(WorkspaceGovernance, { platformRole: "admin" });
  assert.match(admin, /Account locks/);
  assert.match(admin, /Search by name or address/);

  assert.match(
    html(BusinessMetrics, { platformRole: "support" }),
    /Super admin or platform finance access is required/,
  );
  const metrics = html(BusinessMetrics, { platformRole: "finance" });
  assert.match(metrics, /href="\/api\/v1\/admin\/metrics\.csv\?months=12"/);
  assert.match(metrics, /Last 12 months/);

  const alerts = html(PlatformAlerts, { platformRole: "safety" });
  assert.match(alerts, /Operator alerts/);
  assert.match(alerts, /aria-label="Alert status"/);
  assert.match(alerts, /aria-pressed="true"[^>]*>Needs attention/);

  const suspended = html(WorkspaceSuspended, { onSignOut: async () => {} });
  assert.match(suspended, /This workspace is unavailable/);
  assert.match(suspended, /Download my data/);
  assert.match(suspended, /Sign out/);
  assert.match(suspended, /<button class="button" type="button">Check again</);
});

test("a paused coach's workspace reads as the coach's coaching, not the person", () => {
  const member = suspensionCopy({
    role: "subscriber",
    workspace: { name: "Dana Hart" },
    message: "This coaching workspace is temporarily suspended by the platform team.",
  });
  assert.equal(member.title, "Coaching with Dana Hart is paused");
  assert.doesNotMatch(member.title, /Dana Hart is suspended/);
  assert.match(member.body, /Dana Hart’s coaching workspace/);
  assert.doesNotMatch(member.body, /platform support for help/);
  const owner = suspensionCopy({
    role: "owner",
    workspace: { name: "Dana Hart" },
    message: "This coaching workspace is temporarily suspended by the platform team.",
  });
  assert.equal(owner.title, "The Dana Hart workspace is suspended");
  assert.match(owner.body, /temporarily suspended by the platform team/);
});

test("a suspended follower sees renewal, refund and deletion actions", () => {
  const billing = {
    membership: {
      status: "active",
      cancel_at_period_end: false,
      period_end: "2026-10-15T00:00:00Z",
      price_minor: 25000,
      renewable: true,
    },
    transitions: [],
    requests: [
      {
        id: "r1",
        status: "requested",
        data: { amountMinor: 25000 },
        created_at: "2026-09-20T10:00:00Z",
      },
    ],
    charges: [
      {
        id: "c1",
        chargeId: "ch_fixture",
        chargedAt: "2026-09-20T10:00:00Z",
        remainingMinor: 25000,
        eligible: true,
      },
    ],
  };
  const page = html(SuspendedMemberBilling, { initial: billing, coach: "Dana Hart" });
  assert.match(page, /aria-labelledby="suspended-billing-title"/);
  assert.match(page, /not cancelled automatically/);
  assert.match(page, /keeps renewing/);
  assert.match(page, />Cancel membership renewal</);
  // Deletion is a quiet link that asks again in a bottom sheet.
  assert.match(page, /<button class="text-button suspended-delete"[^>]*>Request account deletion</);
  assert.match(page, /<dialog class="bottom-sheet"/);
  assert.match(page, /waiting for review/);
  assert.match(page, /Request a refund/);
  assert.match(page, /<select required="" name="chargeId">/);
  assert.match(page, /<span>Reason<\/span><textarea name="reason"/);
  assert.match(page, /Your refund requests/);
  assert.match(page, /AED/);
  // Renewal already stopped: no cancel action; nothing refundable: no form.
  const stopped = html(SuspendedMemberBilling, {
    initial: {
      ...billing,
      membership: { ...billing.membership, cancel_at_period_end: true },
      charges: [],
      requests: [],
      transitions: [{ id: "t1" }],
    },
  });
  assert.doesNotMatch(stopped, /Cancel membership renewal/);
  assert.match(stopped, /renewal stopped; ends/);
  assert.match(stopped, />Check renewal status</);
  assert.doesNotMatch(stopped, /Request a refund/);
  const none = html(SuspendedMemberBilling, {
    initial: { membership: null, transitions: [], requests: [], charges: [] },
    coach: "Dana Hart",
  });
  // No renewal or refund talk without a membership.
  assert.match(none, /You have no paid membership with Dana Hart, so nothing is charged/);
  assert.doesNotMatch(none, /stop renewal|ask for a refund|keeps renewing/i);
  assert.match(none, /Request account deletion/);
  assert.match(none, /Download my data/);
});

test("governance links follow the operator role", () => {
  assert.equal(html(GovernanceLinks, { platformRole: "none" }), "");
  const finance = html(GovernanceLinks, { platformRole: "finance" });
  assert.match(finance, /Business metrics/);
  assert.doesNotMatch(finance, /Workspaces and accounts/);
  const support = html(GovernanceLinks, { platformRole: "support" });
  assert.match(support, /Workspaces and accounts/);
  assert.doesNotMatch(support, /Business metrics/);
  assert.match(html(GovernanceLinks, { platformRole: "safety" }), /Operator alerts/);
});

test("figures are formatted in AED and percentages, with a dash for no data", () => {
  assert.match(aed(123456), /1,234\.56/);
  assert.match(aed(123456), /AED/);
  assert.equal(aed(null), "—");
  assert.equal(percent(0.1234), "12.3%");
  assert.equal(percent(null), "—");
});

test("new governance styles use logical properties for a later right-to-left pass", async () => {
  const css = await readFile(
    new URL("../apps/web/app/governance.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    css,
    /(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|(?<![(\w-])(min-|max-)?width\s*:/,
  );
  // Media queries keep physical viewport widths, like the existing styles.
  assert.match(css, /@media \(max-width: 650px\)/);
  const layout = await readFile(
    new URL("../apps/web/components/backend-governance-views.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /import "\.\.\/app\/governance\.css";/);
});

test("offline entries wait while a workspace is suspended instead of being rejected", () => {
  assert.equal(
    classifyQueueFailure({ status: 423, code: "WORKSPACE_SUSPENDED", message: "Suspended" }),
    "retry",
  );
  assert.equal(classifyQueueFailure({ status: 400, message: "Invalid" }), "rejected");
});
