// Dark appearance for subscriber surfaces (docs/features/dark-mode.md): the
// brand's dark palette, the stylesheet that applies it, where it applies,
// the member's saved choice and the Display preferences control.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  DARK_STATUS_COLORS,
  brandContrast,
  brandCssVariables,
  brandDarkCssVariables,
  brandDarkPalette,
  brandDesignSchema,
  brandPresets,
} from "@trainer/contracts";
import {
  COLOR_SCHEMES,
  MEMBER_SCHEME_COOKIE,
  colorSchemeCookie,
  colorSchemeFromCookieHeader,
  parseColorScheme,
  themeColorsFor,
} from "../apps/web/color-scheme.ts";
import { TrainerTheme } from "../apps/web/components/trainer-design.tsx";
import { DisplayPreferences } from "../apps/web/components/appearance.tsx";

const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");
const HEX = /^#[0-9a-f]{6}$/;
function mix(a: string, b: string, amount: number) {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const x = channels(a),
    y = channels(b);
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v * (1 - amount) + y[i] * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const relative = (hex: string) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

const designs = [
  ...brandPresets.map((p) => ({
    name: p.name,
    design: brandDesignSchema.parse({
      preset: p.id,
      primary: p.primary,
      accent: p.accent,
      surface: p.surface,
    }),
  })),
  ...[
    "#000000",
    "#ffffff",
    "#777777",
    "#ffff00",
    "#ff00ff",
    "#00ffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#332244",
    "#e8f5e9",
  ].map((color) => ({
    name: color,
    design: brandDesignSchema.parse({
      primary: color,
      accent: color,
      surface: color,
    }),
  })),
  {
    name: "dark surface, light primary",
    design: brandDesignSchema.parse({
      primary: "#f7d154",
      accent: "#1f2a44",
      surface: "#101418",
    }),
  },
];

test("every brand's dark palette keeps text AA, ink 7:1 and field edges 3:1 on dark surfaces", () => {
  for (const { name, design } of designs) {
    const p = brandDarkPalette({ design });
    for (const value of Object.values(p)) assert.match(value, HEX, name);
    // Dark surfaces.
    assert.ok(relative(p.paper) <= 0.012, `${name} paper ${p.paper}`);
    assert.ok(relative(p.card) <= 0.03, `${name} card ${p.card}`);
    for (const surface of [p.paper, p.card, p.tint]) {
      assert.ok(
        brandContrast(p.ink, surface) >= 7,
        `${name} ink on ${surface}`,
      );
      assert.ok(
        brandContrast(p.muted, surface) >= 4.5,
        `${name} muted on ${surface}`,
      );
      assert.ok(
        brandContrast(p.link, surface) >= 4.5,
        `${name} link on ${surface}`,
      );
      assert.ok(
        brandContrast(p.primary, surface) >= 4.5,
        `${name} primary on ${surface}`,
      );
    }
    assert.ok(
      brandContrast(p.onPrimary, p.primary) >= 4.5,
      `${name} on primary`,
    );
    assert.ok(brandContrast(p.onAccent, p.accent) >= 4.5, `${name} on accent`);
    assert.ok(brandContrast(p.onTint, p.tint) >= 4.5, `${name} on tint`);
    for (const surface of [p.paper, p.card])
      assert.ok(
        brandContrast(p.fieldBorder, surface) >= 3,
        `${name} field edge`,
      );
    // Status text on the surfaces, on its own tint, and filled with dark text.
    for (const color of Object.values(DARK_STATUS_COLORS)) {
      for (const surface of [p.paper, p.card])
        assert.ok(brandContrast(color, surface) >= 4.5, `${name} ${color}`);
      assert.ok(
        brandContrast(color, mix(p.card, color, 0.12)) >= 4.5,
        `${name} ${color} on its tint`,
      );
      assert.ok(brandContrast(p.paper, color) >= 4.5, `${name} on ${color}`);
    }
    // The browser colour is the top bar; the logo keeps the surface it was
    // designed on.
    assert.equal(p.themeColor, p.card);
    assert.equal(p.logoPlate, design.surface, name);
  }
});

test("the dark palette keeps the coach's hue and only emits validated colours", () => {
  const nordic = brandDarkPalette({
    design: { primary: "#244c46", accent: "#dfefb5", surface: "#f6f6f2" },
  });
  // Lighter, still teal: green and blue channels above red.
  const [r, g, b] = [1, 3, 5].map((i) =>
    parseInt(nordic.primary.slice(i, i + 2), 16),
  );
  assert.ok(g > r && b > r, nordic.primary);
  assert.ok(relative(nordic.primary) > relative("#244c46"));
  // Malformed themes fall back to the default design, never to raw input.
  const vars = brandDarkCssVariables({
    design: { primary: "red;display:none" },
    accent: "url(javascript:alert(1))",
  });
  for (const [key, value] of Object.entries(vars)) {
    assert.match(key, /^--dark-[a-z-]+$/);
    assert.match(value, HEX);
  }
});

test("appearance.css: one dark block for Dark, the same for System on a dark device", async () => {
  const css = await source("apps/web/app/appearance.css");
  const block = (name: string) => {
    const start = css.indexOf(`/* ${name}:start */`),
      end = css.indexOf(`/* ${name}:end */`);
    assert.ok(start > 0 && end > start, name);
    return css.slice(start, end);
  };
  // Declarations without comments or line wrapping (the System block is
  // indented deeper, so a formatter may wrap it differently).
  const declarations = (text: string) =>
    text
      .slice(text.indexOf("{") + 1, text.lastIndexOf("}"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\( /g, "(")
      .replace(/ \)/g, ")")
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean);
  const dark = block("dark-block"),
    system = block("system-block");
  assert.deepEqual(declarations(system), declarations(dark));
  assert.match(dark, /\[data-color-scheme="dark"\]/);
  assert.match(system, /\[data-color-scheme="system"\]/);
  // System applies only inside the device's dark scheme.
  const media = css.indexOf("@media (prefers-color-scheme: dark)");
  assert.ok(media > 0 && media < css.indexOf("/* system-block:start */"));
  // Every colour the brand sets inline is replaced (inline needs !important),
  // and every dark value it reads exists: inline from TrainerTheme or the
  // neutral palette on :root.
  const inline = Object.entries(
    brandCssVariables({ design: brandDesignSchema.parse({}) }),
  )
    .filter(([, value]) => value.startsWith("#"))
    .map(([key]) => key);
  for (const key of inline)
    assert.match(dark, new RegExp(`${key}: [^;]+ !important;`), key);
  const neutral = css.slice(
    css.indexOf(":root {"),
    css.indexOf("}", css.indexOf(":root {")),
  );
  for (const used of new Set(dark.match(/--dark-[a-z-]+/g))) {
    assert.ok(neutral.includes(used + ":"), `${used} has a neutral value`);
    assert.ok(
      used in brandDarkCssVariables({}) || used === "--dark-white",
      `${used} is set by TrainerTheme`,
    );
  }
  // Only subscriber surfaces: never the platform's public pages or the
  // trainer workspace, never the marketing site.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rules, /platform-ui|\.mk\b|\.mk-|\.workspace/);
  // No new motion (the motion pass owns it) and mobile first.
  assert.doesNotMatch(rules, /animation|transition|@keyframes|max-width/);
});

test("the neutral dark palette (before the coach's brand loads) reaches AA", async () => {
  const css = await source("apps/web/app/appearance.css");
  const value = (name: string) =>
    css.match(new RegExp(`--dark-${name}: (#[0-9a-f]{6});`))![1];
  const paper = value("paper"),
    card = value("white"),
    tint = value("tint");
  for (const surface of [paper, card, tint]) {
    assert.ok(brandContrast(value("ink"), surface) >= 7);
    assert.ok(brandContrast(value("muted"), surface) >= 4.5);
    assert.ok(brandContrast(value("link"), surface) >= 4.5);
  }
  assert.ok(brandContrast(value("on-primary"), value("primary")) >= 4.5);
  assert.ok(brandContrast(value("on-accent"), value("accent")) >= 4.5);
  assert.ok(brandContrast(value("on-tint"), tint) >= 4.5);
  assert.ok(brandContrast(value("field-border"), card) >= 3);
});

test("only subscriber surfaces follow the appearance choice", async () => {
  const workspace = await source("apps/web/components/workspace.tsx");
  const site = await source("apps/web/components/coach-site.tsx");
  const design = await source("apps/web/components/trainer-design.tsx");
  // The member shell and the coach-branded public pages.
  assert.match(
    workspace,
    /className="workspace member-shell"\s+theme=\{state\.tenant\.theme\}\s+colorScheme=\{scheme\}/,
  );
  assert.match(workspace, /colorScheme=\{coach \? colorScheme : undefined\}/);
  // The public website follows it; the Design Studio preview does not.
  assert.match(site, /colorScheme=\{preview \? undefined : scheme\}/);
  assert.match(design, /<TrainerTheme theme=\{theme\}>/);
  // The trainer workspace keeps PlainShell with .platform-ui.
  assert.match(workspace, /<PlainShell className="workspace platform-ui">/);

  const light = renderToStaticMarkup(
    createElement(TrainerTheme, { theme: {}, children: "x" }),
  );
  assert.doesNotMatch(light, /data-color-scheme|--dark-/);
  const member = renderToStaticMarkup(
    createElement(TrainerTheme, {
      theme: { design: { primary: "#253d80" } },
      colorScheme: "system",
      className: "workspace member-shell",
      children: "x",
    }),
  );
  assert.match(member, /data-color-scheme="system"/);
  assert.match(member, /--dark-paper:#[0-9a-f]{6}/);
  assert.match(member, /--paper:#[0-9a-f]{6}/);
});

test("the choice: three values, a cookie mirror and the browser colour per scheme", () => {
  assert.deepEqual([...COLOR_SCHEMES], ["system", "light", "dark"]);
  assert.equal(parseColorScheme("dark"), "dark");
  assert.equal(parseColorScheme("DARK"), null);
  assert.equal(parseColorScheme("dark;x=1"), null);
  assert.equal(parseColorScheme(undefined), null);
  const cookie = colorSchemeCookie("dark", true);
  assert.match(
    cookie,
    new RegExp(
      `^${MEMBER_SCHEME_COOKIE}=dark; Path=/; Max-Age=\\d+; SameSite=Lax; Secure$`,
    ),
  );
  assert.doesNotMatch(colorSchemeCookie("light", false), /Secure/);
  assert.equal(
    colorSchemeFromCookieHeader(`a=1; ${MEMBER_SCHEME_COOKIE}=light; b=2`),
    "light",
  );
  assert.equal(
    colorSchemeFromCookieHeader(`${MEMBER_SCHEME_COOKIE}=blue`),
    null,
  );
  assert.equal(colorSchemeFromCookieHeader(null), null);
  const colors = { light: "#253d80", dark: "#24282e" };
  assert.deepEqual(themeColorsFor("system", colors), [
    { media: "(prefers-color-scheme: light)", color: "#253d80" },
    { media: "(prefers-color-scheme: dark)", color: "#24282e" },
  ]);
  assert.deepEqual(themeColorsFor("dark", colors), [{ color: "#24282e" }]);
  assert.deepEqual(themeColorsFor("light", colors), [{ color: "#253d80" }]);
});

test("Display preferences: a labelled group of three choices, the device's first", () => {
  const html = renderToStaticMarkup(createElement(DisplayPreferences));
  assert.match(html, /<h2>Display preferences<\/h2>/);
  assert.match(
    html,
    /<fieldset class="appearance-choice"[^>]*><legend>Appearance<\/legend>/,
  );
  const radios = [
    ...html.matchAll(
      /<input type="radio" name="appearance"( checked="")? value="(\w+)"/g,
    ),
  ].map((m) => [m[2], !!m[1]]);
  // Server render (no cookie): Match this device is chosen.
  assert.deepEqual(radios, [
    ["system", true],
    ["light", false],
    ["dark", false],
  ]);
  for (const label of ["Match this device", "Light", "Dark"])
    assert.match(html, new RegExp(`<strong>${label}</strong>`));
  // Plain words only in what a member reads.
  const text = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /\b(theme|scheme|prefers|system|cookie)\b/i);
});

test("the profile page offers Display preferences to members only", async () => {
  const workspace = await source("apps/web/components/workspace.tsx");
  assert.match(workspace, /\{sub && <DisplayPreferences \/>\}/);
  // The member app's browser colour follows the choice; trainers keep theirs.
  const install = await source("apps/web/components/member-app-install.tsx");
  assert.match(
    install,
    /if \(role !== "subscriber"\)\s+undo\.push\(swapMeta\("theme-color"/,
  );
});

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const request = (
  path: string,
  method: any = "GET",
  body?: any,
  cookie?: string,
) =>
  app.inject({
    url: "/api/v1" + path,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body,
  });
let member: { cookie: string }, other: { cookie: string };
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const coach = await request("/auth/register", "POST", {
    name: "Coach Appearance",
    email: "appearance-coach@example.test",
    password: "TestingOnly2026!",
    slug: "appearance-coach",
    accepted: true,
  });
  assert.equal(coach.statusCode, 201, coach.body);
  const coachCookie = String(coach.headers["set-cookie"]).split(";")[0];
  const join = async (email: string) => {
    const invitation = await request(
      "/invitations",
      "POST",
      { email, role: "subscriber" },
      coachCookie,
    );
    const token = invitation.json().url.split("/").pop();
    const joined = await request("/invitations/accept", "POST", {
      token,
      name: "Member",
      email,
      password: "TestingClient2026!",
      accepted: true,
    });
    assert.equal(joined.statusCode, 200, joined.body);
    return { cookie: String(joined.headers["set-cookie"]).split(";")[0] };
  };
  member = await join("appearance-member@example.test");
  other = await join("appearance-other@example.test");
});
after(async () => {
  await app.close();
  await db.close();
});

test("the member's appearance is saved per member without touching other preferences", async () => {
  const initial = (
    await request("/notifications/preferences", "GET", undefined, member.cookie)
  ).json();
  assert.equal(initial.data.theme, "system");
  // The notification form saves something first.
  const edited = await request(
    "/notifications/preferences",
    "PUT",
    { version: initial.version, data: { ...initial.data, bookings: false } },
    member.cookie,
  );
  assert.equal(edited.statusCode, 200, edited.body);
  const saved = await request(
    "/preferences/appearance",
    "PUT",
    { theme: "dark" },
    member.cookie,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().data.theme, "dark");
  assert.equal(saved.json().data.bookings, false);
  assert.equal(saved.json().version, edited.json().version + 1);
  const read = (
    await request("/notifications/preferences", "GET", undefined, member.cookie)
  ).json();
  assert.equal(read.data.theme, "dark");
  assert.equal(read.data.bookings, false);
  // Another member of the same coach keeps their own.
  assert.equal(
    (
      await request(
        "/notifications/preferences",
        "GET",
        undefined,
        other.cookie,
      )
    ).json().data.theme,
    "system",
  );
  // The notification form's next save keeps the choice when it sends it back.
  const again = await request(
    "/notifications/preferences",
    "PUT",
    { version: read.version, data: { ...read.data, workouts: false } },
    member.cookie,
  );
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().data.theme, "dark");
  // Only the three values, only signed in.
  for (const theme of ["blue", "", null, "DARK"])
    assert.equal(
      (
        await request(
          "/preferences/appearance",
          "PUT",
          { theme },
          member.cookie,
        )
      ).statusCode,
      400,
      String(theme),
    );
  assert.equal(
    (
      await request(
        "/preferences/appearance",
        "PUT",
        { theme: "dark", extra: 1 },
        member.cookie,
      )
    ).statusCode,
    400,
  );
  assert.notEqual(
    (await request("/preferences/appearance", "PUT", { theme: "light" }))
      .statusCode,
    200,
  );
});
