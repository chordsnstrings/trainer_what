import { z } from "zod";
import { brandColorSchema, brandImageSchema } from "./branding.ts";

/** One bounded, executable-code-free document shared by editor, AI and renderer. */
export const SITE_BUILDER_VERSION = 1 as const;
export const SITE_BUILDER_LIMITS = {
  // Existing sites can hold 100 custom pages plus their five built-in pages.
  pages: 110,
  sectionsPerPage: 60,
  sections: 300,
  itemsPerSection: 24,
  savedSections: 50,
  elementsPerSection: 80,
  elementDepth: 4,
  redirects: 200,
} as const;
export const siteBuilderIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const siteBuilderSlugSchema = z
  .string()
  .max(60)
  .regex(/^$|^[a-z][a-z0-9-]{0,59}$/);
const text = (max: number) => z.string().max(max);
const optionalText = (max: number) => text(max).optional();

export function isSafeBuilderLink(value: string): boolean {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return false;
  if (/^#[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) return true;
  if (/^\/(?!\/)[a-zA-Z0-9/_-]*(?:#[a-zA-Z0-9_-]+)?$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      url.hostname.includes(".") &&
      !/^\d+(\.\d+){3}$/.test(url.hostname) &&
      !url.hostname.includes(":") &&
      !/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
export const siteBuilderLinkSchema = z
  .string()
  .max(1000)
  .refine(
    isSafeBuilderLink,
    "Use a page path, section anchor or public HTTPS address",
  );

/** Normalize only known video providers; never copy arbitrary HTML into an iframe. */
export function getBuilderVideoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      /[\u0000-\u0020\\]/.test(value)
    )
      return null;
    const host = url.hostname.toLowerCase();
    let videoId: string | null = null;
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    ) {
      videoId =
        url.pathname === "/watch"
          ? url.searchParams.get("v")
          : (/^\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})\/?$/.exec(
              url.pathname,
            )?.[1] ?? null);
    } else if (host === "youtu.be") videoId = url.pathname.slice(1);
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId))
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
      const id = /^\/(?:video\/)?([0-9]{1,12})\/?$/.exec(url.pathname)?.[1];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* Invalid provider address. */
  }
  return null;
}
export const siteBuilderVideoSchema = z
  .string()
  .max(1000)
  .refine(
    (v) => !v || !!getBuilderVideoEmbedUrl(v),
    "Use a YouTube or Vimeo HTTPS video link",
  );

export const siteBuilderActionSchema = z
  .object({
    label: text(80),
    kind: z.enum([
      "page",
      "url",
      "programmes",
      "booking",
      "contact",
      "signup",
      "anchor",
    ]),
    href: siteBuilderLinkSchema.optional(),
    pageId: siteBuilderIdSchema.optional(),
    productId: z.string().uuid().optional(),
    newTab: z.boolean().default(false),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (action.kind === "page" && !action.pageId)
      ctx.addIssue({
        code: "custom",
        path: ["pageId"],
        message: "Choose a page",
      });
    if (["url", "anchor"].includes(action.kind) && !action.href)
      ctx.addIssue({
        code: "custom",
        path: ["href"],
        message: "Choose an address",
      });
    if (action.kind === "anchor" && action.href && !action.href.startsWith("#"))
      ctx.addIssue({
        code: "custom",
        path: ["href"],
        message: "Use a section anchor",
      });
  });
export type SiteBuilderAction = z.infer<typeof siteBuilderActionSchema>;

export const siteBuilderStyleSchema = z
  .object({
    background: brandColorSchema.optional(),
    color: brandColorSchema.optional(),
    accent: brandColorSchema.optional(),
    paddingTop: z.number().int().min(0).max(240).optional(),
    paddingBottom: z.number().int().min(0).max(240).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    width: z.enum(["content", "wide", "full"]).optional(),
    columns: z.number().int().min(1).max(4).optional(),
    gap: z.number().int().min(0).max(100).optional(),
    radius: z.number().int().min(0).max(64).optional(),
    minHeight: z.number().int().min(0).max(1000).optional(),
    imagePosition: z
      .enum(["center", "top", "bottom", "left", "right"])
      .optional(),
    imageFit: z.enum(["cover", "contain"]).optional(),
    fontSize: z.number().int().min(12).max(120).optional(),
  })
  .strict();
export type SiteBuilderStyle = z.infer<typeof siteBuilderStyleSchema>;
export const siteBuilderBreakpointSchema = siteBuilderStyleSchema
  .extend({ hidden: z.boolean().optional(), reverse: z.boolean().optional() })
  .strict();
export const siteBuilderResponsiveSchema = z
  .object({
    desktop: siteBuilderBreakpointSchema.optional(),
    tablet: siteBuilderBreakpointSchema.optional(),
    mobile: siteBuilderBreakpointSchema.optional(),
  })
  .strict();
export type SiteBuilderResponsive = z.infer<typeof siteBuilderResponsiveSchema>;

export const siteBuilderItemSchema = z
  .object({
    id: siteBuilderIdSchema,
    title: text(200).default(""),
    body: text(2000).default(""),
    eyebrow: optionalText(100),
    image: brandImageSchema.optional(),
    imageAlt: optionalText(240),
    beforeImage: brandImageSchema.optional(),
    afterImage: brandImageSchema.optional(),
    caption: optionalText(500),
    value: optionalText(80),
    author: optionalText(100),
    role: optionalText(120),
    quote: optionalText(2000),
    question: optionalText(300),
    answer: optionalText(4000),
    href: siteBuilderLinkSchema.optional(),
    action: siteBuilderActionSchema.optional(),
  })
  .strict();
export type SiteBuilderItem = z.infer<typeof siteBuilderItemSchema>;

export type SiteBuilderElement = {
  id: string;
  type:
    "heading" | "text" | "image" | "button" | "video" | "spacer" | "columns";
  text?: string;
  image?: string;
  imageAlt?: string;
  videoUrl?: string;
  action?: SiteBuilderAction;
  style: SiteBuilderStyle;
  responsive: SiteBuilderResponsive;
  children: SiteBuilderElement[];
};
const elementShape = {
  id: siteBuilderIdSchema,
  type: z.enum([
    "heading",
    "text",
    "image",
    "button",
    "video",
    "spacer",
    "columns",
  ]),
  text: optionalText(12000),
  image: brandImageSchema.optional(),
  imageAlt: optionalText(240),
  videoUrl: siteBuilderVideoSchema.optional(),
  action: siteBuilderActionSchema.optional(),
  style: siteBuilderStyleSchema.default({}),
  responsive: siteBuilderResponsiveSchema.default({}),
};
function elementAtDepth(depth: number): z.ZodType<SiteBuilderElement> {
  return z
    .object({
      ...elementShape,
      children:
        depth >= SITE_BUILDER_LIMITS.elementDepth
          ? z.array(z.never()).max(0).default([])
          : z
              .array(elementAtDepth(depth + 1))
              .max(12)
              .default([]),
    })
    .strict() as z.ZodType<SiteBuilderElement>;
}
export const siteBuilderElementSchema = elementAtDepth(1);
export const siteBuilderContentSchema = z
  .object({
    eyebrow: text(100).default(""),
    title: text(300).default(""),
    body: text(20000).default(""),
    image: brandImageSchema.default(""),
    imageAlt: text(240).default(""),
    videoUrl: siteBuilderVideoSchema.default(""),
    poster: brandImageSchema.default(""),
    caption: text(1000).default(""),
    actions: z.array(siteBuilderActionSchema).max(3).default([]),
    items: z
      .array(siteBuilderItemSchema)
      .max(SITE_BUILDER_LIMITS.itemsPerSection)
      .default([]),
    productIds: z.array(z.string().uuid()).max(24).default([]),
    galleryId: z.string().uuid().optional(),
    elements: z.array(siteBuilderElementSchema).max(12).default([]),
  })
  .strict();
export type SiteBuilderContent = z.infer<typeof siteBuilderContentSchema>;

export const SITE_BUILDER_MODULE_IDS = [
  "hero",
  "intro",
  "about",
  "team",
  "split",
  "benefits",
  "services",
  "process",
  "programmes",
  "programme-detail",
  "pricing",
  "booking",
  "call-to-action",
  "gallery",
  "transformation",
  "testimonials",
  "logos",
  "faq",
  "stats",
  "schedule",
  "video",
  "contact",
  "lead",
  "divider",
  "columns",
  "credentials",
  "social",
  "navigation",
  "footer",
  "text",
  "quote",
  "image",
  "resources",
  "comparison",
  "community",
  "nutrition",
  "app-preview",
  "announcement",
] as const;
export type SiteBuilderModuleId = (typeof SITE_BUILDER_MODULE_IDS)[number];
export const siteBuilderSectionSchema = z
  .object({
    id: siteBuilderIdSchema,
    moduleId: z.enum(SITE_BUILDER_MODULE_IDS),
    variant: z.string().max(60),
    content: siteBuilderContentSchema,
    style: siteBuilderStyleSchema.default({}),
    responsive: siteBuilderResponsiveSchema.default({}),
  })
  .strict();
export type SiteBuilderSection = z.infer<typeof siteBuilderSectionSchema>;

export const siteBuilderThemeSchema = z
  .object({
    font: z
      .enum(["sans", "serif", "display", "rounded", "mono"])
      .default("sans"),
    background: brandColorSchema.default("#ffffff"),
    text: brandColorSchema.default("#171917"),
    accent: brandColorSchema.default("#244c46"),
    surface: brandColorSchema.default("#f2f4ef"),
    muted: brandColorSchema.default("#5b635b"),
    border: brandColorSchema.default("#dce0d7"),
    radius: z.number().int().min(0).max(40).default(12),
    width: z.number().int().min(900).max(1600).default(1200),
  })
  .strict();
export type SiteBuilderTheme = z.infer<typeof siteBuilderThemeSchema>;
export const siteBuilderPageSchema = z
  .object({
    id: siteBuilderIdSchema,
    slug: siteBuilderSlugSchema,
    title: text(100).min(1),
    parentId: siteBuilderIdSchema.optional(),
    visible: z.boolean().default(true),
    inNavigation: z.boolean().default(true),
    seoTitle: text(100).default(""),
    seoDescription: text(200).default(""),
    noindex: z.boolean().default(false),
    socialImage: brandImageSchema.default(""),
    sections: z
      .array(siteBuilderSectionSchema)
      .max(SITE_BUILDER_LIMITS.sectionsPerPage),
  })
  .strict();
export type SiteBuilderPage = z.infer<typeof siteBuilderPageSchema>;
const documentSchema = z
  .object({
    version: z.literal(SITE_BUILDER_VERSION),
    theme: siteBuilderThemeSchema,
    header: z
      .object({
        variant: z.enum(["simple", "centered", "split"]).default("simple"),
        sticky: z.boolean().default(true),
        showLogo: z.boolean().default(true),
        showTitle: z.boolean().default(true),
        action: siteBuilderActionSchema.optional(),
      })
      .strict(),
    footer: z
      .object({
        variant: z.enum(["simple", "columns", "centered"]).default("simple"),
        text: text(1000).default(""),
        showSocial: z.boolean().default(true),
        action: siteBuilderActionSchema.optional(),
      })
      .strict(),
    pages: z.array(siteBuilderPageSchema).min(1).max(SITE_BUILDER_LIMITS.pages),
    savedSections: z
      .array(
        z
          .object({
            id: siteBuilderIdSchema,
            name: text(100).min(1),
            section: siteBuilderSectionSchema,
          })
          .strict(),
      )
      .max(SITE_BUILDER_LIMITS.savedSections)
      .default([]),
    redirects: z
      .array(
        z
          .object({
            from: siteBuilderSlugSchema,
            toPageId: siteBuilderIdSchema,
          })
          .strict(),
      )
      .max(SITE_BUILDER_LIMITS.redirects)
      .default([]),
  })
  .strict();
export type SiteBuilderDocument = z.infer<typeof documentSchema>;

// Catalogue, constructors and document validation are defined below so every
// consumer uses the same module variants and reference rules.

export type SiteBuilderFieldType =
  | "text"
  | "textarea"
  | "image"
  | "video"
  | "items"
  | "actions"
  | "products"
  | "gallery"
  | "elements";
export type SiteBuilderField = {
  key: keyof SiteBuilderContent;
  label: string;
  type: SiteBuilderFieldType;
};
export type SiteBuilderModule = {
  id: SiteBuilderModuleId;
  label: string;
  group: string;
  description: string;
  variants: { id: string; label: string; description: string }[];
  fields: SiteBuilderField[];
};
const commonFields: SiteBuilderField[] = [
  { key: "eyebrow", label: "Small label", type: "text" },
  { key: "title", label: "Heading", type: "text" },
  { key: "body", label: "Text", type: "textarea" },
];
const mediaFields: SiteBuilderField[] = [
  { key: "image", label: "Image", type: "image" },
  { key: "imageAlt", label: "Image description", type: "text" },
];
const actionField: SiteBuilderField = {
  key: "actions",
  label: "Buttons",
  type: "actions",
};
const itemField: SiteBuilderField = {
  key: "items",
  label: "Items",
  type: "items",
};
type ModuleSpec = [
  SiteBuilderModuleId,
  string,
  string,
  string,
  string[],
  (
    | "media"
    | "actions"
    | "items"
    | "video"
    | "products"
    | "gallery"
    | "elements"
  )[],
];
const moduleSpecs: ModuleSpec[] = [
  [
    "hero",
    "Hero",
    "Start & navigation",
    "A strong first impression with a clear next step.",
    ["split", "centered", "cover", "editorial", "video"],
    ["media", "actions", "video"],
  ],
  [
    "intro",
    "Introduction",
    "Your coaching",
    "Introduce your approach in a few considered sentences.",
    ["centered", "editorial", "statement"],
    ["actions"],
  ],
  [
    "about",
    "About the coach",
    "Your coaching",
    "Your story, methods and the people you work with.",
    ["portrait", "editorial", "card"],
    ["media", "actions"],
  ],
  [
    "team",
    "Coaching team",
    "Your coaching",
    "Introduce real team members with their roles and portraits.",
    ["cards", "portraits", "list"],
    ["items"],
  ],
  [
    "split",
    "Image and text",
    "Media & content",
    "Pair a photograph with an explanation or story.",
    ["image-left", "image-right", "overlap"],
    ["media", "actions"],
  ],
  [
    "benefits",
    "Benefits",
    "Your coaching",
    "Explain what your coaching includes and why it is useful.",
    ["cards", "icons", "list"],
    ["items"],
  ],
  [
    "services",
    "Services",
    "Your coaching",
    "Present different ways to work with you.",
    ["grid", "rows", "spotlight"],
    ["items", "actions"],
  ],
  [
    "process",
    "How it works",
    "Your coaching",
    "Set clear expectations from first conversation onward.",
    ["steps", "timeline", "stacked"],
    ["items", "actions"],
  ],
  [
    "programmes",
    "Coaching programmes",
    "Offers & conversion",
    "Live programme details connected to your published offers.",
    ["cards", "list", "featured"],
    ["products", "actions"],
  ],
  [
    "programme-detail",
    "Programme details",
    "Offers & conversion",
    "Give one offer more space with its actual price and description.",
    ["overview", "curriculum", "split"],
    ["products", "items", "media"],
  ],
  [
    "pricing",
    "Membership pricing",
    "Offers & conversion",
    "Display current membership prices from your real offers.",
    ["cards", "comparison", "minimal"],
    ["products"],
  ],
  [
    "booking",
    "Book a conversation",
    "Offers & conversion",
    "Direct visitors into your existing coaching enquiry journey.",
    ["split", "centered", "card"],
    ["media", "actions"],
  ],
  [
    "call-to-action",
    "Call to action",
    "Offers & conversion",
    "An intentional next step between sections or at the end of a page.",
    ["band", "split", "centered"],
    ["media", "actions"],
  ],
  [
    "gallery",
    "Photo gallery",
    "Proof & stories",
    "Show selected images or a connected public gallery.",
    ["grid", "masonry", "strip"],
    ["items", "gallery"],
  ],
  [
    "transformation",
    "Progress stories",
    "Proof & stories",
    "Tell real, permissioned progress stories without promising results.",
    ["pairs", "story", "grid"],
    ["items"],
  ],
  [
    "testimonials",
    "Client testimonials",
    "Proof & stories",
    "Add genuine words shared by clients with their permission.",
    ["cards", "quote", "stacked"],
    ["items"],
  ],
  [
    "logos",
    "Partner logos",
    "Proof & stories",
    "Show organisations you genuinely work with and may name.",
    ["strip", "grid", "monochrome"],
    ["items"],
  ],
  [
    "faq",
    "Questions and answers",
    "Your coaching",
    "Answer common questions before someone gets in touch.",
    ["accordion", "columns", "list"],
    ["items"],
  ],
  [
    "stats",
    "Facts and figures",
    "Proof & stories",
    "Add only verified figures, with clear context.",
    ["band", "cards", "minimal"],
    ["items"],
  ],
  [
    "schedule",
    "Schedule",
    "Your coaching",
    "Share your own session times and availability notes.",
    ["table", "cards", "list"],
    ["items", "actions"],
  ],
  [
    "video",
    "Video",
    "Media & content",
    "A privacy-conscious, click-to-load YouTube or Vimeo video.",
    ["widescreen", "split", "feature"],
    ["video", "media"],
  ],
  [
    "contact",
    "Contact and enquiry",
    "Offers & conversion",
    "A real enquiry form routed to your coaching inbox.",
    ["split", "centered", "cards"],
    ["media"],
  ],
  [
    "lead",
    "Start a conversation",
    "Offers & conversion",
    "Invite visitors to enquire about a specific goal or programme.",
    ["split", "banner", "card"],
    ["media", "actions"],
  ],
  [
    "divider",
    "Divider and space",
    "Utility & layout",
    "Create deliberate pauses and labelled chapter breaks.",
    ["line", "spacer", "label"],
    [],
  ],
  [
    "columns",
    "Custom columns",
    "Utility & layout",
    "Compose your own layout from safe, responsive nested elements.",
    ["two", "three", "sidebar"],
    ["elements"],
  ],
  [
    "credentials",
    "Qualifications",
    "Proof & stories",
    "List real qualifications, affiliations and relevant experience.",
    ["badges", "list", "split"],
    ["items", "media"],
  ],
  [
    "social",
    "Social links",
    "Start & navigation",
    "Send visitors to your public profiles using approved HTTPS links.",
    ["links", "cards", "band"],
    ["items"],
  ],
  [
    "navigation",
    "Page navigation",
    "Start & navigation",
    "Help people find the right part of your website.",
    ["links", "cards", "inline"],
    ["items", "actions"],
  ],
  [
    "footer",
    "Footer section",
    "Start & navigation",
    "A final brand statement and useful page links.",
    ["columns", "centered", "minimal"],
    ["items", "actions"],
  ],
  [
    "text",
    "Text and article",
    "Media & content",
    "Write a longer explanation, policy or coaching philosophy.",
    ["article", "columns", "statement"],
    ["actions"],
  ],
  [
    "quote",
    "Coach's statement",
    "Media & content",
    "Share your own words with a considered editorial treatment.",
    ["editorial", "card", "centered"],
    [],
  ],
  [
    "image",
    "Featured image",
    "Media & content",
    "Give a photograph its own space with an optional caption.",
    ["wide", "framed", "split-caption"],
    ["media"],
  ],
  [
    "resources",
    "Useful resources",
    "Media & content",
    "Link to genuine guides, videos or external resources.",
    ["cards", "list", "featured"],
    ["items"],
  ],
  [
    "comparison",
    "Compare options",
    "Offers & conversion",
    "Help visitors understand differences between your services.",
    ["table", "cards", "split"],
    ["items", "actions"],
  ],
  [
    "community",
    "Your community",
    "Your coaching",
    "Describe how people connect and what support is available.",
    ["split", "cards", "banner"],
    ["media", "items", "actions"],
  ],
  [
    "nutrition",
    "Nutrition approach",
    "Your coaching",
    "Explain your own nutrition coaching scope and approach.",
    ["split", "cards", "editorial"],
    ["media", "items", "actions"],
  ],
  [
    "app-preview",
    "Coaching experience",
    "Your coaching",
    "Show how your coaching fits into a member's everyday life.",
    ["split", "devices", "steps"],
    ["media", "items", "actions"],
  ],
  [
    "announcement",
    "Announcement",
    "Start & navigation",
    "A concise update, notice or seasonal invitation.",
    ["banner", "split", "minimal"],
    ["actions"],
  ],
];
const titleCase = (value: string) =>
  value.replaceAll("-", " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const SITE_BUILDER_MODULES: SiteBuilderModule[] = moduleSpecs.map(
  ([id, label, group, description, variants, extras]) => ({
    id,
    label,
    group,
    description,
    variants: variants.map((variant) => ({
      id: variant,
      label: titleCase(variant),
      description: `${titleCase(variant)} layout for ${label.toLowerCase()}.`,
    })),
    fields: [
      ...commonFields,
      ...extras.flatMap((extra): SiteBuilderField[] => {
        switch (extra) {
          case "media":
            return mediaFields;
          case "actions":
            return [actionField];
          case "items":
            return [itemField];
          case "video":
            return [
              {
                key: "videoUrl",
                label: "YouTube or Vimeo video",
                type: "video",
              },
              { key: "poster", label: "Video poster", type: "image" },
              { key: "caption", label: "Caption", type: "text" },
            ];
          case "products":
            return [
              {
                key: "productIds",
                label: "Connected offers",
                type: "products",
              },
            ];
          case "gallery":
            return [
              { key: "galleryId", label: "Connected gallery", type: "gallery" },
            ];
          case "elements":
            return [
              { key: "elements", label: "Layout elements", type: "elements" },
            ];
        }
      }),
    ],
  }),
);
export const SITE_BUILDER_GROUPS = [
  ...new Set(SITE_BUILDER_MODULES.map((m) => m.group)),
];
export const SITE_BUILDER_PRESET_COUNT = SITE_BUILDER_MODULES.reduce(
  (n, m) => n + m.variants.length,
  0,
);
export function getBuilderModule(
  moduleId: string,
): SiteBuilderModule | undefined {
  return SITE_BUILDER_MODULES.find((m) => m.id === moduleId);
}
export function createBuilderId(prefix = "block"): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function action(
  label: string,
  kind: SiteBuilderAction["kind"],
): SiteBuilderAction {
  return { label, kind, newTab: false };
}
function items(values: [string, string][]): SiteBuilderItem[] {
  return values.map(([title, body]) => ({
    id: createBuilderId("item"),
    title,
    body,
  }));
}
const defaultCopy: Partial<
  Record<SiteBuilderModuleId, Partial<SiteBuilderContent>>
> = {
  hero: {
    eyebrow: "Personal coaching",
    title: "Build a way of training that works for you.",
    body: "Explore my approach and find a coaching option that fits your goals and everyday life.",
  },
  intro: {
    eyebrow: "A considered approach",
    title: "Coaching starts with understanding you.",
    body: "Your goals, experience and available time shape the conversation. We start there.",
  },
  about: {
    eyebrow: "Meet your coach",
    title: "The person behind your programme.",
    body: "Share your story, the people you coach and what matters to you in your work.",
  },
  team: { eyebrow: "The people", title: "Meet the team." },
  split: {
    eyebrow: "Your approach",
    title: "Make space for what matters.",
    body: "Use this space to explain a part of your coaching approach in your own words.",
  },
  benefits: { eyebrow: "The details", title: "Coaching, with you in mind." },
  services: { eyebrow: "Work with me", title: "Find the right support." },
  process: { eyebrow: "Getting started", title: "A clear next step." },
  programmes: {
    eyebrow: "Your next chapter",
    title: "Explore coaching programmes.",
    body: "Find out what is included in each programme and choose the support that suits you.",
  },
  "programme-detail": {
    eyebrow: "The programme",
    title: "A closer look at your coaching.",
  },
  pricing: { eyebrow: "Memberships", title: "Choose your coaching." },
  booking: {
    eyebrow: "Let's talk",
    title: "Start with a conversation.",
    body: "Tell me what you are working towards and ask any questions about coaching.",
  },
  "call-to-action": {
    title: "Ready to take the next step?",
    body: "Explore your options or get in touch to discuss what you need.",
  },
  gallery: { eyebrow: "In practice", title: "A look inside." },
  transformation: {
    eyebrow: "Real experiences",
    title: "Progress, in context.",
    body: "Every person's starting point and experience is different.",
  },
  testimonials: {
    eyebrow: "Client perspectives",
    title: "In their own words.",
  },
  logos: { eyebrow: "Connections", title: "Organisations I work with." },
  faq: { eyebrow: "Before you begin", title: "A few useful answers." },
  stats: { eyebrow: "At a glance", title: "The facts that matter." },
  schedule: { eyebrow: "Make time", title: "Training that fits your week." },
  video: { eyebrow: "Watch", title: "Get to know my approach." },
  contact: {
    eyebrow: "Get in touch",
    title: "What would you like to work on?",
    body: "Share your goals and questions using the form below.",
  },
  lead: {
    eyebrow: "Your next step",
    title: "Let's find your starting point.",
    body: "Tell me a little about yourself and what you want from coaching.",
  },
  divider: { title: "" },
  columns: { title: "Make this space your own." },
  credentials: {
    eyebrow: "Experience and education",
    title: "The work behind the coaching.",
  },
  social: { eyebrow: "Stay connected", title: "Find me elsewhere." },
  navigation: { eyebrow: "Explore", title: "Find your next step." },
  footer: { title: "Move forward, your way." },
  text: {
    eyebrow: "In depth",
    title: "Your coaching, in your words.",
    body: "Use this space for a longer explanation of your approach, a useful guide or a page policy.",
  },
  quote: {
    title: "Small steps. A clear direction.",
    body: "Add a personal statement that reflects the way you coach.",
  },
  image: { title: "" },
  resources: { eyebrow: "Keep learning", title: "Useful places to start." },
  comparison: {
    eyebrow: "Find your fit",
    title: "Different support for different needs.",
  },
  community: {
    eyebrow: "Together",
    title: "A place to keep showing up.",
    body: "Explain how your community works and what members can expect.",
  },
  nutrition: {
    eyebrow: "Everyday nourishment",
    title: "An approach that fits your life.",
    body: "Describe your nutrition coaching approach, qualifications and scope in your own words.",
  },
  "app-preview": {
    eyebrow: "Your coaching experience",
    title: "Your next step, close at hand.",
    body: "Discover how your programme and coaching support come together.",
  },
  announcement: {
    title: "A note from your coach.",
    body: "Add a timely update for your visitors.",
  },
};
function defaultItems(moduleId: SiteBuilderModuleId): SiteBuilderItem[] {
  switch (moduleId) {
    case "benefits":
      return items([
        [
          "Your starting point",
          "Share your experience, goals and the support you need.",
        ],
        ["Your everyday life", "Discuss your available time and equipment."],
        [
          "Your next step",
          "Choose the coaching option that makes sense for you.",
        ],
      ]);
    case "process":
      return items([
        ["Explore", "Read about my approach and coaching options."],
        ["Get in touch", "Ask questions and share what you are looking for."],
        [
          "Choose your next step",
          "Find out whether the available support is right for you.",
        ],
      ]);
    case "faq":
      return items([
        [
          "How do I find the right programme?",
          "Review the available coaching options, then contact me if you need help deciding.",
        ],
        [
          "Can I ask a question before joining?",
          "Yes. Use the contact page to tell me what you would like to know.",
        ],
      ]).map((item) => ({ ...item, question: item.title, answer: item.body }));
    // Evidence-based modules deliberately start empty. Neither templates nor
    // AI may manufacture testimonials, qualifications, statistics or prices.
    default:
      return [];
  }
}
export function createBuilderElement(
  type: SiteBuilderElement["type"],
  overrides: Partial<SiteBuilderElement> = {},
): SiteBuilderElement {
  return siteBuilderElementSchema.parse({
    id: createBuilderId("element"),
    type,
    text:
      type === "heading"
        ? "Your heading"
        : type === "text"
          ? "Write in your own words."
          : "",
    style: {},
    responsive: {},
    children: [],
    ...overrides,
  });
}
export function createModule(
  moduleId: SiteBuilderModuleId,
  variant?: string,
  overrides: Partial<SiteBuilderSection> = {},
  language: "en" | "ar" = "en",
): SiteBuilderSection {
  const module = getBuilderModule(moduleId);
  if (!module) throw new Error(`Unknown website module: ${moduleId}`);
  const selected = variant ?? module.variants[0].id;
  if (!module.variants.some((v) => v.id === selected))
    throw new Error(`Unknown ${moduleId} layout: ${selected}`);
  const content = siteBuilderContentSchema.parse({
    ...defaultCopy[moduleId],
    items: defaultItems(moduleId),
  });
  if (["hero", "programmes", "call-to-action", "services"].includes(moduleId))
    content.actions = [action("Explore programmes", "programmes")];
  if (["hero", "booking", "lead", "call-to-action"].includes(moduleId))
    content.actions.push(action("Get in touch", "contact"));
  if (moduleId === "columns") {
    const count = selected === "three" ? 3 : 2;
    content.elements = Array.from({ length: count }, () =>
      createBuilderElement("columns", {
        style: { columns: 1 },
        children: [
          createBuilderElement("heading"),
          createBuilderElement("text"),
        ],
      }),
    );
  }
  const style: SiteBuilderStyle = {
    paddingTop: moduleId === "divider" ? 24 : 80,
    paddingBottom: moduleId === "divider" ? 24 : 80,
    width: "content",
    align: ["centered", "statement"].includes(selected) ? "center" : "left",
  };
  if (moduleId === "columns") style.columns = selected === "three" ? 3 : 2;
  if (language === "ar") {
    content.title = arabicModuleTitles[moduleId];
    content.eyebrow = "";
    content.body = arabicModuleBodies[moduleId] ?? "";
    content.actions = content.actions.map((a) => ({
      ...a,
      label: a.kind === "programmes" ? "اكتشف البرامج" : "تواصل معي",
    }));
    content.items = arabicDefaultItems(moduleId);
    if (moduleId === "columns")
      for (const element of content.elements)
        for (const child of element.children)
          child.text =
            child.type === "heading" ? "عنوانك هنا" : "اكتب بأسلوبك الخاص.";
    style.align = ["centered", "statement"].includes(selected)
      ? "center"
      : "right";
  }
  return siteBuilderSectionSchema.parse({
    id: createBuilderId("section"),
    moduleId,
    variant: selected,
    content,
    style,
    responsive: { mobile: { paddingTop: 48, paddingBottom: 48, columns: 1 } },
    ...overrides,
  });
}

const arabicModuleTitles: Record<SiteBuilderModuleId, string> = {
  hero: "تدريب يناسبك ويناسب حياتك.",
  intro: "يبدأ التدريب بفهم احتياجاتك.",
  about: "تعرّف على مدربك.",
  team: "تعرّف على الفريق.",
  split: "مساحة لما يهمك.",
  benefits: "تدريب يضعك في الحسبان.",
  services: "الدعم المناسب لك.",
  process: "خطوتك التالية واضحة.",
  programmes: "اكتشف برامج التدريب.",
  "programme-detail": "تعرّف على تفاصيل البرنامج.",
  pricing: "اختر عضويتك.",
  booking: "لنبدأ بمحادثة.",
  "call-to-action": "هل أنت مستعد للخطوة التالية؟",
  gallery: "نظرة من الداخل.",
  transformation: "التقدم في سياقه.",
  testimonials: "بكلماتهم.",
  logos: "جهات أعمل معها.",
  faq: "إجابات قد تفيدك.",
  stats: "حقائق مهمة.",
  schedule: "تدريب يناسب أسبوعك.",
  video: "تعرّف على أسلوبي.",
  contact: "ما الذي تريد العمل عليه؟",
  lead: "لنحدد نقطة البداية.",
  divider: "",
  columns: "صمّم هذه المساحة بطريقتك.",
  credentials: "الخبرة وراء التدريب.",
  social: "تابعني هنا.",
  navigation: "اكتشف خطوتك التالية.",
  footer: "تقدم بطريقتك.",
  text: "تدريبك بكلماتك.",
  quote: "خطوات صغيرة واتجاه واضح.",
  image: "",
  resources: "موارد مفيدة للبداية.",
  comparison: "دعم مختلف لاحتياجات مختلفة.",
  community: "مساحة للاستمرار.",
  nutrition: "نهج يناسب حياتك.",
  "app-preview": "خطوتك التالية في متناولك.",
  announcement: "رسالة من مدربك.",
};
const arabicModuleBodies: Partial<Record<SiteBuilderModuleId, string>> = {
  hero: "اكتشف أسلوبي واختر برنامجاً يناسب أهدافك وحياتك اليومية.",
  intro: "أهدافك وخبرتك والوقت المتاح لك هي نقطة البداية.",
  programmes: "تعرّف على ما يتضمنه كل برنامج واختر الدعم الذي يناسبك.",
  booking: "أخبرني بما تسعى إليه واطرح أسئلتك عن التدريب.",
  "call-to-action": "اكتشف الخيارات المتاحة أو تواصل معي لمناقشة احتياجاتك.",
  transformation: "تختلف نقطة البداية والتجربة من شخص إلى آخر.",
  contact: "شارك أهدافك وأسئلتك باستخدام النموذج أدناه.",
  lead: "أخبرني قليلاً عنك وعما تريده من التدريب.",
};
function arabicDefaultItems(moduleId: SiteBuilderModuleId): SiteBuilderItem[] {
  if (moduleId === "benefits")
    return items([
      ["نقطة البداية", "شارك خبرتك وأهدافك والدعم الذي تحتاجه."],
      ["حياتك اليومية", "ناقش الوقت والمعدات المتاحة لك."],
      ["خطوتك التالية", "اختر الدعم الذي يناسب احتياجاتك."],
    ]);
  if (moduleId === "process")
    return items([
      ["اكتشف", "تعرّف على أسلوبي وخيارات التدريب."],
      ["تواصل", "اطرح أسئلتك وشارك ما تبحث عنه."],
      ["اختر خطوتك التالية", "حدّد ما إذا كان الدعم المتاح مناسباً لك."],
    ]);
  if (moduleId === "faq")
    return items([
      [
        "كيف أختار البرنامج المناسب؟",
        "راجع خيارات التدريب المتاحة وتواصل معي إذا احتجت للمساعدة.",
      ],
      [
        "هل يمكنني طرح سؤال قبل الاشتراك؟",
        "نعم. استخدم صفحة التواصل وأخبرني بما تريد معرفته.",
      ],
    ]).map((item) => ({ ...item, question: item.title, answer: item.body }));
  return [];
}

// Page slugs are resolved beneath a verified coach route. Names such as
// "admin" and "login" are valid legacy content there; host routing is
// responsible for separating those pages from application endpoints.
export function builderElements(
  section: SiteBuilderSection,
): SiteBuilderElement[] {
  const all: SiteBuilderElement[] = [];
  const visit = (elements: SiteBuilderElement[]) => {
    for (const element of elements) {
      all.push(element);
      visit(element.children);
    }
  };
  visit(section.content.elements);
  return all;
}
function sectionActions(section: SiteBuilderSection): SiteBuilderAction[] {
  return [
    ...section.content.actions,
    ...section.content.items.flatMap((item) =>
      item.action ? [item.action] : [],
    ),
    ...builderElements(section).flatMap((element) =>
      element.action ? [element.action] : [],
    ),
  ];
}
function everyAction(doc: SiteBuilderDocument): SiteBuilderAction[] {
  return [
    ...(doc.header.action ? [doc.header.action] : []),
    ...(doc.footer.action ? [doc.footer.action] : []),
    ...doc.pages.flatMap((page) => page.sections.flatMap(sectionActions)),
    ...doc.savedSections.flatMap((saved) => sectionActions(saved.section)),
  ];
}
function documentIssues(doc: SiteBuilderDocument, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  const pages = new Map(doc.pages.map((page) => [page.id, page]));
  if (pages.size !== doc.pages.length)
    issue(["pages"], "Page identifiers must be unique");
  if (new Set(doc.pages.map((page) => page.slug)).size !== doc.pages.length)
    issue(["pages"], "Page addresses must be unique");
  if (doc.pages.filter((page) => page.slug === "").length !== 1)
    issue(["pages"], "Keep exactly one home page");
  const sections = doc.pages.flatMap((page) => page.sections);
  if (sections.length > SITE_BUILDER_LIMITS.sections)
    issue(
      ["pages"],
      `Use at most ${SITE_BUILDER_LIMITS.sections} sections across the website`,
    );
  if (new Set(sections.map((section) => section.id)).size !== sections.length)
    issue(["pages"], "Section identifiers must be unique across pages");
  if (
    new Set(doc.savedSections.map((saved) => saved.id)).size !==
    doc.savedSections.length
  )
    issue(["savedSections"], "Saved section identifiers must be unique");
  doc.pages.forEach((page, index) => {
    if (!page.title.trim())
      issue(["pages", index, "title"], "Give this page a title");
    if (page.parentId) {
      const parent = pages.get(page.parentId);
      if (
        !parent ||
        parent.id === page.id ||
        parent.parentId ||
        page.slug === ""
      )
        issue(
          ["pages", index, "parentId"],
          "Choose another top-level page as this page's menu parent",
        );
    }
  });
  for (const [index, section] of [
    ...sections,
    ...doc.savedSections.map((saved) => saved.section),
  ].entries()) {
    const path = ["sections", index];
    if (
      !getBuilderModule(section.moduleId)?.variants.some(
        (variant) => variant.id === section.variant,
      )
    )
      issue([...path, "variant"], "Choose a known layout for this module");
    if (
      new Set(section.content.items.map((item) => item.id)).size !==
      section.content.items.length
    )
      issue(
        [...path, "content", "items"],
        "Item identifiers must be unique within a section",
      );
    if (
      new Set(section.content.productIds).size !==
      section.content.productIds.length
    )
      issue([...path, "content", "productIds"], "Choose each offer only once");
    const elements = builderElements(section);
    if (elements.length > SITE_BUILDER_LIMITS.elementsPerSection)
      issue(
        [...path, "content", "elements"],
        `Use at most ${SITE_BUILDER_LIMITS.elementsPerSection} elements in one section`,
      );
    if (new Set(elements.map((element) => element.id)).size !== elements.length)
      issue(
        [...path, "content", "elements"],
        "Element identifiers must be unique within a section",
      );
    for (const element of elements)
      if (element.type !== "columns" && element.children.length)
        issue(
          [...path, "content", "elements"],
          "Only a columns element may contain other elements",
        );
  }
  for (const action of everyAction(doc))
    if (action.kind === "page" && action.pageId && !pages.has(action.pageId))
      issue(["pages"], "A button refers to a page that no longer exists");
  const redirects = new Set<string>();
  for (const [index, redirect] of doc.redirects.entries()) {
    if (!redirect.from || doc.pages.some((page) => page.slug === redirect.from))
      issue(
        ["redirects", index, "from"],
        "Redirect only an unused page address",
      );
    if (redirects.has(redirect.from))
      issue(["redirects", index, "from"], "Redirect addresses must be unique");
    redirects.add(redirect.from);
    if (!pages.has(redirect.toPageId))
      issue(
        ["redirects", index, "toPageId"],
        "The redirect's destination page no longer exists",
      );
  }
}
export const siteBuilderSchema = documentSchema.superRefine(documentIssues);
export const siteBuilderDocumentSchema = siteBuilderSchema;

export function isBuilderGloballyHidden(value: {
  responsive: SiteBuilderResponsive;
}): boolean {
  return (
    value.responsive.desktop?.hidden === true &&
    value.responsive.tablet?.hidden === true &&
    value.responsive.mobile?.hidden === true
  );
}
export type SiteBuilderPublishIssue = {
  code: string;
  message: string;
  pageId?: string;
  sectionId?: string;
};
export function getBuilderPublishIssues(
  input: SiteBuilderDocument,
): SiteBuilderPublishIssue[] {
  const parsed = siteBuilderSchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => ({
      code: "INVALID_DOCUMENT",
      message: issue.message,
    }));
  const doc = parsed.data,
    issues: SiteBuilderPublishIssue[] = [];
  const home = doc.pages.find((page) => page.slug === "");
  if (!home?.visible)
    issues.push({
      code: "HOME_HIDDEN",
      message: "Make the home page visible before publishing",
      pageId: home?.id,
    });
  if (
    home?.visible &&
    !home.sections.some((section) => !isBuilderGloballyHidden(section))
  )
    issues.push({
      code: "EMPTY_HOME",
      message: "Add a visible section to the home page before publishing",
      pageId: home.id,
    });
  const visible = new Set(
    doc.pages.filter((page) => page.visible).map((page) => page.id),
  );
  const check = (
    action: SiteBuilderAction,
    pageId?: string,
    sectionId?: string,
  ) => {
    if (action.kind === "page" && action.pageId && !visible.has(action.pageId))
      issues.push({
        code: "HIDDEN_PAGE_LINK",
        message: `The “${action.label}” button links to a hidden page`,
        pageId,
        sectionId,
      });
  };
  if (doc.header.action) check(doc.header.action);
  if (doc.footer.action) check(doc.footer.action);
  for (const page of doc.pages.filter((page) => page.visible)) {
    for (const section of page.sections.filter(
      (section) => !isBuilderGloballyHidden(section),
    )) {
      section.content.actions.forEach((action) =>
        check(action, page.id, section.id),
      );
      section.content.items.forEach((item) => {
        if (item.action) check(item.action, page.id, section.id);
      });
      const visit = (elements: SiteBuilderElement[]) => {
        for (const element of elements) {
          if (isBuilderGloballyHidden(element)) continue;
          if (element.action) check(element.action, page.id, section.id);
          visit(element.children);
        }
      };
      visit(section.content.elements);
    }
  }
  return issues;
}

/** No hidden pages, reusable draft sections or globally hidden children escape. */
export function projectPublishedBuilder(
  input: SiteBuilderDocument,
): SiteBuilderDocument {
  const doc = structuredClone(siteBuilderSchema.parse(input));
  doc.savedSections = [];
  doc.pages = doc.pages.filter((page) => page.visible);
  const visible = new Set(doc.pages.map((page) => page.id));
  const safeAction = (action?: SiteBuilderAction) =>
    action?.kind === "page" && action.pageId && !visible.has(action.pageId)
      ? undefined
      : action;
  const visibleElements = (
    elements: SiteBuilderElement[],
  ): SiteBuilderElement[] =>
    elements
      .filter((element) => !isBuilderGloballyHidden(element))
      .map((element) => ({
        ...element,
        action: safeAction(element.action),
        children: visibleElements(element.children),
      }));
  for (const page of doc.pages) {
    if (page.parentId && !visible.has(page.parentId)) delete page.parentId;
    page.sections = page.sections
      .filter((section) => !isBuilderGloballyHidden(section))
      .map((section) => ({
        ...section,
        content: {
          ...section.content,
          actions: section.content.actions.flatMap((action) =>
            safeAction(action) ? [action] : [],
          ),
          items: section.content.items.map((item) => ({
            ...item,
            action: safeAction(item.action),
          })),
          elements: visibleElements(section.content.elements),
        },
      }));
  }
  doc.header.action = safeAction(doc.header.action);
  doc.footer.action = safeAction(doc.footer.action);
  doc.redirects = doc.redirects.filter((redirect) =>
    visible.has(redirect.toPageId),
  );
  return doc;
}
export function builderMediaReferences(doc: SiteBuilderDocument): string[] {
  const refs = new Set<string>();
  const add = (value?: string) => {
    if (value && /^\/api\/v1\/media\/[0-9a-f-]{36}$/i.test(value))
      refs.add(value);
  };
  for (const page of doc.pages) add(page.socialImage);
  for (const section of [
    ...doc.pages.flatMap((page) => page.sections),
    ...doc.savedSections.map((saved) => saved.section),
  ]) {
    add(section.content.image);
    add(section.content.poster);
    for (const item of section.content.items) {
      add(item.image);
      add(item.beforeImage);
      add(item.afterImage);
    }
    for (const element of builderElements(section)) add(element.image);
  }
  return [...refs];
}
export function referencedMediaIds(doc: SiteBuilderDocument): string[] {
  return builderMediaReferences(doc).map((url) =>
    url.slice("/api/v1/media/".length),
  );
}
export const builderMediaIds = referencedMediaIds;
export function builderContentText(input: SiteBuilderDocument): string {
  const doc = projectPublishedBuilder(input),
    strings: string[] = [doc.footer.text];
  if (doc.header.action) strings.push(doc.header.action.label);
  if (doc.footer.action) strings.push(doc.footer.action.label);
  for (const page of doc.pages) {
    strings.push(page.title, page.seoTitle, page.seoDescription);
    for (const section of page.sections) {
      const content = section.content;
      strings.push(
        content.eyebrow,
        content.title,
        content.body,
        content.caption,
        content.imageAlt,
      );
      for (const item of content.items)
        for (const field of [
          "title",
          "body",
          "eyebrow",
          "caption",
          "value",
          "author",
          "role",
          "quote",
          "question",
          "answer",
          "imageAlt",
        ] as const)
          if (item[field]) strings.push(item[field]!);
      for (const element of builderElements(section)) {
        if (element.text) strings.push(element.text);
        if (element.imageAlt) strings.push(element.imageAlt);
      }
      strings.push(...sectionActions(section).map((action) => action.label));
    }
  }
  return strings.filter(Boolean).join("\n\n");
}
export function findBuilderPage(
  doc: SiteBuilderDocument,
  slug: string,
  includeHidden = false,
): SiteBuilderPage | undefined {
  return doc.pages.find(
    (page) =>
      page.slug === slug.replace(/^\/+|\/+$/g, "") &&
      (includeHidden || page.visible),
  );
}
export function builderPagePath(
  page: Pick<SiteBuilderPage, "slug">,
  basePath = "",
): string {
  return `${basePath.replace(/\/$/, "")}/${page.slug}`;
}
export function findBuilderRedirect(
  doc: SiteBuilderDocument,
  slug: string,
): SiteBuilderPage | undefined {
  const redirect = doc.redirects.find(
    (redirect) => redirect.from === slug.replace(/^\/+|\/+$/g, ""),
  );
  return redirect
    ? doc.pages.find((page) => page.id === redirect.toPageId && page.visible)
    : undefined;
}
export function duplicateSection(
  section: SiteBuilderSection,
): SiteBuilderSection {
  const copy = structuredClone(section);
  copy.id = createBuilderId("section");
  copy.content.items.forEach((item) => {
    item.id = createBuilderId("item");
  });
  builderElements(copy).forEach((element) => {
    element.id = createBuilderId("element");
  });
  return copy;
}
export function duplicatePage(
  page: SiteBuilderPage,
  overrides: Partial<SiteBuilderPage> = {},
): SiteBuilderPage {
  return siteBuilderPageSchema.parse({
    ...structuredClone(page),
    id: createBuilderId("page"),
    slug: `${page.slug || "home"}`.slice(0, 55) + "-copy",
    title: `${page.title.slice(0, 93)} (copy)`,
    sections: page.sections.map(duplicateSection),
    ...overrides,
  });
}
export function renameBuilderPage(
  input: SiteBuilderDocument,
  pageId: string,
  slug: string,
): SiteBuilderDocument {
  const doc = structuredClone(input),
    page = doc.pages.find((page) => page.id === pageId);
  if (!page) throw new Error("Page not found");
  if (!page.slug && slug)
    throw new Error("The home page keeps the root address");
  if (page.slug === slug) return doc;
  const oldSlug = page.slug;
  page.slug = siteBuilderSlugSchema.parse(slug);
  doc.redirects = doc.redirects.filter(
    (redirect) => redirect.from !== slug && redirect.from !== oldSlug,
  );
  if (oldSlug) doc.redirects.push({ from: oldSlug, toPageId: pageId });
  return siteBuilderSchema.parse(doc);
}

export type SiteBuilderIdentity = {
  name?: string;
  headline?: string;
  bio?: string;
  category?: string;
  language?: "en" | "ar";
};
export type SiteBuilderTemplate = {
  id: string;
  label: string;
  description: string;
  theme: SiteBuilderTheme;
  pageCount: number;
};
const themed = (overrides: Partial<SiteBuilderTheme>): SiteBuilderTheme =>
  siteBuilderThemeSchema.parse(overrides);
export const SITE_BUILDER_TEMPLATES: SiteBuilderTemplate[] = [
  {
    id: "editorial",
    label: "Editorial",
    description:
      "Confident type, thoughtful stories and generous space for a personal coaching brand.",
    theme: themed({
      font: "serif",
      background: "#fcfbf8",
      text: "#242721",
      accent: "#536246",
      surface: "#eceee7",
      muted: "#61655c",
      border: "#daddd2",
      radius: 0,
      width: 1280,
    }),
    pageCount: 4,
  },
  {
    id: "strength",
    label: "Strength",
    description:
      "Direct headlines, dark surfaces and energetic colour for strength and performance coaching.",
    theme: themed({
      font: "display",
      background: "#151716",
      text: "#f6f8f1",
      accent: "#c2ef73",
      surface: "#242824",
      muted: "#bcc5b8",
      border: "#444e43",
      radius: 4,
      width: 1280,
    }),
    pageCount: 4,
  },
  {
    id: "minimal",
    label: "Minimal",
    description:
      "A restrained, clear website with compact offers and calm navigation.",
    theme: themed({
      font: "sans",
      background: "#ffffff",
      text: "#161c18",
      accent: "#244c46",
      surface: "#f2f5f1",
      muted: "#5b665e",
      border: "#dce3db",
      radius: 12,
      width: 1160,
    }),
    pageCount: 4,
  },
  {
    id: "warm",
    label: "Warm",
    description:
      "Soft colours, welcoming portraits and an approachable route into coaching.",
    theme: themed({
      font: "rounded",
      background: "#fffaf4",
      text: "#3c332c",
      accent: "#91523e",
      surface: "#f3e7da",
      muted: "#706258",
      border: "#decbbb",
      radius: 24,
      width: 1200,
    }),
    pageCount: 4,
  },
  {
    id: "performance",
    label: "Performance",
    description:
      "Structured grids, clear programme details and bold blue accents.",
    theme: themed({
      font: "sans",
      background: "#f7f9fc",
      text: "#111e35",
      accent: "#235cd4",
      surface: "#e8eef8",
      muted: "#56647b",
      border: "#d2ddeb",
      radius: 8,
      width: 1280,
    }),
    pageCount: 4,
  },
  {
    id: "blank",
    label: "Blank canvas",
    description: "One clean page, ready for your own selection of sections.",
    theme: themed({}),
    pageCount: 1,
  },
];
type Layout = [SiteBuilderModuleId, string];
const templateLayouts: Record<
  string,
  { home: Layout[]; about: Layout[]; programmes: Layout[]; contact: Layout[] }
> = {
  editorial: {
    home: [
      ["hero", "editorial"],
      ["intro", "statement"],
      ["split", "overlap"],
      ["programmes", "list"],
      ["process", "timeline"],
      ["call-to-action", "split"],
    ],
    about: [
      ["about", "editorial"],
      ["text", "article"],
      ["process", "stacked"],
    ],
    programmes: [
      ["intro", "editorial"],
      ["programmes", "featured"],
      ["faq", "columns"],
    ],
    contact: [
      ["contact", "split"],
      ["faq", "list"],
    ],
  },
  strength: {
    home: [
      ["hero", "cover"],
      ["intro", "statement"],
      ["benefits", "cards"],
      ["programmes", "cards"],
      ["process", "steps"],
      ["call-to-action", "band"],
    ],
    about: [
      ["about", "portrait"],
      ["intro", "statement"],
      ["process", "steps"],
    ],
    programmes: [
      ["hero", "centered"],
      ["pricing", "cards"],
      ["faq", "accordion"],
    ],
    contact: [
      ["contact", "cards"],
      ["booking", "centered"],
    ],
  },
  minimal: {
    home: [
      ["hero", "split"],
      ["benefits", "list"],
      ["programmes", "list"],
      ["about", "card"],
      ["faq", "accordion"],
      ["call-to-action", "centered"],
    ],
    about: [
      ["about", "portrait"],
      ["intro", "centered"],
      ["process", "steps"],
    ],
    programmes: [
      ["intro", "centered"],
      ["pricing", "minimal"],
      ["faq", "list"],
    ],
    contact: [["contact", "centered"]],
  },
  warm: {
    home: [
      ["hero", "split"],
      ["intro", "centered"],
      ["about", "portrait"],
      ["benefits", "icons"],
      ["programmes", "cards"],
      ["booking", "card"],
    ],
    about: [
      ["about", "card"],
      ["split", "image-right"],
      ["process", "timeline"],
    ],
    programmes: [
      ["intro", "centered"],
      ["programmes", "featured"],
      ["faq", "accordion"],
    ],
    contact: [
      ["contact", "split"],
      ["faq", "columns"],
    ],
  },
  performance: {
    home: [
      ["hero", "split"],
      ["benefits", "cards"],
      ["process", "steps"],
      ["programmes", "featured"],
      ["app-preview", "steps"],
      ["call-to-action", "band"],
    ],
    about: [
      ["about", "portrait"],
      ["intro", "editorial"],
      ["process", "stacked"],
    ],
    programmes: [
      ["intro", "statement"],
      ["pricing", "comparison"],
      ["faq", "columns"],
    ],
    contact: [
      ["contact", "cards"],
      ["booking", "split"],
    ],
  },
};
export function createBuilderPage(
  title: string,
  slug: string,
  sections: SiteBuilderSection[] = [],
): SiteBuilderPage {
  return siteBuilderPageSchema.parse({
    id: createBuilderId("page"),
    slug,
    title,
    sections,
  });
}
export function createTemplate(
  templateId: string,
  identity: SiteBuilderIdentity = {},
): SiteBuilderDocument {
  const template = SITE_BUILDER_TEMPLATES.find(
    (template) => template.id === templateId,
  );
  if (!template) throw new Error(`Unknown website template: ${templateId}`);
  const language = identity.language ?? "en",
    ar = language === "ar";
  const doc: SiteBuilderDocument = {
    version: 1,
    theme: { ...template.theme },
    header: {
      variant:
        templateId === "editorial"
          ? "centered"
          : templateId === "strength"
            ? "split"
            : "simple",
      sticky: true,
      showLogo: true,
      showTitle: true,
      action: action(ar ? "اكتشف البرامج" : "Explore programmes", "programmes"),
    },
    footer: {
      variant: templateId === "warm" ? "centered" : "columns",
      text: identity.name ?? "",
      showSocial: true,
    },
    pages: [],
    savedSections: [],
    redirects: [],
  };
  if (templateId === "blank") {
    doc.pages = [createBuilderPage(ar ? "الرئيسية" : "Home", "", [])];
    return siteBuilderSchema.parse(doc);
  }
  const layouts = templateLayouts[templateId];
  const build = (layout: Layout[]) =>
    layout.map(([moduleId, variant]) => {
      const section = createModule(moduleId, variant, {}, language);
      if (moduleId === "about") {
        section.content.title = identity.name
          ? ar
            ? `تعرّف على ${identity.name}`
            : `Meet ${identity.name}`
          : section.content.title;
        section.content.body = identity.bio ?? "";
      }
      // Templates supply layout and neutral prompts, never invented biography.
      if (["text", "split", "app-preview"].includes(moduleId))
        section.content.body = "";
      return section;
    });
  doc.pages = [
    createBuilderPage(ar ? "الرئيسية" : "Home", "", build(layouts.home)),
    createBuilderPage(
      ar ? "عن المدرب" : "About",
      "about",
      build(layouts.about),
    ),
    createBuilderPage(
      ar ? "البرامج" : "Programmes",
      "programmes",
      build(layouts.programmes),
    ),
    createBuilderPage(
      ar ? "تواصل" : "Contact",
      "contact",
      build(layouts.contact),
    ),
  ];
  const hero = doc.pages[0].sections.find(
    (section) => section.moduleId === "hero",
  )!;
  if (identity.headline) hero.content.title = identity.headline;
  if (identity.bio) hero.content.body = identity.bio.slice(0, 2000);
  if (identity.category) hero.content.eyebrow = identity.category;
  doc.pages[0].seoTitle = (identity.name ?? "").slice(0, 100);
  return siteBuilderSchema.parse(doc);
}

export type LegacyBuilderSite = {
  headline?: string;
  introduction?: string;
  about?: string;
  contactEmail?: string;
  whatsapp?: string;
  instagram?: string;
  youtube?: string;
  cta?: string;
  seoTitle?: string;
  seoDescription?: string;
  language?: "en" | "ar";
  pages?: { slug: string; title: string; body: string; visible?: boolean }[];
  builder?: SiteBuilderDocument;
};
export type LegacyBuilderTenant = {
  name?: string;
  theme?: {
    name?: string;
    bio?: string;
    headline?: string;
    accent?: string;
    category?: string;
    design?: {
      primary?: string;
      accent?: string;
      surface?: string;
      typography?: string;
      corners?: string;
      logoUrl?: string;
      photoUrl?: string;
      coverUrl?: string;
      coachBio?: string;
    };
  };
};
/** Existing root fields remain in site storage; all legacy page copy is carried into sections. */
export function legacyToBuilder(
  site: LegacyBuilderSite,
  tenant: LegacyBuilderTenant = {},
): SiteBuilderDocument {
  if (site.builder)
    return siteBuilderSchema.parse(structuredClone(site.builder));
  const brand = tenant.theme ?? {},
    design = brand.design ?? {},
    language = site.language ?? "en",
    ar = language === "ar";
  const doc = createTemplate("minimal", {
    name: tenant.name ?? brand.name,
    headline: site.headline || brand.headline,
    bio: site.introduction || brand.bio,
    category: brand.category,
    language,
  });
  const hero = createModule("hero", "split", {}, language);
  hero.content.title =
    site.headline ||
    brand.headline ||
    tenant.name ||
    brand.name ||
    hero.content.title;
  hero.content.body = site.introduction || brand.bio || "";
  hero.content.image = design.coverUrl || design.photoUrl || "";
  hero.content.imageAlt = tenant.name || brand.name || "";
  hero.content.actions = [
    action(site.cta || (ar ? "ابدأ التدريب" : "Start coaching"), "programmes"),
  ];
  const about = createModule("about", "portrait", {}, language);
  about.content.body = site.about || design.coachBio || brand.bio || "";
  about.content.image = design.photoUrl || "";
  about.content.imageAlt = tenant.name || brand.name || "";
  const contact = createModule("contact", "split", {}, language);
  // Contact details remain in the existing typed root fields and are rendered
  // as real contact controls; do not leak them into free-text AI review.
  contact.content.body = "";
  const social = createModule("social", "links", {}, language);
  for (const [title, href] of [
    ["Instagram", site.instagram],
    ["YouTube", site.youtube],
  ] as const)
    if (href && isSafeBuilderLink(href))
      social.content.items.push({
        id: createBuilderId("item"),
        title,
        body: "",
        href,
      });
  doc.pages = [
    createBuilderPage(ar ? "الرئيسية" : "Home", "", [
      hero,
      createModule("programmes", "cards", {}, language),
    ]),
    createBuilderPage(ar ? "عن المدرب" : "About", "about", [about]),
    createBuilderPage(ar ? "العضويات" : "Memberships", "memberships", [
      createModule("pricing", "cards", {}, language),
    ]),
    createBuilderPage(ar ? "الصور" : "Galleries", "galleries", [
      createModule("gallery", "grid", {}, language),
    ]),
    createBuilderPage(ar ? "تواصل" : "Contact", "contact", [
      contact,
      ...(social.content.items.length ? [social] : []),
    ]),
    ...(site.pages ?? []).map((page) => {
      const section = createModule("text", "article", {}, language);
      section.content.title = page.title;
      section.content.eyebrow = "";
      section.content.body = page.body;
      return {
        ...createBuilderPage(page.title, page.slug, [section]),
        visible: page.visible !== false,
        inNavigation: page.visible !== false,
      };
    }),
  ];
  doc.pages[0].seoTitle = site.seoTitle ?? "";
  doc.pages[0].seoDescription = site.seoDescription ?? "";
  const accent = design.primary || brand.accent;
  if (accent && brandColorSchema.safeParse(accent).success)
    doc.theme.accent = accent;
  if (design.surface && brandColorSchema.safeParse(design.surface).success)
    doc.theme.surface = design.surface;
  if (design.typography === "editorial") doc.theme.font = "serif";
  else if (design.typography === "geometric") doc.theme.font = "display";
  else if (design.typography === "humanist") doc.theme.font = "rounded";
  if (design.corners === "square") doc.theme.radius = 0;
  else if (design.corners === "round") doc.theme.radius = 24;
  return siteBuilderSchema.parse(doc);
}
