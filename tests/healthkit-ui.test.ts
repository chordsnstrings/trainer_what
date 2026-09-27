import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HealthKitSyncView,
  HealthKitActivityList,
  dayLine,
  type Status,
} from "../apps/web/components/healthkit-sync.tsx";

const noop = () => {};
const base: Status = {
  available: true,
  code: null,
  message: "Automatic Apple Health sync is available.",
  coachAllowsSync: true,
  consent: false,
  wearablePermissionWithdrawn: false,
  devices: [],
  synced: { days: 0, observations: 0, last_sync_at: null },
  pendingCodeExpiresAt: null,
  server: "https://coach.example.test",
};
const render = (
  status: Status | null,
  extra: Partial<Parameters<typeof HealthKitSyncView>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(HealthKitSyncView, {
      status,
      role: "subscriber",
      message: "",
      busy: false,
      consent: false,
      pairing: null,
      onConsent: noop,
      onCreate: noop,
      onCancel: noop,
      onDisconnect: noop,
      onDelete: noop,
      ...extra,
    }),
  );
const device = (overrides: Record<string, unknown> = {}) => ({
  id: "device-" + Math.random(),
  name: "Synthetic iPhone",
  platform: "ios",
  status: "active",
  revokedReason: null,
  pairedAt: "2026-09-20T08:00:00.000Z",
  lastSyncAt: "2026-09-27T06:00:00.000Z",
  samplesReceived: 1234,
  lastErrorCode: null,
  ...overrides,
});

test("the sync panel explains each unavailable state without offering pairing", () => {
  assert.match(render(null), /Loading sync status/);
  const off = render({
    ...base,
    available: false,
    code: "HEALTHKIT_SYNC_DISABLED",
    message: "Automatic Apple Health sync is not enabled on this platform yet.",
  });
  assert.match(off, /Not available/);
  assert.doesNotMatch(off, /Create pairing code/);
  const member = render({ ...base, coachAllowsSync: false });
  assert.match(
    member,
    /Your coach has not enabled automatic Apple Health sync/,
  );
  assert.doesNotMatch(member, /Create pairing code/);
  const trainer = render(
    { ...base, coachAllowsSync: false },
    { role: "owner" },
  );
  assert.match(trainer, /href="\/trainer\/onboarding\/wearables"/);
  const withdrawn = render({ ...base, wearablePermissionWithdrawn: true });
  assert.match(withdrawn, /Permission withdrawn/);
  assert.doesNotMatch(withdrawn, /Create pairing code/);
});

test("pairing needs explicit consent and shows the one-time code with the server address", () => {
  const ready = render(base);
  assert.match(ready, /type="checkbox"/);
  assert.match(
    ready,
    /<button type="button" class="button" disabled="">Create pairing code/,
  );
  const consented = render(base, { consent: true });
  assert.match(
    consented,
    /<button type="button" class="button">Create pairing code/,
  );
  const code = render(base, {
    consent: false,
    pairing: {
      code: "7K2M-9QXR-4T8V",
      expiresAt: "2026-09-27T10:10:00.000Z",
      server: "https://coach.example.test",
    },
  });
  assert.match(code, /aria-live="polite"/);
  assert.match(code, /7K2M-9QXR-4T8V/);
  assert.match(code, /https:\/\/coach\.example\.test/);
  assert.match(code, /Cancel code/);
  // Five active devices: the limit is explained and pairing is disabled.
  const full = render(
    { ...base, devices: Array.from({ length: 5 }, () => device()) },
    { consent: true },
  );
  assert.match(full, /Five devices are connected/);
  assert.match(
    full,
    /<button type="button" class="button" disabled="">Create pairing code/,
  );
});

test("device rows show last sync, pause reasons, revocation and data deletion", () => {
  const html = render({
    ...base,
    devices: [
      device({ lastErrorCode: "HEALTHKIT_POLICY" }),
      device({
        name: "Old iPad",
        status: "revoked",
        revokedReason: "source_revoked",
        platform: "ipados",
      }),
    ],
    synced: {
      days: 12,
      observations: 96,
      last_sync_at: "2026-09-27T06:00:00.000Z",
    },
  });
  assert.match(html, /Paired devices/);
  assert.match(html, /aria-label="Disconnect Synthetic iPhone"/);
  assert.match(html, /Paused: your coach has turned automatic sync off/);
  assert.match(html, /Apple Health use revoked/);
  assert.doesNotMatch(html, /aria-label="Disconnect Old iPad"/);
  assert.match(html, /12 days · 96 derived observations/);
  assert.match(html, /Delete synced data/);
  // New layout rules use logical properties only.
  assert.doesNotMatch(html, /(margin|padding)-(left|right)/);
});

test("the progress card lists synchronized days in plain language", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(HealthKitActivityList, { days: [], lastSyncAt: null }),
    ),
    "",
  );
  const day = {
    day: "2026-09-26",
    steps: 11000,
    activeEnergyKcal: 640,
    sleepMinutes: 450,
    workoutMinutes: 50,
    workouts: [{ activity: "traditional_strength_training", minutes: 50 }],
    restingHeartRate: 54,
    hrvMs: 58,
    bodyMassKg: 80.5,
  };
  assert.equal(
    dayLine(day),
    "11,000 steps · 640 kcal active · 7 h 30 min asleep · Traditional strength training 50 min · resting heart rate 54 bpm · HRV 58 ms · 80.5 kg",
  );
  const html = renderToStaticMarkup(
    createElement(HealthKitActivityList, {
      days: [day],
      lastSyncAt: "2026-09-27T06:00:00.000Z",
      notice: "Descriptive records from Apple Health, not medical advice.",
    }),
  );
  assert.match(html, /Activity from Apple Health/);
  assert.match(html, /not medical advice/);
  assert.match(html, /11,000 steps/);
});
