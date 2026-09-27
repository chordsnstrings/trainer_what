import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminRoute } from "../apps/web/components/app-routes.ts";
import {
  HostMetricsPanel,
  HostOperations,
} from "../apps/web/components/host-operations.tsx";

const snapshot = {
  asOf: "2026-09-27T10:00:00.000Z",
  overall: "critical",
  thresholds: { revision: 1, values: {}, reason: "Initial defaults" },
  controller: {
    state: "measured",
    reportedAt: "2026-09-27T09:58:00.000Z",
    ageSeconds: 120,
    release: "a".repeat(40),
  },
  metricsSource: "controller",
  metrics: [
    {
      key: "disk:/",
      label: "Disk used (/)",
      value: 92.5,
      unit: "%",
      status: "critical",
      warning: 80,
      critical: 90,
      detail: "6.0 GiB free of 80.0 GiB",
    },
    {
      key: "memory_available",
      label: "Memory available",
      value: 40,
      unit: "%",
      status: "ok",
      warning: 15,
      critical: 7,
      detail: "1600 MiB available of 4000 MiB",
    },
  ],
  containers: [
    { service: "api", state: "running", health: "healthy", status: "ok" },
    { service: "web", state: "exited", health: null, status: "critical" },
  ],
} as any;

test("the host view has its own admin route", () => {
  assert.equal(adminRoute("/admin/infrastructure/host"), "infrastructure_host");
  assert.equal(
    adminRoute("/admin/infrastructure/host/"),
    "infrastructure_host",
  );
  assert.equal(
    adminRoute("/admin/infrastructure/observer"),
    "infrastructure_observer",
  );
});

test("host metrics render values, thresholds and labelled states", () => {
  const html = renderToStaticMarkup(
    createElement(HostMetricsPanel, { snapshot, compact: true }),
  );
  assert.match(html, /aria-label="Host metrics"/);
  assert.match(html, /Disk used \(\/\)/);
  assert.match(html, /92\.5/);
  assert.match(html, /warning 80, critical 90/);
  assert.match(html, /host-level-critical">Critical/);
  assert.match(html, /web<\/span><span class="muted">exited/);
  assert.match(html, /href="\/admin\/infrastructure\/host"/);
});

test("the host view renders its heading, navigation and loading state before data", () => {
  const html = renderToStaticMarkup(createElement(HostOperations));
  assert.match(html, /<h1>Host and backups\.<\/h1>/);
  assert.match(html, /aria-current="page">Host and backups/);
  assert.match(html, /role="status">Loading host status/);
});
