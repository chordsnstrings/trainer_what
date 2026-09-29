// The trainsyou corporate identity (docs/features/brand.md): the supplied
// assets are present and referenced, the default platform name is the
// brand, the palette and contrast rules hold in light and dark, and a
// renamed platform or a trainer's own branding never shows the trainsyou
// artwork.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import {
  BRAND_ASSETS,
  BRAND_COLORS,
  BRAND_COPY,
  BRAND_NAME,
  BRAND_SHARE_IMAGE_ALT,
  DEFAULT_PLATFORM_NAME,
  PLATFORM_ICON_BASE,
  SUPERSEDED_PLATFORM_NAMES,
  llmsTxt,
  marketingJsonLd,
  marketingMetadata,
  marketingPage,
  platformIcons,
  platformManifest,
  platformName,
  usesBrandIdentity,
} from "@trainer/contracts";
import { INTEGRATION_CATALOG } from "../packages/providers/src/configuration.ts";
import { PlatformLogo } from "../apps/web/components/brand-logo.tsx";
import { PublicHeader } from "../apps/web/components/public-header.tsx";
import {
  MarketingFooter,
  MarketingHeader,
  claimCta,
} from "../apps/web/components/marketing/frame.tsx";
import { MarketingSite } from "../apps/web/components/marketing/site.tsx";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";

const web = (path: string) => new URL("../apps/web/" + path, import.meta.url);
const pub = (asset: string) => web("public" + asset);
const source = (path: string) => readFile(web(path), "utf8");
const ORIGIN = "https://trainsyou.com";

test("the default platform name is trainsyou and a configured APP_NAME still overrides it", () => {
  assert.equal(DEFAULT_PLATFORM_NAME, "trainsyou");
  const setting = INTEGRATION_CATALOG.find((d) => d.id === "application")!
    .fields.find((f) => f.key === "APP_NAME")!;
  assert.equal(setting.defaultValue, DEFAULT_PLATFORM_NAME);
  for (const name of ["trainsyou", "TrainsYou", " trainsyou.com ", "Trains You"])
    assert.ok(usesBrandIdentity(name), name);
  for (const name of ["Acme Coaching", "Trainer Brain", "", "trainsyoupro", null])
    assert.equal(usesBrandIdentity(name), false, String(name));
  assert.equal(platformManifest().name, "trainsyou");
  assert.equal(platformManifest("Acme Coaching").name, "Acme Coaching");
});

test("the shown platform name is trainsyou for a blank, the old default or any brand spelling", () => {
  for (const name of [undefined, null, "", "  ", "Trainer Brain", " Trainer Brain "])
    assert.equal(platformName(name), BRAND_NAME, String(name));
  // A spelling that shows the trainsyou identity is written the brand's way
  // (one lowercase word) in titles, alt text, JSON-LD and emails.
  for (const name of ["TrainsYou", "Trains You", "trains-you", " trainsyou.com "])
    assert.equal(platformName(name), BRAND_NAME, name);
  for (const name of ["Acme Coaching", "Trainer Brain Pro", "trainer brain"])
    assert.equal(platformName(name), name.trim(), name);
  // The settings field treats the same old default as unset.
  const setting = INTEGRATION_CATALOG.find((d) => d.id === "application")!
    .fields.find((f) => f.key === "APP_NAME")!;
  assert.deepEqual(setting.supersededValues, [...SUPERSEDED_PLATFORM_NAMES]);
});

test("every supplied logo, icon and share image is in apps/web/public/brand at its real size", async () => {
  for (const asset of Object.values(BRAND_ASSETS)) {
    assert.ok(asset.startsWith("/brand/"), asset);
    assert.ok((await stat(pub(asset))).size > 0, asset);
  }
  const png = async (asset: string, width: number, height: number, opaque: boolean) => {
    const meta = await sharp(await readFile(pub(asset))).metadata();
    assert.equal(meta.format, "png", asset);
    assert.equal(meta.width, width, asset);
    assert.equal(meta.height, height, asset);
    // Home-screen icons that crop or fill need an opaque image.
    if (opaque) assert.equal(meta.hasAlpha, false, asset);
  };
  await png(BRAND_ASSETS.icon192, 192, 192, true);
  await png(BRAND_ASSETS.icon512, 512, 512, true);
  await png(BRAND_ASSETS.appleTouchIcon, 180, 180, true);
  await png(BRAND_ASSETS.shareImage, 1200, 630, true);
  await png(BRAND_ASSETS.lockupInkPng, 2400, 608, false);
  // The SVG logos are the supplied outlined artwork: ink for light surfaces,
  // white for dark ones, never retyped.
  for (const [asset, fill] of [
    [BRAND_ASSETS.lockupInk, "#171917"],
    [BRAND_ASSETS.wordmarkInk, "#171917"],
    [BRAND_ASSETS.symbolInk, "#171917"],
    [BRAND_ASSETS.lockupWhite, "#FFFFFF"],
    [BRAND_ASSETS.wordmarkWhite, "#FFFFFF"],
    [BRAND_ASSETS.symbolWhite, "#FFFFFF"],
  ]) {
    const svg = await readFile(pub(asset), "utf8");
    assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/, asset);
    assert.ok(svg.includes(`fill="${fill}"`), asset);
    assert.doesNotMatch(svg, /<text|<script|href=/i, asset);
  }
  const ico = await readFile(pub(BRAND_ASSETS.faviconIco));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], "favicon.ico header");
});

test("the platform manifest, favicons and install icons use the trainsyou icons", async () => {
  const manifest = platformManifest();
  assert.equal(manifest.description, BRAND_COPY.descriptor);
  assert.equal(manifest.theme_color, BRAND_COLORS.ink);
  assert.equal(manifest.background_color, BRAND_COLORS.paper);
  assert.deepEqual(
    manifest.icons.map((i) => [i.src, i.sizes, i.purpose]),
    [
      [BRAND_ASSETS.icon192, "192x192", "any"],
      [BRAND_ASSETS.icon512, "512x512", "any"],
      [BRAND_ASSETS.icon512, "512x512", "maskable"],
    ],
  );
  const icons = platformIcons();
  assert.equal(icons.favicon, BRAND_ASSETS.faviconIco);
  assert.equal(icons.faviconSvg, BRAND_ASSETS.faviconSvg);
  assert.equal(icons.apple180, BRAND_ASSETS.appleTouchIcon);
  // Another name keeps the generated initials icons.
  const other = platformIcons("Acme Coaching");
  for (const src of [other.icon192, other.icon512, other.maskable512, other.apple180])
    assert.ok(src.startsWith(PLATFORM_ICON_BASE), src);
  assert.equal(other.faviconSvg, null);
  // The root layout and app/manifest.ts read them from the configured name.
  const layout = await source("app/layout.tsx");
  assert.match(layout, /const icons = platformIcons\(name\);/);
  assert.match(layout, /apple: \{ url: icons\.apple180/);
  assert.match(layout, /icons\.faviconSvg/);
  // Inter ships in the repository (OFL), so the build needs no network.
  assert.match(layout, /from "next\/font\/local"/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  for (const file of ["inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"]) {
    assert.match(layout, new RegExp(`src: "\\./fonts/${file.replace(/\./g, "\\.")}"`));
    const woff2 = await readFile(web("app/fonts/" + file));
    assert.equal(woff2.subarray(0, 4).toString("latin1"), "wOF2", file);
  }
  assert.match(await source("app/fonts/Inter-OFL.txt"), /SIL Open Font License, Version 1\.1/);
  assert.match(await source("app/manifest.ts"), /platformManifest\(name\)/);
  // The brand assets are static files, outside the routing proxy.
  assert.match(await source("proxy.ts"), /\|brand\/\)/);
});

test("marketing pages share the trainsyou card on the home page and a branded preview elsewhere", async () => {
  const ctx = { origin: ORIGIN, appName: "trainsyou" };
  const home = marketingMetadata(marketingPage("/")!, ctx);
  assert.equal(home.openGraph.images[0].url, ORIGIN + BRAND_ASSETS.shareImage);
  assert.equal(home.twitter.images[0], ORIGIN + BRAND_ASSETS.shareImage);
  assert.equal(home.openGraph.images[0].width, 1200);
  assert.equal(home.openGraph.images[0].height, 630);
  // The supplied card's alternative text describes the card's own words,
  // not the page's H1; generated cards keep the page's H1.
  assert.equal(
    BRAND_SHARE_IMAGE_ALT,
    "trainsyou: Your coaching. Beyond your hours. Teach your AI. Grow your coaching business.",
  );
  assert.equal(home.openGraph.images[0].alt, BRAND_SHARE_IMAGE_ALT);
  const pricing = marketingMetadata(marketingPage("/pricing")!, ctx);
  assert.equal(pricing.openGraph.images[0].url, ORIGIN + "/og?path=%2Fpricing");
  assert.equal(pricing.openGraph.images[0].alt, marketingPage("/pricing")!.h1);
  const renamed = marketingMetadata(marketingPage("/")!, { ...ctx, appName: "Acme" });
  assert.equal(renamed.openGraph.images[0].alt, marketingPage("/")!.h1);
  const og = await source("app/og/route.tsx");
  assert.match(og, /BRAND_ASSETS\.lockupInk/);
  assert.match(og, /BRAND_ASSETS\.symbolInk/);
  assert.match(og, /usesBrandIdentity\(platform\.name\)/);
  const graph = marketingJsonLd(marketingPage("/")!, ctx)["@graph"] as any[];
  const org = graph.find((n) => n["@type"] === "Organization");
  assert.equal(org.logo, ORIGIN + BRAND_ASSETS.lockupInkPng);
  assert.equal(org.slogan, BRAND_COPY.line);
  // A renamed platform gets neither the trainsyou logo nor its slogan.
  const acme = marketingJsonLd(marketingPage("/")!, { ...ctx, appName: "Acme" })["@graph"] as any[];
  const acmeOrg = acme.find((n) => n["@type"] === "Organization");
  assert.ok(acmeOrg.logo.endsWith(PLATFORM_ICON_BASE + "512.png"));
  assert.equal(acmeOrg.slogan, undefined);
});

test("the approved lines lead the home page, its description and llms.txt", () => {
  const home = marketingPage("/")!;
  // The home H1 says what happens; the brand line closes every page instead.
  assert.equal(home.h1, BRAND_COPY.homeHeadline);
  assert.equal(home.eyebrow, BRAND_COPY.audience.toUpperCase());
  assert.ok(home.intro.startsWith("Teach your own AI how you coach"));
  assert.ok(home.intro.includes("Build a paid coaching offering around your methods, your identity and your standards"));
  assert.ok(home.description.startsWith(BRAND_COPY.line));
  const llms = llmsTxt({ origin: ORIGIN, appName: "trainsyou" });
  assert.ok(llms.includes(`${BRAND_COPY.descriptor}. ${BRAND_COPY.audience}. ${BRAND_COPY.line}`));
  assert.ok(llms.includes(BRAND_COPY.introduction));
  assert.doesNotMatch(llmsTxt({ origin: "https://acme.example", appName: "Acme" }), /trainsyou/i);
  assert.deepEqual(claimCta(true), { label: "Teach your AI", href: "/signup" });
  assert.equal(claimCta(false).label, "Join early access");
});

test("the brand line is the closing heading on every marketing page; a renamed platform asks the call to action", () => {
  const platform = {
    name: "trainsyou",
    initials: "T",
    supportEmail: null,
    companyDetails: null,
    registrationOpen: false,
    coachAddressTemplate: ORIGIN + "/coach/{slug}",
    availability: {
      model: true,
      nutrition: false,
      voice: false,
      customDomains: false,
      payments: true,
      payouts: false,
      whoop: false,
      zepp: false,
      instagram: false,
    },
    followerModel: DEFAULT_FOLLOWER_MODEL,
  };
  const closing = (path: string, name = "trainsyou") => {
    const html = renderToStaticMarkup(
      createElement(MarketingSite, {
        page: marketingPage(path)!,
        platform: { ...platform, name },
        origin: ORIGIN,
      }),
    );
    const match = html.match(/<section class="mk-closing"[^>]*>([\s\S]*?)<\/section>/);
    assert.ok(match, path + " has a closing panel");
    return match[1];
  };
  for (const path of ["/", "/pricing"]) {
    const panel = closing(path);
    assert.match(panel, new RegExp(`<h2[^>]*>${BRAND_COPY.line.replace(/\./g, "\\.")}</h2>`), path);
    assert.match(panel, /Guided setup\. Nothing goes live until you publish\./);
    assert.doesNotMatch(panel, /class="eyebrow"/, "the closing panel has no eyebrow");
  }
  assert.match(closing("/"), /href="\/how-it-works"/);
  assert.match(closing("/pricing"), /href="\/follower-calculator"/);
  const acme = closing("/", "Acme Coaching");
  assert.match(acme, /<h2[^>]*>Ready to teach your AI\?<\/h2>/);
  assert.doesNotMatch(acme, /Beyond your hours/);
});

test("the header and footer show the lockup in ink and white, and a renamed platform shows its name", () => {
  const props = { appName: "trainsyou", initials: "T", cta: claimCta(true) };
  const header = renderToStaticMarkup(createElement(MarketingHeader, props));
  assert.match(header, /aria-label="trainsyou home"/);
  assert.ok(header.includes(`class="brand-logo-light" src="${BRAND_ASSETS.lockupInk}"`));
  assert.ok(header.includes(`class="brand-logo-dark" src="${BRAND_ASSETS.lockupWhite}"`));
  assert.match(header, />Teach your AI</);
  const footer = renderToStaticMarkup(createElement(MarketingFooter, props));
  assert.ok(footer.includes(BRAND_ASSETS.lockupInk) && footer.includes(BRAND_ASSETS.lockupWhite));
  assert.ok(footer.includes(BRAND_COPY.line));
  const acme = renderToStaticMarkup(createElement(PlatformLogo, { name: "Acme Coaching" }));
  assert.doesNotMatch(acme, /brand\//);
  assert.match(acme, />AC<\/span><span>Acme Coaching</);
});

test("sign-in and joining pages on a trainer's own address show the trainer, never the platform's logo or sign-up", async () => {
  const platform = { name: "trainsyou", initials: "T", registrationOpen: true };
  const render = (coach: Parameters<typeof PublicHeader>[0]["coach"], path = "/login") =>
    renderToStaticMarkup(createElement(PublicHeader, { path, platform, coach }));
  const trainer = { name: "Alex Morgan", slug: "alex-morgan", theme: {} };
  for (const markup of [
    render({ slug: "alex-morgan", host: true, trainer }),
    render({ slug: "alex-morgan", host: true, trainer: null }),
    render({ slug: "alex-morgan", host: true, trainer }, "/forgot-password"),
  ]) {
    assert.doesNotMatch(markup, /\/brand\/|Teach your AI|href="\/signup"|trainsyou/, markup);
    assert.match(markup, /href="\/join-coach\/alex-morgan"/);
    assert.match(markup, /<a class="wordmark"[^>]* href="\/">/);
  }
  assert.match(render({ slug: "alex-morgan", host: true, trainer }), /Alex Morgan/);
  // A /coach/ page on the platform address links home to the coach's page.
  assert.match(render({ slug: "alex-morgan", host: false, trainer }), /href="\/coach\/alex-morgan"/);
  // The platform's own sign-in page keeps the trainsyou header.
  const own = render(null);
  assert.ok(own.includes(BRAND_ASSETS.lockupInk));
  assert.match(own, />Teach your AI</);
  // The server passes the proxy's coach slug down; the page uses it.
  const page = await source("app/[[...path]]/page.tsx");
  assert.match(page, /<Workspace[\s\S]*coachSlug=\{coachSlug\}/);
  const workspace = await source("components/workspace.tsx");
  assert.match(workspace, /<Public\s+path=\{path\}\s+platform=\{platform\}\s+coachSlug=\{coachSlug\}/);
  assert.match(workspace, /<PublicHeader/);
  assert.doesNotMatch(workspace, /<MarketingHeader/);
  assert.match(await source("components/discovery-server.ts"), /x-trainer-site-slug/);
});

test("platform surfaces carry .platform-ui; trainer-branded ones never show the platform identity", async () => {
  const workspace = await source("components/workspace.tsx");
  // Members get their trainer's brand in the member shell; everyone else
  // works in the platform identity.
  assert.match(workspace, /<TrainerTheme className="workspace member-shell"/);
  assert.match(workspace, /<PlainShell className="workspace platform-ui">/);
  assert.match(workspace, /coach \? "public" : "public platform-ui"/);
  assert.match(workspace, /<PlatformLogo name=\{platformName\} \/>/);
  // The loading screen may belong to a trainer's member app: no platform mark.
  assert.doesNotMatch(workspace, /brand-mark">b\./);
  assert.match(await source("components/marketing/site.tsx"), /"public mk platform-ui"/);
  assert.match(await source("components/coach-directory.tsx"), /directory-page platform-ui/);
  for (const file of ["components/coach-site.tsx", "components/trainer-design.tsx"]) {
    const text = await source(file);
    assert.doesNotMatch(text, /PlatformLogo|BRAND_ASSETS|platform-ui/, file);
  }
  // Trainer-branded surfaces map the new tokens onto their own design.
  const design = await source("app/trainer-design.css");
  for (const token of ["--field-border", "--on-green", "--on-lime", "--focus", "--canvas"])
    assert.match(design, new RegExp(`\\.trainer-theme \\{[^}]*${token}:`), token);
});

// Minimal colour maths for the token checks (WCAG 2.x relative luminance).
type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
};
const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
function declarations(block: string) {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function resolver(...layers: Record<string, string>[]) {
  const merged = Object.assign({}, ...layers);
  const resolve = (value: string, depth = 0): Rgb => {
    assert.ok(depth < 10, "token cycle: " + value);
    const v = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
    const ref = v.match(/^var\((--[\w-]+)\)$/);
    if (ref) return resolve(merged[ref[1]], depth + 1);
    const mix = v.match(/^color-mix\(in srgb, (var\(--[\w-]+\)) (\d+)%, (var\(--[\w-]+\))\)$/);
    if (mix) {
      const [a, share, b] = [resolve(mix[1], depth + 1), Number(mix[2]) / 100, resolve(mix[3], depth + 1)];
      return a.map((c, i) => Math.round(c * share + b[i] * (1 - share))) as Rgb;
    }
    throw new Error("unresolvable token value " + v);
  };
  return (name: string) => resolve(`var(${name})`);
}

const platformCssFiles = ["globals.css", "marketing.css", "analytics-consent.css", "platform-settings.css", "governance.css", "host-operations.css"];

test("design tokens are the supplied palette and meet the contrast checks in light and dark", async () => {
  const css = await readFile(web("app/globals.css"), "utf8");
  const root = declarations(css.match(/:root \{([\s\S]*?)\n\}/)![1]);
  const dark = declarations(
    css.match(
      /@media \(prefers-color-scheme: dark\) \{\s*\.workspace\.platform-ui,[^{]*\.acquisition-consent \{([\s\S]*?)\n  \}/,
    )![1],
  );
  // The supplied palette, value for value (digital/design-tokens.css).
  const palette: Record<string, string> = {
    "--ty-white": BRAND_COLORS.white,
    "--ty-ink": BRAND_COLORS.ink,
    "--ty-paper": BRAND_COLORS.paper,
    "--ty-muted": BRAND_COLORS.muted,
    "--ty-line": BRAND_COLORS.line,
    "--ty-pace": BRAND_COLORS.pace,
    "--ty-success": BRAND_COLORS.success,
    "--ty-warning": BRAND_COLORS.warning,
    "--ty-error": BRAND_COLORS.error,
  };
  for (const [token, value] of Object.entries(palette))
    assert.equal(root[token]?.toLowerCase(), value.toLowerCase(), token);
  assert.equal(root["--ty-radius-control"], "6px");
  assert.equal(root["--ty-radius-panel"], "8px");
  assert.match(root["--ty-font-body"], /Inter.*Arial/);
  // The supplied contrast checks hold for the chosen roles.
  const light = resolver(root);
  const night = resolver(root, dark);
  for (const [mode, color] of [["light", light], ["dark", night]] as const) {
    const pairs: Array<[string, string]> = [
      ["--ink", "--white"],
      ["--ink", "--paper"],
      ["--ink", "--mint"],
      ["--ink", "--canvas"],
      ["--muted", "--white"],
      ["--muted", "--paper"],
      ["--muted", "--mint"],
      ["--on-green", "--green"],
      ["--on-lime", "--lime"],
      ["--on-band", "--band-ink"],
      ["--on-status", "--error"],
      ["--success", "--success-bg"],
      ["--warning", "--warning-bg"],
      ["--error", "--error-bg"],
      ["--success", "--white"],
      ["--warning", "--white"],
      ["--error", "--white"],
      ["--ink", "--client-bubble"],
    ];
    for (const [fg, bg] of pairs) {
      const ratio = contrast(color(fg), color(bg));
      assert.ok(ratio >= 4.5, `${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    // Focus rings and field edges stay visible (non-text contrast 3:1).
    for (const bg of ["--white", "--paper"]) {
      assert.ok(contrast(color("--focus"), color(bg)) >= 3, `${mode}: focus on ${bg}`);
      assert.ok(contrast(color("--field-border"), color(bg)) >= 3, `${mode}: field edge on ${bg}`);
    }
  }
  // The public platform pages have no ink bands: no platform stylesheet
  // paints a band ink (the marketing site is always light).
  const marketing = await readFile(web("app/marketing.css"), "utf8");
  for (const file of platformCssFiles) {
    const text = await readFile(web("app/" + file), "utf8");
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      assert.doesNotMatch(
        rule[2],
        /background(-color)?:\s*var\(--band-ink\)/,
        `${file}: ${rule[1].trim()} paints an ink band`,
      );
  }
  // The closing panel is Pace with ink text; its ink focus ring and the
  // ink button's white text stay readable on it.
  const closingRule = marketing.match(/\n\.mk-closing \{([^}]*)\}/);
  assert.ok(closingRule, "the closing panel rule");
  const closing = declarations(closingRule[1]);
  assert.match(closingRule[1], /background:\s*var\(--lime\);/);
  assert.match(closingRule[1], /color:\s*var\(--on-lime\);/);
  const panel = resolver(root, closing);
  const ring = contrast(panel("--focus"), panel("--lime"));
  assert.ok(ring >= 3, `focus ring on the closing panel is ${ring.toFixed(2)}:1`);
  assert.ok(contrast(panel("--on-lime"), panel("--lime")) >= 4.5);
  const button = marketing.match(/\n\.mk-closing \.button \{([^}]*)\}/);
  assert.ok(button, "the closing button rule");
  assert.match(button[1], /background:\s*var\(--ink\);/);
  assert.match(button[1], /color:\s*var\(--ty-white\);/);
  assert.ok(contrast(panel("--ty-white"), panel("--ink")) >= 4.5);
  // The primary action is Pace with ink text and an ink edge (3:1 or better
  // against white); its hover stays readable. The address preview's claim
  // button on white follows it (lime is the only primary style on white),
  // and the action stays 15px semibold on phones too.
  const cta = marketing.match(/\n(\.button\.mk-cta,[^{]*)\{([^}]*)\}/);
  assert.ok(cta, "the primary action rule");
  assert.match(cta[1], /\.mk-econ \.mk-address \.button/);
  assert.match(cta[2], /background:\s*var\(--lime\);/);
  assert.match(cta[2], /color:\s*var\(--on-lime\);/);
  assert.match(cta[2], /border:\s*1px solid var\(--ink\);/);
  assert.match(cta[2], /font-size:\s*15px;/);
  assert.match(cta[2], /font-weight:\s*600;/);
  assert.ok(contrast(light("--ink"), light("--white")) >= 3);
  const hover = marketing.match(/\n\.button\.mk-cta:hover:not\(:disabled\)[^{]*\{\s*background:\s*([^;]+);/);
  assert.ok(hover, "the primary action hover rule");
  const hovered = resolver(root, { "--hover": hover[1].trim() });
  assert.ok(contrast(hovered("--on-lime"), hovered("--hover")) >= 4.5, "hover contrast");
  // Pace is a background accent: never text on a light surface.
  for (const file of platformCssFiles) {
    const text = await readFile(web("app/" + file), "utf8");
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|\s|;)color:\s*var\(--lime\)/.test(rule[2])) continue;
      const selector = rule[1].trim();
      assert.ok([".coach-monogram"].includes(selector), `${file}: lime text in ${selector}`);
    }
  }
});

test("dark mode is the workspace's alone; public platform pages are always light", async () => {
  const css = await readFile(web("app/globals.css"), "utf8");
  // Every selector inside a dark-scheme block names the workspace.
  const blocks = [...css.matchAll(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g)];
  assert.equal(blocks.length, 2, "the token block and the logo swap");
  for (const [, body] of blocks)
    for (const rule of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g))
      for (const selector of rule[1].split(","))
        assert.match(selector.trim(), /\.workspace\.platform-ui/, `dark rule for ${selector.trim()}`);
  assert.match(css, /\.workspace\.platform-ui \.brand-logo \.brand-logo-light \{\s*display: none;/);
  assert.match(css, /\.workspace\.platform-ui \.brand-logo \.brand-logo-dark \{\s*display: block;/);
  // The public root and the document behind it stay light in any scheme.
  assert.match(css, /\n\.public\.platform-ui \{\s*color-scheme: light;\s*\}/);
  assert.match(
    css,
    /\n:root:has\(\.public\.platform-ui\) \{\s*background: var\(--ty-white\);\s*color-scheme: light;\s*\}/,
  );
  // The browser colour of public platform pages is white in every scheme;
  // the workspace keeps the root layout's paper and ink pair.
  const page = await source("app/[[...path]]/page.tsx");
  assert.match(page, /themeColor: BRAND_COLORS\.white, colorScheme: "light"/);
  assert.match(page, /isPublicPlatformRoute\("\/" \+ path\.join\("\/"\)\)/);
  const layout = await source("app/layout.tsx");
  assert.match(layout, /media: "\(prefers-color-scheme: dark\)", color: BRAND_COLORS\.ink/);
});
