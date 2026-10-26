// Page group "content": /guides, /guides/* (4), /faq, /about, /methodology, /terms, /privacy,
// /ai-disclosure, /coaches and /404. Concept A "Live Brain".
// Copy: blueprint C13, C14, C18-C23 first, content.json for the rest. Legal text comes from the
// published policy pack (docs/legal/uae-2026-10 in the repo) and is rendered in full.
// Signature pieces: guide covers, the article doc layout (sticky TOC with a sliding indicator,
// in-context tools), the FAQ command palette with topic tabs, the methodology pipeline and
// source ledger (evidence filters, arrival highlight), the about "What shipped" log, the
// coaches empty directory and the 404 console line.
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { content } from "./registry.mjs";
import {
  esc, icon, cta, ctaMicro, button, textLink, link, band, sectionHead, chip, flagChip, notOnYet, sourceBadge, sourceById,
  estimateLabel, sampleLabel, pendingTag, founderNote, faqList, vx, ruleBuilder, addressPreview, kamranPill,
  windowFrame, dataTable, lanePill, statementLines, href,
} from "./components.mjs";

// The browser maths module doubles as CommonJS, so build-time figures match the live widgets.
const calc = createRequire(import.meta.url)("../site/assets/calc.js");

/* ================================================================ shared */

const page = (p) => {
  const x = content.pages.find((pg) => pg.path === p);
  if (!x) throw new Error("No content page " + p);
  return x;
};
const pad2 = (n) => String(n).padStart(2, "0");
const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
/** "28 Sept 2026" (the live site's legal date format). */
const dateLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mono = (s) => ({ html: `<span class="mono">${esc(s)}</span>` });

/** Build-time word-budget check (C0): warns, never changes copy. */
function budget(label, text, max) {
  const n = words(text);
  if (n > max) console.warn(`[content] ${label}: ${n} words (budget ${max})`);
  return text;
}

/** C0 copy rules on content.json strings: grade-6 vocabulary and "your AI". */
function plain(s) {
  return String(s ?? "")
    .replace(/held-out scenarios/g, "your test cases")
    .replace(/ (?:using|in) marginal bands of 25%, 20%, 15% and 10%/g, " that falls as you grow: 25%, 20%, 15% and 10%, each for its own group of subscribers")
    .replace(/ in marginal bands:/g, ", set for each group of subscribers:")
    .replace(/the standard marginal bands:/g, "the standard bands, each rate for its own group of subscribers:")
    .replace(/\bThe Brain\b/g, "Your AI")
    .replace(/\bthe Brain\b/g, "your AI")
    .replace(/“Available soon”/g, "“Not on yet”")
    .replace(/trainsyou learns/g, "your AI learns");
}

/** Small local icons (same 16px stroke system as components.icon). */
const svg = (d, cls = "") =>
  `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC_SEARCH = svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/>');
const IC_DOC = svg('<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>');

/** A method badge (no market source; links the method section). */
const methodBadge = (hash, label = "Method") =>
  `<a class="source-badge" href="methodology.html#${hash}" data-track="source_open" data-source="${hash}">${esc(label)}${icon("arrow")}</a>`;

/** Hero for long-form pages: copy on 7 columns, an aside on 5. */
function docHero({ kicker = "", h1, meta = [], body = "", aside = "", cls = "" }) {
  return `<section class="band band-white hero doc-hero${cls ? " " + cls : ""}" data-hero aria-labelledby="hero-h">
  <div class="wrap doc-hero-grid">
    <div class="doc-hero-copy">
      ${kicker ? `<p class="kicker">${kicker}</p>` : ""}
      <h1 id="hero-h">${esc(h1)}</h1>
      ${meta.length ? `<p class="doc-meta mono">${meta.map((m) => `<span>${m}</span>`).join("")}</p>` : ""}
      ${body}
    </div>
    ${aside ? `<div class="doc-hero-aside">${aside}</div>` : ""}
  </div>
</section>`;
}

/** Table of contents: sticky on desktop (indicator moves by transform), a disclosure on phones. */
function toc(items, { id = "toc", title = "On this page" } = {}) {
  return `<nav class="toc" id="${id}" aria-labelledby="${id}-h" data-toc>
  <button type="button" class="toc-toggle" aria-expanded="false" aria-controls="${id}-body"><span>${esc(title)}</span><span class="mono toc-count">${items.length} sections</span>${icon("chevron", "toc-chev")}</button>
  <p class="toc-h" id="${id}-h">${esc(title)}</p>
  <div class="toc-body" id="${id}-body"><div><div class="toc-track"><ol class="toc-list">${items
    .map((it, i) => `<li><a href="#${it.id}" data-toc-link="${it.id}"><span class="mono toc-n">${pad2(i + 1)}</span><span>${esc(it.label)}</span></a></li>`)
    .join("")}</ol><span class="toc-ink" aria-hidden="true"></span></div></div></div>
</nav>`;
}
const docLayout = (tocHtml, body, { cls = "", attrs = "" } = {}) =>
  `<div class="doc${cls ? " " + cls : ""}"><aside class="doc-toc">${tocHtml}</aside><div class="doc-body"${attrs ? " " + attrs : ""}>${body}</div></div>`;

/** FAQ accordion with html answers (same markup and hooks as components.faqList). */
function faqItems(list, { prefix = "faq", level = 3 } = {}) {
  return `<div class="faq" data-accordion>${list
    .map((f) => {
      const id = `${prefix}-${f.id}`;
      return `<div class="faq-item arrive" id="q-${f.id}" data-faq-item${f.show ? ` data-show="${f.show}"` : ""}>
  <h${level} class="faq-q"><button type="button" id="${id}-b" aria-expanded="false" aria-controls="${id}" data-faq="${esc(f.id)}"><span>${esc(f.q)}</span><span class="faq-ic" aria-hidden="true"></span></button></h${level}>
  <div class="faq-a" id="${id}" role="region" aria-labelledby="${id}-b"><div>${f.html}</div></div>
</div>`;
    })
    .join("")}</div>`;
}

/** FAQ band used by the long-form pages: heading left, accordion right, Kamran inline on phones. */
/** Answers trimmed to the 45-word FAQ budget (C0); meaning unchanged. */
const FAQ_TRIM = {
  "Why do the calculator’s scenarios differ so much?":
    "Cautious and typical use published averages from brand accounts, retail and apps. The strong case uses the top values found in the research and our assumptions for an engaged, growing audience: a best case, not a typical result. Yours will differ.",
  "Does sharing my link every day help?":
    "Some. Each Story gives the same viewers another chance to tap, so within a month the gain levels off, and link stickers can reduce engagement. Over months, regular sharing reaches new people. Reels with a comment keyword and your bio link reach new people too.",
};

function faqBand({ faqs, prefix, title = "Questions", id, tone = "white", aside = "" }) {
  const list = faqs.map((f, i) => ({ q: plain(f.q), a: budget(`${prefix} FAQ "${f.q}"`, plain(FAQ_TRIM[f.q] ?? f.a), 45), id: f.id || `${prefix}${i + 1}` }));
  return band(
    { tone, cls: "faq-band", label: id },
    `<div class="split faq-split">
  <div class="s-copy" data-reveal>
    <h2 id="${id}">${esc(title)}</h2>
    <p class="mt-s">${textLink("/faq", "All questions")}</p>
    ${aside}
    <div class="kamran-inline-m">${kamranPill()}</div>
  </div>
  <div class="s-media" data-reveal>${faqList(list, { prefix })}</div>
</div>`,
  );
}

/** "Sources:" row of source badges, labelled by publisher. */
const sourcesRow = (ids = []) =>
  ids.length ? `<p class="art-sources"><span class="art-src-l">Sources</span>${ids.map((id) => sourceBadge(id, { label: sourceById(id).publisher })).join("")}</p>` : "";

/** Words in a content page (for reading time). */
function pageWords(p) {
  const parts = [p.intro, p.lede];
  for (const s of p.sections || []) {
    parts.push(s.heading, ...(s.body || []), ...(s.bullets || []), s.note);
    for (const st of s.steps || []) parts.push(st.title, st.body);
    for (const c of s.cards || []) parts.push(c.title, c.body);
    for (const r of s.table?.rows || []) parts.push(r.join(" "));
  }
  for (const f of p.faqs || []) parts.push(f.q, f.a);
  return words(parts.filter(Boolean).join(" "));
}
const readMins = (n) => Math.max(2, Math.ceil(n / 220));

/* ============================================================ GUIDES */

const GUIDES = ["/guides/pricing-online-coaching-uae", "/guides/instagram-followers-to-clients", "/guides/uae-advertiser-permit", "/guides/writing-coaching-rules"];

/** Per-guide treatment. h1: C14 rewrites (titles keep their search wording). */
const GUIDE = {
  "/guides/pricing-online-coaching-uae": {
    n: 1, short: "Pricing", q: "What should I charge?", art: "pricing",
    h1: "How to price online coaching in the UAE",
    excerpt: "Published AED ranges, worked examples and what commission costs, so your price adds up.",
    headings: { why: "Why subscriptions price differently" },
    inlineAfter: "ranges",
    closing: { label: "Estimate my earnings", path: "/earnings-calculator" },
  },
  "/guides/instagram-followers-to-clients": {
    n: 2, short: "Followers to clients", q: "Will my followers pay?", art: "funnel",
    h1: "Turning Instagram followers into paying clients",
    excerpt: "Why most followers never see a Story, and what turns the ones who do into clients.",
    headings: { "same-people": "Why repeat sharing levels off", steps: "What to do, step by step" },
    inlineAfter: "funnel",
    closing: { label: "See what my followers are worth", path: "/follower-calculator" },
  },
  "/guides/uae-advertiser-permit": {
    n: 3, short: "Advertiser permit", q: "Do I need a permit?", art: "permit",
    h1: "What the UAE advertiser permit means for trainers",
    excerpt: "What reports say, when promoting your own coaching is exempt, and a checklist before you post.",
    headings: {},
    inlineAfter: "own",
    closing: { label: "Read the FAQ", path: "/faq" },
  },
  "/guides/writing-coaching-rules": {
    n: 4, short: "Writing rules", q: "How do I teach my AI?", art: "rules",
    h1: "Writing coaching rules your AI can follow",
    excerpt: "Write each rule as when, do, unless, because. Then check it against your test cases.",
    headings: { test: "Check rules against your test cases" },
    inlineAfter: "format",
    closing: { label: "Try the demo", path: "/demo" },
  },
};

/** Copy fixes for individual guide strings (C0 vocabulary where a plain swap would not read well). */
const GUIDE_TEXT = {
  "Once live, the Brain hands you anything below your confidence threshold. When you approve or correct it, the correction is recorded with its reason and becomes teaching; the next release is evaluated against your scenarios before it goes live, and you can roll back to an earlier release at any time.":
    "Once live, your AI hands you anything it is not sure enough about; you set how sure it must be. When you approve or correct it, the correction is recorded with its reason and becomes teaching. The next release is checked against your test cases before it goes live, and you can roll back to an earlier release at any time.",
};
const gtext = (s) => plain(GUIDE_TEXT[s] ?? s);

/** Cover art: small product-style sketches, no figures (figures live in the article with sources). */
function coverArt(kind) {
  if (kind === "pricing")
    return `<div class="ca ca-tiers"><p><span>Workout</span><span class="mono">AED ···</span></p><p><span>+ Nutrition</span><span class="mono">AED ···</span></p><p><span>+ Voice add-on</span><span class="mono">AED ···</span></p></div>`;
  if (kind === "funnel")
    return `<div class="ca ca-funnel"><p style="--w:1"><span>See</span></p><p style="--w:.62"><span>Tap</span></p><p style="--w:.3"><span>Pay</span></p></div>`;
  if (kind === "permit")
    return `<div class="ca ca-check"><p><span>Your own coaching</span>${lanePill("Reported exempt", "applied")}</p><p><span>A brand deal</span>${lanePill("Check first", "toyou")}</p></div>`;
  return `<div class="ca ca-rule mono"><p><b>When</b><span>2 easy sessions</span></p><p><b>Do</b><span>+2.5 kg</span></p><p><b>Unless</b><span>poor sleep</span></p><p><b>Because</b><span>recovery first</span></p></div>`;
}

/** A guide cover (whole card is one link). */
function guideCover(path, { compact = false, level = 3 } = {}) {
  const p = page(path), g = GUIDE[path];
  const meta = `<p class="cover-meta mono"><span>${readMins(pageWords(p))} min read</span><span>Updated ${dateLabel(p.lastUpdated)}</span>${icon("arrow")}</p>`;
  return `<a class="cover${compact ? " cover-compact" : ""} ri" href="${href(path)}" data-track="guide_open" data-guide="${esc(path)}">
  ${compact ? "" : `<div class="cover-art" aria-hidden="true"><span class="cover-n mono">${pad2(g.n)}</span>${coverArt(g.art)}</div>`}
  <div class="cover-body">
    <p class="cover-q">${esc(g.q)}</p>
    <h${level} class="cover-t">${esc(g.h1)}</h${level}>
    ${compact ? "" : `<p class="cover-x">${esc(budget(`cover ${path}`, g.excerpt, 18))}</p>`}
    ${meta}
  </div>
</a>`;
}

/** Earnings mini (static figures computed here; live in content.js where `live`). */
function earningsTool({ subs = 60, price = 199, rate = 250, live = false, id = "me" } = {}) {
  const e = calc.compactEarnings(subs, price, rate);
  const field = (name, label, value, max, affix = "") =>
    `<div class="field"><label for="${id}-${name}">${esc(label)}</label><div class="${affix ? "input-affix" : ""}">${affix ? `<span class="affix">${affix}</span>` : ""}<input class="input" id="${id}-${name}" name="${name}" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${value}"></div></div>`;
  const inputs = live
    ? `<div class="mt-fields">${field("price", "Your monthly price", price, 10000, "AED")}${field("subs", "Paying subscribers", subs, 100000)}</div>`
    : `<p class="mt-inputs mono"><span>${subs} subscribers</span><span>AED ${price} a month</span><span>Sample inputs</span></p>`;
  return windowFrame(
    `${inputs}
    <div class="calc-head">${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
    <p class="mt-figure"><span class="calc-figure">${vx(calc.aed(e.beforeOtherCostsMinor), 10, { cls: "me-net" })}</span></p>
    <p class="calc-sub">a month before other costs and tax</p>
    <dl class="stmt mt-m">
      <div class="stmt-row"><dt>Subscriptions</dt><dd>${vx(calc.aed(e.subscriptionMonthlyMinor), 11, { cls: "vx-end me-subs" })}</dd></div>
      <div class="stmt-row"><dt>Our share (<span class="mono">${vx(calc.pct(e.effectiveCommissionPct, 2), 0, { cls: "me-pct" })}</span> overall)</dt><dd>${vx("− " + calc.aed(e.commissionMinor), 13, { cls: "vx-end me-comm" })}</dd></div>
    </dl>
    <div class="calc-foot">${methodBadge("earnings-calculator")}<span class="note">Subscriptions only. Not an earnings promise.</span></div>
    <p class="sr-only" aria-live="polite" data-live></p>`,
    { title: "Earnings estimate", meta: "monthly", cls: "calc-window mt-window" },
  );
}

/** Follower mini: best case headline with typical and cautious as lanes. */
function followerTool({ followers = 7000, live = false, id = "mf" } = {}) {
  const d = { ...calc.FOLLOWER_DEFAULTS, followers };
  const est = calc.estimateFollowers(d);
  const v = (s) => est.scenarios[s].revenueMonth12Minor;
  const max = Math.max(1, v("strong"));
  const lane = (key, label) =>
    `<div class="calc-lane" data-lane="${key}"><span class="calc-lane-label">${esc(label)}</span><span class="calc-lane-bar"><span style="--v:${(v(key) / max).toFixed(4)}"></span></span><span class="calc-lane-val">${vx(calc.aed(v(key)), 11, { cls: "vx-end mfl-" + key })}</span></div>`;
  const inputs = live
    ? `<div class="mt-fields mt-fields-1"><div class="field"><label for="${id}-followers">Your Instagram followers</label><input class="input" id="${id}-followers" name="followers" type="number" inputmode="numeric" min="0" max="10000000" step="1" value="${followers}"></div></div>
       <p class="note mt-assume">At AED ${d.priceAed} a month, ${d.linkStoriesPerMonth} link Stories and ${d.ctaReelsPerMonth} keyword Reels a month, ${d.yearlyCancelPct}% cancelling a year.</p>`
    : `<p class="mt-inputs mono"><span>${calc.whole(followers)} followers</span><span>AED ${d.priceAed} a month</span><span>${d.linkStoriesPerMonth} link Stories</span></p>`;
  return windowFrame(
    `${inputs}
    <div class="calc-head">${chip("Best case", "neutral")}${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
    <p class="calc-figure-line"><span class="calc-upto">Up to</span> <span class="calc-figure">${vx(calc.aed(v("strong")), 10, { cls: "mf-strong" })}</span></p>
    <p class="calc-sub">a month at your price, before platform commission</p>
    <div class="calc-lanes">${lane("cautious", "Cautious")}${lane("typical", "Typical")}${lane("strong", "Best case")}</div>
    <div class="calc-foot">${sourceBadge("revenuecat-state-2026", { label: "Sources" })}<span class="note">Active subscribers after 12 months × your price.</span></div>
    <p class="sr-only" aria-live="polite" data-live></p>`,
    { title: "Follower estimate", meta: "12 months", cls: "calc-window mt-window" },
  );
}

/* ----------------------------------------------------------- /guides */

function guidesIndex() {
  const p = page("/guides");
  return {
    title: `${p.title} · trainsyou`,
    main: [
      `<section class="band band-white hero guides-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">Guides</p>
      <h1 id="hero-h">Guides for taking your coaching online</h1>
      <p class="lede">${esc(budget("guides lede", "Practical, sourced guides for UAE trainers: pricing, followers, the advertiser permit and rules your AI can follow.", 25))}</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${button("/earnings-calculator", "Estimate my earnings", { location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">
      <h2 class="sr-only">Four guides</h2>
      <div class="covers">${GUIDES.map((g) => guideCover(g)).join("")}</div>
    </div>
  </div>
</section>`,
      band(
        { tone: "paper", cls: "tools-band", label: "tools-h" },
        `${sectionHead({ kicker: "Tools", title: "Run your own numbers", id: "tools-h", layout: "split", lede: "Two calculators, the same maths the guides use. Every market figure links to its source." })}
<div class="tools" data-reveal="stagger">
  <div class="tool ri">
    <div class="tool-head"><h3>Earnings calculator</h3><p>What you keep at your price, after our share.</p></div>
    ${earningsTool({ id: "gi-e" })}
    <p class="tool-cta">${button("/earnings-calculator", "Estimate my earnings", { location: "inline" })}</p>
  </div>
  <div class="tool ri">
    <div class="tool-head"><h3>Follower calculator</h3><p>A best case from your followers, with typical and cautious beside it.</p></div>
    ${followerTool({ id: "gi-f" })}
    <p class="tool-cta">${button("/follower-calculator", "See what my followers are worth", { location: "inline" })}</p>
  </div>
</div>
<p class="tools-foot">${textLink("/methodology", "How we source numbers")}</p>`,
      ),
    ].join("\n"),
    closing: { secondary: { label: "Estimate my earnings", path: "/earnings-calculator" } },
    js: ["calc.js"],
  };
}

/* ------------------------------------------------------- guide article */

/** Parse "When …, do …, unless …, because …" into the four rule parts. */
function ruleParts(sentence) {
  const s = sentence.replace(/\.$/, "");
  const iU = s.indexOf(", unless "), iB = s.indexOf(", because ");
  const head = s.slice(0, iU), i1 = head.indexOf(", ");
  return [
    ["When", head.slice(5, i1)],
    ["Do", head.slice(i1 + 2)],
    ["Unless", s.slice(iU + 9, iB)],
    ["Because", s.slice(iB + 10)],
  ];
}
const ruleCard = (title, sentence, tag = "Illustrative") =>
  `<article class="rcard ri"><header class="rcard-head"><span><span class="rcard-k">Your rule</span>${esc(title)}</span>${chip(tag, "sample")}</header><dl>${ruleParts(sentence)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join("")}</dl></article>`;

/** Strong-case table for three example accounts, computed with the calculator's maths. */
function followerExamples() {
  const count = (n) => {
    const c = calc.displayCount(n);
    return c === null ? "< 1" : calc.whole(c);
  };
  const D = calc.FOLLOWER_DEFAULTS;
  const rows = [3000, 7000, 30000].map((followers) => {
    const e = calc.estimateFollowers({ ...D, followers }).scenarios.strong;
    return [calc.whole(followers), mono(count(e.month1New)), mono(count(e.activeMonth12)), mono(count(e.signups12)), mono(calc.aed(e.revenueMonth12Minor))];
  });
  return `<div class="art-block" data-reveal>
  <p class="art-chips">${chip("Best case", "neutral")}${notOnYet("payments", "subscriber payments")}${estimateLabel()}</p>
  ${dataTable({
    caption: `Strong case, a best case for an engaged, growing audience and not a typical result: AED ${D.priceAed} a month, ${D.linkStoriesPerMonth} link Stories and ${D.ctaReelsPerMonth} keyword Reels a month, ${D.yearlyCancelPct}% yearly cancellations (assumptions version ${calc.FOLLOWER_MODEL.version}).`,
    columns: ["Followers", "New subscribers, first month", "Active after 12 months", "Sign-ups over 12 months", "A month at month 12"],
    rows,
    cls: "table-num",
  })}
  <p class="art-more">${textLink("/methodology#strong-case", "How the strong case is calibrated")}</p>
</div>`;
}

/** One article section from content.json. */
function articleSection(path, s) {
  const g = GUIDE[path];
  const heading = g.headings[s.id] || s.heading;
  budget(`H2 ${path}#${s.id}`, heading, 6);
  const parts = [];
  if (s.body?.length) parts.push(`<div class="art-block art-p">${s.body.map((b) => `<p>${esc(gtext(b))}</p>`).join("")}</div>`);
  if (s.bullets?.length) parts.push(`<ul class="art-block art-list">${s.bullets.map((b) => `<li>${esc(gtext(b))}</li>`).join("")}</ul>`);
  if (s.steps?.length) {
    const isRule = path.endsWith("writing-coaching-rules") && s.id === "format";
    parts.push(
      `<ol class="art-block art-steps${isRule ? " art-steps-rule" : ""}">${s.steps
        .map((st, i) => `<li><span class="st-n mono">${isRule ? esc(st.title) : pad2(i + 1)}</span>${isRule ? "" : `<h3>${esc(st.title)}</h3>`}<p>${esc(gtext(st.body))}</p></li>`)
        .join("")}</ol>`,
    );
  }
  if (s.cards?.length) parts.push(`<div class="art-block rule-cards" data-reveal="stagger">${s.cards.map((c) => ruleCard(c.title, c.body, c.label)).join("")}</div>`);
  if (s.table) {
    const t = s.table;
    const money = path.endsWith("pricing-online-coaching-uae") && s.id === "examples";
    parts.push(
      `<div class="art-block" data-reveal>${money ? `<p class="art-chips">${notOnYet("payments", "subscriber payments")}${chip("Arithmetic, not a forecast", "estimate")}</p>` : ""}${dataTable({
        caption: t.caption,
        columns: t.columns,
        rows: t.rows.map((r) => r.map((c, i) => (i > 0 && /AED|%|About/.test(c) ? mono(c) : c))),
        cls: "table-num",
      })}</div>`,
    );
  }
  if (path.endsWith("instagram-followers-to-clients") && s.id === "examples") parts.push(followerExamples());
  if (s.note) parts.push(`<p class="art-block note art-note">${esc(gtext(s.note))}</p>`);
  if (s.sources?.length) parts.push(sourcesRow(s.sources));
  return `<section class="art-sec" id="${s.id}" aria-labelledby="${s.id}-h"><h2 id="${s.id}-h">${esc(heading)}</h2>${parts.join("")}</section>`;
}

/** The in-context next step after the first useful section (C14). */
function inlineTool(path) {
  if (path.endsWith("pricing-online-coaching-uae"))
    return `<aside class="itool" aria-labelledby="ic-h" data-mini-earn data-reveal>
  <div class="itool-copy"><p class="kicker">Try it</p><h3 id="ic-h">Your price, after our share</h3><p>Change the price and the number of paying subscribers. The calculator adds nutrition, voice and sessions.</p>
  <p class="itool-cta"><a class="btn btn-secondary" href="earnings-calculator.html?price=199&amp;subs=60" data-cta="secondary" data-loc="inline" data-mini-go>Try my price in the earnings calculator${icon("arrow", "btn-arrow")}</a></p></div>
  <div class="itool-tool">${earningsTool({ live: true, id: "ge" })}</div>
</aside>`;
  if (path.endsWith("instagram-followers-to-clients"))
    return `<aside class="itool" aria-labelledby="ic-h" data-mini-follow data-reveal>
  <div class="itool-copy"><p class="kicker">Try it</p><h3 id="ic-h">Put your own follower count in</h3><p>The same maths as the follower calculator, with its other inputs at their defaults.</p>
  <p class="itool-cta">${button("/follower-calculator", "See what my followers are worth", { location: "inline" })}</p></div>
  <div class="itool-tool">${followerTool({ live: true, id: "gf" })}</div>
</aside>`;
  if (path.endsWith("writing-coaching-rules"))
    return `<aside class="itool itool-rule" aria-labelledby="ic-h" data-reveal>
  <div class="itool-copy"><p class="kicker">Try it</p><h3 id="ic-h">Change a rule, see the decision</h3><p>Edit the sample progression rule. The outcome follows your numbers.</p>
  <p class="itool-cta">${button("/demo", "Try editing a rule in the demo", { location: "inline" })}</p></div>
  <div class="itool-tool">${ruleBuilder({ id: "guide-rule" })}<p class="mt-s">${sampleLabel("Sample trainer · scripted · no AI model called")}</p></div>
</aside>`;
  return `<aside class="itool itool-addr" aria-labelledby="ic-h" data-reveal>
  <div class="itool-copy"><p class="kicker">Your own coaching</p><h3 id="ic-h">Promote your own address</h3><p>Your link goes to your own coaching site and app, under your name.</p></div>
  <div class="itool-tool"><div class="card">${addressPreview({ id: "permit-addr" })}</div></div>
</aside>`;
}

/** The hero aside: each guide's key panel. */
function guideAside(path) {
  if (path.endsWith("pricing-online-coaching-uae"))
    return `<div class="kp">
  <p class="kp-h">Published ranges</p>
  <div class="kp-fig"><p class="fact-figure">AED 70–350</p><p>a one-to-one session in Dubai ${sourceBadge("heytrainer-dubai-2026")}</p></div>
  <div class="kp-fig"><p class="fact-figure">AED 400–2,000</p><p>a month of online coaching, basic to premium ${sourceBadge("369mmafit-online-2026")}</p></div>
  <p class="note">Price guides published by fitness businesses, not official statistics.</p>
</div>`;
  if (path.endsWith("instagram-followers-to-clients")) {
    const rows = [
      ["See a Story", "9.6–10.4%", "of followers, brand accounts with 1–5K followers", "socialinsider-stories", 1],
      ["Tap the link", "1–5%", "of viewers per link Story, from creator reports", "creatorflow-link-sticker", 0.74],
      ["Pay", "0.72–6.2%", "of visitors, from retail and app proxies", "revenuecat-state-2026", 0.48],
    ];
    return `<div class="kp">
  <p class="kp-h">The follower funnel</p>
  <ol class="funnel">${rows
    .map(([step, val, of, src, w], i) => `<li><span class="fn-n mono">${pad2(i + 1)}</span><span class="fn-step">${step}</span><span class="fn-val">${val}</span><span class="fn-of">${of} ${sourceBadge(src)}</span><span class="fn-bar" style="--w:${w}" aria-hidden="true"></span></li>`)
    .join("")}</ol>
  <p class="note">Shapes are not to scale.</p>
</div>`;
  }
  if (path.endsWith("uae-advertiser-permit"))
    return windowFrame(
      `<p class="cp-label">What reports say</p>
  <ul class="pcheck">
    <li><span>Promoting your own coaching, from your personal account</span>${lanePill("Reported exempt", "applied")}</li>
    <li><span>A paid or gifted post for a gym, brand or supplement</span>${lanePill("Check the rules first", "toyou")}</li>
    <li><span>Another trainer’s programme, or affiliate links</span>${lanePill("Check the rules first", "toyou")}</li>
  </ul>
  <p class="pcheck-foot"><span class="note">Information, not legal advice. Rules change.</span><span class="pcheck-src">${sourceBadge("gulfnews-advertiser-permit", { label: "Gulf News" })}${sourceBadge("uae-media-council-permit", { label: "UAE Media Council" })}</span></p>`,
      { title: "Permit check", meta: "Reports", cls: "permit-window" },
    );
  const ex = page(path).sections.find((s) => s.id === "example").cards[0];
  return `<div class="kp kp-rule">${ruleCard(ex.title, ex.body, ex.label)}<p class="note">Every rule keeps its source, so you can see why your AI did what it did.</p></div>`;
}

function guideArticle(path) {
  return () => {
    const p = page(path), g = GUIDE[path];
    const n = pageWords(p), srcCount = new Set(p.sections.flatMap((s) => s.sources || [])).size;
    const secs = p.sections;
    const items = secs.map((s) => ({ id: s.id, label: g.headings[s.id] || s.heading }));
    items.push({ id: "guide-faq-h", label: "Questions" });
    const at = secs.findIndex((s) => s.id === g.inlineAfter);
    const body = secs.map((s, i) => articleSection(path, s) + (i === at ? inlineTool(path) : "")).join("");
    const others = GUIDES.filter((x) => x !== path);
    const relatedTools = (p.related || []).filter((r) => !r.startsWith("/guides"));
    budget(`H1 ${path}`, g.h1, 8);
    return {
      title: `${p.title} · trainsyou`,
      description: plain(p.description).replace("with your test cases", "on your test cases"),
      main: [
        docHero({
          kicker: `<a class="crumb" href="guides.html">Guides</a><span aria-hidden="true">/</span><span>Guide ${pad2(g.n)} of 04</span>`,
          h1: g.h1,
          meta: [`${readMins(n)} min read`, `Updated ${dateLabel(p.lastUpdated)}`, srcCount ? `${srcCount} sources` : ""].filter(Boolean),
          body: `<div class="in-short"><p class="kicker">In short</p><p>${esc(gtext(p.intro))}</p></div>`,
          aside: guideAside(path),
          cls: "guide-hero",
        }),
        band({ tone: "white", cls: "doc-band" }, docLayout(toc(items, { id: "guide-toc" }), `<article class="art" data-guide-body>${body}</article>`)),
        faqBand({ faqs: p.faqs, prefix: "gfaq", id: "guide-faq-h", title: "Questions", tone: "paper" }),
        band(
          { tone: "white", cls: "more-band", label: "more-h" },
          `${sectionHead({ title: "Keep reading", id: "more-h", layout: "split", lede: "The other guides, and the tools this one points to." })}
<div class="covers covers-compact" data-reveal="stagger">${others.map((o) => guideCover(o, { compact: true })).join("")}</div>
${relatedTools.length ? `<p class="more-tools" data-reveal>${relatedTools.map((r) => textLink(r, page(r).navLabel)).join("")}</p>` : ""}`,
        ),
      ].join("\n"),
      closing: { secondary: g.closing },
      js: path.endsWith("pricing-online-coaching-uae") || path.endsWith("instagram-followers-to-clients") ? ["calc.js"] : [],
    };
  };
}

/* =============================================================== FAQ */

/** Questions grouped by objection (C18). Answers come from content.json, rebuilt where C18 says so. */
function faqGroups() {
  const f = (path, q) => {
    const x = page(path).faqs.find((i) => i.q === q);
    if (!x) throw new Error(`FAQ not found: ${path} "${q}"`);
    return x.a;
  };
  const fr = (q) => (content.availabilityLines || []).find((l) => l.when === "frontier" && l.faq?.q === q)?.faq.a;
  const P = (t, label) => `<p>${esc(budget(`FAQ ${label}`, plain(t), 45))}</p>`;
  const item = (id, q, text) => ({ id, q, html: P(text, q) });
  const frontierOnly = (content.availabilityLines || []).find((l) => l.when === "frontier" && l.path === "/faq" && l.faq);
  const connectRows = [
    ["Apple Health exports", chip("Live", "live")],
    ["WHOOP", chip("Not on yet", "soon")],
    ["Zepp", chip("Not on yet", "soon")],
    ["Your own domain", chip("Not on yet", "soon")],
    ["Instagram", chip("Not on yet", "soon")],
    ["Voice add-on for subscribers", flagChip("voice", "Live", "Not on yet")],
  ];
  return [
    {
      id: "control", label: "Your AI and control", line: "It acts only where your rules make it sure. Everything else comes to you.",
      link: ["/trainer-brain", "How your AI decides"],
      items: [
        item("replace", "Will your AI replace me?", f("/faq", "Will the AI replace me?")),
        {
          id: "data", q: "Is your AI trained on my data?",
          html: `<p data-show="frontier:off">${esc(budget("FAQ data", plain(f("/faq", "Is the AI trained on my data?")), 45))}</p><p data-show="frontier:on">${esc(budget("FAQ data frontier", plain(fr("Is the AI trained on my data?")), 45))}</p>`,
        },
        item("bad-advice", "Will it give bad advice under my name?", f("/faq", "Will it give bad advice under my name?")),
        item("untaught", "What does your AI do with a situation I never taught?", f("/guides/writing-coaching-rules", "What does the Brain do with a situation I never taught?")),
        ...(frontierOnly ? [{ id: "better", q: frontierOnly.faq.q, html: P(frontierOnly.faq.a, "better"), show: "frontier:on" }] : []),
      ],
    },
    {
      id: "safety", label: "Safety", line: "Pain, medical issues and red flags always come to you, enforced in code.",
      link: ["/features/safety", "Safety rules"],
      items: [
        item("pain", "What happens when a subscriber reports pain?", f("/faq", "What happens when a subscriber reports pain?")),
        item("medical", "Is trainsyou a medical service?", f("/about", "Is trainsyou a medical service?")),
      ],
    },
    {
      id: "money", label: "Money", line: "Free to join. We earn only when your subscribers pay.",
      link: ["/pricing", "Pricing in detail"],
      extra: `<p class="fp-chip">${notOnYet("payments", "subscriber payments")}</p>`,
      items: [
        item("cost", "Does it cost anything to join?", f("/faq", "Does it cost anything to join?")),
        {
          id: "pay-today", q: "Can subscribers pay me today?",
          html: `<p data-show="payments:off">Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can join, set up your page and app, and teach and test your AI.</p><p data-show="payments:on">Yes. Once your page is published, subscribers pay by card in AED at the price you set.</p>`,
        },
        item("price", "Who sets the subscription price?", f("/faq", "Who sets the subscription price?")),
        {
          id: "payout", q: "How does money reach me?",
          html: `<p>${esc("Subscribers pay by card in AED. After reconciliation, your earnings are paid monthly to your verified UAE bank account, with a statement from gross to net.")}</p><p class="faq-chips">${notOnYet("payments", "subscriber payments and payouts")}</p>`,
        },
        item("refund", "Is cancellation the same as a refund?", f("/faq", "Is cancellation the same as a refund?")),
        item("get", "What does a subscriber get for their money?", f("/faq", "What does a subscriber get for their money?")),
      ],
    },
    {
      id: "setup", label: "Setup", line: "A guided checklist. Nothing goes live until you publish.",
      link: ["/get-started", "See the setup steps"],
      items: [
        item("skills", "Do I need technical skills?", f("/faq", "Do I need technical skills?")),
        {
          id: "connect", q: "What can I connect?",
          html: `<p>Apple Health exports work today. The rest show “Not on yet” until they are switched on for everyone.</p><ul class="conn">${connectRows.map(([t, c]) => `<li><span>${esc(t)}</span>${c}</li>`).join("")}</ul>`,
        },
        item("offline", "Does it work offline?", f("/faq", "Does it work offline?")),
      ],
    },
    {
      id: "brand", label: "Your brand and followers", line: "Your name, your site, your price. Your teaching stays private to you.",
      link: ["/follower-calculator", "What are my followers worth?"],
      items: [
        item("followers", "Will my followers pay?", f("/faq", "Will my followers pay?")),
        item("how-many", "How many followers do I need?", f("/guides/instagram-followers-to-clients", "How many followers do I need?")),
        item("brand", "Whose brand do subscribers see?", f("/about", "Whose brand do subscribers see?")),
        item("method", "Does trainsyou own my method?", f("/about", "Does trainsyou own my method?")),
      ],
    },
    {
      id: "uae", label: "UAE and legal", line: "Information, not legal advice. Rules change, so check the current source.",
      link: ["/guides/uae-advertiser-permit", "The advertiser permit guide"],
      items: [
        item("permit", "Do I need an advertiser permit to promote my own coaching?", f("/faq", "Do I need an advertiser permit to promote my own coaching?")),
        item("permit-cost", "Does the permit cost money?", f("/guides/uae-advertiser-permit", "Does the permit cost money?")),
        item("legal-advice", "Does trainsyou give legal advice?", f("/guides/uae-advertiser-permit", "Does trainsyou give legal advice?")),
        item("arabic", "Can subscribers use it in Arabic?", "Yes. Member controls are in English and Arabic, with right-to-left layouts. Prices are in AED. Marketing pages are in English."),
      ],
    },
  ];
}

function faqPage() {
  const p = page("/faq");
  const groups = faqGroups();
  const all = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label })));
  const always = all.filter((it) => !it.show).length;
  const suggested = ["replace", "bad-advice", "pain", "cost", "pay-today"].map((id) => all.find((it) => it.id === id));
  const count = (g) => {
    const base = g.items.filter((it) => !it.show).length, extra = g.items.length - base;
    return extra ? `<span data-show="frontier:off">${base}</span><span data-show="frontier:on">${base + extra}</span>` : String(base);
  };
  const palette = windowFrame(
    `<div class="palette" data-palette data-suggest="${suggested.map((s) => s.id).join(" ")}">
  <div class="pal-bar">${IC_SEARCH}<label class="sr-only" for="pal-q">Search the questions</label><input id="pal-q" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search ${always} questions" aria-describedby="pal-hint"><kbd class="pal-kbd" aria-hidden="true">/</kbd></div>
  <p class="pal-label" id="pal-label">Suggested</p>
  <ul class="pal-list" id="pal-list" aria-labelledby="pal-label">${suggested
    .map((s) => `<li><a class="pal-opt" href="#q-${s.id}"><span class="pal-g">${esc(s.group)}</span><span class="pal-t">${esc(s.q)}</span>${icon("arrow")}</a></li>`)
    .join("")}</ul>
  <div class="pal-empty" hidden><p class="pal-miss mono">No rule for “<span data-pal-term></span>”.</p>${lanePill("Handed to you", "toyou")}<p class="pal-try">Try <button type="button" class="pal-chip" data-pal-try="refund">refund</button><button type="button" class="pal-chip" data-pal-try="pain">pain</button><button type="button" class="pal-chip" data-pal-try="permit">permit</button><button type="button" class="pal-chip" data-pal-try="offline">offline</button></p></div>
  <p class="pal-foot mono" id="pal-hint"><span class="hide-m">↑ ↓ to move · Enter to open · Esc to clear</span><span class="only-m">Tap a question to open it</span><span data-pal-count></span></p>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`,
    { title: "Ask · trainsyou FAQ", meta: "plain answers", cls: "pal-window" },
  );
  const tabs = groups
    .map((g, i) => `<button type="button" role="tab" id="g-${g.id}-t" aria-controls="g-${g.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span>${esc(g.label)}</span><span class="mono ft-n">${count(g)}</span></button>`)
    .join("");
  const panels = groups
    .map(
      (g, i) => `<div class="faq-panel" role="tabpanel" id="g-${g.id}" aria-labelledby="g-${g.id}-t" tabindex="0" data-group="${esc(g.label)}">
  <div class="fp-side"><p class="fp-n mono">${pad2(i + 1)} / ${pad2(groups.length)}</p><h3>${esc(g.label)}</h3><p>${esc(budget("FAQ group line", g.line, 18))}</p>${g.extra || ""}<p>${textLink(g.link[0], g.link[1])}</p></div>
  <div class="fp-list">${faqItems(g.items, { prefix: "f", level: 4 })}</div>
</div>`,
    )
    .join("");
  return {
    title: `${p.title} · trainsyou`,
    main: [
      `<section class="band band-white hero faq-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">FAQ</p>
      <h1 id="hero-h">${esc(p.h1)}</h1>
      <p class="lede">${esc(budget("faq lede", "Plain answers on your AI, safety, money, setup, your brand and UAE rules.", 25))}</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">${palette}</div>
  </div>
</section>`,
      band(
        { tone: "paper", id: "questions", cls: "faq-topics-band", label: "topics-h" },
        `${sectionHead({ kicker: "By topic", title: "Every question, by worry", id: "topics-h", layout: "split", lede: "Short answers, 45 words or fewer. Legal answers keep their hedges." })}
<div class="faq-groups" data-tabs data-faq-groups>
  <div class="tabs-list faq-tabs" role="tablist" aria-label="Question topics">${tabs}<span class="faq-ink" aria-hidden="true"></span></div>
  ${panels}
</div>
<div class="faq-still" data-reveal><p><strong>Still unsure?</strong> Ask out loud, or try the demo.</p><div class="row">${kamranPill()}${textLink("/demo", "Try the demo")}</div><p>${pendingTag("Kamran on this page: owner decision 15")}</p></div>`,
      ),
    ].join("\n"),
  };
}

/* ============================================================= ABOUT */

/** Dated changes from the product's own release notes (docs/*_2026-10-*.md), in plain words. */
const SHIPPED = [
  { date: "2026-10-19", t: "Daily workflows", b: "Trainer Today and Inbox put the day’s work first. Subscriber Today keeps training first.", chips: () => chip("Shipped", "live") },
  { date: "2026-10-17", t: "WHOOP recovery and training", b: "Your rules can lower a session’s load when recovery is low, with the subscriber’s permission.", chips: () => chip("Not on yet", "soon") },
  { date: "2026-10-16", t: "A website draft from setup", b: "Setup turns your answers, your own photos and your real prices into a draft for review.", chips: () => `${chip("Shipped", "live")}${notOnYet("publish", "publishing")}` },
  { date: "2026-10-14", t: "Personal nutrition", b: "Coach-confirmed energy targets, cuisine and halal preferences, household portions and a printable week.", chips: () => chip("Shipped", "live") },
  { date: "2026-10-14", t: "Nutrition and voice passes", b: "One-month passes, and 6- or 12-month packs with clear refund terms.", chips: () => notOnYet("payments", "subscriber payments") },
  { date: "2026-10-14", t: "Scroll scenes for your site", b: "Twelve scroll presets for your coaching site, edited in the website builder.", chips: () => chip("Shipped", "live") },
  { date: "2026-10-13", t: "Coaching memory", b: "Chat can recall a relevant earlier exchange, within what each subscriber allows.", chips: () => chip("Shipped", "live") },
  { date: "2026-10-07", t: "Policies published, sign-up open", b: "Terms, privacy policy and digital coaching disclosure published. Trainer sign-up opened.", chips: () => chip("Shipped", "live") },
  { date: "2026-10-05", t: "Guided workouts", b: "One guided runner: exact sets, rest timers, pause, and pain reports that pause training.", chips: () => chip("Shipped", "live") },
];

function aboutPage() {
  const p = page("/about");
  const sec = (id) => p.sections.find((s) => s.id === id);
  const companyRows = [
    ["What it is", "A platform for personal trainers"],
    ["Built for", "Trainers in the UAE and their followers"],
    ["Prices", "In AED, set by each trainer"],
    ["Languages", "English and Arabic member controls, right-to-left"],
    ["Joining", "Free for trainers"],
    ["We earn", "A share of subscription revenue"],
  ];
  const company = windowFrame(
    `<dl class="kv">${companyRows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}
    <div><dt>Founder</dt><dd>${pendingTag("Owner to supply (decision 2)")}</dd></div></dl>`,
    { title: "trainsyou · company card", meta: "UAE", cls: "company-window" },
  );
  const stairs = [
    [25, "1–100"],
    [20, "101–300"],
    [15, "301–1,000"],
    [10, "1,001+"],
  ];
  return {
    title: `${p.title} · trainsyou`,
    main: [
      `<section class="band band-white hero about-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">About</p>
      <h1 id="hero-h">${esc(p.h1)}</h1>
      <p class="lede">${esc(budget("about lede", p.lede, 25))}</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${button("/methodology", "Read how we source numbers", { location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">${company}</div>
  </div>
</section>`,
      band(
        { tone: "paper", cls: "mission-band", label: "mission-h" },
        `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Founder</p>
    ${founderNote()}
    <p class="kamran-note">Kamran, the voice on this site, is an AI voice of our founder, used with consent. ${pendingTag("Founder name: decision 2")}</p>
  </div>
  <div class="s-media" data-reveal>
    <h2 id="mission-h" class="kicker">Our mission</h2>
    <p class="mission-q">Make personal training affordable to more people by scaling real trainers’ judgment.</p>
    <p class="mission-sub">Not by replacing them with a generic app.</p>
  </div>
</div>`,
      ),
      band(
        { tone: "white", cls: "isnot-band", label: "isnot-h" },
        `${sectionHead({ title: sec("is-not").heading, id: "isnot-h", layout: "split", lede: plain(sec("what").body[0]) })}
<div class="isnot" data-reveal="stagger">
  <div class="ri isnot-col"><h3>${icon("check")}We are</h3><ul>
    <li>${esc(sec("is-not").bullets[0])}</li>
    <li>${esc(sec("what").body[1])}</li>
    <li>${esc(plain(sec("who").body[1]))}</li></ul></div>
  <div class="ri isnot-col isnot-no"><h3>${icon("x")}We are not</h3><ul>${content.notStatements.map((s) => `<li>${esc(plain(s))}</li>`).join("")}</ul></div>
</div>`,
      ),
      band(
        { tone: "paper", cls: "money-band", label: "money-h" },
        `<div class="cols-2 money-cols">
  <div data-reveal>
    <p class="kicker">How we make money</p>
    <h2 id="money-h">We earn when subscribers pay</h2>
    <p class="sec-lede mt-s">${esc(plain(sec("money").body[0]))}</p>
    <div class="mini-stairs" role="img" aria-label="Our share per paying subscriber: 25% for 1 to 100, 20% for 101 to 300, 15% for 301 to 1,000, 10% above 1,000.">${stairs
      .map(([r, l]) => `<div class="ms" style="--h:${r / 25}"><span class="ms-bar"><span class="mono">${r}%</span></span><span class="ms-l mono">${l}</span></div>`)
      .join("")}</div>
    <p class="mt-s">${notOnYet("payments", "subscriber payments")}</p>
    <p class="mt-s">${textLink("/pricing", "Pricing in detail")}</p>
  </div>
  <div data-reveal>
    <p class="kicker">How we talk about results</p>
    <h2 id="results-h">${esc("Estimates, never promises")}</h2>
    <ul class="results-list">${sec("honesty").bullets.map((b) => `<li>${icon("check")}<span>${esc(b)}</span></li>`).join("")}</ul>
    <p class="mt-s">${textLink("/methodology", "Every market figure sourced")}</p>
  </div>
</div>`,
      ),
      band(
        { tone: "white", cls: "shipped-band", label: "shipped-h" },
        `${sectionHead({ kicker: "Changelog", title: "What shipped", id: "shipped-h", layout: "split", lede: "Dated changes from our release notes. Chips show what still waits on payments, publishing or a switch." })}
<ol class="ship" data-reveal="stagger">${SHIPPED.map(
          (s) => `<li class="ri"><time class="ship-d mono" datetime="${s.date}">${dateLabel(s.date)}</time><span class="ship-dot" aria-hidden="true"></span><div class="ship-c"><h3>${esc(s.t)}</h3><p>${esc(budget("shipped " + s.t, s.b, 18))}</p><p class="ship-chips">${s.chips()}</p></div></li>`,
        ).join("")}</ol>
<p class="note ship-note">Subscribers use these once your page is live. Publishing waits for subscriber payments.</p>`,
      ),
      band(
        { tone: "paper", cls: "where-band", label: "where-h" },
        `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Where we work</p>
    <h2 id="where-h">Built for the UAE</h2>
    <p class="sec-lede mt-s">${esc(sec("where").body[0])}</p>
    <p class="mt-s">${textLink("/uae", "trainsyou in the UAE")}</p>
  </div>
  <div class="s-media" data-reveal>
    <div class="contact card">
      <h3 id="contact-h">Company and contact</h3>
      <dl class="kv kv-plain">
        <div><dt>Company name</dt><dd>${pendingTag("[owner to supply]")}</dd></div>
        <div><dt>Licence</dt><dd>${pendingTag("[owner to supply]")}</dd></div>
        <div><dt>Address</dt><dd>${pendingTag("[owner to supply]")}</dd></div>
        <div><dt>Support email</dt><dd>${pendingTag("[owner to supply]")}</dd></div>
        <div><dt>Account holders</dt><dd>Use the Support page in your account.</dd></div>
      </dl>
    </div>
  </div>
</div>`,
      ),
      faqBand({ faqs: p.faqs.map((f, i) => ({ ...f, id: ["money", "method", "medical", "brand"][i] })), prefix: "afaq", id: "afaq-h", title: "Questions about us" }),
    ].join("\n"),
    closing: { secondary: { label: "Read how we source numbers", path: "/methodology" } },
  };
}

/* ======================================================= METHODOLOGY */

const FAMILY_ORDER = ["measured", "proxy", "vendor", "official", "price", "rule"];
const FAMILY_LABEL = { measured: "Measured", proxy: "Used as a proxy", vendor: "Vendor data or claim", official: "Official, platform or press", price: "Price guide", rule: "Rule of thumb" };
const family = (ev) =>
  /proxy/i.test(ev) ? "proxy" : /^(Measured|Experiment)/.test(ev) ? "measured" : /^Vendor/.test(ev) ? "vendor" : /(Official|Press|Platform)/.test(ev) ? "official" : /price guide/i.test(ev) ? "price" : "rule";

/** Rates per scenario: label, basis and sources (ported from the live methodology page). */
const RATE_ROWS = [
  { key: "linkClickPct", label: "Link-sticker click, per viewer per link Story", basis: "Creator reports 1-5%, no industry benchmark (rule of thumb); IQFluence median 4.1%, strong creators 6-7% (vendor data)", sources: ["creatorflow-link-sticker", "iqfluence-story-links"] },
  { key: "dmOpenPct", label: "Keyword commenters who open the DM link", basis: "Vendor claims, no dataset", sources: ["communipass-auto-dm", "chatautodm-2026"] },
  { key: "broadcastClickPct", label: "Broadcast members who open one link message", basis: "Email click medians for sports, health and fitness, all industries (measured; used as a proxy)", sources: ["mailerlite-benchmarks"] },
  { key: "bioClickPct", label: "Profile visitors who open the bio link in a month (only when you enter visits)", basis: "Rule of thumb, 1-3%", sources: ["hopp-bio-link"] },
  { key: "paidPct", label: "Visit to paid subscriber", basis: "Luxury retail; Health & Fitness app downloads that turn paid within 35 days, median and upper quartile (measured; used as a proxy: an app install shows more intent than a Story tap, so these may overstate). No published benchmark exists for coaching subscriptions", sources: ["dynamicyield-conversion", "revenuecat-state-2026"] },
  { key: "audienceRenewalPct", label: "New people each month: share of each audience new to your link", basis: "Cautious: the same people all year. Typical: about the yearly follower growth Socialinsider measured on brand accounts, 11-22% by tier, about 1-1.7% a month (measured; our rounding). Strong: our assumption for a growing audience; above the default monthly cancellations (2.9%), so more sharing never lowers month-12 subscribers", sources: ["socialinsider-engagement"] },
];
const TIER_BASIS = [
  ["Cautious and typical: Socialinsider image and video reach (measured, brand accounts). Strong: our assumption, the 20.5% a six-frame Story sequence reached, used as a monthly audience.", ["socialinsider-stories"]],
  ["Cautious: image reach, 3.5% (measured). Typical: the 5% vendor floor, above the measured 4.2% video reach (vendor claim). Strong: our assumption, the six-frame 20.5%; HypeAuditor finds accounts of 1,000-10,000 followers engage most (vendor data).", ["socialinsider-stories", "iqfluence-engagement", "hypeauditor-2025"]],
  ["Image reach (measured); at least 5% (vendor claim); strong: the IQFluence 5-8% band, lower for larger accounts (vendor claim, no dataset).", ["socialinsider-stories", "iqfluence-engagement"]],
];
/** One formula per follower step, condensed from the step text (mono, product-UI style). */
const FORMULAS = [
  "S = followers × Story share",
  "c = 1 − (1 − click)^k",
  "f(m+1) = (1 − r)(1 − c) f(m) + r",
  "viewers × comments/view × 2.03 × DM open",
  "visit = 1 − Π(1 − chance)",
  "C(T) = visit-to-paid × first visitors by T",
  "A(m) = A(m−1)(1 − churn) + new(m)",
];
const CHANGES = [
  "28 September 2026: first publication of sources and calculator assumptions (version 2026-09-28).",
  "28 September 2026 (version 2026-09-28.2): repeat link Stories now reach the same viewers, so the chance of a visit levels off instead of adding up; visit to paid subscriber changed to 0.72% (luxury, high-consideration retail) to 2.89% (EMEA average), because a monthly coaching subscription is a considered purchase and the UAE is in EMEA.",
  "28 September 2026 (version 2026-09-28.3): three scenarios instead of one range, with the strong case as the headline at our owner’s direction; Reels with a comment keyword, the bio link and a broadcast channel join Stories; yearly cancellations give active subscribers after 12 months; tier boundaries no longer lower an estimate.",
  "28 September 2026 (version 2026-09-28.4): each audience gains new people every month; strong visit to paid is 6.2%, the Health & Fitness upper quartile, instead of 10.7%; engagement no longer raises the strong Story share; the monthly amount uses the whole number of subscribers shown; an unverified creator sales figure is no longer presented as a source.",
];

/** Where each source is cited: content.json sections, plus the calculator assumptions tables and home. */
function citations() {
  const m = new Map(content.sources.map((s) => [s.id, new Set()]));
  for (const p of content.pages) for (const s of p.sections || []) for (const id of s.sources || []) m.get(id)?.add(p.path);
  for (const r of RATE_ROWS) for (const id of r.sources) m.get(id)?.add("/methodology");
  for (const [, ids] of TIER_BASIS) for (const id of ids) m.get(id)?.add("/methodology");
  for (const id of ["socialinsider-reach", "socialinsider-reels", "metricool-2026", "meta-instagram-ranking", "revenuecat-renewals", "coachway-2026"]) m.get(id)?.add("/methodology");
  m.get("revenuecat-state-2026")?.add("/");
  return m;
}

function methodologyPage() {
  const p = page("/methodology");
  const sec = (id) => p.sections.find((s) => s.id === id);
  const M = calc.FOLLOWER_MODEL, D = calc.FOLLOWER_DEFAULTS, SC = ["cautious", "typical", "strong"];
  const cites = citations();
  const fams = FAMILY_ORDER.map((f) => ({ f, n: content.sources.filter((s) => family(s.evidence) === f).length })).filter((x) => x.n);
  const maxF = Math.max(...fams.map((x) => x.n));
  const retrieved = [...new Set(content.sources.map((s) => s.retrieved))].map(dateLabel).join(", ");
  const srcLinks = (ids) => ids.map((id) => `<a class="inline-link" href="#${id}">${esc(sourceById(id).publisher)}</a>`).join(", ");
  const pct = (v) => `${v}%`;

  // Hero aside: the evidence ledger at a glance.
  const ledger = windowFrame(
    `<p class="lg-total"><span class="calc-figure">${content.sources.length}</span><span>sources, each with a weight label<br><span class="mono lg-ret">Retrieved ${esc(retrieved)}</span></span></p>
  <ul class="lg-fams">${fams
    .map((x) => `<li><span>${esc(FAMILY_LABEL[x.f])}</span><span class="lg-bar"><span style="--v:${(x.n / maxF).toFixed(3)}"></span></span><span class="mono">${x.n}</span></li>`)
    .join("")}</ul>
  <p class="lg-foot"><a class="tlink" href="#sources"><span>Browse the sources</span>${icon("arrow")}</a><span class="mono">Assumptions v${esc(M.version)}</span></p>`,
    { title: "Evidence ledger", meta: "methodology", cls: "ledger-window" },
  );

  // 1 · Principles
  const principles = `<section class="art-sec" id="principles" aria-labelledby="principles-h"><h2 id="principles-h">${esc(sec("principles").heading)}</h2>
<ol class="principles" data-reveal="stagger">${sec("principles").bullets.map((b, i) => `<li class="ri"><span class="mono">${pad2(i + 1)}</span><p>${esc(b)}</p></li>`).join("")}</ol></section>`;

  // 2 · Follower method
  const ff = sec("follower-formula");
  const tierLabel = (i) => {
    const upTo = M.tiers[i].upTo, from = i === 0 ? 0 : (M.tiers[i - 1].upTo ?? 0) + 1;
    return upTo === null ? `Above ${calc.whole(from - 1)}` : `${calc.whole(from)}–${calc.whole(upTo)}`;
  };
  const tierRows = M.tiers.map((t, i) => {
    const [basis, ids] = TIER_BASIS[Math.min(i, 2)];
    return [tierLabel(i), mono(pct(t.storyPct.cautious)), mono(pct(t.storyPct.typical)), mono(pct(t.storyPct.strong)), { html: `<span class="basis">${esc(basis)} ${srcLinks(ids)}</span>` }];
  });
  const rateRows = RATE_ROWS.map((r) => [r.label, mono(pct(M.scenarios.cautious[r.key])), mono(pct(M.scenarios.typical[r.key])), mono(pct(M.scenarios.strong[r.key])), { html: `<span class="basis">${esc(r.basis)}. ${srcLinks(r.sources)}</span>` }]);
  const otherRows = [
    ["Reach of one call-to-action Reel or post, by tier", `Cautious (feed posts): ${M.tiers.map((t) => t.reelPct.cautious + "%").join(" / ")}. Typical and strong (Reels): ${M.tiers.map((t) => t.reelPct.strong + "%").join(" / ")}`, "Measured, brand accounts.", ["socialinsider-reach", "socialinsider-reels"]],
    ["Comments per Reel view, by tier", M.tiers.map((t) => t.commentsPerViewPct + "%").join(" / "), "Measured, brand accounts; our division of published medians.", ["socialinsider-engagement"]],
    ["Keyword comments per view", `Comments per view × ${M.keywordCommentFactor}`, "Measured (+202.78% comments with a comment call to action); treating the extra comments as keyword comments is our inference.", ["metricool-2026"]],
    ["How channels overlap", "Cautious: Reels reach the same people as Stories. Typical and strong: each Reel reaches new people. Stories and broadcast are nested in every scenario", "Our assumption, from a platform statement.", ["meta-instagram-ranking"]],
    ["Average engagement (scales Story reach and comments; the strong Story share only down)", `${M.engagementBenchmarkPct}%, scaling at most ×${M.engagementFactorMax}`, "Measured, brand accounts.", ["socialinsider-engagement"]],
    ["Members who cancel per year", "Your input, 5-80%; 30% unless you change it", "Owner assumption. Published data show more cancellations: 32-54% of Health & Fitness app subscribers leave after the first month (measured), and 45% of online coaching clients remain at month 12 (vendor data).", ["revenuecat-renewals", "coachway-2026"]],
  ].map(([a, v, b, ids]) => [a, { html: `<span class="mono-soft">${esc(v)}</span>` }, { html: `<span class="basis">${esc(b)} ${srcLinks(ids)}</span>` }]);
  const worked = calc.estimateFollowers(D);
  const count = (n) => {
    const c = calc.displayCount(n);
    return c === null ? "fewer than 1" : calc.whole(c);
  };
  const strong = M.scenarios.strong;
  const perStory = Math.round(strong.linkClickPct * strong.paidPct) / 100;
  const signupShare = Math.round((worked.scenarios.strong.signups12 / D.followers) * 1000) / 10;
  const NAMES = { cautious: "Cautious", typical: "Typical", strong: "Strong case" };
  const follower = `<section class="art-sec" id="follower-calculator" aria-labelledby="fc-h">
  <div class="arrive" data-arrive><p class="kicker">Follower calculator</p><h2 id="fc-h">How the follower estimate works</h2></div>
  <div class="art-block art-p">${ff.body.map((b) => `<p>${esc(b)}</p>`).join("")}</div>
  <ol class="art-block pipe" data-reveal="stagger">${ff.steps
    .map((st, i) => `<li class="ri"><span class="pipe-n mono">${pad2(i + 1)}</span><div class="pipe-c"><h3>${esc(st.title)}</h3><code class="pipe-f mono">${esc(FORMULAS[i] || "")}</code><p>${esc(st.body)}</p></div></li>`)
    .join("")}</ol>
  <h3 class="art-h3" id="follower-assumptions">Assumptions in use (version ${esc(M.version)})</h3>
  <div class="art-block" data-reveal>${dataTable({ caption: "Story audience: % of followers who see at least one of your Stories a month (your own Story views replace it)", columns: ["Followers", "Cautious", "Typical", "Strong case", "Basis and label"], rows: tierRows, cls: "table-basis" })}</div>
  <div class="art-block" data-reveal>${dataTable({ caption: "Rates per scenario", columns: ["Assumption", "Cautious", "Typical", "Strong case", "Basis and label"], rows: rateRows, cls: "table-basis" })}</div>
  <div class="art-block" data-reveal>${dataTable({ caption: "Other assumptions", columns: ["Assumption", "Value", "Basis and label"], rows: otherRows, cls: "table-basis table-basis-3" })}</div>
  <h3 class="art-h3" id="strong-case">How the strong case is calibrated</h3>
  <ul class="art-block art-list">
    <li>Per link Story, ${strong.linkClickPct}% of viewers tap and ${strong.paidPct}% of them pay: about ${perStory}% of the people who see it each time. Each month ${strong.audienceRenewalPct}% of the audience is new to your link, so sign-ups keep coming. [Our assumption; measured proxies]</li>
    <li>Over 12 months the worked example below signs up about ${signupShare}% of its followers, far above published creator averages: Passion.io puts course conversion at 0.1-1% (low), 1.5-5% (mid) and 0.52-1.1% for higher-priced courses, and Stan’s creators with 1,000-10,000 followers sell about USD 273 a month, against ${calc.aed(worked.scenarios.strong.revenueMonth12Minor)} a month in the strong case. [Rule of thumb; vendor data] ${srcLinks(["passion-creator-rates", "stan-creator-economy"])}</li>
    <li>The strong rates are the top values found in the research: ${strong.linkClickPct}% link clicks (creator reports), ${strong.dmOpenPct}% of keyword commenters opening the DM link (vendor claims) and ${strong.paidPct}% visit to paid, the upper quartile of Health &amp; Fitness apps (measured; it may overstate). [Measured; vendor claims; our assumption]</li>
  </ul>
  <div class="art-block" data-reveal>
    <p class="art-chips">${notOnYet("payments", "subscriber payments")}${estimateLabel()}</p>
    ${dataTable({
      caption: `Worked example: ${calc.whole(D.followers)} followers, AED ${D.priceAed}, ${D.linkStoriesPerMonth} link Stories and ${D.ctaReelsPerMonth} keyword Reels a month, ${D.yearlyCancelPct}% yearly cancellations. Before platform commission, payment processing and tax.`,
      columns: ["Scenario", "First month", "Active after 12 months", "Sign-ups over 12 months", "A month at month 12"],
      rows: SC.map((s) => {
        const r = worked.scenarios[s];
        return [NAMES[s], mono(count(r.month1New)), mono(count(r.activeMonth12)), mono(count(r.signups12)), mono(calc.aed(r.revenueMonth12Minor))];
      }),
      cls: "table-num",
    })}
  </div>
</section>`;

  // 3 · Earnings method
  const em = sec("earnings-method");
  const e = calc.compactEarnings(150, 199, 250);
  const keep = e.subscriptionMonthlyMinor - e.commissionMinor;
  const stmt = windowFrame(
    `<div class="stmt-head">${chip("Sample", "sample")}${notOnYet("payments", "subscriber payments")}</div>${statementLines([
      { label: "150 paying subscribers × AED 199", value: calc.aed(e.subscriptionMonthlyMinor) },
      { label: "Our share · subscribers 1–100 at 25%", value: "− " + calc.aed(e.bands[0].commissionMinor), tone: "minus" },
      { label: "Our share · subscribers 101–150 at 20%", value: "− " + calc.aed(e.bands[1].commissionMinor), tone: "minus" },
      { label: "Before other costs", value: calc.aed(keep), tone: "total" },
    ])}<p class="stmt-foot mono">≈ ${calc.whole(e.equivalentSessions)} sessions at AED 250 · ${calc.pct(e.effectiveCommissionPct, 2)} overall</p>`,
    { title: "Worked example · monthly", meta: "AED", cls: "stmt-window" },
  );
  const earnings = `<section class="art-sec" id="earnings-calculator" aria-labelledby="ec-h">
  <div class="arrive" data-arrive><p class="kicker">Earnings calculator</p><h2 id="ec-h">How the earnings estimate works</h2></div>
  <ul class="art-block art-list">${em.bullets.map((b) => `<li>${esc(plain(b))}</li>`).join("")}</ul>
  <div class="art-block em-grid" data-reveal>
    <div>${dataTable({ caption: "Our share per paying subscriber, by band. Each rate applies only to its band.", columns: ["Paying subscribers", "Our share"], rows: [["1–100", mono("25%")], ["101–300", mono("20%")], ["301–1,000", mono("15%")], ["Above 1,000", mono("10%")]], cls: "table-num" })}</div>
    <div>${stmt}</div>
  </div>
</section>`;

  // 4 · Sources ledger
  const pagesCited = [...new Set([...cites.values()].flatMap((s) => [...s]))]
    .map((path) => ({ path, label: path === "/" ? "Home" : path === "/methodology" ? "Calculator assumptions" : page(path).navLabel }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const rows = content.sources
    .map((s) => {
      const fam = family(s.evidence), on = [...(cites.get(s.id) || [])];
      const onHtml = on.length
        ? on.map((path) => (path === "/methodology" ? `<a class="inline-link" href="#follower-assumptions">Calculator assumptions</a>` : link(path, path === "/" ? "Home" : page(path).navLabel, { cls: "inline-link" }))).join(", ")
        : "Background research only";
      return `<li class="src arrive" id="${esc(s.id)}" data-family="${fam}" data-pages="${esc(on.join(" ") || "none")}">
  <div class="src-who">${chip(s.evidence, fam === "measured" ? "live" : fam === "vendor" || fam === "rule" ? "soon" : "neutral")}<p class="src-pub">${esc(s.publisher)}</p><p class="mono src-date">${esc(s.published)} · retrieved ${esc(dateLabel(s.retrieved))}</p></div>
  <div class="src-what"><a class="src-title" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}${icon("external")}<span class="sr-only"> (opens in a new tab)</span></a><p>${esc(s.claim)}</p></div>
  <div class="src-use"><p><span class="src-k">Used for</span>${esc(s.usedFor)}</p><p><span class="src-k">Cited on</span>${onHtml}</p></div>
</li>`;
    })
    .join("");
  const sources = `<section class="art-sec" id="sources" aria-labelledby="src-h">
  <h2 id="src-h">Sources</h2>
  <div class="art-block art-p"><p>Each source is labelled by how much weight it can bear: measured (a dataset with a stated sample), used as a proxy, vendor data or claim, rule of thumb, platform statement, official figure, price guide or press report.</p></div>
  <div class="art-block src-filters" data-src-filters>
    <div class="src-chips" role="group" aria-label="Filter by evidence">
      <button type="button" class="fchip" data-fam="all" aria-pressed="true">All <span class="mono">${content.sources.length}</span></button>
      ${fams.map((x) => `<button type="button" class="fchip" data-fam="${x.f}" aria-pressed="false">${esc(FAMILY_LABEL[x.f])} <span class="mono">${x.n}</span></button>`).join("")}
    </div>
    <div class="field src-page"><label for="src-page">Cited on</label><select id="src-page"><option value="all">Any page</option>${pagesCited.map((x) => `<option value="${esc(x.path)}">${esc(x.label)}</option>`).join("")}<option value="none">Background research only</option></select></div>
    <p class="src-count mono" aria-hidden="true"><span data-src-count>${content.sources.length}</span> of ${content.sources.length} shown</p>
    <p class="sr-only" aria-live="polite" data-live></p>
  </div>
  <ol class="src-list" data-sources>${rows}</ol>
</section>`;

  // 5 · Exclusions, 6 · change log
  const exclude = `<section class="art-sec" id="exclude" aria-labelledby="ex-h"><h2 id="ex-h">What we exclude</h2>
<div class="art-block ex-grid" data-reveal="stagger">
  <div class="ri ex-col"><h3>From the follower estimate</h3><ul>${["Trials and discounts", "Refunds and failed payments", "Platform commission", "Payment processing", "Tax", "New followers, except through the new people each month"].map((t) => `<li>${icon("minus")}<span>${esc(t)}</span></li>`).join("")}</ul></div>
  <div class="ri ex-col"><h3>From the earnings estimate</h3><ul>${["Payment processing", "Your own domain", "Refunds and disputes", "Booking fees", "Tax"].map((t) => `<li>${icon("minus")}<span>${esc(t)}</span></li>`).join("")}</ul></div>
</div></section>`;
  const changes = `<section class="art-sec" id="changes" aria-labelledby="ch-h"><h2 id="ch-h">Change log</h2>
<ol class="art-block chlog">${CHANGES.map((c) => `<li><span class="ch-dot" aria-hidden="true"></span><p>${esc(c)}</p></li>`).join("")}</ol>
<p class="note mt-s">${esc(p.faqs[0].a)}</p></section>`;

  const items = [
    { id: "principles", label: "How we use figures" },
    { id: "follower-calculator", label: "Follower estimate" },
    { id: "earnings-calculator", label: "Earnings estimate" },
    { id: "sources", label: "Sources" },
    { id: "exclude", label: "What we exclude" },
    { id: "changes", label: "Change log" },
  ];
  return {
    title: `${p.title} · trainsyou`,
    main: [
      `<section class="band band-white hero meth-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">Methodology</p>
      <h1 id="hero-h">${esc(p.h1)}</h1>
      <p class="lede">${esc(budget("methodology lede", "Every market figure on this site, with its source, its date and how we use it. Plus the calculator assumptions in use.", 25))}</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${button("/follower-calculator", "Back to the follower calculator", { location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">${ledger}</div>
  </div>
</section>`,
      band({ tone: "white", cls: "doc-band meth-band" }, docLayout(toc(items, { id: "meth-toc" }), `<div class="art art-wide">${principles}${follower}${earnings}${sources}${exclude}${changes}</div>`)),
    ].join("\n"),
    js: [],
  };
}

/* ============================================================= LEGAL */

const LEGAL_DIR = "/home/user/trainer_what/docs/legal/uae-2026-10";
const LEGAL = {
  "/terms": { file: "terms-2026-10-14.en.md", short: "Terms" },
  "/privacy": { file: "privacy.en.md", short: "Privacy" },
  "/ai-disclosure": { file: "ai-disclosure.en.md", short: "Digital coaching disclosure" },
};

/** Parse the policy markdown: title, edition line, numbered sections of plain paragraphs. */
function parseLegal(md) {
  const blocks = md.replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = { title: "", edition: "", sections: [] };
  for (const b of blocks) {
    if (b.startsWith("# ")) out.title = b.slice(2).trim();
    else if (b.startsWith("## ")) {
      const m = b.slice(3).match(/^(\d+)\.\s*(.*)$/);
      out.sections.push({ n: m ? +m[1] : out.sections.length + 1, heading: m ? m[2] : b.slice(3), paras: [] });
    } else if (!out.sections.length) out.edition += (out.edition ? " " : "") + b;
    else out.sections[out.sections.length - 1].paras.push(b.replace(/\n/g, " "));
  }
  return out;
}
const isArabic = (s) => (s.match(/[؀-ۿ]/g) || []).length > s.length * 0.3;

function legalPage(path) {
  return () => {
    const p = page(path), meta = LEGAL[path], file = join(LEGAL_DIR, meta.file);
    if (!existsSync(file)) {
      console.warn(`[content] legal source missing: ${file}`);
      return { main: docHero({ kicker: "Legal", h1: p.h1, body: `<p class="lede">The published text could not be loaded for this prototype.</p>` }) };
    }
    const doc = parseLegal(readFileSync(file, "utf8"));
    const allText = doc.sections.flatMap((s) => s.paras).join(" ");
    const editionDate = (doc.edition.match(/Policy edition:\s*([^.]+)\./) || [])[1] || dateLabel(p.lastUpdated);
    const hasAr = doc.sections.some((s) => s.paras.some(isArabic));
    const switcher = `<nav class="legal-nav" aria-label="Policies">${Object.entries(LEGAL)
      .map(([pth, m]) => `<a href="${href(pth)}"${pth === path ? ' aria-current="page"' : ""}>${IC_DOC}<span>${esc(m.short)}</span></a>`)
      .join("")}</nav>`;
    const info = `<div class="kp legal-info"><p class="kp-h">This document</p><dl class="kv kv-plain">
  <div><dt>Policy edition</dt><dd class="mono">${esc(editionDate)}</dd></div>
  <div><dt>Sections</dt><dd class="mono">${doc.sections.length}</dd></div>
  <div><dt>Reading time</dt><dd class="mono">${readMins(words(allText))} min</dd></div>
  <div><dt>Language</dt><dd>${hasAr ? "English, with the commercial update also in Arabic" : "English"}</dd></div>
</dl></div>`;
    const items = doc.sections.map((s) => ({ id: `s${s.n}`, label: s.heading }));
    const body = doc.sections
      .map(
        (s) => `<section class="legal-sec" id="s${s.n}" aria-labelledby="s${s.n}-h"><h2 id="s${s.n}-h"><span class="mono legal-n">${pad2(s.n)}</span><span>${esc(s.heading)}</span></h2>${s.paras
          .map((t) => (isArabic(t) ? `<p lang="ar" dir="rtl" class="legal-ar">${esc(t)}</p>` : `<p>${esc(t)}</p>`))
          .join("")}</section>`,
      )
      .join("");
    return {
      title: `${p.title} · trainsyou`,
      main: [
        docHero({
          kicker: "Legal",
          h1: doc.title === "Digital coaching and health disclosure" ? p.h1 : doc.title || p.h1,
          meta: [`Edition ${esc(editionDate)}`, `Last updated ${esc(editionDate)}`, `${readMins(words(allText))} min read`],
          body: switcher,
          aside: info,
          cls: "legal-hero",
        }),
        band(
          { tone: "white", cls: "doc-band legal-band" },
          docLayout(toc(items, { id: "legal-toc", title: "Sections" }), `<article class="legal"><p class="legal-edition">${esc(doc.edition)}</p>${body}<p class="legal-end note">End of ${esc(p.title.toLowerCase())}. ${link("/faq", "Questions? Read the FAQ", { cls: "inline-link" })}</p></article>`),
        ),
      ].join("\n"),
    };
  };
}

/* =========================================================== COACHES */

function coachesPage({ page: p }) {
  const dir = windowFrame(
    `<div class="dir-bar" aria-hidden="true"><span class="dir-search">${IC_SEARCH}<span>Search coaches</span></span><span class="dir-f">Strength</span><span class="dir-f">Weight loss</span><span class="dir-f">Pre and postnatal</span></div>
  <div class="dir-empty">
    <p class="dir-line mono"><span class="dir-k">0 listings</span> No coaches are listed yet.</p>
    <div class="dir-skel" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="dir-note">Coaches choose to be listed here once their page is published.</p>
  </div>`,
    { title: "Find a coach · UAE", meta: "0 listings", cls: "dir-window" },
  );
  const sample = `<article class="listing card">
  <header class="listing-head"><span class="app-avatar" aria-hidden="true">LS</span><div><h3>Layla Strength</h3><p class="mono">laylastrength.trainsyou.com</p></div>${chip("Sample", "sample")}</header>
  <p class="listing-b">Strength coaching in your method, day by day. Workout and nutrition tiers.</p>
  <p class="listing-chips">${chip("Strength", "neutral")}${chip("English and Arabic", "neutral")}${chip("Prices in AED", "neutral")}</p>
  <p class="note">How a listing could look. Not a real coach.</p>
</article>`;
  return {
    title: `${p.title} · trainsyou`,
    main: [
      `<section class="band band-white hero coaches-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">Directory</p>
      <h1 id="hero-h">${esc(p.h1)}</h1>
      <p class="lede">Coaches choose to be listed here. Coaching yourself? Start free and list your page when you publish.</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
      <p class="mt-s">${notOnYet("publish", "publishing")}</p>
    </div>
    <div class="hero-media">${dir}</div>
  </div>
</section>`,
      band(
        { tone: "paper", cls: "list-band", label: "list-h" },
        `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">For trainers</p>
    <h2 id="list-h">How listing will work</h2>
    <ol class="list-steps">
      <li><span class="mono">01</span><span>Set up your page and teach your AI. ${chip("Live", "live")}</span></li>
      <li><span class="mono">02</span><span>Publish your page. ${flagChip("publish", "Live", "Not on yet")}</span></li>
      <li><span class="mono">03</span><span>Choose whether to be listed. Listing is always your choice.</span></li>
    </ol>
    <p class="note mt-s">Looking for a coach? Ask your trainer for their trainsyou address.</p>
  </div>
  <div class="s-media" data-reveal>${sample}</div>
</div>`,
      ),
    ].join("\n"),
    closing: { secondary: { label: "See how it works", path: "/how-it-works" } },
  };
}

/* =============================================================== 404 */

function notFoundPage() {
  const next = [
    ["/", "Home", "What trainsyou is, in one screen"],
    ["/demo", "Demo", "Watch your AI apply a rule"],
    ["/pricing", "Pricing", "Free to join, you set the price"],
    ["/guides", "Guides", "Pricing, followers, permits, rules"],
  ];
  const console404 = windowFrame(
    `<p class="cp-label">Request</p>
  <p class="nf-path mono" data-miss-path>this page</p>
  <div class="rule-chip nf-rule"><span class="rule-src">Your rules · checked</span><code class="rule-text mono">No rule for this page.</code></div>
  <div class="nf-lane">${lanePill("Handed to you", "toyou")}</div>
  <ul class="nf-links">${next.map(([pth, l, d]) => `<li><a href="${href(pth)}"><span class="nf-l">${esc(l)}</span><span class="nf-d">${esc(d)}</span>${icon("arrow")}</a></li>`).join("")}</ul>`,
    { title: "Inbox · Unmatched", meta: "404", cls: "nf-window" },
  );
  return {
    title: "Page not found · trainsyou",
    main: `<section class="band band-white hero nf-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">404</p>
      <h1 id="hero-h">This page isn’t here.</h1>
      <p class="lede">Your coaching still can be.</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">${console404}</div>
  </div>
</section>`,
    closing: { secondary: { label: "Try the demo", path: "/demo" } },
  };
}

/* ============================================================ export */

export const pages = {
  "/guides": guidesIndex,
  ...Object.fromEntries(GUIDES.map((g) => [g, guideArticle(g)])),
  "/faq": faqPage,
  "/about": aboutPage,
  "/methodology": methodologyPage,
  "/terms": legalPage("/terms"),
  "/privacy": legalPage("/privacy"),
  "/ai-disclosure": legalPage("/ai-disclosure"),
  "/coaches": coachesPage,
  "/404": notFoundPage,
};
