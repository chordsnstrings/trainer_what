// Renders real apps/web components with React DOM in local Chromium
// (never a cloud browser), for behaviour a source-text or fake-object test
// cannot see: React-controlled fields, render-time state, reloads.
//
// `openHarness(entry)` bundles `entry` (TSX that imports the components and
// mounts them) with the esbuild that tsx already ships, serves it from
// http://harness.test/<path> through Playwright request routing, and returns
// the page. API calls are answered by `routes`. Tests skip when no Chromium
// is installed (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or /opt/pw-browsers).
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

export const HARNESS_ORIGIN = "http://harness.test";
export const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
/** Why a browser test cannot run here, or false when it can. */
export const noBrowser = chromiumPath
  ? false
  : "no local Chromium (set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)";

type Route = (request: {
  method: string;
  url: string;
  body: string | null;
}) => { status?: number; json: unknown } | undefined;

export async function openHarness(
  entry: string,
  {
    path = "/app",
    routes = () => undefined,
    reducedMotion = "no-preference",
  }: {
    path?: string;
    routes?: Route;
    reducedMotion?: "reduce" | "no-preference";
  } = {},
) {
  const esbuild = require("esbuild") as typeof import("esbuild");
  const bundle = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: root + "tests",
      loader: "tsx",
      sourcefile: "harness-entry.tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    target: "es2022",
    logLevel: "silent",
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_APP_RELEASE": '"harness"',
    },
    banner: { js: "var process = { env: {} };" },
  });
  const script = bundle.outputFiles[0].text;
  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch({
    headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion,
  });
  const errors: string[] = [];
  await context.route(`${HARNESS_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      const answer = routes({
        method: request.method(),
        url: url.pathname + url.search,
        body: request.postData(),
      });
      return route.fulfill({
        status: answer?.status ?? (answer ? 200 : 404),
        contentType: "application/json",
        body: JSON.stringify(answer?.json ?? { error: "not routed" }),
      });
    }
    if (url.pathname === "/harness.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: script,
      });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`,
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(HARNESS_ORIGIN + path);
  return {
    page,
    errors,
    async close() {
      await browser.close();
    },
  };
}
