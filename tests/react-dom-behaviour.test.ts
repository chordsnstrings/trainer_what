// Behaviour of member-app controls with real React DOM in local Chromium
// (tests/react-dom-harness.ts): the owner's "the analytics choice closes
// for good" and "Reload never loses typing", checked as a member meets
// them rather than by reading source text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { noBrowser, openHarness } from "./react-dom-harness";

const UNSAVED_ENTRY = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { hasUnsavedInput, unsavedMark } from "../apps/web/components/pwa";

function Composer() {
  const [text, setText] = useState("");
  return (
    <form id="marked" {...unsavedMark(!!text.trim())} onSubmit={(e) => { e.preventDefault(); setText(""); }}>
      <textarea id="message" value={text} onChange={(e) => setText(e.target.value)} />
      <button id="send" type="submit">Send</button>
    </form>
  );
}
function Unmarked() {
  const [text, setText] = useState("");
  return <input id="plain" value={text} onChange={(e) => setText(e.target.value)} />;
}
function Screen({ mark }: { mark: boolean }) {
  return mark ? <Composer /> : <Unmarked />;
}
const root = createRoot(document.getElementById("root")!);
(window as any).show = (mark: boolean) => root.render(<Screen mark={mark} />);
(window as any).unsaved = () => hasUnsavedInput(document);
(window as any).show(true);
`;

test(
  "Reload sees typing in React-controlled fields only through the unsaved mark",
  { skip: noBrowser },
  async () => {
    const harness = await openHarness(UNSAVED_ENTRY);
    const { page } = harness;
    try {
      await page.waitForSelector("#message");
      assert.equal(await page.evaluate(() => (window as any).unsaved()), false);
      await page.locator("#message").fill("Tired today, can we swap?");
      // React copies a controlled value into defaultValue, so only the
      // form's data-unsaved mark shows the typing is not sent.
      assert.equal(
        await page.evaluate(() => {
          const el = document.querySelector("#message") as HTMLTextAreaElement;
          return el.value === el.defaultValue;
        }),
        true,
        "React keeps defaultValue equal to the controlled value",
      );
      assert.equal(await page.evaluate(() => (window as any).unsaved()), true);
      // Sent: the composer is empty and nothing is left to lose.
      await page.locator("#send").click();
      assert.equal(await page.evaluate(() => (window as any).unsaved()), false);
      // Without a mark a controlled field is invisible to the check, which
      // is why every controlled member form carries data-unsaved.
      await page.evaluate(() => (window as any).show(false));
      await page.locator("#plain").fill("typed");
      assert.equal(await page.evaluate(() => (window as any).unsaved()), false);
      assert.deepEqual(harness.errors, []);
    } finally {
      await harness.close();
    }
  },
);

const CONSENT_ENTRY = `
import { createRoot } from "react-dom/client";
import { AcquisitionConsent } from "../apps/web/components/acquisition";
const root = createRoot(document.getElementById("root")!);
root.render(<AcquisitionConsent />);
`;

for (const [answer, button, stored] of [
  ["No thanks", /^No thanks$/, "declined"],
  ["Close", /^Close$/, "dismissed"],
] as const)
  test(
    `the analytics bar closes completely after "${answer}" and stays closed after a reload`,
    { skip: noBrowser },
    async () => {
      const posts: string[] = [];
      const harness = await openHarness(CONSENT_ENTRY, {
        path: "/coach/alex-morgan",
        routes: ({ method, url }) => {
          if (url.startsWith("/api/v1/public/acquisition/consent")) {
            if (method !== "GET") posts.push(method);
            return { json: { granted: false } };
          }
          return undefined;
        },
      });
      const { page } = harness;
      try {
        const bar = page.locator(".consent-bar");
        await bar.waitFor({ state: "visible" });
        await page.getByRole("button", { name: button }).click();
        // It slides away and is then removed: nothing is left on the page,
        // not even a spacer or a floating control.
        await page.waitForFunction(
          () =>
            !document.querySelector(
              ".consent-bar, .acquisition-consent, .consent-bar-spacer",
            ),
          null,
          { timeout: 3000 },
        );
        assert.equal(
          await page.evaluate(() =>
            localStorage.getItem("analytics-preference"),
          ),
          stored,
        );
        // Declining or closing never saves consent on the server.
        assert.deepEqual(posts, []);
        await page.reload();
        // The saved answer keeps the bar away on every later visit.
        await page.waitForTimeout(600);
        assert.equal(await bar.count(), 0, "the bar came back after a reload");
        assert.deepEqual(harness.errors, []);
      } finally {
        await harness.close();
      }
    },
  );

const TOAST_ENTRY = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppUpdateToast } from "../apps/web/components/pwa-ui";
let key = 0;
const root = createRoot(document.getElementById("root")!);
// Each call stands for a new page: the member workspace remounts per path.
(window as any).page = (path: string, release = "/sw.js?v=r2") =>
  root.render(<AppUpdateToast key={++key} path={path} waiting release={release} onReload={() => ((window as any).reloaded = true)} />);
(window as any).page("/app");
`;

test(
  '"Later" on the update toast lasts across pages until the next release',
  { skip: noBrowser },
  async () => {
    const harness = await openHarness(TOAST_ENTRY, { reducedMotion: "reduce" });
    const { page } = harness;
    try {
      const toast = page.locator(".app-update-toast");
      await toast.waitFor();
      await page.locator(".app-update-later").click();
      assert.equal(await toast.count(), 0);
      await page.evaluate(() => (window as any).page("/app/chat"));
      await page.waitForTimeout(100);
      assert.equal(await toast.count(), 0, "came back on the next page");
      await page.reload();
      await page.waitForTimeout(200);
      assert.equal(await toast.count(), 0, "came back after a reload");
      // A newer release asks again.
      await page.evaluate(() => (window as any).page("/app", "/sw.js?v=r3"));
      await toast.waitFor();
      assert.deepEqual(harness.errors, []);
    } finally {
      await harness.close();
    }
  },
);
