import type { SiteBuilderModuleId } from "./site-builder.ts";

/** Shared compositions, not duplicated page code. Existing variant IDs stay intact. */
const compositions = {
  portrait: [
    "Portrait feature",
    "Tall portrait beside a generous introduction.",
  ],
  panorama: [
    "Panoramic feature",
    "Wide landscape media beneath a two-column introduction.",
  ],
  "image-first": [
    "Image first",
    "Lead with full-width media, followed by the story and next step.",
  ],
  "framed-split": [
    "Framed split",
    "Two inset panels pair media with a contained text column.",
  ],
  offset: [
    "Offset editorial",
    "Unequal columns and offset media create an editorial rhythm.",
  ],
  "overlay-panel": [
    "Image with panel",
    "An opaque, readable text panel sits over a large image.",
  ],
  thumbnail: [
    "Portrait introduction",
    "A compact image accompanies a spacious text-led introduction.",
  ],
  reverse: [
    "Reversed feature",
    "Place the visual on the opposite side of the text.",
  ],
  bento: [
    "Bento grid",
    "A tall opening card anchors a grid of smaller supporting cards.",
  ],
  "bordered-grid": [
    "Connected grid",
    "Flush, bordered cells form a structured two-column collection.",
  ],
  "compact-grid": [
    "Compact directory",
    "Four concise columns make larger collections easy to scan.",
  ],
  "split-heading": [
    "Side introduction",
    "Keep the introduction beside a two-column content collection.",
  ],
  "editorial-list": [
    "Editorial rows",
    "Wide rows give each item a clear title and supporting detail.",
  ],
  "numbered-rows": [
    "Numbered index",
    "Large chapter numbers organise a single-column index.",
  ],
  alternating: [
    "Alternating stories",
    "Offset successive cards to create a stepped reading rhythm.",
  ],
  "feature-stack": [
    "Lead story",
    "A full-width opening card leads into a two-column collection.",
  ],
  "step-cards": [
    "Step cards",
    "Each step has its own framed card with a prominent number.",
  ],
  zigzag: [
    "Zigzag timeline",
    "Successive steps alternate around a central timeline.",
  ],
  chapters: [
    "Chapters",
    "Full-width chapters pair oversized numbers with detailed text.",
  ],
  "side-note": [
    "Editorial columns",
    "A narrow heading column accompanies a wider reading column.",
  ],
  "reading-card": [
    "Reading card",
    "A narrow, inset reading surface gives longer copy a quiet frame.",
  ],
  manifesto: [
    "Manifesto",
    "An oversized statement leads into a restrained supporting paragraph.",
  ],
  signature: [
    "Signed statement",
    "An opening quotation mark and inset attribution frame your words.",
  ],
  mosaic: [
    "Photo mosaic",
    "A wide opening photograph is followed by a varied image grid.",
  ],
  "photo-journal": [
    "Photo journal",
    "Large photographs and side captions form an editorial sequence.",
  ],
  "contact-sheet": [
    "Contact sheet",
    "A dense, consistently cropped grid keeps captions close to images.",
  ],
  "answer-cards": [
    "Answer cards",
    "Always-visible answers sit in a two-column card grid.",
  ],
  "numbered-answers": [
    "Numbered answers",
    "An open question-and-answer index with large reference numbers.",
  ],
  "centered-answers": [
    "Centred accordion",
    "A centred introduction leads into a narrow accordion.",
  ],
  "form-panel": [
    "Enquiry panel",
    "A framed form sits beside a compact, vertically centred introduction.",
  ],
  "form-first": [
    "Form first",
    "The enquiry form leads, with supporting copy beside it.",
  ],
  "form-stack": [
    "Stacked enquiry",
    "A full-width introduction sits above a narrow enquiry form.",
  ],
  "chapter-divider": [
    "Chapter break",
    "A chapter label separates two horizontal rules.",
  ],
  "double-rule": [
    "Double rule",
    "Two rules create a deliberate pause between sections.",
  ],
  dots: [
    "Dotted pause",
    "A centred sequence of small dots creates a quiet visual break.",
  ],
  four: [
    "Four columns",
    "Four equal editable columns, two on tablets and one on phones.",
  ],
  "wide-start": [
    "Wide opening column",
    "A wide leading column is paired with a narrow sidebar.",
  ],
  "wide-end": [
    "Wide closing column",
    "A narrow introduction is paired with a wide closing column.",
  ],
} as const;

export type SiteBuilderComposition = keyof typeof compositions;
export type SiteBuilderLayout = {
  id: string;
  label: string;
  description: string;
  composition: SiteBuilderComposition;
};

// Each family chooses compatible compositions; no generated biographies, prices or proof.
const additions: Record<
  SiteBuilderModuleId,
  readonly SiteBuilderComposition[]
> = {
  hero: [
    "portrait",
    "panorama",
    "image-first",
    "framed-split",
    "offset",
    "overlay-panel",
    "thumbnail",
  ],
  intro: ["side-note", "reading-card", "manifesto"],
  about: ["reverse", "panorama", "framed-split", "offset", "thumbnail"],
  team: ["bento", "editorial-list", "compact-grid"],
  split: ["portrait", "panorama", "image-first", "framed-split", "thumbnail"],
  benefits: [
    "bento",
    "split-heading",
    "numbered-rows",
    "bordered-grid",
    "compact-grid",
  ],
  services: [
    "bento",
    "split-heading",
    "editorial-list",
    "bordered-grid",
    "alternating",
  ],
  process: [
    "step-cards",
    "zigzag",
    "chapters",
    "compact-grid",
    "split-heading",
  ],
  programmes: [
    "bento",
    "split-heading",
    "editorial-list",
    "bordered-grid",
    "feature-stack",
  ],
  "programme-detail": ["split-heading", "editorial-list", "reading-card"],
  pricing: [
    "bento",
    "split-heading",
    "editorial-list",
    "bordered-grid",
    "compact-grid",
    "feature-stack",
    "reading-card",
  ],
  booking: ["reverse", "framed-split", "panorama"],
  "call-to-action": [
    "portrait",
    "panorama",
    "image-first",
    "framed-split",
    "offset",
    "overlay-panel",
    "thumbnail",
  ],
  gallery: [
    "bento",
    "bordered-grid",
    "compact-grid",
    "feature-stack",
    "mosaic",
    "photo-journal",
    "contact-sheet",
  ],
  transformation: ["alternating", "feature-stack", "split-heading"],
  testimonials: [
    "bento",
    "split-heading",
    "editorial-list",
    "bordered-grid",
    "compact-grid",
    "feature-stack",
    "alternating",
  ],
  logos: ["bordered-grid", "compact-grid", "split-heading"],
  faq: [
    "answer-cards",
    "numbered-answers",
    "centered-answers",
    "reading-card",
    "split-heading",
  ],
  stats: ["bordered-grid", "split-heading", "editorial-list"],
  schedule: ["split-heading", "bordered-grid", "numbered-rows"],
  video: ["reverse", "framed-split", "image-first", "portrait", "offset"],
  contact: ["form-panel", "form-first", "form-stack", "reading-card", "offset"],
  lead: ["form-panel", "form-first", "form-stack"],
  divider: ["chapter-divider", "double-rule", "dots"],
  columns: ["four", "wide-start", "wide-end"],
  credentials: ["bordered-grid", "compact-grid", "editorial-list"],
  social: ["bordered-grid", "split-heading", "numbered-rows"],
  navigation: ["bordered-grid", "split-heading", "numbered-rows"],
  footer: ["side-note", "reading-card", "split-heading"],
  text: ["side-note", "reading-card", "manifesto"],
  quote: ["side-note", "reading-card", "signature"],
  image: ["portrait", "panorama", "image-first", "framed-split", "offset"],
  resources: ["bento", "split-heading", "editorial-list"],
  comparison: ["bordered-grid", "split-heading", "numbered-rows"],
  community: ["bento", "split-heading", "feature-stack"],
  nutrition: ["bento", "split-heading", "editorial-list"],
  "app-preview": ["reverse", "panorama", "framed-split"],
  announcement: ["side-note", "reading-card", "manifesto"],
};

export const SITE_BUILDER_ADDITIONAL_LAYOUTS = Object.fromEntries(
  Object.entries(additions).map(([moduleId, ids]) => [
    moduleId,
    ids.map((id) => ({
      id,
      composition: id,
      label: compositions[id][0],
      description: compositions[id][1],
    })),
  ]),
) as Record<SiteBuilderModuleId, SiteBuilderLayout[]>;

export function getBuilderLayout(
  moduleId: SiteBuilderModuleId,
  variant: string,
) {
  return SITE_BUILDER_ADDITIONAL_LAYOUTS[moduleId]?.find(
    (layout) => layout.id === variant,
  );
}

/** Families whose renderer owns an inner composition root instead of a fragment. */
export const SITE_BUILDER_WRAPPED_MODULES: readonly SiteBuilderModuleId[] = [
  "hero",
  "about",
  "split",
  "booking",
  "call-to-action",
  "faq",
  "video",
  "contact",
  "lead",
  "divider",
  "credentials",
  "footer",
  "quote",
  "image",
  "community",
  "nutrition",
  "app-preview",
  "announcement",
];
