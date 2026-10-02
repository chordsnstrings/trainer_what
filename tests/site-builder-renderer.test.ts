import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SITE_BUILDER_MODULES,
  createBuilderElement,
  createBuilderPage,
  createModule,
  createTemplate,
  type SiteBuilderAction,
} from "@trainer/contracts";
import {
  BuilderWebsite,
  BuilderSection,
  BuilderTheme,
  BuilderHeader,
} from "../apps/web/components/site-builder-renderer.tsx";
import {
  builderStyleVariables,
  resolveBuilderActionHref,
  safeBuilderImage,
  type BuilderContext,
} from "../apps/web/components/site-builder-render-utils.ts";

const context: BuilderContext = {
  name: "Amina Coaching",
  tenantSlug: "amina",
  basePath: "/coach/amina",
  joinPath: "/join-coach/amina",
};
const hidden = {
  desktop: { hidden: true },
  tablet: { hidden: true },
  mobile: { hidden: true },
};
const render = (
  moduleId: Parameters<typeof createModule>[0],
  variant?: string,
  ctx = context,
) => {
  const builder = createTemplate("minimal");
  const section = createModule(moduleId, variant);
  return renderToStaticMarkup(
    createElement(BuilderTheme, {
      theme: builder.theme,
      children: createElement(BuilderSection, {
        section,
        context: ctx,
        builder,
        firstHeading: true,
      }),
    }),
  );
};

test("all registered layouts render their real family with safe public defaults", () => {
  let count = 0;
  for (const module of SITE_BUILDER_MODULES)
    for (const variant of module.variants) {
      const html = render(module.id, variant.id);
      assert.ok(
        html.includes(`data-module="${module.id}"`),
        `${module.id}/${variant.id}`,
      );
      assert.ok(html.includes(`data-variant="${variant.id}"`));
      assert.doesNotMatch(
        html,
        /undefined|NaN|dangerouslySetInnerHTML|<script/i,
      );
      if (
        [
          "stats",
          "testimonials",
          "transformation",
          "credentials",
          "team",
          "logos",
        ].includes(module.id)
      ) {
        assert.doesNotMatch(html, /\b(?:500|1000|10,000|98%|5-star)\b/);
        assert.doesNotMatch(html, /sb-empty-copy/);
      }
      count++;
    }
  assert.ok(count >= 270);
});

test("native pricing displays only recorded public offers, exact terms and the real join route", () => {
  const builder = createTemplate("minimal");
  const section = createModule("pricing");
  section.content.items = [
    { id: "fake", title: "Invented discount", body: "AED 9" },
  ];
  const html = renderToStaticMarkup(
    createElement(BuilderSection, {
      section,
      builder,
      context: {
        ...context,
        products: [
          {
            id: "a",
            data: {
              name: "Strength Essentials",
              priceMinor: 25000,
              billing: "monthly",
              tier: "workout",
            },
          },
          { id: "b", data: { name: "Unknown charge", priceMinor: undefined } },
        ],
      },
    }),
  );
  assert.match(html, /Strength Essentials/);
  assert.match(html, /AED\s250\.00 \/ month/);
  assert.match(html, /href="\/join-coach\/amina"/);
  assert.doesNotMatch(
    html,
    /Invented discount|AED 9|Unknown charge|productId=/,
  );
  const empty = render("pricing");
  assert.match(empty, /Plans are not listed yet/);
  assert.doesNotMatch(empty, /AED/);
});

test("unselected pages, saved sections and globally hidden sections/elements never appear publicly", () => {
  const builder = createTemplate("minimal");
  const home = builder.pages[0];
  home.sections = [
    createModule("hero"),
    createModule("text", undefined, { responsive: hidden }),
  ];
  home.sections[1].content.body = "PRIVATE HIDDEN SECTION";
  const columns = createModule("columns");
  columns.content.elements = [
    createBuilderElement("text", {
      text: "PRIVATE HIDDEN ELEMENT",
      responsive: hidden,
    }),
  ];
  home.sections.push(columns);
  builder.pages.push({
    ...createBuilderPage("Secret draft", "secret", [createModule("text")]),
    visible: false,
  });
  builder.pages.at(-1)!.sections[0].content.body = "PRIVATE PAGE BODY";
  builder.savedSections.push({
    id: "saved",
    name: "SECRET SAVED TITLE",
    section: createModule("text"),
  });
  builder.savedSections[0].section.content.body = "SECRET SAVED BODY";
  const html = renderToStaticMarkup(
    createElement(BuilderWebsite, { builder, context }),
  );
  assert.doesNotMatch(html, /PRIVATE|SECRET|Secret draft/);
  const missing = renderToStaticMarkup(
    createElement(BuilderWebsite, { builder, context, path: "secret" }),
  );
  assert.match(missing, /Page not found/);
  assert.doesNotMatch(missing, /PRIVATE PAGE BODY/);
  const preview = renderToStaticMarkup(
    createElement(BuilderWebsite, {
      builder,
      context,
      path: "secret",
      preview: true,
    }),
  );
  assert.match(preview, /PRIVATE PAGE BODY/);
});

test("safe links fail closed, hidden page destinations are omitted and booking requires enrollment", () => {
  const builder = createTemplate("minimal");
  const link = (href: string): SiteBuilderAction => ({
    kind: "url",
    href,
    label: "Go",
    newTab: false,
  });
  for (const unsafe of [
    "javascript:alert(1)",
    "//evil.example.com",
    "data:text/html,secret",
    "https://good.example.com@evil.example.com",
    "https://127.0.0.1/",
    "https://localhost/x",
  ]) {
    assert.equal(
      resolveBuilderActionHref(link(unsafe), builder, context),
      null,
      unsafe,
    );
    assert.equal(safeBuilderImage(unsafe), undefined, unsafe);
  }
  assert.equal(
    resolveBuilderActionHref(
      link("https://example.com/video"),
      builder,
      context,
    ),
    "https://example.com/video",
  );
  assert.equal(
    resolveBuilderActionHref(
      { kind: "booking", label: "Book", newTab: false },
      builder,
      context,
    ),
    "/join-coach/amina",
  );
  builder.pages[1].visible = false;
  assert.equal(
    resolveBuilderActionHref(
      {
        kind: "page",
        pageId: builder.pages[1].id,
        label: "Private",
        newTab: false,
      },
      builder,
      context,
    ),
    null,
  );
  assert.equal(
    safeBuilderImage("/api/v1/media/11111111-1111-4111-8111-111111111111"),
    "/api/v1/media/11111111-1111-4111-8111-111111111111",
  );
});

test("videos wait for a deliberate click and reject arbitrary iframe destinations", () => {
  const section = createModule("video");
  section.content.videoUrl = "https://youtu.be/dQw4w9WgXcQ";
  section.content.caption = "A tour of the studio";
  let html = renderToStaticMarkup(
    createElement(BuilderSection, { section, context }),
  );
  assert.match(html, /Play video: A tour of the studio/);
  assert.match(html, /video provider/);
  assert.doesNotMatch(html, /<iframe|autoplay=|src="https:\/\/.*youtube/);
  section.content.videoUrl = "https://evil.example.com/embed/track";
  html = renderToStaticMarkup(
    createElement(BuilderSection, { section, context }),
  );
  assert.doesNotMatch(html, /evil\.example|<iframe|sb-video-play/);
});

test("gallery fallback retains group titles/photos, selected older galleries and initial pagination", () => {
  const gallery = (id: string) => ({
    id,
    title: `Gallery ${id}`,
    description: "Training together",
    photos: [
      {
        media_id: `${id}-photo`,
        url: "https://example.com/coach-photo.jpg",
        alt: "Coach demonstrating an exercise",
        caption: "Technique practice",
      },
    ],
  });
  const section = createModule("gallery");
  const ctx = {
    ...context,
    galleries: Array.from({ length: 24 }, (_, index) => gallery(String(index))),
    boundGalleries: [gallery("older")],
  };
  let html = renderToStaticMarkup(
    createElement(BuilderSection, { section, context: ctx }),
  );
  assert.match(html, /Gallery 0/);
  assert.match(html, /Coach demonstrating an exercise/);
  assert.match(html, /More galleries/);
  assert.doesNotMatch(html, /Gallery older/);
  section.content.galleryId = "older";
  html = renderToStaticMarkup(
    createElement(BuilderSection, { section, context: ctx }),
  );
  assert.match(html, /Gallery older/);
  assert.doesNotMatch(html, /Gallery 0|More galleries/);
});

test("contact forms have linked labels, consent, bounded plain fields and a nonfocusable honeypot", () => {
  const html = render("contact");
  assert.match(
    html.match(/<input[^>]*name="name"[^>]*>/)?.[0] ?? "",
    /required/,
  );
  assert.match(html, /type="email"/);
  assert.match(html, /minLength="10" maxLength="4000"/);
  assert.match(
    html.match(/<input[^>]*name="consent"[^>]*>/)?.[0] ?? "",
    /type="checkbox" required/,
  );
  assert.match(
    html.match(/<input[^>]*name="website"[^>]*>/)?.[0] ?? "",
    /aria-hidden="true" tabindex="-1"/,
  );
  assert.match(html, /aria-describedby=/);
  assert.doesNotMatch(html, /placeholder="Your name"/);
});

test("Arabic has scoped RTL, nested navigation and independently bounded style overrides", () => {
  const builder = createTemplate("minimal");
  const html = renderToStaticMarkup(
    createElement(BuilderWebsite, {
      builder,
      context: { ...context, language: "ar" },
    }),
  );
  assert.match(html, /dir="rtl" lang="ar"/);
  assert.match(html, /تخطي|انتقل إلى المحتوى/);
  builder.pages[1].parentId = builder.pages[0].id;
  let nav = renderToStaticMarkup(
    createElement(BuilderHeader, { builder, context }),
  );
  assert.match(nav, /sb-nav-group/);
  builder.pages[0].inNavigation = false;
  nav = renderToStaticMarkup(
    createElement(BuilderHeader, { builder, context }),
  );
  assert.ok(
    nav.includes(builder.pages[1].title),
    "Child remains reachable when its parent is omitted from navigation",
  );
  const style = builderStyleVariables(
    { paddingTop: 900, gap: -20 },
    { desktop: { hidden: true }, mobile: { hidden: false, fontSize: 30 } },
  ) as Record<string, string>;
  assert.equal(style["--sb-pt"], "240px");
  assert.equal(style["--sb-gap"], "0px");
  assert.equal(style["--sb-display"], "none");
  assert.equal(style["--sb-display-mobile"], "block");
  assert.equal(style["--sb-title-size-mobile"], "30px");
});

test("every before-and-after layout preserves paired client photos and contextual copy", () => {
  const module = SITE_BUILDER_MODULES.find((m) => m.id === "transformation")!;
  assert.match(module.description, /before-and-after photos/);
  for (const variant of module.variants) {
    const section = createModule("transformation", variant.id);
    section.content.items = [
      {
        id: "client-story",
        title: "A real coaching journey",
        body: "Client-approved context",
        beforeImage: "/api/v1/media/client-before",
        afterImage: "/api/v1/media/client-after",
        imageAlt: "Permissioned client progress",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(BuilderSection, { section, context }),
    );
    assert.match(html, /src="\/api\/v1\/media\/client-before"/);
    assert.match(html, /src="\/api\/v1\/media\/client-after"/);
    assert.match(html, />Before<\/figcaption>/);
    assert.match(html, />After<\/figcaption>/);
    assert.match(html, /Client-approved context/);
  }
});
