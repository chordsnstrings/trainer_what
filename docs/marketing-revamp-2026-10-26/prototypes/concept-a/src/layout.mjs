// Document layout: head, header (desktop nav + mobile sheet), footer, closing
// panel, sticky mobile CTA, consent bar, Kamran, dev panel. Builders do not edit
// this file; request changes in your report.
import { content, href, PAGES, pageByPath } from "./registry.mjs";
import { esc, cta, ctaMicro, button, icon, kamranPill, FLAGS } from "./components.mjs";


const FONTS = "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=JetBrains+Mono:wght@400;500&display=swap";

/** C0 desktop nav: How it works · Trainer Brain · Features · Demo · Pricing · For trainers ▾ · Guides. */
const NAV = [
  { path: "/how-it-works" },
  { path: "/trainer-brain" },
  { path: "/features" },
  { path: "/demo" },
  { path: "/pricing" },
  {
    label: "For trainers",
    path: "/for-trainers",
    children: ["/for-trainers", "/for-trainers/weight-loss", "/for-trainers/strength", "/for-trainers/muscle-gain", "/for-trainers/pre-postnatal", "/uae"],
  },
  { path: "/guides" },
];
const CHILD_LABEL = { "/for-trainers": "All specialties", "/uae": "In the UAE" };
const label = (p) => CHILD_LABEL[p] ?? pageByPath.get(p)?.navLabel ?? p;

/** Is `path` the current page or (for sections) an ancestor of it? */
const isCurrent = (path, current) => path === current;
const inSection = (path, current) => path !== "/" && (current === path || current.startsWith(path + "/"));

function headerNav(current) {
  const items = NAV.map((item) => {
    if (item.children) {
      const open = item.children.some((c) => inSection(c, current));
      return `<li class="nav-drop-wrap"><button type="button" class="nav-link nav-drop-btn${open ? " is-section" : ""}" aria-expanded="false" aria-controls="nav-drop">${esc(item.label)}${icon("chevron", "nav-chev")}</button>
<div class="nav-drop" id="nav-drop" hidden><ul>${item.children
        .map((c) => `<li><a href="${href(c)}"${isCurrent(c, current) ? ' aria-current="page"' : ""}>${esc(label(c))}</a></li>`)
        .join("")}</ul></div></li>`;
    }
    const attrs = isCurrent(item.path, current)
      ? ' class="nav-link" aria-current="page"'
      : inSection(item.path, current) ? ' class="nav-link is-section"' : ' class="nav-link"';
    return `<li><a href="${href(item.path)}"${attrs}>${esc(label(item.path))}</a></li>`;
  }).join("");
  return `<nav class="nav-desktop" aria-label="Main"><ul>${items}</ul></nav>`;
}

/** The phone/tablet sheet: content.json nav groups, specialties folded into "For trainers". */
function menuSheet(current) {
  const groups = content.nav.map((g) => {
    const links = g.links.length ? g.links : [{ label: g.label, href: g.href }];
    const extra = g.label === "For trainers" ? ["/for-trainers/weight-loss", "/for-trainers/strength", "/for-trainers/muscle-gain", "/for-trainers/pre-postnatal"].map((p) => ({ label: label(p), href: p })) : [];
    // Specialties sit directly under "By specialty" (/for-trainers), not after the last link.
    const at = links.findIndex((l) => l.href === "/for-trainers");
    const all = extra.length && at >= 0 ? [...links.slice(0, at + 1), ...extra, ...links.slice(at + 1)] : [...links, ...extra];
    return `<div class="sheet-group"><p class="sheet-label">${esc(g.label)}</p><ul>${all
      .map((l) => `<li><a href="${href(l.href)}"${isCurrent(l.href, current) ? ' aria-current="page"' : ""}>${esc(l.label)}</a></li>`)
      .join("")}</ul></div>`;
  }).join("");
  return `<div class="menu-sheet" id="menu-sheet" hidden>
  <div class="wrap sheet-inner">
    <nav class="sheet-nav" aria-label="Menu">${groups}</nav>
    <div class="sheet-actions">${cta({ location: "menu", block: true })}<a class="btn btn-ghost btn-block" href="login.html">Sign in</a></div>
  </div>
</div>`;
}

function header(current) {
  return `<header class="site-header" data-header>
  <div class="wrap header-inner">
    <a class="brand" href="index.html"${current === "/" ? ' aria-current="page"' : ""}><img src="assets/trainsyou-lockup-ink.svg" alt="trainsyou" width="162" height="41"></a>
    ${headerNav(current)}
    <div class="header-actions">
      <a class="signin" href="login.html"${current === "/login" ? ' aria-current="page"' : ""}>Sign in</a>
      ${cta({ location: "header", size: "sm" })}
      <button type="button" class="menu-btn" aria-expanded="false" aria-controls="menu-sheet"><span class="menu-lines" aria-hidden="true"><span></span><span></span></span><span class="menu-label">Menu</span></button>
    </div>
  </div>
</header>
${menuSheet(current)}`;
}

/**
 * Footer, grouped as C0 sets it: Product (with its Features column), For trainers,
 * Resources, Company, Legal. Labels come from content.json; /coaches stays hidden
 * until listings exist (decision 11).
 */
const FOOTER_GROUPS = [
  { label: "Product", paths: ["/how-it-works", "/trainer-brain", "/demo", "/features", "/pricing", "/security-and-privacy"] },
  { label: "Features", from: "Features" },
  { label: "For trainers", paths: ["/get-started", "/for-trainers", "/for-trainers/weight-loss", "/for-trainers/strength", "/for-trainers/muscle-gain", "/for-trainers/pre-postnatal", "/uae"] },
  { label: "Resources", paths: ["/guides", "/guides/pricing-online-coaching-uae", "/guides/instagram-followers-to-clients", "/guides/uae-advertiser-permit", "/guides/writing-coaching-rules", "/earnings-calculator", "/follower-calculator", "/faq"] },
  { label: "Company", paths: ["/about", "/methodology"] },
  { label: "Legal", paths: ["/terms", "/privacy", "/ai-disclosure"] },
];
function footer() {
  const all = content.footer.flatMap((g) => g.links);
  const labelFor = (p) => all.find((l) => l.href === p)?.label ?? pageByPath.get(p)?.navLabel ?? p;
  const groups = FOOTER_GROUPS.map((g) => ({
    label: g.label,
    links: g.from ? content.footer.find((x) => x.label === g.from).links : g.paths.map((p) => ({ href: p, label: labelFor(p) })),
  }));
  const cols = groups
    .map((g) => `<div class="foot-col"><p class="foot-label">${esc(g.label)}</p><ul>${g.links.map((l) => `<li><a href="${href(l.href)}">${esc(l.label)}</a></li>`).join("")}</ul></div>`)
    .join("");
  return `<footer class="site-footer" data-footer>
  <div class="wrap">
    <div class="foot-top">
      <div class="foot-brand">
        <a href="index.html" class="foot-logo"><img src="assets/trainsyou-lockup-ink.svg" alt="trainsyou" width="142" height="36" loading="lazy"></a>
        <p class="foot-line">${esc(content.brand.copy.line)}</p>
        <p class="foot-entity">${esc(content.entitySentence)}</p>
      </div>
      <nav class="foot-cols" aria-label="Footer">${cols}</nav>
    </div>
    <div class="foot-bottom">
      <p>© 2026 trainsyou · Prices in AED</p>
      <p class="foot-links"><a href="methodology.html">Every market figure sourced → Methodology</a><button type="button" class="foot-btn" data-consent-open>Analytics preferences</button></p>
      <p class="foot-proto">Prototype · Concept A “Live Brain” · Copy pending owner approval</p>
    </div>
  </div>
</footer>`;
}

/** Closing panel (every page): Pace background, ink text. secondary: { label, path } or null. */
export function closingPanel({ secondary } = {}) {
  return `<section class="closing" aria-labelledby="closing-h" data-closing>
  <div class="wrap"><div class="closing-panel" data-reveal>
    <div class="closing-copy">
      <h2 id="closing-h">Your coaching. Beyond your hours.</h2>
      <p>Guided setup. Nothing goes live until you publish.</p>
    </div>
    <div class="closing-actions">
      <div class="closing-btns">${cta({ location: "closing", size: "lg" })}${secondary ? button(secondary.path, secondary.label, { location: "closing", variant: "ink-ghost", size: "lg" }) : ""}</div>
      ${ctaMicro({ short: true })}
      <div class="kamran-slot">${kamranPill()}</div>
    </div>
  </div></div>
</section>`;
}

function chrome() {
  const pages = PAGES.map((p) => `<li><a href="${href(p.path)}"><span class="mono">${esc(p.file.replace(/\.html$/, ""))}</span></a></li>`).join("");
  const sw = (flag, text, onValue, sub = "") =>
    `<button type="button" class="dev-switch" role="switch" aria-checked="false" data-flag="${flag}" data-on="${onValue}"><span class="dev-sw-text"><span>${esc(text)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="dev-sw" aria-hidden="true"></span></button>`;
  return `<div class="sticky-cta" data-sticky inert>${cta({ location: "sticky", block: true })}${ctaMicro({ short: true })}</div>
<div class="consent" data-consent role="region" aria-label="Analytics preferences" hidden>
  <p>We measure visits with first-party analytics only if you allow it.</p>
  <div class="consent-btns"><button type="button" class="btn btn-ghost btn-sm" data-consent-choice="denied">Decline</button><button type="button" class="btn btn-secondary btn-sm" data-consent-choice="granted">Allow</button></div>
</div>
${kamranPill({ inline: false }).replace('class="kamran"', 'class="kamran kamran-float"')}
<div class="kamran-pop" id="kamran-pop" role="dialog" aria-modal="false" aria-labelledby="kamran-pop-h" hidden>
  <p class="kp-h" id="kamran-pop-h">Talk to Kamran (AI voice)</p>
  <p>Kamran is an AI voice that answers questions about trainsyou. Calls are not connected in this prototype.</p>
  <button type="button" class="btn btn-secondary btn-sm" data-kamran-close>Close</button>
</div>
<button type="button" class="dev-btn" data-dev-open aria-expanded="false" aria-controls="devpanel"><span class="mono">dev</span></button>
<div class="devpanel" id="devpanel" role="dialog" aria-modal="false" aria-labelledby="devpanel-h" hidden>
  <div class="dev-head"><p id="devpanel-h">Prototype controls</p><button type="button" class="dev-close" data-dev-close aria-label="Close prototype controls">${icon("x")}</button></div>
  <div class="dev-body">
    <p class="dev-label">Live state</p>
    ${sw("payments", "Subscriber payments + payouts", "on", "Off in production")}
    ${sw("publish", "Publishing (launch gate passed)", "on", "Blocked while payments are off")}
    ${sw("registration", "Registration open", "open", "Off shows the early-access labels")}
    ${sw("frontier", "Frontier model wording", "on", "Flag off live: fallback copy")}
    ${sw("voice", "Voice add-on for subscribers", "on", "Not on yet")}
    ${sw("motion", "Reduce motion for OS setting", "respect", "Owner decision 5; default plays always")}
    <div class="dev-actions"><button type="button" class="btn btn-secondary btn-sm" data-replay-hero>${icon("replay")}Replay hero</button><button type="button" class="btn btn-ghost btn-sm" data-dev-reset>Reset</button><button type="button" class="btn btn-ghost btn-sm" data-consent-open>Consent bar</button></div>
    <a class="dev-gallery" href="../">← All concepts</a>
    <p class="dev-label">All ${PAGES.length} pages</p>
    <ul class="dev-pages">${pages}</ul>
  </div>
</div>`;
}

const defaultSecondary = (page) => {
  if (page.cta && !/^\/(signup|get-started)/.test(page.cta.href)) return { label: page.cta.label, path: page.cta.href };
  return page.path === "/demo" ? { label: "See how it works", path: "/how-it-works" } : { label: "Try the demo", path: "/demo" };
};

/**
 * The full HTML document for one page.
 * result: { main, title?, description?, closing? (false | { secondary }), css?: [], js?: [], bodyClass? }
 */
export function renderDocument(page, result) {
  const r = typeof result === "string" ? { main: result } : result;
  const title = r.title ?? (page.path === "/" ? `trainsyou · ${page.title}` : `${page.title} · trainsyou`);
  const description = r.description ?? page.description ?? "";
  const css = ["site.css", `${page.module}.css`, ...(r.css || [])];
  const js = [...(r.js || []), `${page.module}.js`];
  const closing = r.closing === false ? "" : closingPanel({ secondary: r.closing?.secondary === undefined ? defaultSecondary(page) : r.closing.secondary });
  const flagAttrs = Object.entries({ ...FLAGS, motion: "always" }).map(([k, v]) => ` data-${k}="${v}"`).join("");
  return `<!doctype html>
<html lang="en" dir="ltr"${flagAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${page.noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta name="color-scheme" content="light">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
${css.map((f) => `<link rel="stylesheet" href="assets/${f}">`).join("\n")}
<script>(function(h){h.classList.add("js");try{var f=JSON.parse(localStorage.getItem("tyA.flags")||"{}");for(var k in f)if(/^(payments|registration|frontier|voice|publish|motion)$/.test(k))h.setAttribute("data-"+k,String(f[k]))}catch(e){}})(document.documentElement)</script>
</head>
<body data-page="${esc(page.path)}" data-module="${page.module}"${r.bodyClass ? ` class="${r.bodyClass}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
${header(page.path)}
<main id="main" tabindex="-1">
${r.main}
${closing}
</main>
${footer()}
${chrome()}
<script src="assets/site.js" defer></script>
${js.map((f) => `<script src="assets/${f}" defer></script>`).join("\n")}
</body>
</html>
`;
}
