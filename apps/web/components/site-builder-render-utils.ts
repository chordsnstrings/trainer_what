import {
  isSafeBuilderLink,
  brandContrast,
  type SiteBuilderAction,
  type SiteBuilderDocument,
  type SiteBuilderResponsive,
  type SiteBuilderStyle,
} from "@trainer/contracts";
import type { CSSProperties } from "react";

export type BuilderProduct = {
  id: string;
  data: {
    name?: string;
    description?: string;
    priceMinor?: number;
    tier?: string;
    billing?: string;
    programmeDays?: number;
    premiumVoice?: boolean;
    voiceIncluded?: boolean;
    voiceAddOnMinor?: number;
    trialDays?: number;
  };
};
export type BuilderGallery = {
  id: string;
  title?: string;
  description?: string;
  photos?: Array<{
    media_id?: string;
    url: string;
    alt?: string;
    caption?: string;
  }>;
};
export type BuilderInquiry = {
  name: string;
  email: string;
  message: string;
  consent: true;
  website: string;
};
/** Only public, tenant-scoped projections belong here, never a workspace row. */
export type BuilderContext = {
  name: string;
  basePath: string;
  joinPath: string;
  tenantSlug?: string;
  language?: "en" | "ar";
  logoUrl?: string;
  photoUrl?: string;
  contactEmail?: string;
  whatsapp?: string;
  instagram?: string;
  youtube?: string;
  products?: BuilderProduct[];
  galleries?: BuilderGallery[];
  /** Explicitly selected galleries beyond the first public page. */
  boundGalleries?: BuilderGallery[];
  preview?: boolean;
  onInquiry?: (inquiry: BuilderInquiry) => Promise<void>;
  onNavigate?: (slug: string) => void;
};

export function builderPagePath(basePath: string, slug: string): string {
  const base = /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(basePath)
    ? basePath.replace(/\/$/, "")
    : "";
  const safeSlug = /^[a-z][a-z0-9-]{0,59}$/.test(slug) ? slug : "";
  return `${base}${safeSlug ? `/${safeSlug}` : ""}` || "/";
}

/** Do not turn an invalid/missing destination into an apparently working CTA. */
export function resolveBuilderActionHref(
  action: SiteBuilderAction,
  builder: SiteBuilderDocument | undefined,
  context: BuilderContext,
): string | null {
  const pages = (builder?.pages ?? []).filter(
    (page) => page.visible || context.preview,
  );
  if (action.kind === "url" || action.kind === "anchor")
    return action.href && isSafeBuilderLink(action.href) ? action.href : null;
  if (action.kind === "page") {
    const page = pages.find((candidate) => candidate.id === action.pageId);
    return page ? builderPagePath(context.basePath, page.slug) : null;
  }
  if (action.kind === "contact" || action.kind === "programmes") {
    const families =
      action.kind === "contact"
        ? ["contact", "lead"]
        : ["pricing", "programmes", "programme-detail"];
    const page = pages.find((candidate) =>
      candidate.sections.some((section) => families.includes(section.moduleId)),
    );
    if (page) {
      const section = page.sections.find((candidate) =>
        families.includes(candidate.moduleId),
      )!;
      return `${builderPagePath(context.basePath, page.slug)}#${section.id}`;
    }
    if (action.kind === "contact") {
      return context.contactEmail &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.contactEmail)
        ? `mailto:${context.contactEmail}`
        : null;
    }
  }
  // Booking and choosing a coaching plan happen inside the member app, after
  // joining. Do not invent a public checkout or carry an unsupported plan ID.
  return isSafeBuilderLink(context.joinPath) ? context.joinPath : null;
}

export function safeBuilderImage(
  value: string | undefined,
): string | undefined {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return undefined;
  if (/^\/api\/v1\/media\/[a-zA-Z0-9_-]+$/.test(value)) return value;
  if (
    /^\/(?!\/)[a-zA-Z0-9/_-]+\.(?:png|jpe?g|webp|avif|gif)(?:\?[a-zA-Z0-9=&_-]+)?$/i.test(
      value,
    )
  )
    return value;
  return isSafeBuilderLink(value) && value.startsWith("https:")
    ? value
    : undefined;
}

export function builderContrastText(color: string): string {
  return brandContrast("#ffffff", color) > brandContrast("#171917", color)
    ? "#ffffff"
    : "#171917";
}

type CustomProperties = CSSProperties & Record<`--${string}`, string | number>;
/** Bounded CSS variables only. No authored CSS, URL interpolation or HTML. */
export function builderStyleVariables(
  style: SiteBuilderStyle = {},
  responsive: SiteBuilderResponsive = {},
): CSSProperties {
  const vars: CustomProperties = {};
  const add = (
    value: SiteBuilderStyle & { hidden?: boolean; reverse?: boolean },
    suffix = "",
  ) => {
    const colour = (key: string, candidate: string | undefined) => {
      if (candidate && /^#[a-fA-F0-9]{6}$/.test(candidate))
        vars[`--sb-${key}${suffix}`] = candidate;
    };
    const number = (
      key: string,
      candidate: number | undefined,
      min: number,
      max: number,
      unit = "px",
    ) => {
      if (typeof candidate === "number" && Number.isFinite(candidate))
        vars[`--sb-${key}${suffix}`] =
          `${Math.min(max, Math.max(min, candidate))}${unit}`;
    };
    colour("section-background", value.background);
    colour("section-color", value.color);
    colour("section-accent", value.accent);
    if (value.accent && /^#[a-fA-F0-9]{6}$/.test(value.accent))
      vars[`--sb-section-on-accent${suffix}`] = builderContrastText(
        value.accent,
      );
    if (
      value.background &&
      !value.color &&
      /^#[a-fA-F0-9]{6}$/.test(value.background)
    )
      vars[`--sb-section-color${suffix}`] = builderContrastText(
        value.background,
      );
    number("pt", value.paddingTop, 0, 240);
    number("pb", value.paddingBottom, 0, 240);
    number("gap", value.gap, 0, 100);
    number("section-radius", value.radius, 0, 64);
    number("min-height", value.minHeight, 0, 1000);
    number("title-size", value.fontSize, 12, 120);
    number("columns", value.columns, 1, 4, "");
    if (value.align) vars[`--sb-align${suffix}`] = value.align;
    if (value.width)
      vars[`--sb-section-width${suffix}`] =
        value.width === "full"
          ? "100%"
          : value.width === "wide"
            ? "1440px"
            : "var(--sb-width)";
    if (value.imagePosition)
      vars[`--sb-image-position${suffix}`] = value.imagePosition;
    if (value.imageFit) vars[`--sb-image-fit${suffix}`] = value.imageFit;
    if (value.hidden !== undefined)
      vars[`--sb-display${suffix}`] = value.hidden ? "none" : "block";
    if (value.reverse !== undefined) {
      vars[`--sb-reverse${suffix}`] = value.reverse ? "1" : "0";
      vars[`--sb-media-order${suffix}`] = value.reverse ? "-1" : "0";
      vars[`--sb-flex-direction${suffix}`] = value.reverse
        ? "row-reverse"
        : "row";
    }
  };
  add(style);
  if (responsive.desktop) add(responsive.desktop);
  if (responsive.tablet) add(responsive.tablet, "-tablet");
  if (responsive.mobile) add(responsive.mobile, "-mobile");
  return vars;
}
