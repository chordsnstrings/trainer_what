// Layout: <head>, header (desktop nav + mobile sheet), footer, closing
// panel, sticky mobile CTA, Kamran, consent bar, dev panel, scripts.
// DO NOT EDIT in page builds: request changes in your report.
import { content } from "./content.mjs";
import { PAGES, href, pageFor } from "./registry.mjs";
import { esc, cx, each, cta, secondary, icon, kamranPill } from "./components.mjs";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..500&display=swap";

const label = (path) => pageFor(path).navLabel;

// Section C0 header nav, labels/links resolved from the registry.
const NAV = [
  { path: "/how-it-works", label: "How it works" },
  { path: "/trainer-brain", label: "Trainer Brain" },
  { path: "/features", label: "Features", match: /^\/features/ },
  { path: "/demo", label: "Demo" },
  { path: "/pricing", label: "Pricing" },
  {
    label: "For trainers",
    match: /^\/(for-trainers|uae)/,
    menu: [
      ["/for-trainers/weight-loss", "Weight loss"],
      ["/for-trainers/strength", "Strength"],
      ["/for-trainers/muscle-gain", "Muscle gain"],
      ["/for-trainers/pre-postnatal", "Pre and postnatal"],
      ["/uae", "In the UAE"],
      ["/for-trainers", "All specialties"],
    ],
  },
  { path: "/guides", label: "Guides", match: /^\/guides/ },
];

function isCurrent(item, path) {
  return item.path === path || (item.match && item.match.test(path));
}

function header(page) {
  const path = page.path;
  const items = each(NAV, (item) => {
    if (item.menu) {
      return `<li class="nav-item has-menu">
  <button class="nav-link nav-menu-btn" type="button" aria-expanded="false" aria-controls="menu-trainers"${isCurrent(item, path) ? ' data-current="true"' : ""}>${esc(item.label)}${icon("chevron", { size: 16 })}</button>
  <div class="nav-menu" id="menu-trainers" hidden><ul>${each(
    item.menu,
    ([p, l]) => `<li><a class="nav-menu-link" href="${href(p)}"${p === path ? ' aria-current="page"' : ""}>${esc(l)}</a></li>`,
  )}</ul></div>
</li>`;
    }
    return `<li class="nav-item"><a class="nav-link" href="${href(item.path)}"${item.path === path ? ' aria-current="page"' : isCurrent(item, path) ? ' data-current="true"' : ""}>${esc(item.label)}</a></li>`;
  });
  return `<header class="site-header" data-header>
  <div class="wrap header-in">
    <a class="brand" href="${href("/")}" aria-label="trainsyou home"><img src="assets/trainsyou-lockup-ink.svg" width="162" height="41" alt="trainsyou"></a>
    <nav class="nav-desktop" aria-label="Main"><ul class="nav-list">${items}</ul></nav>
    <div class="header-actions">
      <a class="nav-signin" href="${href("/login")}">Sign in</a>
      ${cta({ location: "header", size: "md", className: "header-cta" })}
    </div>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="mobile-menu" data-menu-btn><span class="menu-btn-label">Menu</span><span class="menu-icon" aria-hidden="true"><i></i><i></i></span></button>
  </div>
</header>`;
}

function mobileMenu(page) {
  let i = 0;
  const group = (g) => {
    const links = g.links && g.links.length ? g.links : [{ label: g.label, href: g.href }];
    return `<div class="mm-group">
  ${g.links && g.links.length ? `<p class="mm-label">${esc(g.label)}</p>` : ""}
  <ul>${each(links, (l) => `<li style="--i:${Math.min(i++, 5)}"><a class="mm-link" href="${href(l.href)}"${l.href === page.path ? ' aria-current="page"' : ""}>${esc(l.label)}</a></li>`)}</ul>
</div>`;
  };
  return `<div class="mobile-menu" id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu" hidden data-mobile-menu>
  <div class="mm-inner">
    <nav aria-label="Main (mobile)">${each(content.nav, group)}</nav>
    <div class="mm-actions">
      ${cta({ location: "menu", block: true })}
      <a class="btn btn-secondary btn-lg btn-block" href="${href("/login")}">Sign in</a>
    </div>
  </div>
</div>`;
}

function footer() {
  // content.json footer groups; legal links split into their own group and
  // /coaches left out until listings exist (decision 11).
  const legal = ["/terms", "/privacy", "/ai-disclosure"];
  const groups = content.footer.map((g) => ({
    label: g.label,
    links: g.links.filter((l) => !legal.includes(l.href) && l.href !== "/coaches"),
  }));
  groups.push({ label: "Legal", links: legal.map((p) => ({ href: p, label: label(p) })) });
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-top">
      <div class="footer-brand">
        <a class="brand" href="${href("/")}" aria-label="trainsyou home"><img src="assets/trainsyou-lockup-ink.svg" width="138" height="35" alt="trainsyou" loading="lazy"></a>
        <p class="footer-line">Your coaching. Beyond your hours.</p>
        <p class="footer-src"><a class="link-arrow" href="${href("/methodology")}"><span class="la">Every market figure links to its source</span><span class="arr" aria-hidden="true">→</span></a></p>
      </div>
      <div class="footer-cols">${each(
        groups,
        (g) => `<nav class="footer-col" aria-label="${esc(g.label)}"><p class="footer-h">${esc(g.label)}</p><ul>${each(g.links, (l) => `<li><a href="${href(l.href)}">${esc(l.label)}</a></li>`)}</ul></nav>`,
      )}</div>
    </div>
    <div class="footer-bottom">
      <p>© 2026 trainsyou · Prices in AED · For personal trainers in the UAE</p>
      <p><button class="footer-btn" type="button" data-consent-open>Analytics preferences</button><span class="footer-proto">Concept C prototype · copy pending owner approval</span></p>
    </div>
  </div>
</footer>`;
}

/** Closing panel: Pace background, ink text (kept on every page). */
export function closingPanel({ secondary: sec } = {}) {
  return `<section class="closing" aria-labelledby="closing-title" data-closing>
  <div class="wrap closing-in">
    <div class="closing-copy">
      <h2 class="closing-title" id="closing-title">Your coaching. Beyond your hours.</h2>
      <p class="closing-line">Guided setup. Nothing goes live until you publish.</p>
    </div>
    <div class="closing-actions">
      ${cta({ location: "closing" })}
      ${sec ? secondary(sec.label, sec.path, { location: "closing", className: "on-pace" }) : ""}
    </div>
    ${kamranPill({ inline: true, location: "closing" })}
  </div>
</section>`;
}

function stickyCta() {
  return `<div class="sticky-cta" data-sticky aria-hidden="true">
  ${cta({ location: "sticky", block: true })}
  <p class="sticky-sub">Free to join</p>
</div>`;
}

function consentBar() {
  return `<div class="consent" data-consent-bar role="region" aria-label="Analytics preferences" hidden>
  <div class="consent-in">
    <p>We use first-party analytics only with your OK. Nothing is stored until you choose.</p>
    <div class="consent-actions"><button class="btn btn-secondary btn-sm" type="button" data-consent="denied">Decline</button><button class="btn btn-primary btn-sm" type="button" data-consent="granted">Allow</button></div>
  </div>
</div>`;
}

function kamranDialog() {
  return `<div class="kamran-pop" role="dialog" aria-modal="false" aria-labelledby="kamran-title" hidden data-kamran-pop>
  <p class="kamran-pop-t" id="kamran-title">Talk to Kamran (AI voice)</p>
  <p>Kamran is an AI voice of our founder, used with consent. It answers questions about trainsyou out loud.</p>
  <p class="fine">This prototype does not place calls.</p>
  <button class="btn btn-secondary btn-sm" type="button" data-kamran-close>Close</button>
</div>`;
}

const FLAG_ROWS = [
  ["payments", "Subscriber payments and payouts", "off", "on"],
  ["publish", "Publishing (payments launch gate)", "blocked", "open"],
  ["registration", "Registration", "closed", "open"],
  ["frontier", "Frontier model wording", "off", "on"],
  ["voice", "Voice add-on for subscribers", "off", "on"],
  ["rtl-preview", "RTL preview (subscriber-app vignette only)", "off", "on"],
];

function devPanel(page) {
  return `<div class="dev" data-dev>
  <button class="dev-toggle" type="button" aria-expanded="false" aria-controls="dev-panel" data-dev-toggle>Dev</button>
  <div class="dev-panel" id="dev-panel" role="dialog" aria-label="Prototype controls" hidden>
    <div class="dev-head"><p class="dev-title">Concept C · The Method</p><button class="dev-x" type="button" data-dev-close aria-label="Close prototype controls">${icon("close", { size: 18 })}</button></div>
    <p class="dev-sub">Product state (live today: payments off, publishing blocked, registration open, frontier off, voice off)</p>
    <ul class="dev-flags">${each(
      FLAG_ROWS,
      ([f, l, off, on]) => `<li><span id="flag-${f}-l">${esc(l)}</span><button class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="flag-${f}-l" data-flag="${f}" data-off="${off}" data-on="${on}"><span class="switch-state" data-switch-state>${off}</span><span class="switch-knob" aria-hidden="true"></span></button></li>`,
    )}</ul>
    <div class="dev-actions">
      <button class="btn btn-secondary btn-sm" type="button" data-replay-hero>Replay hero</button>
      <button class="btn btn-secondary btn-sm" type="button" data-reset-flags>Reset to live state</button>
      <button class="btn btn-secondary btn-sm" type="button" data-consent-open>Consent bar</button>
    </div>
    <details class="dev-pages"><summary>All ${PAGES.length} pages</summary><ol>${each(
      PAGES,
      (p) => `<li><a href="${p.file}"${p.path === page.path ? ' aria-current="page"' : ""}>${esc(p.path === "/" ? "Home" : p.path)}</a></li>`,
    )}</ol></details>
    <a class="dev-all" href="../">All concepts<span class="arr" aria-hidden="true">→</span></a>
  </div>
</div>`;
}

/**
 * Render a full HTML document. `result` is the page module's PageResult
 * (see src/BUILDERS.md).
 */
export function renderDocument(page, result) {
  const title = result.title || page.title;
  const description = result.description || page.description || "";
  const group = page.owner;
  const sticky = result.sticky !== false;
  const closing = result.closing === false ? "" : closingPanel({ secondary: result.closing || { label: "Try the demo", path: "/demo" } });
  const kamran = result.kamran !== false;
  return `<!doctype html>
<html lang="en" dir="ltr" data-payments="off" data-publish="blocked" data-registration="open" data-frontier="off" data-voice="off" data-rtl-preview="off" data-consent="unset">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · trainsyou</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="assets/site.css">
<link rel="stylesheet" href="assets/${group}.css">
<script src="assets/boot.js"></script>
<script defer src="assets/site.js"></script>
${result.calc ? '<script defer src="assets/calc.js"></script>\n' : ""}<script defer src="assets/${group}.js"></script>
</head>
<body class="${cx("page-" + page.kind, "group-" + group, sticky && "has-sticky", result.bodyClass)}" data-path="${esc(page.path)}">
<a class="skip" href="#main">Skip to content</a>
${header(page)}
${mobileMenu(page)}
<main id="main" tabindex="-1">
${result.main}
${closing}
</main>
${footer()}
${sticky ? stickyCta() : ""}
${kamran ? kamranPill({ inline: false, location: "float" }) : ""}
${kamranDialog()}
${consentBar()}
${devPanel(page)}
</body>
</html>
`;
}
