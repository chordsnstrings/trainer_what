// Synthetic, network-free visual matrix. No real client photos or provider calls.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import {
  SITE_BUILDER_MODULES,
  createModule,
  createTemplate,
} from "@trainer/contracts";
import {
  BuilderSection,
  BuilderTheme,
} from "../apps/web/components/site-builder-renderer.tsx";

const css = (
  await Promise.all(
    ["site-builder-public.css", "site-builder-layouts.css"].map((name) =>
      readFile(new URL(`../apps/web/app/${name}`, import.meta.url), "utf8"),
    ),
  )
).join("\n");
const builder = createTemplate("minimal");
const context = {
  name: "Synthetic coaching fixture",
  tenantSlug: "layout-fixture",
  basePath: "/coach/layout-fixture",
  joinPath: "/join-coach/layout-fixture",
  preview: true,
  products: Array.from({ length: 3 }, (_, i) => ({
    id: `offer-${i}`,
    data: {
      name: `Fixture programme ${i + 1}`,
      description: "A synthetic published offer for layout verification.",
      priceMinor: 25000 + i * 5000,
      billing: "monthly",
      tier: "workout",
    },
  })),
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route("https://layout-fixture.invalid/**", (route) =>
  route.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="${route.request().url().includes("after") ? "#597665" : "#b1bdac"}"/><circle cx="400" cy="300" r="125" fill="#ebeee5"/><path d="M180 960V640q220-300 440 0v320" fill="#d0d7c7"/></svg>`,
  }),
);
await mkdir("test-results", { recursive: true });
const results: object[] = [],
  failures: object[] = [];
try {
  for (const language of ["en", "ar"] as const) {
    for (const module of SITE_BUILDER_MODULES) {
      const html = module.variants
        .map(({ id }) => {
          const section = createModule(module.id, id, {}, language);
          section.content.image = "/api/v1/media/fixture-portrait";
          section.content.imageAlt = "Synthetic test portrait";
          section.content.caption = "Synthetic fixture caption";
          section.content.videoUrl =
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
          section.content.poster = section.content.image;
          section.content.items = Array.from({ length: 4 }, (_, i) => ({
            id: `item-${i}`,
            title:
              language === "ar"
                ? `قصة تدريب ${i + 1}`
                : `A considered coaching detail ${i + 1}`,
            body:
              language === "ar"
                ? "هذه بيانات اصطناعية للتحقق من تنسيق الصور والنصوص على جميع الشاشات."
                : "This is synthetic content for checking clear reading rhythm, generous spacing and image alignment across screen sizes.",
            image: section.content.image,
            imageAlt: "Synthetic portrait",
            caption: "Fixture caption",
            value: `${i + 1}`,
            eyebrow: "Fixture context",
            beforeImage: "/api/v1/media/fixture-before",
            afterImage: "/api/v1/media/fixture-after",
            quote:
              "Synthetic words for a visual fixture; not a real testimonial.",
            author: "Fixture client",
            role: "Fixture role",
            question: "How does this coaching work?",
            answer: "A synthetic answer checks readable spacing and wrapping.",
            href: "https://example.test/guide",
          }));
          return renderToStaticMarkup(
            createElement(BuilderTheme, {
              theme: builder.theme,
              language,
              children: createElement(BuilderSection, {
                section,
                builder,
                context: { ...context, language },
                firstHeading: true,
              }),
            }),
          );
        })
        .join("");
      await page.setContent(
        `<html><head><base href="https://layout-fixture.invalid/"><style>html,body{margin:0;padding:0}body{background:#e8ebe4}.fixture{margin:0 auto} ${css}</style></head><body><main class="fixture">${html}</main></body></html>`,
      );
      for (const width of [1280, 768, 390]) {
        await page.locator(".fixture").evaluate((el, width) => {
          (el as HTMLElement).style.width = `${width}px`;
        }, width);
        const measured = await page.locator(".sb-site").evaluateAll((sites) =>
          sites.map((site) => {
            const section = site.querySelector<HTMLElement>("[data-module]")!;
            return {
              module: section.dataset.module,
              variant: section.dataset.variant,
              width: site.clientWidth,
              contentWidth: site.scrollWidth,
              height: Math.round(site.getBoundingClientRect().height),
            };
          }),
        );
        for (const entry of measured) {
          const result = { language, viewport: width, ...entry };
          results.push(result);
          if (entry.contentWidth > width + 1 || entry.height <= 0)
            failures.push(result);
        }
        if (
          language === "en" &&
          ["hero", "transformation", "contact", "pricing"].includes(
            module.id,
          ) &&
          [1280, 390].includes(width)
        ) {
          const variant =
            module.id === "hero"
              ? "framed-split"
              : module.id === "contact"
                ? "form-panel"
                : module.id === "pricing"
                  ? "split-heading"
                  : "alternating";
          await page.locator(`[data-variant="${variant}"]`).screenshot({
            path: `test-results/layout-${module.id}-${width}.png`,
          });
        }
      }
    }
  }
  await writeFile(
    "test-results/site-builder-layout-check.json",
    JSON.stringify({ checked: results.length, failures, results }, null, 2),
  );
  console.log(JSON.stringify({ checked: results.length, failures }, null, 2));
  assert.equal(
    failures.length,
    0,
    "Every catalogue layout must fit its preview container in both directions.",
  );
} finally {
  await browser.close();
}
