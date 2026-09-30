import sharp from "sharp";
import {
  appInitials,
  brandContrast,
  type AppShortcut,
  type BrandDesign,
} from "@trainer/contracts";

/**
 * Install icons for the coach-branded member app and the coach website
 * (docs/features/discovery.md, docs/features/pwa.md). Every icon is an
 * opaque PNG at exactly the declared size.
 */

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

/**
 * Shortcut symbols on a 24-unit grid, from Lucide (ISC licence, the icon set
 * the web app already uses): dumbbell, utensils, message-circle and
 * calendar-check.
 */
const SHORTCUT_GLYPHS: Record<AppShortcut, string> = {
  workout:
    '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>',
  meal: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  chat: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  booking:
    '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="m9 15 2 2 4-4"/>',
};

/** White or black, whichever reads better on the brand colour. */
function inkOn(background: string) {
  return brandContrast("#ffffff", background) >=
    brandContrast("#000000", background)
    ? "#ffffff"
    : "#000000";
}

export const MASKABLE_LOGO_SCALE = 0.56;
export type AppIconVariant = "any" | "apple" | "maskable" | "shortcut";

/**
 * Render an exact-size PNG. A platform-hosted logo sits on the brand surface
 * colour (inside the maskable safe zone when needed); otherwise initials are
 * drawn on the brand primary colour. A shortcut icon draws its feature's
 * symbol on the primary colour, filling the maskable safe zone. Output is
 * always opaque.
 */
export async function renderAppIcon(options: {
  name: string;
  design: BrandDesign;
  size: number;
  variant: AppIconVariant;
  logo?: Buffer;
  shortcut?: AppShortcut;
}): Promise<Buffer> {
  const { name, design, size, variant, logo, shortcut } = options;
  if (variant === "shortcut" && shortcut) {
    const ink = inkOn(design.primary);
    // The symbol spans 48% of the side, inside the safe zone of radius 0.4.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><rect width="24" height="24" fill="${design.primary}"/><g transform="translate(6.24 6.24) scale(0.48)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SHORTCUT_GLYPHS[shortcut]}</g></svg>`;
    return sharp(Buffer.from(svg))
      .resize(size, size)
      .flatten({ background: design.primary })
      .png()
      .toBuffer();
  }
  if (logo) {
    try {
      // A maskable icon's safe zone is the centred circle of radius 0.4; a
      // square of side 0.56 fits inside it (half-diagonal 0.396).
      const inner = Math.round(
        size *
          (variant === "maskable"
            ? MASKABLE_LOGO_SCALE
            : variant === "apple"
              ? 0.8
              : 0.84),
      );
      const fitted = await sharp(logo)
        .resize(inner, inner, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      return await sharp({
        create: {
          width: size,
          height: size,
          channels: 3,
          background: design.surface,
        },
      })
        .composite([{ input: fitted, gravity: "centre" }])
        // The base is opaque, so dropping the alpha channel loses nothing;
        // home-screen surfaces treat an alpha channel inconsistently.
        .removeAlpha()
        .png()
        .toBuffer();
    } catch {
      // A damaged stored image falls back to initials rather than failing.
    }
  }
  const ink = inkOn(design.primary);
  const fontSize = variant === "maskable" ? 150 : 190;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" fill="${design.primary}"/><text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="${ink}">${escapeXml(appInitials(name))}</text></svg>`;
  return sharp(Buffer.from(svg))
    .resize(size, size)
    .flatten({ background: design.primary })
    .png()
    .toBuffer();
}
