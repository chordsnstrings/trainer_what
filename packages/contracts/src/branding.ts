import { z } from "zod";

export const brandColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color, such as #244c46.");

/** Public display images only. No server fetch, credentials, signed URLs or local hosts. */
export function isPublicBrandImage(value: string): boolean {
  if (!value) return true;
  if (/^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      host.includes(".") &&
      !host.includes(":") &&
      !host.startsWith("[") &&
      !/^\d+(\.\d+){3}$/.test(host) &&
      !/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) &&
      !/[\u0000-\u0020\\]/.test(value)
    );
  } catch {
    return false;
  }
}

export const brandImageSchema = z
  .string()
  .trim()
  .max(1024)
  .refine(
    isPublicBrandImage,
    "Use a public HTTPS image URL without a password, query string or fragment.",
  );
export const brandSections = [
  "program",
  "nutrition",
  "progress",
  "coach",
] as const;
export const brandSectionSchema = z.enum(brandSections);
export type BrandSection = z.infer<typeof brandSectionSchema>;

export const brandDesignSchema = z
  .object({
    preset: z
      .enum(["nordic", "clay", "coastal", "mono", "custom"])
      .default("nordic"),
    primary: brandColorSchema.default("#244c46"),
    accent: brandColorSchema.default("#dfefb5"),
    surface: brandColorSchema.default("#f6f6f2"),
    typography: z
      .enum(["modern", "editorial", "geometric", "humanist"])
      .default("modern"),
    buttonStyle: z.enum(["filled", "outline"]).default("filled"),
    corners: z.enum(["square", "soft", "round"]).default("soft"),
    density: z.enum(["airy", "balanced", "compact"]).default("balanced"),
    logoUrl: brandImageSchema.default(""),
    photoUrl: brandImageSchema.default(""),
    coverUrl: brandImageSchema.default(""),
    tagline: z.string().trim().max(100).default(""),
    welcome: z.string().trim().max(320).default(""),
    programLabel: z.string().trim().min(2).max(40).default("Programme"),
    coachBio: z.string().trim().max(1000).default(""),
    dashboardFocus: brandSectionSchema.default("program"),
    sectionOrder: z
      .array(brandSectionSchema)
      .length(4)
      .default([...brandSections]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.sectionOrder).size !== brandSections.length)
      context.addIssue({
        code: "custom",
        path: ["sectionOrder"],
        message: "Include each home section exactly once.",
      });
    if (value.sectionOrder[0] !== value.dashboardFocus)
      context.addIssue({
        code: "custom",
        path: ["dashboardFocus"],
        message: "The highlighted section must be first in the home layout.",
      });
  });
export type BrandDesign = z.infer<typeof brandDesignSchema>;
export const defaultBrandDesign: BrandDesign = brandDesignSchema.parse({});

export const brandPresets = [
  {
    id: "nordic",
    name: "Nordic",
    detail: "Calm, natural and quietly confident.",
    primary: "#244c46",
    accent: "#dfefb5",
    surface: "#f6f6f2",
    typography: "modern",
    corners: "soft",
  },
  {
    id: "clay",
    name: "Clay",
    detail: "Warm earth tones, an editorial voice.",
    primary: "#733f32",
    accent: "#edceb3",
    surface: "#fbf5ef",
    typography: "editorial",
    corners: "soft",
  },
  {
    id: "coastal",
    name: "Coastal",
    detail: "Clear blue, fresh energy, clean lines.",
    primary: "#253d80",
    accent: "#cbd7ff",
    surface: "#f4f6fc",
    typography: "geometric",
    corners: "round",
  },
  {
    id: "mono",
    name: "Mono",
    detail: "Essential shapes. A stronger presence.",
    primary: "#202020",
    accent: "#deded7",
    surface: "#f7f7f4",
    typography: "humanist",
    corners: "square",
  },
] as const;

/** Old or malformed saved themes always render a safe default. */
export function resolveBrandDesign(theme: unknown): BrandDesign {
  const value =
    theme && typeof theme === "object"
      ? (theme as Record<string, unknown>)
      : {};
  const parsed = brandDesignSchema.safeParse(value.design);
  if (parsed.success) return parsed.data;
  const accent = brandColorSchema.safeParse(value.accent);
  return {
    ...defaultBrandDesign,
    sectionOrder: [...brandSections],
    ...(accent.success ? { primary: accent.data } : {}),
  };
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex: string): number {
  return rgb(hex)
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
export function brandContrast(a: string, b: string): number {
  if (
    !brandColorSchema.safeParse(a).success ||
    !brandColorSchema.safeParse(b).success
  )
    return 0;
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
function mix(a: string, b: string, amount: number): string {
  const first = rgb(a),
    second = rgb(b);
  return (
    "#" +
    first
      .map((v, i) =>
        Math.round(v * (1 - amount) + second[i] * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function textOn(color: string): string {
  return brandContrast("#000000", color) >= brandContrast("#ffffff", color)
    ? "#000000"
    : "#ffffff";
}
export const brandFontStacks = {
  modern: {
    body: "Arial, Helvetica, sans-serif",
    heading: "Arial, Helvetica, sans-serif",
  },
  editorial: {
    body: "Arial, Helvetica, sans-serif",
    heading: 'Georgia, "Times New Roman", serif',
  },
  geometric: {
    body: '"Trebuchet MS", Arial, sans-serif',
    heading: '"Trebuchet MS", Arial, sans-serif',
  },
  humanist: {
    body: "Verdana, Geneva, sans-serif",
    heading: "Verdana, Geneva, sans-serif",
  },
} as const;

/** Only fixed CSS properties and validated values cross this boundary. */
export function brandCssVariables(theme: unknown): Record<string, string> {
  const design = resolveBrandDesign(theme);
  let card = mix(
    design.surface,
    "#ffffff",
    luminance(design.surface) > 0.5 ? 0.7 : 0.06,
  );
  if (brandContrast(textOn(design.surface), card) < 4.5) card = design.surface;
  const ink =
    brandContrast("#202b2c", design.surface) >= 7 &&
    brandContrast("#202b2c", card) >= 7
      ? "#202b2c"
      : textOn(design.surface);
  const muted = mix(ink, design.surface, 0.24);
  const quiet =
    brandContrast(muted, design.surface) >= 4.5 &&
    brandContrast(muted, card) >= 4.5
      ? muted
      : ink;
  const tint = mix(design.surface, design.accent, 0.13);
  const link =
    brandContrast(design.primary, design.surface) >= 4.5 &&
    brandContrast(design.primary, card) >= 4.5
      ? design.primary
      : ink;
  return {
    "--paper": design.surface,
    "--white": card,
    "--ink": ink,
    "--muted": quiet,
    "--green": design.primary,
    "--mint": tint,
    "--lime": design.accent,
    "--sand": tint,
    "--blue": tint,
    "--line": mix(design.surface, ink, 0.2),
    "--radius": { square: "2px", soft: "12px", round: "22px" }[design.corners],
    "--brand-primary": design.primary,
    "--brand-on-primary": textOn(design.primary),
    "--brand-accent": design.accent,
    "--brand-on-accent": textOn(design.accent),
    "--brand-link": link,
    "--brand-tint": tint,
    "--brand-on-tint": textOn(tint),
    "--brand-font": brandFontStacks[design.typography].body,
    "--brand-heading-font": brandFontStacks[design.typography].heading,
    "--brand-button-radius": { square: "2px", soft: "8px", round: "999px" }[
      design.corners
    ],
    "--brand-space": { airy: "30px", balanced: "22px", compact: "16px" }[
      design.density
    ],
  };
}

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return [h, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v + m)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
/**
 * Raises `color`'s lightness (keeping its hue and saturation, so the brand
 * stays recognisable) until it reaches `ratio` on every background.
 */
function lift(color: string, backgrounds: string[], ratio: number): string {
  const [h, s, l] = hsl(color);
  for (let step = 0; step <= 100; step++) {
    const candidate = step
      ? fromHsl(h, s, Math.min(1, l + step / 100))
      : color;
    if (backgrounds.every((b) => brandContrast(candidate, b) >= ratio))
      return candidate;
  }
  return "#ffffff";
}
/** Mixes `color` toward `toward` until it reaches `ratio` on every background. */
function toward(
  color: string,
  target: string,
  backgrounds: string[],
  ratio: number,
): string {
  for (let step = 0; step <= 40; step++) {
    const candidate = mix(color, target, step / 40);
    if (backgrounds.every((b) => brandContrast(candidate, b) >= ratio))
      return candidate;
  }
  return target;
}

/**
 * Dark appearance of a trainer's brand, for the subscriber surfaces that
 * follow a member's Light, Dark or System choice (the member app, the coach
 * website and the coach's sign-in and joining pages; see
 * docs/features/dark-mode.md). Only validated six-digit colours come out.
 *
 * - `paper` and `card` are near-black surfaces with a trace of the primary.
 * - `primary` is the brand primary made lighter (same hue and saturation)
 *   until it reads 4.5:1 on paper, card and tint: filled buttons, meters,
 *   the featured tile, and text wherever shared styles colour text with
 *   it; `onPrimary` is black or white, whichever reads better (at least
 *   4.5:1). `link` (text links, outline buttons, the current tab) is the
 *   same colour.
 * - `muted` text and `link` reach 4.5:1 and `ink` 7:1 on paper, card and
 *   tint; field edges reach 3:1 on paper and card.
 * - `accent` keeps the coach's accent (avatar and chip backgrounds) with
 *   black or white text on it.
 * - `themeColor` is the browser and status bar colour (the top bar);
 *   `logoPlate` is the coach's own surface, the one their logo was
 *   designed on, shown behind it so a dark logo on a transparent
 *   background stays visible.
 */
export type BrandDarkPalette = {
  paper: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  fieldBorder: string;
  primary: string;
  onPrimary: string;
  link: string;
  accent: string;
  onAccent: string;
  tint: string;
  onTint: string;
  themeColor: string;
  logoPlate: string;
};
/** Status colours on dark surfaces (the platform's dark set). */
export const DARK_STATUS_COLORS = {
  success: "#7fcb9f",
  warning: "#e0b25c",
  error: "#f08a80",
} as const;
export function brandDarkPalette(theme: unknown): BrandDarkPalette {
  const design = resolveBrandDesign(theme);
  const base = "#121413";
  // A trace of the primary, never enough to lift the surface (a saturated
  // green would otherwise lighten it past the status colours' contrast).
  let paper = mix(base, design.primary, 0.1);
  if (luminance(paper) > 0.012) paper = mix(base, design.primary, 0.04);
  if (luminance(paper) > 0.012) paper = base;
  const card = mix(paper, "#ffffff", 0.07);
  const ink =
    luminance(design.surface) > 0.6
      ? mix("#f4f5f1", design.surface, 0.5)
      : "#f4f5f1";
  const tint = mix(card, design.accent, 0.16);
  const surfaces = [paper, card, tint];
  const onTint = brandContrast(ink, tint) >= 4.5 ? ink : textOn(tint);
  // Shared CSS also uses the primary as text (tabs, text buttons), so it
  // reaches 4.5:1 like the link colour.
  const primary = lift(design.primary, surfaces, 4.5);
  const accent = design.accent;
  return {
    paper,
    card,
    ink: toward(ink, "#ffffff", surfaces, 7),
    muted: toward(mix(ink, paper, 0.34), ink, surfaces, 4.5),
    line: mix(paper, ink, 0.16),
    fieldBorder: toward(mix(paper, ink, 0.35), ink, [paper, card], 3),
    primary,
    onPrimary: textOn(primary),
    link: primary,
    accent,
    onAccent: textOn(accent),
    tint,
    onTint,
    themeColor: card,
    logoPlate: design.surface,
  };
}
/**
 * The dark palette as `--dark-*` custom properties, set inline beside
 * brandCssVariables. app/appearance.css maps them onto the ordinary tokens
 * (`--paper`, `--ink`, `--brand-link`, …) only while the surface is dark.
 */
export function brandDarkCssVariables(theme: unknown): Record<string, string> {
  const p = brandDarkPalette(theme);
  return {
    "--dark-paper": p.paper,
    "--dark-white": p.card,
    "--dark-ink": p.ink,
    "--dark-muted": p.muted,
    "--dark-line": p.line,
    "--dark-field-border": p.fieldBorder,
    "--dark-primary": p.primary,
    "--dark-on-primary": p.onPrimary,
    "--dark-link": p.link,
    "--dark-accent": p.accent,
    "--dark-on-accent": p.onAccent,
    "--dark-tint": p.tint,
    "--dark-on-tint": p.onTint,
    "--dark-logo-plate": p.logoPlate,
  };
}
