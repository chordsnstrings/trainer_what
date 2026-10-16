// Runs the real client renderer in a network-free fixture. No provider, account or production writes.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

await mkdir("test-results", { recursive: true });
const css = (
  await Promise.all(
    [
      "site-builder-public.css",
      "site-builder-layouts.css",
      "site-builder-scroll.css",
    ].map((name) => readFile(`apps/web/app/${name}`, "utf8")),
  )
).join("\n");
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import React, { useState, StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { createModule, createTemplate } from '@trainer/contracts';
    import { BuilderWebsite, BuilderSection, BuilderTheme } from './apps/web/components/site-builder-renderer.tsx';
    function Fixture() {
      const [options, setOptions] = useState({}); window.fixture = setOptions;
      const doc = createTemplate('blank'); doc.header.sticky = true;
      const journey = createModule('scroll-journey', options.variant || 'cinematic', {}, options.ar ? 'ar' : 'en');
      journey.id = 'story'; journey.style.width = 'full'; journey.style.paddingTop = 24;
      journey.content.title = options.ar ? 'قصة التدريب' : 'A story worth sharing';
      journey.content.items = journey.content.items.map((s, i) => ({ ...s, id:'scene-'+i, image:'https://images.example.com/scene-'+i+'.jpg', imageAlt:'Synthetic landscape '+i, body: options.long ? 'Long content needs room to read. '.repeat(45) : s.body,
        action:{label:options.ar?'تابع':'Continue',kind:'anchor',href:'#after',newTab:false} }));
      if (options.eight) journey.content.items = Array.from({length:8}, (_,i)=>({...journey.content.items[i%3],id:'scene-'+i}));
      journey.scroll.mobile = options.stacked ? 'stacked' : 'animated';
      journey.scroll.enabled = !options.disabled;
      const photo = createModule('scroll-image', options.imageVariant || 'zoom-in'); photo.id='photo';
      photo.content.image='https://images.example.com/scene-1.jpg';
      photo.content.body='A single photo with a steady, gentle movement.';
      const after=createModule('text'); after.id='after'; after.content.title='The story continues here.';
      doc.pages[0].sections=options.removed?[after]:[journey,photo,after];
      const context = {name:'Studio coaching',tenantSlug:'fixture',basePath:'/coach/fixture',joinPath:'/join-coach/fixture',language:options.ar?'ar':'en',preview:!!options.preview};
      const site = options.editing ? <BuilderTheme theme={doc.theme} language={context.language}>{doc.pages[0].sections.map(section=><BuilderSection key={section.id} section={section} context={context} builder={doc} onSelect={()=>{}} />)}</BuilderTheme> : <BuilderWebsite builder={doc} context={context} />;
      return options.preview ? <div id="preview-root" style={{height:options.previewHeight || 650,overflow:'auto'}}><div className="sbe-canvas-frame" style={{width:options.previewWidth || 1200,zoom:options.zoom || .65}}>{site}</div></div> : site;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
  `,
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://images.example.com/**", (route) =>
  route.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="g"><stop stop-color="#235749"/><stop offset="1" stop-color="#c9c7a0"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1100" cy="360" r="270" fill="#dbbc83"/><path d="M0 1000 500 280 1300 1000" fill="#263d37"/></svg>`,
  }),
);
await page.route("https://builder-fixture.test/", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<html><head><style>html,body{margin:0}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div></body></html>`,
  }),
);
await page.goto("https://builder-fixture.test/");
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const story = page.locator("#story .sb-scroll");
const photo = page.locator("#photo .sb-scroll");
async function configure(options: Record<string, unknown> = {}) {
  await page.evaluate((opts) => (window as any).fixture(opts), options);
  await expect(page.locator("#after")).toBeAttached();
  await page.waitForTimeout(80);
}
async function scrollToScene(index: number) {
  await story.locator(".sb-scroll-track").evaluate((track, i) => {
    const host = track.parentElement!;
    const root = document.querySelector("#preview-root");
    const scale = host.getBoundingClientRect().width / host.offsetWidth;
    const style = getComputedStyle(host);
    const top = parseFloat(style.getPropertyValue("--sb-scroll-top")) * scale;
    const travel =
      parseFloat(style.getPropertyValue("--sb-scroll-travel")) * scale;
    const n = host.querySelectorAll(".sb-scroll-scene").length;
    const delta =
      track.getBoundingClientRect().top -
      (root?.getBoundingClientRect().top ?? 0) -
      top +
      (travel * (i + 0.35)) / n;
    (root ?? window).scrollBy({ top: delta, behavior: "instant" });
  }, index);
  await expect(story.locator(`[data-scene="${index}"]`)).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    story.locator('.sb-scroll-scene[aria-hidden="true"]'),
  ).toHaveCount(2);
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "no horizontal page overflow",
  );
}
try {
  await expect(story).toHaveAttribute("data-motion", "true");
  await expect(photo).toHaveAttribute("data-motion", "true");
  for (const index of [0, 1, 2, 1, 0]) {
    await scrollToScene(index);
    const geometry = await story.locator(".sb-scroll-stage").boundingBox();
    const header = await page.locator(".sb-header").boundingBox();
    assert.ok(
      geometry && header && Math.abs(geometry.y - header.height) < 3,
      "stage stays below sticky header",
    );
  }
  await story.getByRole("button", { name: /Scene 3:/ }).click();
  await expect(story.locator('[data-scene="2"]')).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await page.screenshot({ path: "test-results/builder-scroll-desktop.png" });
  await page.locator("#after").scrollIntoViewIfNeeded();
  assert.ok(
    (await story.locator(".sb-scroll-stage").boundingBox())!.y < 0,
    "story releases before subsequent content",
  );
  checks.push(
    "independent modules, forward/reverse scroll, scene navigation, sticky header and end handoff",
  );

  for (const variant of [
    "cinematic",
    "portrait",
    "split",
    "reversed",
    "centered",
    "minimal",
  ]) {
    await configure({ variant });
    await expect(story).toHaveAttribute("data-motion", "true");
    await scrollToScene(1);
    await noOverflow();
  }
  for (const imageVariant of [
    "zoom-in",
    "zoom-out",
    "drift-up",
    "drift-left",
    "drift-right",
    "still",
  ]) {
    await configure({ imageVariant });
    await expect(photo).toHaveAttribute("data-motion", "true");
    await photo.scrollIntoViewIfNeeded();
    await noOverflow();
  }
  checks.push("all twelve presets render with motion");
  for (const variant of ["cinematic", "portrait", "split"]) {
    await configure({ variant });
    await page.emulateMedia({ media: "print" });
    const positions = await story
      .locator(".sb-scroll-scene")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          top: n.getBoundingClientRect().top,
          bottom: n.getBoundingClientRect().bottom,
          color: getComputedStyle(n).color,
          position: getComputedStyle(n.querySelector(".sb-scroll-copy")!)
            .position,
        })),
      );
    assert.ok(
      positions.every(
        (p, i) =>
          p.position === "relative" &&
          (i === 0 || p.top >= positions[i - 1].bottom),
      ),
      "print keeps every scene in readable document flow",
    );
    assert.ok(
      positions.every((p) => p.color !== "rgb(255, 255, 255)"),
      "print retains readable text without backgrounds",
    );
    await page.emulateMedia({ media: "screen" });
  }
  checks.push(
    "printing keeps all scenes, copy and links in normal readable flow",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await configure();
  await expect(story).toHaveAttribute("data-motion", "true");
  await scrollToScene(1);
  await noOverflow();
  await page.screenshot({ path: "test-results/builder-scroll-phone.png" });
  await configure({ ar: true, variant: "portrait" });
  await expect(story).toHaveAttribute("data-motion", "true");
  await scrollToScene(1);
  await noOverflow();
  await page.screenshot({ path: "test-results/builder-scroll-arabic.png" });
  await configure({ stacked: true });
  await expect(story).toHaveAttribute("data-motion", "false");
  await expect(story.locator("[inert]")).toHaveCount(0);
  await configure({ eight: true });
  await expect(story).toHaveAttribute("data-motion", "true");
  await noOverflow();
  await configure({ long: true });
  await expect(story).toHaveAttribute("data-motion", "false");
  await expect(story.locator("[inert]")).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await configure();
  await expect(story).toHaveAttribute("data-motion", "false");
  checks.push(
    "phone, Arabic, eight scenes, stacked preference, long copy and short landscape fallback",
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await configure();
  await expect(story).toHaveAttribute("data-motion", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(story).toHaveAttribute("data-motion", "false");
  await expect(story.locator("[inert]")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(story).toHaveAttribute("data-motion", "true");
  await scrollToScene(0);
  await story.getByRole("button", { name: "Read without motion" }).click();
  await expect(story).toHaveAttribute("data-motion", "false");
  await expect(story).toBeFocused();
  checks.push(
    "live reduced-motion preference and accessible read-without-motion control",
  );

  // A new page mount clears the visitor-only reading choice.
  await configure({ removed: true });
  // A laptop's editor toolbar leaves less height than a full browser page.
  // This ordinary phone scene (including its action) still fits the stage.
  await page.setViewportSize({ width: 1280, height: 720 });
  await configure({
    preview: true,
    previewWidth: 390,
    previewHeight: 575,
    zoom: 1,
  });
  await expect(story).toHaveAttribute("data-motion", "true");
  await scrollToScene(1);
  checks.push(
    "phone-sized laptop preview animates ordinary copy and a scene action",
  );
  await expect(story.locator(".sb-scroll-preview-status")).toHaveCount(0);
  await configure({ preview: true, previewWidth: 700, stacked: true, zoom: 1 });
  await expect(story).toHaveAttribute("data-motion", "true");
  await scrollToScene(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await configure({ preview: true, editing: true });
  await expect(story).toHaveAttribute("data-motion", "false");
  await configure({ preview: true });
  await expect(story).toHaveAttribute("data-motion", "true");
  await scrollToScene(1);
  await story.getByRole("button", { name: /Scene 3:/ }).click();
  await expect(story.locator('[data-scene="2"]')).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await configure({ preview: true, zoom: 0.85 });
  await scrollToScene(0);
  await story.locator('[data-scene="0"] a').focus();
  await story.locator(".sb-scroll-track").evaluate((track) => {
    document.querySelector("#preview-root")!.scrollTop +=
      track.clientHeight / 2;
  });
  await expect(story).toHaveAttribute("data-motion", "false");
  await expect(story.locator('[data-scene="0"] a')).toBeFocused();
  await configure({ removed: true });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  checks.push(
    "static editing, nested zoomed preview, focused-link preservation and unmount cleanup",
  );
  for (const [options, reason] of [
    [{ disabled: true }, "turned off"],
    [{ previewWidth: 390, stacked: true }, "stacked photos"],
    [{ previewHeight: 350, zoom: 1 }, "too short"],
    [{ long: true, previewWidth: 390, zoom: 1 }, "text stays readable"],
  ] as const) {
    await configure({ preview: true, ...options });
    await expect(story).toHaveAttribute("data-motion", "false");
    await expect(story.getByRole("status")).toContainText(reason);
    await expect(story.locator("[inert]")).toHaveCount(0);
  }
  await page.emulateMedia({ media: "print" });
  await expect(story.getByRole("status")).not.toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await configure({ preview: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(story.getByRole("status")).toContainText(
    "reduced-motion setting",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(story).toHaveAttribute("data-motion", "true");
  await expect(story.getByRole("status")).toHaveCount(0);
  await configure({ long: true });
  await expect(story.getByRole("status")).toHaveCount(0);
  checks.push(
    "preview explains intentional fallbacks, clears them on recovery and never adds editor guidance to public pages",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/builder-scroll-check.json",
    JSON.stringify({ status: "passed", checks, errors }, null, 2),
  );
  console.log("Builder scroll check passed:", checks);
} catch (error) {
  await page.screenshot({ path: "test-results/builder-scroll-failure.png" });
  await writeFile(
    "test-results/builder-scroll-check.json",
    JSON.stringify(
      { status: "failed", checks, errors, failure: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
