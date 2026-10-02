import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SITE_BUILDER_MODULES,
  SITE_BUILDER_PRESET_COUNT,
  SITE_BUILDER_TEMPLATES,
  builderContentText,
  builderMediaReferences,
  createBuilderElement,
  createModule,
  createTemplate,
  duplicatePage,
  duplicateSection,
  findBuilderPage,
  findBuilderRedirect,
  getBuilderPublishIssues,
  getBuilderVideoEmbedUrl,
  legacyToBuilder,
  projectPublishedBuilder,
  renameBuilderPage,
  siteBuilderElementSchema,
  siteBuilderSchema,
  type SiteBuilderDocument,
} from "@trainer/contracts";

const media = (last: string) =>
  `/api/v1/media/11111111-1111-4111-8111-${last.padStart(12, "0")}`;
const hidden = {
  desktop: { hidden: true },
  tablet: { hidden: true },
  mobile: { hidden: true },
};
function withModule(
  moduleId: Parameters<typeof createModule>[0],
  variant?: string,
) {
  const doc = createTemplate("minimal");
  doc.pages[0].sections = [createModule(moduleId, variant)];
  return doc;
}

test("every catalogue preset produces a valid bounded document without fabricated proof", () => {
  assert.ok(SITE_BUILDER_MODULES.length >= 35);
  assert.ok(SITE_BUILDER_PRESET_COUNT >= 100);
  for (const module of SITE_BUILDER_MODULES) {
    for (const variant of module.variants) {
      const doc = withModule(module.id, variant.id);
      const parsed = siteBuilderSchema.safeParse(doc);
      assert.equal(
        parsed.success,
        true,
        `${module.id}/${variant.id}: ${parsed.success ? "" : parsed.error.message}`,
      );
      if (
        [
          "testimonials",
          "transformation",
          "stats",
          "logos",
          "credentials",
          "team",
        ].includes(module.id)
      )
        assert.deepEqual(doc.pages[0].sections[0].content.items, [], module.id);
      if (["pricing", "programmes", "programme-detail"].includes(module.id))
        assert.deepEqual(
          doc.pages[0].sections[0].content.productIds,
          [],
          module.id,
        );
    }
  }
});

test("five distinct multipage starter sites validate with Arabic and real identity copy", () => {
  const templates = SITE_BUILDER_TEMPLATES.filter(
    (template) => template.id !== "blank",
  );
  assert.equal(templates.length, 5);
  const layouts = new Set<string>();
  for (const template of templates) {
    const doc = createTemplate(template.id, {
      name: "Nadia",
      headline: "Training with intention",
      bio: "My own biography.",
      language: "en",
    });
    assert.equal(siteBuilderSchema.safeParse(doc).success, true);
    assert.equal(doc.pages.length, 4);
    assert.deepEqual(getBuilderPublishIssues(doc), []);
    assert.equal(
      doc.pages[0].sections[0].content.title,
      "Training with intention",
    );
    assert.equal(
      doc.pages.find((page) => page.slug === "about")?.sections[0].content.body,
      "My own biography.",
    );
    layouts.add(
      JSON.stringify([
        doc.theme,
        doc.pages[0].sections.map((section) => [
          section.moduleId,
          section.variant,
        ]),
      ]),
    );
    const arabic = createTemplate(template.id, { language: "ar" });
    assert.equal(siteBuilderSchema.safeParse(arabic).success, true);
    assert.equal(arabic.pages[0].title, "الرئيسية");
    assert.match(arabic.pages[0].sections[0].content.title, /[\u0600-\u06ff]/);
    assert.doesNotMatch(
      builderContentText(arabic),
      /Explore programmes|Get in touch|Your starting point/,
    );
  }
  assert.equal(layouts.size, 5);
  assert.equal(
    getBuilderPublishIssues(createTemplate("blank"))[0].code,
    "EMPTY_HOME",
  );
});

test("legacy migration preserves all custom copy, visibility, SEO, photos and built-in addresses", () => {
  const legacy = {
    headline: "An existing headline",
    introduction: "An existing introduction",
    about: "Existing biography\n\nSecond paragraph.",
    cta: "My existing button",
    seoTitle: "Existing SEO title",
    seoDescription: "Existing search summary",
    contactEmail: "coach@example.test",
    whatsapp: "+971501234567",
    pages: Array.from({ length: 100 }, (_, index) => ({
      slug: `page-${index}`,
      title: `Page ${index}`,
      body: `Existing body ${index}\n\n${"x".repeat(index === 99 ? 19000 : 4)}`,
      visible: index !== 42,
    })),
  };
  const frozen = structuredClone(legacy);
  const doc = legacyToBuilder(legacy, {
    name: "Existing Coach",
    theme: {
      design: {
        photoUrl: media("1"),
        coverUrl: media("2"),
        primary: "#123456",
        typography: "editorial",
      },
    },
  });
  assert.equal(siteBuilderSchema.safeParse(doc).success, true);
  assert.deepEqual(
    legacy,
    frozen,
    "conversion does not mutate the legacy record",
  );
  assert.equal(doc.pages.length, 105);
  assert.deepEqual(
    doc.pages.slice(0, 5).map((page) => page.slug),
    ["", "about", "memberships", "galleries", "contact"],
  );
  assert.equal(doc.pages[0].sections[0].content.title, legacy.headline);
  assert.equal(doc.pages[0].sections[0].content.body, legacy.introduction);
  assert.equal(doc.pages[0].sections[0].content.actions[0].label, legacy.cta);
  assert.equal(doc.pages[0].sections[0].content.image, media("2"));
  assert.equal(doc.pages[0].seoTitle, legacy.seoTitle);
  assert.equal(doc.pages[0].seoDescription, legacy.seoDescription);
  assert.equal(doc.pages[1].sections[0].content.body, legacy.about);
  assert.equal(doc.pages[1].sections[0].content.image, media("1"));
  assert.equal(doc.theme.accent, "#123456");
  assert.equal(doc.theme.font, "serif");
  for (const page of legacy.pages) {
    const converted = findBuilderPage(doc, page.slug, true)!;
    assert.equal(converted.sections[0].content.body, page.body);
    assert.equal(converted.visible, page.visible);
  }
  assert.doesNotMatch(
    builderContentText(doc),
    /coach@example.test|971501234567|Existing body 42\b/,
  );
  assert.equal(findBuilderPage(doc, "page-42"), undefined);
});

test("public projection cannot reveal hidden pages, reusable drafts or globally hidden descendants", () => {
  const doc = createTemplate("minimal"),
    hiddenPage = doc.pages[1];
  hiddenPage.visible = false;
  hiddenPage.sections[0].content.body = "PRIVATE PAGE";
  hiddenPage.sections[0].content.image = media("1");
  hiddenPage.socialImage = media("2");
  doc.redirects.push({ from: "private-old", toPageId: hiddenPage.id });
  const secret = createModule("text", "article");
  secret.content.body = "PRIVATE REUSABLE";
  secret.content.image = media("3");
  doc.savedSections.push({
    id: "saved-secret",
    name: "PRIVATE NAME",
    section: secret,
  });
  const globallyHidden = createModule("text", "article");
  globallyHidden.content.body = "PRIVATE SECTION";
  globallyHidden.content.image = media("4");
  globallyHidden.responsive = hidden;
  doc.pages[0].sections.push(globallyHidden);
  const custom = createModule("columns", "two");
  custom.content.elements = [
    createBuilderElement("columns", {
      responsive: hidden,
      children: [
        createBuilderElement("image", {
          image: media("5"),
          text: "PRIVATE CHILD",
        }),
      ],
    }),
    createBuilderElement("text", { text: "Visible child" }),
  ];
  doc.pages[0].sections.push(custom);
  const snapshot = structuredClone(doc),
    publicDoc = projectPublishedBuilder(doc);
  assert.deepEqual(doc, snapshot, "projection never edits a draft");
  assert.doesNotMatch(
    JSON.stringify(publicDoc),
    /PRIVATE|private-old|saved-secret/,
  );
  assert.deepEqual(builderMediaReferences(publicDoc), []);
  assert.equal(builderMediaReferences(doc).length, 5);
  assert.match(builderContentText(doc), /Visible child/);
  assert.equal(siteBuilderSchema.safeParse(publicDoc).success, true);
});

test("legacy app-like slugs remain valid under the coach route and retain rename redirects", () => {
  const pages = ["admin", "app", "login", "privacy", "api", "signup"].map(
    (slug) => ({
      slug,
      title: slug,
      body: `Existing ${slug} content`,
      visible: true,
    }),
  );
  const doc = legacyToBuilder({ pages });
  for (const page of pages)
    assert.equal(
      findBuilderPage(doc, page.slug)?.sections[0].content.body,
      page.body,
    );
  const admin = findBuilderPage(doc, "admin")!;
  const renamed = renameBuilderPage(
    doc,
    admin.id,
    "administration-information",
  );
  assert.equal(
    findBuilderRedirect(renamed, "admin")?.slug,
    "administration-information",
  );
});

test("hidden-page links block publication, while public projection also removes such links defensively", () => {
  const doc = createTemplate("minimal"),
    target = doc.pages[1];
  target.visible = false;
  doc.header.action = {
    kind: "page",
    pageId: target.id,
    label: "Private coaching draft",
    newTab: false,
  };
  assert.equal(getBuilderPublishIssues(doc)[0].code, "HIDDEN_PAGE_LINK");
  assert.equal(projectPublishedBuilder(doc).header.action, undefined);
  doc.header.action = undefined;
  const custom = createModule("columns", "two");
  custom.content.elements = [
    createBuilderElement("button", {
      action: {
        kind: "page",
        pageId: target.id,
        label: "Hidden button",
        newTab: false,
      },
      responsive: hidden,
    }),
  ];
  doc.pages[0].sections.push(custom);
  assert.deepEqual(
    getBuilderPublishIssues(doc),
    [],
    "globally hidden controls have no public destination",
  );
});

test("draft parser rejects executable URLs, unknown layouts, unbounded nested layouts and unknown properties", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.example",
    "https://user:password@safe.example/path",
    "https://127.0.0.1/image.jpg",
    "https://localhost/image.jpg",
    "/\\evil.example",
    "https://good.example\n.evil.example",
  ]) {
    const doc = createTemplate("minimal");
    doc.pages[0].sections[0].content.actions = [
      { kind: "url", label: "Bad address", href: value, newTab: false },
    ];
    assert.equal(siteBuilderSchema.safeParse(doc).success, false, value);
  }
  const unknown: any = createTemplate("minimal");
  unknown.pages[0].sections[0].content.html = "<script>bad()</script>";
  assert.equal(siteBuilderSchema.safeParse(unknown).success, false);
  delete unknown.pages[0].sections[0].content.html;
  unknown.pages[0].sections[0].variant = "generated-css";
  assert.equal(siteBuilderSchema.safeParse(unknown).success, false);
  let element: any = { id: "leaf", type: "text", text: "Leaf" };
  for (let depth = 0; depth < 5; depth++)
    element = { id: `column-${depth}`, type: "columns", children: [element] };
  assert.equal(siteBuilderElementSchema.safeParse(element).success, false);
});

test("YouTube and Vimeo normalize to safe embeds; arbitrary frames never pass", () => {
  assert.equal(
    getBuilderVideoEmbedUrl(
      "https://www.youtube.com/watch?v=abcdefghijk&autoplay=1",
    ),
    "https://www.youtube-nocookie.com/embed/abcdefghijk",
  );
  assert.equal(
    getBuilderVideoEmbedUrl("https://youtu.be/abcdefghijk"),
    "https://www.youtube-nocookie.com/embed/abcdefghijk",
  );
  assert.equal(
    getBuilderVideoEmbedUrl("https://vimeo.com/12345678"),
    "https://player.vimeo.com/video/12345678",
  );
  for (const value of [
    "http://youtube.com/watch?v=abcdefghijk",
    "https://youtube.com.evil.example/embed/abcdefghijk",
    "https://evil.example/video",
    "https://youtube.com:8443/embed/abcdefghijk",
    "<iframe src='https://youtube.com/embed/abcdefghijk'>",
    "https://vimeo.com/12345/private-token",
  ])
    assert.equal(getBuilderVideoEmbedUrl(value), null, value);
});

test("page identities, routes, reference targets and menu hierarchy must remain coherent", () => {
  const mutate = (fn: (doc: SiteBuilderDocument) => void) => {
    const doc = createTemplate("minimal");
    fn(doc);
    assert.equal(siteBuilderSchema.safeParse(doc).success, false);
  };
  mutate((doc) => {
    doc.pages[1].id = doc.pages[0].id;
  });
  mutate((doc) => {
    doc.pages[1].slug = doc.pages[0].slug;
  });
  mutate((doc) => {
    doc.pages[1].slug = "admin/private";
  });
  mutate((doc) => {
    doc.pages[0].slug = "home";
  });
  mutate((doc) => {
    doc.pages[1].parentId = doc.pages[1].id;
  });
  mutate((doc) => {
    doc.pages[1].parentId = doc.pages[2].id;
    doc.pages[2].parentId = doc.pages[1].id;
  });
  mutate((doc) => {
    doc.header.action = {
      kind: "page",
      label: "Broken destination",
      pageId: "missing",
      newTab: false,
    };
  });
  mutate((doc) => {
    doc.redirects.push({ from: "about", toPageId: doc.pages[2].id });
  });
  mutate((doc) => {
    doc.redirects.push({ from: "old", toPageId: "missing" });
  });
  mutate((doc) => {
    doc.pages[1].sections[0].id = doc.pages[0].sections[0].id;
  });
});

test("duplicating pages and nested sections creates independent element and item identities", () => {
  const original = createModule("columns", "three");
  const duplicate = duplicateSection(original);
  assert.notEqual(duplicate.id, original.id);
  assert.notEqual(
    duplicate.content.elements[0].id,
    original.content.elements[0].id,
  );
  assert.notEqual(
    duplicate.content.elements[0].children[0].id,
    original.content.elements[0].children[0].id,
  );
  duplicate.content.elements[0].children[0].text = "Independent text";
  assert.notEqual(
    duplicate.content.elements[0].children[0].text,
    original.content.elements[0].children[0].text,
  );
  const doc = withModule("benefits", "cards"),
    copy = duplicatePage(doc.pages[0]);
  assert.notEqual(
    copy.sections[0].content.items[0].id,
    doc.pages[0].sections[0].content.items[0].id,
  );
  assert.equal(copy.slug, "home-copy");
  doc.pages.push(copy);
  assert.equal(siteBuilderSchema.safeParse(doc).success, true);
});

test("renaming a page preserves a direct redirect to its stable identity without mutating its draft", () => {
  const original = createTemplate("minimal"),
    page = original.pages[1];
  const renamed = renameBuilderPage(original, page.id, "my-story");
  assert.equal(page.slug, "about");
  assert.equal(findBuilderRedirect(renamed, "about")?.slug, "my-story");
  const second = renameBuilderPage(renamed, page.id, "my-approach");
  assert.equal(findBuilderRedirect(second, "about")?.slug, "my-approach");
  assert.equal(findBuilderRedirect(second, "my-story")?.slug, "my-approach");
  const restoredName = renameBuilderPage(second, page.id, "about");
  assert.equal(findBuilderRedirect(restoredName, "my-story")?.slug, "about");
  assert.equal(
    restoredName.redirects.some((redirect) => redirect.from === "about"),
    false,
  );
  assert.throws(
    () => renameBuilderPage(original, original.pages[0].id, "not-home"),
    /home page/,
  );
});
