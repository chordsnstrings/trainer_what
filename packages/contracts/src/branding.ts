import { z } from "zod";

export const brandColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color, such as #244c46.");

/** Public display images only. No server fetch, credentials, signed URLs or local hosts. */
export function isPublicBrandImage(value: string): boolean {
  if (!value) return true;
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
    programLabel: z.string().trim().min(2).max(40).default("My program"),
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
