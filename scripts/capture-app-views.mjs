import { chromium } from "playwright";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyBootstrapRecovery,
  verifySettingsUi,
} from "./verify-settings-ui.mjs";

// Local synthetic development/CI evidence only. This does not use a remote
// browser, deploy an application, or contact any third-party provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("Screenshots may only target a loopback synthetic app");
if (process.env.NODE_ENV === "production")
  throw new Error("Synthetic screenshot fixtures are forbidden in production");
const output = resolve(
  root,
  process.env.APP_SCREENSHOT_DIR ?? "test-results/app-views",
);
const password = process.env.DEMO_PASSWORD ?? "TrainerDemo2026!";
const managed = process.env.APP_SCREENSHOT_EXTERNAL_SERVERS !== "1";
const children = [];
const errors = [];
const manifest = [];
const blockedExternal = new Set();
const recentApiRequests = [];
async function paceApiRequests(limit = 90, record = true) {
  // All local browser contexts share one IP. Leave room below the real
  // 120/minute application limit for authenticated fixture verification.
  for (;;) {
    const now = Date.now();
    while (recentApiRequests.length && recentApiRequests[0] <= now - 60050)
      recentApiRequests.shift();
    if (recentApiRequests.length < limit) {
      if (record) recentApiRequests.push(now);
      return;
    }
    await new Promise((done) =>
      setTimeout(
        done,
        Math.min(1000, Math.max(25, recentApiRequests[0] + 60050 - now)),
      ),
    );
  }
}
const viewports = [
  ["desktop", { width: 1440, height: 1050 }],
  ["mobile", { width: 390, height: 844 }],
];
await mkdir(output, { recursive: true });
const serverLog = createWriteStream(join(output, "servers.log"));
const localEnv = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: "",
  MIGRATION_DATABASE_URL: "",
  PGLITE_DATA_DIR: join(
    root,
    ".data",
    "app-views-" + randomBytes(6).toString("hex"),
  ),
  PUBLIC_APP_URL: base,
  API_HOST: "127.0.0.1",
  API_PORT: "4000",
  NEXT_TELEMETRY_DISABLED: "1",
  SECURITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  NUTRITION_ENABLED: "true",
  NUTRITION_SCOPE_APPROVED: "true",
  LEGAL_APPROVED: "false",
  COMMERCE_ENABLED: "false",
  PAYOUTS_ENABLED: "false",
  BUNDLE_CHANGES_APPROVED: "false",
};
for (const key of Object.keys(localEnv))
  if (
    /^(STRIPE_|LEAN_|MODEL_|EMAIL_|RESEND_|WHOOP_|ZEPP_|VOICE_|DOMAIN_|FOOD_|MEAL_PHOTO_)/.test(
      key,
    )
  )
    delete localEnv[key];

function launch(args, cwd = root) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: localEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(serverLog, { end: false });
  child.stderr.pipe(serverLog, { end: false });
  children.push(child);
  return child;
}
async function completion(child) {
  await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(
            new Error(
              `Local fixture command failed (${code}); inspect servers.log`,
            ),
          ),
    );
  });
}
async function waitForServer(url) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      children.some((child) => child.exitCode !== null && child.exitCode !== 0)
    )
      throw new Error("A local screenshot server exited; inspect servers.log");
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Local server did not become ready: ${url}`);
}
const publicRoutes = [
  ["/", "Platform home"],
  ["/how-it-works", "How it works"],
  ["/demo", "Interactive coaching demo"],
  ["/pricing", "Platform economics"],
  ["/faq", "Questions"],
  ["/login", "Sign in"],
  ["/signup", "Coach registration"],
  ["/forgot-password", "Password recovery"],
  ["/reset-password/synthetic-preview-token", "Password reset form"],
  ["/verify-email/synthetic-preview-token", "Email verification form"],
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/ai-disclosure", "Digital coaching disclosure"],
  ["/coach/alex-morgan", "Coach storefront · current availability"],
  ["/join-coach/alex-morgan", "Client registration"],
];
const trainerRoutes = [
  ["/trainer", "Trainer overview"],
  ["/trainer/subscribers", "Subscribers"],
  ["/trainer/programs", "Programs"],
  ["/trainer/messages", "Messages"],
  ["/trainer/bookings", "Coaching calendar"],
  ["/trainer/support", "Trainer support"],
  ["/trainer/exceptions", "Coaching exceptions"],
  ["/trainer/analytics", "Business analytics"],
  ["/trainer/finance", "Finance · ledger"],
  ["/trainer/products", "Subscription offers"],
  ["/trainer/payouts", "Trainer payouts"],
  ["/trainer/integrations", "Trainer connections"],
  ["/trainer/settings", "Trainer settings and security"],
  ["/trainer/design", "App design studio"],
  ["/trainer/brand", "Brand studio entry"],
  ["/trainer/brain", "Coaching interview"],
  ["/trainer/brain/constitution", "Coaching constitution"],
  ["/trainer/brain/knowledge", "Knowledge sources"],
  ["/trainer/brain/scenarios", "Scenario lab"],
  ["/trainer/brain/releases", "Brain releases"],
];
const onboardingSteps = [
  "account",
  "identity",
  "brand",
  "brain-intro",
  "interview",
  "uploads",
  "knowledge",
  "scenarios",
  "readiness",
  "offer",
  "payout",
  "wearables",
  "voice",
  "domain",
  "preview",
  "publish",
  "nutrition-cases",
  "nutrition-recipes",
  "nutrition-policy",
  "nutrition-scenarios",
  "nutrition-preview",
  "nutrition-readiness",
];
const nutritionSections = [
  ["", "Nutrition overview"],
  ["cases", "Teach nutrition through cases"],
  ["recipes", "Ingredients and recipes"],
  ["policy", "Diet and nutrition rules"],
  ["scenarios", "Nutrition case checks"],
  ["preview", "Sample meal week"],
  ["readiness", "Nutrition activation"],
  ["exceptions", "Nutrition exceptions"],
];
const subscriberRoutes = [
  ["/app", "Client home"],
  ["/app/program", "Client program"],
  ["/app/chat", "Coach chat"],
  ["/app/bookings", "Book a coaching session"],
  ["/app/support", "Client support"],
  ["/app/progress", "Client progress"],
  ["/app/twin", "Client coaching context"],
  ["/app/membership", "Client membership"],
  ["/app/wearables", "Client connections"],
  ["/app/profile", "Client profile and security"],
  ["/app/intake", "Client intake"],
  ["/app/nutrition", "Daily meal plan"],
  ["/app/nutrition/log", "Photo, barcode and manual meal entry"],
];
const integrations = [
  "application",
  "stripe",
  "lean",
  "model",
  "email",
  "whoop",
  "apple",
  "zepp",
  "voice",
  "domains",
];
function safeName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function escape(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

let browser;
try {
  if (managed) {
    await completion(launch(["--import", "tsx", "scripts/seed-demo.ts"]));
    await completion(
      launch([
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        "import {prepareScreenshotFixtures} from './scripts/verify-settings-ui.mjs'; await prepareScreenshotFixtures();",
      ]),
    );
    launch(["--import", "tsx", "src/server.ts"], join(root, "apps/api"));
    launch(
      [
        join(root, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
      ],
      join(root, "apps/web"),
    );
    await waitForServer("http://127.0.0.1:4000/health");
    await waitForServer(base);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  async function context() {
    const ctx = await browser.newContext({
      viewport: viewports[0][1],
      locale: "en-GB",
      timezoneId: "Asia/Dubai",
      serviceWorkers: "block",
    });
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === new URL(base).origin &&
        url.pathname.startsWith("/api/")
      )
        await paceApiRequests();
      if (
        ["data:", "blob:", "about:"].includes(url.protocol) ||
        url.origin === new URL(base).origin
      )
        return route.continue();
      blockedExternal.add(url.origin);
      return route.abort("blockedbyclient");
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) =>
      errors.push({
        route: new URL(page.url()).pathname,
        message: error.message,
      }),
    );
    return { ctx, page };
  }
  const publicView = await context();
  const trainer = await context();
  const subscriber = await context();
  async function login(page, email, target) {
    await page.goto(base + "/login", { waitUntil: "networkidle" });
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(base + target);
    await page.locator(".page-heading h1").first().waitFor();
  }
  await login(trainer.page, "coach@example.test", "/trainer");
  await login(subscriber.page, "sam.taylor@example.test", "/app");
  const bootResponse = await trainer.ctx.request.get(
    base + "/api/v1/bootstrap",
  );
  if (!bootResponse.ok()) throw new Error("Synthetic fixture bootstrap failed");
  const boot = await bootResponse.json();
  if (
    boot.environment !== "development" ||
    boot.user.email !== "coach@example.test"
  )
    throw new Error(
      "Screenshot target is not the expected development fixture",
    );
  const sam = boot.members?.find(
    (member) => member.email === "sam.taylor@example.test",
  );
  if (sam) {
    trainerRoutes.push([
      `/trainer/subscribers/${sam.id}`,
      "Subscriber coaching context",
    ]);
    trainerRoutes.push([
      `/trainer/nutrition/clients/${sam.id}`,
      "Coach view of client nutrition",
    ]);
  }
  const checks = await verifySettingsUi({
    base,
    trainer,
    subscriber,
    password,
    onVerifiedView: async (name, route = "/admin/integrations/model") => {
      for (const [device] of viewports)
        await capture(trainer.page, {
          route,
          title:
            route === "/trainer/design"
              ? "Personal app design studio"
              : "AI connection credentials",
          group: "Superadmin",
          device,
          state: name,
        });
    },
  });
  await writeFile(
    join(output, "functional-checks.json"),
    JSON.stringify(checks, null, 2),
  );

  async function capture(
    page,
    { route, title, group, device, state = "default", setup, navigate = true },
  ) {
    await paceApiRequests(80, false);
    await page.setViewportSize(viewports.find(([name]) => name === device)[1]);
    if (navigate) await page.goto(base + route, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor();
    await page.waitForFunction(
      () => !document.body.innerText.includes("Opening your workspace…"),
    );
    if (setup) await setup(page);
    await page.evaluate(() => document.fonts.ready);
    // Never capture even fixture credential values, setup keys or one-time codes.
    const enteredSecrets = await page
      .locator('input[type="password"], input[autocomplete="one-time-code"]')
      .evaluateAll((nodes) => nodes.filter((node) => node.value).length);
    if (enteredSecrets)
      throw new Error(`Credential input is not empty at ${route}`);
    if (await page.getByText("Manual setup key:", { exact: false }).count())
      throw new Error(`Authenticator setup key is visible at ${route}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    const file = `${String(manifest.length + 1).padStart(3, "0")}-${safeName(group)}-${safeName(title)}-${safeName(state)}-${device}.png`;
    await page.screenshot({
      path: join(output, file),
      fullPage: true,
      animations: "disabled",
    });
    const item = {
      route,
      title,
      group,
      state,
      device,
      width: page.viewportSize().width,
      file,
      overflow,
      observedPath: new URL(page.url()).pathname,
    };
    manifest.push(item);
    if (overflow)
      errors.push({
        route,
        device,
        state,
        message: "Horizontal viewport overflow",
      });
    if (item.observedPath !== route)
      errors.push({
        route,
        device,
        message: `Unexpected redirect to ${item.observedPath}`,
      });
    console.log(
      `Captured ${manifest.length}: ${device} ${route}${state === "default" ? "" : ` · ${state}`}`,
    );
  }
  async function routes(page, rows, group) {
    for (const [route, title] of rows)
      for (const [device] of viewports)
        await capture(page, { route, title, group, device });
  }
  async function state(page, route, title, group, name, setup) {
    for (const [device] of viewports)
      await capture(page, { route, title, group, device, state: name, setup });
  }
  Object.assign(
    checks,
    await verifyBootstrapRecovery({
      base,
      page: trainer.page,
      onRetryView: async (page, { route, device }) =>
        capture(page, {
          route,
          device,
          group: "Superadmin",
          title: "Temporary workspace error",
          state: "Synthetic 429 · retry available",
          navigate: false,
        }),
    }),
  );
  await writeFile(
    join(output, "functional-checks.json"),
    JSON.stringify(checks, null, 2),
  );
  await routes(
    trainer.page,
    [
      ["/admin/settings", "Superadmin settings catalog"],
      ["/trainer/design", "Personal app design studio"],
    ],
    "New views",
  );
  await routes(
    subscriber.page,
    [["/app", "Personalized client home"]],
    "New views",
  );
  await routes(
    subscriber.page,
    [["/app/nutrition/log", "Meal photo entry"]],
    "Meal capture",
  );
  for (const method of ["Scan a product", "Write it down"])
    await state(
      subscriber.page,
      "/app/nutrition/log",
      "Meal entry",
      "Meal capture",
      method,
      async (page) => {
        await page
          .locator(".capture-methods button")
          .filter({ hasText: method })
          .click();
      },
    );
  for (const kind of ["photo", "barcode"]) {
    await state(
      subscriber.page,
      "/app/nutrition/log",
      kind === "photo"
        ? "Review a meal photo estimate"
        : "Review a barcode product",
      "Meal capture",
      "Synthetic draft · before confirmation",
      async (page) => {
        await page
          .locator(".capture-draft-row")
          .filter({
            hasText: kind === "photo" ? "Meal photo" : "Product barcode",
          })
          .getByRole("button", { name: "Review", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "A final check, then it’s yours.",
            exact: true,
          })
          .waitFor();
        if (kind === "photo") {
          await page
            .getByLabel("Portion answers, oils, sauces or corrections", {
              exact: true,
            })
            .fill("Synthetic example: includes one teaspoon of olive oil.");
        } else {
          await page.getByLabel(/^Unit on the label/).selectOption("ml");
          await page.getByLabel("Amount eaten", { exact: true }).fill("250");
          await page.getByText("120 kcal", { exact: true }).waitFor();
        }
      },
    );
    await subscriber.page
      .getByLabel(
        "I checked the food, portion and estimated values. Save this as my own confirmed diary entry.",
        { exact: true },
      )
      .check();
    const confirmed = subscriber.page.waitForResponse(
      (response) =>
        /\/api\/v1\/nutrition\/captures\/[^/]+\/confirm$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await subscriber.page
      .getByRole("button", { name: "Confirm and log my meal", exact: true })
      .click();
    const response = await confirmed;
    if (!response.ok())
      throw new Error(
        `Synthetic ${kind} UI confirmation failed (${response.status()})`,
      );
    await subscriber.page
      .getByText(
        "Meal recorded. Your confirmed estimate is now in your diary and daily totals.",
        { exact: false },
      )
      .waitFor();
    checks[
      kind === "photo"
        ? "photoDraftConfirmationPersisted"
        : "barcodeServingScaledAndConfirmed"
    ] = true;
  }
  await state(
    subscriber.page,
    "/app/nutrition",
    "Confirmed photo and barcode entries",
    "Meal capture",
    "Diary after subscriber confirmation",
    async (page) => {
      await page
        .getByRole("navigation", { name: "Your nutrition" })
        .getByRole("button", { name: "Meal diary", exact: true })
        .click();
      await page
        .getByText("Synthetic chicken and rice", { exact: false })
        .waitFor();
      await page.getByText("Synthetic oat drink", { exact: false }).waitFor();
    },
  );
  await writeFile(
    join(output, "functional-checks.json"),
    JSON.stringify(checks, null, 2),
  );
  await routes(publicView.page, publicRoutes, "Public");
  await state(
    publicView.page,
    "/demo",
    "Interactive coaching demo",
    "Public",
    "Pain escalation",
    async (page) => {
      await page
        .getByRole("button", { name: "New pain is reported", exact: true })
        .click();
      await page.getByText("Workout paused", { exact: true }).waitFor();
    },
  );
  await routes(trainer.page, trainerRoutes, "Trainer");
  await routes(
    trainer.page,
    onboardingSteps.map((step) => [
      `/trainer/onboarding/${step}`,
      `Onboarding · ${step.replaceAll("-", " ")}`,
    ]),
    "Onboarding",
  );
  await routes(
    trainer.page,
    nutritionSections.map(([section, title]) => [
      "/trainer/nutrition" + (section ? "/" + section : ""),
      title,
    ]),
    "Coach nutrition",
  );
  await routes(
    trainer.page,
    [
      ["/admin", "Platform operations"],
      ["/admin/settings", "Superadmin settings catalog"],
      ["/admin/security", "Superadmin account security"],
      ...integrations.map((id) => [
        `/admin/integrations/${id}`,
        `Platform configuration · ${id}`,
      ]),
    ],
    "Superadmin",
  );
  await routes(subscriber.page, subscriberRoutes, "Client");
  for (const tab of [
    "Weekly groceries",
    "Food preferences",
    "Meal diary",
    "Check in",
  ])
    await state(
      subscriber.page,
      "/app/nutrition",
      "Client nutrition",
      "Client nutrition",
      tab,
      async (page) => {
        await page
          .getByRole("navigation", { name: "Your nutrition" })
          .getByRole("button", { name: tab, exact: true })
          .click();
      },
    );
  for (const tab of ["Style", "Home layout", "Preview"])
    await state(
      trainer.page,
      "/trainer/design",
      "App design studio",
      "Trainer design",
      tab,
      async (page) => {
        await page.getByRole("tab", { name: tab, exact: true }).click();
      },
    );
  for (const mode of ["Client app", "Storefront"])
    await state(
      trainer.page,
      "/trainer/design",
      "App design studio",
      "Trainer design",
      `${mode} preview`,
      async (page) => {
        await page.getByRole("tab", { name: "Preview", exact: true }).click();
        await page.getByRole("button", { name: mode, exact: true }).click();
      },
    );
  for (const preset of ["Nordic", "Clay", "Coastal", "Mono"])
    await state(
      trainer.page,
      "/trainer/design",
      "App design studio",
      "Trainer design",
      `${preset} preset`,
      async (page) => {
        await page.getByRole("tab", { name: "Style", exact: true }).click();
        await page
          .locator(".design-presets button")
          .filter({ hasText: preset })
          .click();
      },
    );
  for (const tab of ["Offers", "Refunds", "Payouts"])
    await state(
      trainer.page,
      "/trainer/finance",
      "Trainer finance",
      "Trainer",
      tab,
      async (page) => {
        await page.getByRole("button", { name: tab, exact: true }).click();
      },
    );
  await state(
    trainer.page,
    "/trainer",
    "Trainer navigation",
    "Trainer",
    "Navigation open",
    async (page) => {
      const menu = page.getByRole("button", { name: "Open navigation" });
      if (await menu.isVisible()) await menu.click();
    },
  );
  await state(
    subscriber.page,
    "/app",
    "Client navigation",
    "Client",
    "Navigation open",
    async (page) => {
      const menu = page.getByRole("button", { name: "Open navigation" });
      if (await menu.isVisible()) await menu.click();
    },
  );
  await subscriber.page.goto(base + "/app/program", {
    waitUntil: "networkidle",
  });
  await subscriber.page
    .getByRole("button", { name: "Start workout", exact: true })
    .first()
    .click();
  await subscriber.page.waitForURL("**/app/workouts/*");
  const workout = new URL(subscriber.page.url()).pathname;
  await routes(subscriber.page, [[workout, "Workout session"]], "Client");
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        synthetic: true,
        localBrowser: true,
        count: manifest.length,
        routes: [...new Set(manifest.map((item) => item.route))],
        checks,
        views: manifest,
        errors,
        blockedExternalOrigins: [...blockedExternal],
      },
      null,
      2,
    ),
  );
  const cards = [];
  for (const item of manifest) {
    const png = (await readFile(join(output, item.file))).toString("base64");
    cards.push(
      `<article data-group="${escape(item.group)}" data-device="${item.device}" data-search="${escape((item.title + " " + item.route + " " + item.state).toLowerCase())}"><header><span>${escape(item.group)} · ${item.device} · ${item.width}px</span><h2>${escape(item.title)}</h2><p>${escape(item.route)}${item.state !== "default" ? " · " + escape(item.state) : ""}</p></header><img loading="lazy" alt="${escape(item.title + " — " + item.device + " — " + item.state)}" src="data:image/png;base64,${png}"></article>`,
    );
  }
  await writeFile(
    join(output, "GymMembership_App_Views.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GymMembership · Application screenshots</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f4f0;color:#1d302d;font:15px/1.5 system-ui,sans-serif}main{max-width:1680px;margin:auto;padding:32px}h1{font-size:clamp(30px,4vw,56px);letter-spacing:-.05em;margin:0}p{margin:8px 0 20px;color:#5d6a65}.controls{display:flex;gap:10px;flex-wrap:wrap;position:sticky;top:0;background:#f4f4f0;padding:15px 0;z-index:1;border-bottom:1px solid #d4dcd6}input,select{font:inherit;padding:10px 13px;border:1px solid #c5cec7;border-radius:5px;background:white}input{flex:1;min-width:220px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px;margin-top:24px}article{background:white;border:1px solid #d8ded9;border-radius:9px;overflow:hidden;align-self:start}article[hidden]{display:none}article header{padding:18px}article span{font-size:12px;letter-spacing:.05em;text-transform:uppercase}article h2{font-size:20px;margin:7px 0}article p{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;margin:0}img{display:block;width:100%;height:auto;border-top:1px solid #e6eae5;cursor:zoom-in}dialog{width:min(1500px,98vw);max-height:96vh;border:0;padding:0;background:white}dialog::backdrop{background:#15231de8}dialog button{position:fixed;top:10px;right:15px;border:0;background:#1d302d;color:white;font:16px system-ui;padding:12px;cursor:pointer}dialog img{cursor:zoom-out}small{display:block;margin:15px 0;color:#65736b}</style><main><h1>Your coaching platform, view by view.</h1><p>${manifest.length} actual browser screenshots across ${new Set(manifest.map((item) => item.route)).size} routes. Desktop and mobile. Synthetic development data; provider connections stay disabled. Click any screenshot to inspect the full view.</p><div class="controls"><input id="search" aria-label="Find a screen" placeholder="Find a screen, route or state"><select id="group" aria-label="Area"><option value="">Every area</option>${[...new Set(manifest.map((item) => item.group))].map((group) => `<option>${escape(group)}</option>`).join("")}</select><select id="device" aria-label="Device"><option value="">Both devices</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></div><small id="count"></small><section class="grid">${cards.join("")}</section></main><dialog><button aria-label="Close screenshot">Close ×</button><img alt="Expanded screenshot"></dialog><script>const articles=[...document.querySelectorAll('article')],controls=['search','group','device'].map(id=>document.getElementById(id));function filter(){let count=0;for(const card of articles){card.hidden=!!((controls[0].value&&!card.dataset.search.includes(controls[0].value.toLowerCase()))||(controls[1].value&&card.dataset.group!==controls[1].value)||(controls[2].value&&card.dataset.device!==controls[2].value));if(!card.hidden)count++}document.getElementById('count').textContent=count+' views shown'}controls.forEach(el=>el.addEventListener('input',filter));filter();const dialog=document.querySelector('dialog');document.querySelectorAll('article img').forEach(img=>img.addEventListener('click',()=>{dialog.querySelector('img').src=img.src;dialog.querySelector('img').alt=img.alt;dialog.showModal()}));dialog.addEventListener('click',()=>dialog.close());</script></html>`,
  );
  console.log(
    `Screenshot gallery complete: ${manifest.length} captures; ${errors.length} layout/browser errors.`,
  );
  if (errors.length)
    throw new Error(
      `${errors.length} screenshot checks failed; inspect manifest.json`,
    );
} catch (error) {
  await writeFile(
    join(output, "capture-failure.json"),
    JSON.stringify(
      { message: String(error), completedViews: manifest.length, errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  if (children.some((child) => child.exitCode === null))
    await new Promise((done) => setTimeout(done, 500));
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
  serverLog.end();
}
