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
import { WorkspaceSuspended } from "../apps/web/components/workspace-suspended.tsx";
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
  assert.match(suspended, /This workspace is suspended\./);
  assert.match(suspended, /Download my data/);
  assert.match(suspended, /Sign out/);
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
    new URL("../apps/web/app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /import "\.\/governance\.css";/);
});

test("offline entries wait while a workspace is suspended instead of being rejected", () => {
  assert.equal(
    classifyQueueFailure({ status: 423, code: "WORKSPACE_SUSPENDED", message: "Suspended" }),
    "retry",
  );
  assert.equal(classifyQueueFailure({ status: 400, message: "Invalid" }), "rejected");
});
