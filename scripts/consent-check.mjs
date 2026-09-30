// Optional analytics consent, on its own (local Chromium only; never a cloud
// browser): the marketing lifecycle at 1440 (checkAcquisitionConsent) and
// the phone-first bar, answers and entry points on a coach website and in
// the member app at 390x844 and 360x740 (checkConsentOnPhone). The full
// browser check (scripts/browser-check.mjs) runs both too. Start it through
// scripts/run-consent-check.mjs, which seeds data and starts the servers.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  checkAcquisitionConsent,
  checkConsentOnPhone,
} from "./browser-completion-check.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  context.setDefaultNavigationTimeout(180_000);
  context.setDefaultTimeout(60_000);
  // Stay inside the API's normal request budget.
  let next = 0;
  await context.route("**/api/v1/**", async (route) => {
    const now = Date.now(),
      wait = Math.max(0, next - now);
    next = now + wait + 400;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await route.continue().catch(() => {});
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const desktop = await checkAcquisitionConsent({ page, base });
  await context.close();
  const phone = await checkConsentOnPhone({
    browser,
    base,
    member: "sam.taylor@example.test",
    password: process.env.DEMO_PASSWORD ?? "TrainerDemo2026!",
  });
  if (errors.length) throw new Error("Page errors: " + errors.join("; "));
  console.log(JSON.stringify({ desktop, phone }, null, 2));
  console.log("Consent check passed.");
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
}
