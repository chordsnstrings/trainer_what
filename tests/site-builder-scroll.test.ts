import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createModule,
  createTemplate,
  duplicateSection,
  siteBuilderSchema,
  siteBuilderSectionSchema,
  builderMediaReferences,
  projectPublishedBuilder,
} from "@trainer/contracts";
import { BuilderSection } from "../apps/web/components/site-builder-renderer.tsx";
import {
  scrollSceneFrame,
  scrollImageTransform,
} from "../apps/web/components/site-builder-scroll-model.ts";

test("scroll settings round-trip through saved and duplicated sections without changing old documents", () => {
  const old = createModule("hero");
  assert.equal(
    Object.hasOwn(siteBuilderSectionSchema.parse(old), "scroll"),
    false,
  );
  const section = createModule("scroll-journey", "portrait");
  section.scroll!.pace = "slow";
  section.scroll!.mobile = "stacked";
  section.content.items[0].image =
    "/api/v1/media/11111111-1111-4111-8111-111111111111";
  section.content.items[0].focusX = 23;
  section.content.items[0].action = {
    label: "Get in touch",
    kind: "contact",
    newTab: false,
  };
  const copy = duplicateSection(section);
  assert.notEqual(copy.id, section.id);
  assert.notEqual(copy.content.items[0].id, section.content.items[0].id);
  assert.deepEqual(copy.scroll, section.scroll);
  assert.equal(copy.content.items[0].focusX, 23);
  const doc = createTemplate("blank");
  doc.pages[0].sections = [section];
  doc.savedSections = [{ id: "saved-story", name: "My story", section: copy }];
  const parsed = siteBuilderSchema.parse(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(parsed, doc);
  assert.ok(
    JSON.stringify(builderMediaReferences(parsed)).includes(
      "11111111-1111-4111-8111-111111111111",
    ),
  );
  assert.deepEqual(
    projectPublishedBuilder(parsed).pages[0].sections[0].scroll,
    section.scroll,
  );
});

test("scroll data is bounded and cannot introduce scripts, unsafe actions or image sources", () => {
  const scene = createModule("scroll-journey");
  for (const scroll of [
    { enabled: "yes" },
    { pace: "forever" },
    { focusY: 101 },
    { focusX: -1 },
    { script: "alert(1)" },
  ])
    assert.equal(
      siteBuilderSectionSchema.safeParse({ ...scene, scroll }).success,
      false,
    );
  for (const patch of [
    { focusX: 101 },
    { focusY: NaN },
    { image: "javascript:alert(1)" },
    { action: { label: "Go", kind: "url", href: "javascript:alert(1)" } },
  ])
    assert.equal(
      siteBuilderSectionSchema.safeParse({
        ...scene,
        content: {
          ...scene.content,
          items: [{ ...scene.content.items[0], ...patch }],
        },
      }).success,
      false,
    );
  scene.content.items = Array.from({ length: 9 }, (_, i) => ({
    id: `scene-${i}`,
    title: "Title",
    body: "",
  }));
  assert.equal(siteBuilderSectionSchema.safeParse(scene).success, false);
  scene.content.items.pop();
  assert.equal(siteBuilderSectionSchema.safeParse(scene).success, true);
});

test("server rendering exposes every scene and usable actions with no motion dependency", () => {
  const section = createModule("scroll-journey", "cinematic", {}, "ar");
  section.content.items[1].action = {
    label: "Explore",
    kind: "url",
    href: "https://example.com/coaching",
    newTab: false,
  };
  const html = renderToStaticMarkup(
    createElement(BuilderSection, {
      section,
      context: {
        name: "Fixture",
        tenantSlug: "fixture",
        basePath: "/coach/fixture",
        joinPath: "/join-coach/fixture",
        language: "ar",
      },
    }),
  );
  for (const item of section.content.items)
    assert.ok(html.includes(item.title));
  assert.match(html, /data-motion="false"/);
  assert.match(html, /href="https:\/\/example.com\/coaching"/);
  assert.doesNotMatch(html, /aria-hidden="true"[^>]*inert|<script|window\./);
});

test("each scroll boundary keeps one accessible scene and a continuous visible image", () => {
  for (const count of [1, 3, 8]) {
    for (let step = 0; step <= 1000; step++) {
      const frames = Array.from({ length: count }, (_, index) =>
        scrollSceneFrame(step / 1000, count, index),
      );
      assert.equal(frames.filter((f) => f.active).length, 1);
      assert.ok(frames.every((f) => f.opacity >= 0 && f.opacity <= 1));
      assert.ok(
        Math.abs(frames.reduce((sum, f) => sum + f.opacity, 0) - 1) < 0.00001,
      );
    }
    assert.equal(scrollSceneFrame(1, count, count - 1).opacity, 1);
  }
  assert.equal(
    scrollImageTransform(0, "still", "strong"),
    scrollImageTransform(1, "still", "strong"),
  );
  assert.notEqual(
    scrollImageTransform(0, "zoom-in", "standard"),
    scrollImageTransform(1, "zoom-in", "standard"),
  );
  assert.doesNotMatch(scrollImageTransform(NaN, "portrait", "strong"), /NaN/);
});
