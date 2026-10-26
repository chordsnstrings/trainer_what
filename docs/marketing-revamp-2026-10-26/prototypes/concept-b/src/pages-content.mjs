// Concept B · content pages. Owner: the content page builder.
//
//   /guides, the four /guides/*, /faq, /about, /methodology, /terms,
//   /privacy, /ai-disclosure, /coaches (C22) and /404 (C23).
//
// Copy: blueprint C13, C14, C18-C23 (pending owner approval) and the
// Concept B per-page notes; content.json for everything else. Legal text is
// the published policy pack, read at build time from the repo
// (docs/legal/uae-2026-10, see LEGAL below) and shown in full.
// Styles: site/assets/content.css. Scripts: site/assets/content.js.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { content, esc, href, C, pageFor, registry, sourceFor, LIVE } from "./core.mjs";
import * as H from "./components.mjs";
import { pages as corePages } from "./pages-core.mjs";
import { pages as productPages } from "./pages-product.mjs";
import { pages as audiencePages } from "./pages-audience.mjs";
import { pages as moneyPages } from "./pages-money.mjs";

const {
  icon, hl, eyebrow, sectionHead, band, ctaRow, primaryCta, secondaryLink, chip, statusChip, sampleLabel,
  estimateLabel, srcBadge, paymentsNote, val, numberField, faq, statusStrip, stairs, bandMeter, kamranPill,
  crumbs, ext, addressPreview, statement,
} = H;

/* ===================================================================== */
/* Copy helpers                                                           */
/* ===================================================================== */
/** Grade-6 vocabulary and one product name (C0, principle 2). */
const VOCAB = [
  [/hands you anything below your confidence threshold/g, "hands you anything it isn’t sure enough about"],
  [/(?:your )?held-out scenarios/g, "your test cases"], [/your confidence threshold/gi, "how sure it must be"],
  [/[Mm]arginal bands of/g, "bands of"], [/marginal bands/g, "bands"], [/[Ss]afety floor/g, "safety rules it can’t switch off"],
  [/“Available soon”/g, "“Not on yet”"], [/Available soon/g, "Not on yet"], [/trainsyou learns/g, "Your AI learns"],
  [/\bthe Brain\b/g, "your AI"], [/\bThe Brain\b/g, "Your AI"], [/\byour Brain\b/g, "your AI"], [/\bYour Brain\b/g, "Your AI"],
  [/against your scenarios/g, "against your test cases"], [/on your held-out scenarios/g, "on your test cases"],
];
const fix = (s) => VOCAB.reduce((t, [a, b]) => t.replace(a, b), String(s ?? ""));
/** Questions are headings: "AI" always belongs to someone. */
const qfix = (s) => fix(String(s ?? "").replace(/\b[Tt]he (Brain|AI)\b/g, "my AI").replace(/\bmy Brain\b/g, "my AI")).replace(/\ban AI\b/g, "your AI");
const fx = (s) => esc(fix(s));
const words = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
let CUR = "";
/** Build-time copy budget check (C0). Warns, never fails. */
function budget(what, text, max) {
  const n = words(text);
  if (n > max) console.warn(`  budget ${CUR} · ${what}: ${n} words (max ${max}) · "${String(text).replace(/<[^>]+>/g, "").slice(0, 60)}"`);
}
const num2 = (n) => String(n).padStart(2, "0");
const fmtDate = (iso) => new Date(String(iso).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const pct2 = (x) => `${Math.round(x * 100) / 100}%`;
const okIcon = () => icon("check").replace("<svg", '<svg class="icon-ok"');
const noIcon = () => icon("cross").replace("<svg", '<svg class="icon-no"');

/** Reading time: every visible string of a content page, at 220 words a minute. */
function readMins(page) {
  const bits = [page.intro, page.lede];
  for (const s of page.sections || []) {
    bits.push(s.heading, ...(s.body || []), ...(s.bullets || []), s.note);
    for (const x of [...(s.steps || []), ...(s.cards || [])]) bits.push(x.title, x.body);
    if (s.table) bits.push(...s.table.rows.flat());
  }
  for (const f of page.faqs || []) bits.push(f.q, f.a);
  return Math.max(1, Math.round(words(bits.filter(Boolean).join(" ")) / 220));
}

/* ===================================================================== */
/* Shared components (content group)                                      */
/* ===================================================================== */
/** Named source badges ("Socialinsider →") to /methodology#id. */
function srcList(ids, label = "Sources") {
  const list = (ids || []).map(sourceFor).filter(Boolean);
  const seen = {};
  list.forEach((s) => (seen[s.publisher] = (seen[s.publisher] || 0) + 1));
  const items = list.map((s) => `<a class="src" href="${href("/methodology#" + s.id)}" aria-label="Source: ${esc(s.publisher)}, ${esc(s.title)}">${esc(s.publisher)}${seen[s.publisher] > 1 ? `<span class="src-t">· ${esc(s.title.replace(/^Instagram /, ""))}</span>` : ""}${icon("arrow")}</a>`);
  return items.length ? `<p class="ct-srcs"><span class="ct-srcs-l">${esc(label)}</span>${items.join("")}</p>` : "";
}

/** Inner hero shared by the content pages. { h1, mark, lede, eyebrow, crumbs, cta, meta, visual, after, sweep, cls } */
function hero(o) {
  budget("H1", o.h1, 8);
  if (o.lede) budget("lede", o.lede, 25);
  return `<section class="page-hero ct-hero${o.cls ? " " + o.cls : ""}" data-hero aria-labelledby="h1">
<div class="container ct-hero-grid${o.visual ? "" : " ct-hero-grid--solo"}">
  <div class="ct-hero-copy">
    ${o.crumbs || ""}${o.eyebrowHtml || eyebrow(o.eyebrow)}
    <h1 id="h1"${o.sweep === false ? "" : ' class="sweep"'}>${hl(o.h1, o.mark)}</h1>
    ${o.lede ? `<p class="lede">${esc(o.lede)}</p>` : ""}
    ${o.meta || ""}
    ${o.cta || ""}
    ${o.after || ""}
  </div>
  ${o.visual ? `<div class="ct-hero-vis">${o.visual}</div>` : ""}
</div>
</section>`;
}
/** "6 min read · Updated 28 Sept 2026 · 4 sources" */
const metaRow = (items) => `<ul class="ct-meta">${items.filter(Boolean).map((t) => `<li>${t}</li>`).join("")}</ul>`;

/** Table of contents: sticky rail on desktop, disclosure on phones. items: [{id, title}] */
function toc(items, o = {}) {
  const label = o.label || "On this page";
  return `<nav class="toc${o.legal ? " toc--legal" : ""}" aria-label="${esc(label)}" data-toc>
  <button class="toc-toggle" type="button" aria-expanded="false" aria-controls="toc-panel"><span class="toc-toggle-l">${esc(label)}</span><span class="toc-toggle-n">${items.length} sections</span><span class="toc-chev">${icon("chevron")}</span></button>
  <div class="toc-panel" id="toc-panel"><div class="toc-inner">
    <p class="eyebrow eyebrow--muted toc-title">${esc(label)}</p>
    <div class="toc-rail"><ol class="toc-list">${items.map((it, i) => `<li><a href="#${it.id}" data-toc-link><span class="fig toc-n" aria-hidden="true">${num2(i + 1)}</span><span class="toc-t">${esc(it.title)}</span></a></li>`).join("")}</ol><span class="toc-ind" aria-hidden="true"></span></div>
    ${o.foot || ""}
  </div></div>
</nav>`;
}

/** One article section with an Archivo number, an H2 (≤6 words) and its parts. */
function section(id, n, title, inner, o = {}) {
  budget("H2", title, 6);
  return `<section class="ct-sec${o.reveal === false ? "" : " reveal"}${o.cls ? " " + o.cls : ""}" id="${id}" aria-labelledby="${id}-h">
  <h2 id="${id}-h" class="ct-h2"><span class="fig ct-sec-n" aria-hidden="true">${num2(n)}</span><span>${esc(title)}</span></h2>
  ${inner}
</section>`;
}
const paras = (list) => (list || []).map((p) => `<p>${fx(p)}</p>`).join("");
const dashList = (list) => `<ul class="ct-list">${list.map((b) => `<li>${fx(b)}</li>`).join("")}</ul>`;
const tickList = (list, kind = "ok") => `<ul class="tick-list ct-ticks">${list.map((b) => `<li>${kind === "ok" ? okIcon() : kind === "no" ? noIcon() : icon("info")}<span>${fx(b)}</span></li>`).join("")}</ul>`;
const stepList = (steps, o = {}) => `<ol class="ct-steps${o.cls ? " " + o.cls : ""}">${steps.map((s, i) => `<li><span class="fig ct-step-n" aria-hidden="true">${num2(i + 1)}</span><div><h3>${fx(s.title)}</h3><p>${fx(s.body)}</p></div></li>`).join("")}</ol>`;

/** Article: TOC rail + reading column. */
const article = (tocHtml, body) => `<div class="band ct-read"><div class="container ct-article"><aside class="ct-toc-col">${tocHtml}</aside><div class="ct-body">${body}</div></div></div>`;

/** "In short": the full intro, answer-first. */
const inShort = (text, extra = "") => `<div class="ct-short"><p class="eyebrow">In short</p><p>${fx(text)}</p>${extra}</div>`;

/** Answers over the 45-word FAQ budget (C0), cut without changing the meaning. */
const FAQ_TRIM = {
  "Why do the calculator’s scenarios differ so much?": "Cautious and typical use published averages from brand accounts, retail and apps. The strong case uses the top values in the research and our assumptions for an engaged, growing audience: a best case, not typical. Your number depends on your content, audience, offer and price.",
  "Does sharing my link every day help?": "Some. Each Story gives the same viewers another chance to tap, so the gain levels off within a month, and link stickers can reduce engagement. Over months, regular sharing reaches new followers, as do Reels with a comment keyword and your bio link.",
};
/** FAQ band with an Archivo heading column. */
function faqBand(items, o = {}) {
  const list = items.map((f) => ({ q: qfix(f.q), a: fix(FAQ_TRIM[f.q] || f.a), html: f.html }));
  list.forEach((f) => !f.html && budget("FAQ answer", f.a, 45));
  return band({
    id: o.id || "questions", tone: o.tone || "paper", labelledby: (o.id || "questions") + "-h",
    inner: `<div class="split faq-split ct-faq-split">
  <div class="reveal">${eyebrow("Questions")}<h2 id="${o.id || "questions"}-h">${esc(o.title || "Questions, answered")}</h2>${o.side || ""}<div class="faq-kamran ct-faq-k">${kamranPill({ location: "faq", inline: true })}</div></div>
  <div class="reveal">${faq(list, { idPrefix: o.prefix || "gq" })}</div>
</div>`,
  });
}

/** Related pages: titled link cards. */
function related(paths, o = {}) {
  const kind = (p) => (p.kind === "guide" ? "Guide" : /calculator/.test(p.path) ? "Calculator" : p.kind === "feature" ? "Feature" : p.path === "/pricing" ? "Pricing" : "Page");
  const cards = paths.map(pageFor).filter(Boolean).map((p) => `<a class="ct-rel" href="${href(p.path)}" data-cta="related"><span class="eyebrow eyebrow--plain eyebrow--muted">${kind(p)}</span><span class="ct-rel-t">${esc(p.navLabel)}</span>${icon("arrow")}</a>`);
  return band({
    id: "related", labelledby: "related-h", tight: true,
    inner: `${sectionHead({ eyebrow: "Keep reading", title: o.title || "Related", id: "related-h" })}<div class="ct-rels reveal" data-stagger>${cards.join("")}</div>`,
  });
}

/** In-context CTA card (pace-wash), used once per guide after the first useful section. */
const inlineCta = (inner, o = {}) => `<aside class="ct-try${o.cls ? " " + o.cls : ""}" aria-labelledby="${o.id}-h">${inner}</aside>`;

/* ===================================================================== */
/* Guide data                                                             */
/* ===================================================================== */
const G = {
  pricing: "/guides/pricing-online-coaching-uae",
  followers: "/guides/instagram-followers-to-clients",
  permit: "/guides/uae-advertiser-permit",
  rules: "/guides/writing-coaching-rules",
};
const GUIDE = {
  [G.pricing]: {
    h1: "How to price online coaching in the UAE", mark: "price",
    lede: "Price between what your followers can afford and what your time is worth. A subscription to your method can sit well below your session rate.",
    dek: "Published UAE price ranges, worked AED examples, tiers, and what commission costs.",
    closing: { label: "Estimate my earnings", href: "/earnings-calculator" },
  },
  [G.followers]: {
    h1: "Turning Instagram followers into paying clients", mark: "paying",
    lede: "Only some followers see any one Story, a few tap a link, and a few visitors buy. Here is each step, with benchmarks.",
    dek: "Why most followers never see a Story, the benchmark for each step, and what helps.",
    closing: { label: "See what my followers are worth", href: "/follower-calculator" },
  },
  [G.permit]: {
    h1: "What the UAE advertiser permit means for trainers", mark: "permit",
    lede: "Reports say promoting your own coaching through a personal account is exempt. Rules change, so check the UAE Media Council. Information, not legal advice.",
    dek: "What reports say about the permit, and its exemption for promoting your own coaching.",
    closing: { label: "Coaching in the UAE", href: "/uae" },
  },
  [G.rules]: {
    h1: "Writing coaching rules your AI can follow", mark: "rules",
    lede: "Name the situation, the action, the exceptions and your reason, in plain words. Then test it on cases you didn’t use to write it.",
    dek: "A plain format your AI can apply: when, do, unless, because. Then test it.",
    closing: { label: "Try the demo", href: "/demo" },
  },
};
/** H2s cut to six words or fewer (C0); the rest keep content.json headings. */
const H2 = {
  [G.pricing]: { why: "Why subscriptions price differently", upfront: "Monthly or upfront, worked through" },
  [G.followers]: { "same-people": "Why more Stories level off", steps: "What to do, step by step" },
  [G.rules]: { example: "Four example rules", test: "Check it with your test cases" },
};
const h2For = (path, s) => (H2[path] && H2[path][s.id]) || s.heading;
const sec = (page, id) => page.sections.find((s) => s.id === id);

/* ---------------------------------------------------- signature visuals */
/** Price ladder: published ranges, then your subscription (Sample). */
function priceLadder(o = {}) {
  const rows = [
    { k: "Hybrid, online and in person", v: "AED 1,500–3,000", u: "a month", src: "369mmafit-online-2026" },
    { k: "Online coaching", v: "AED 400–2,000", u: "a month", src: "369mmafit-online-2026" },
    { k: "One-to-one session", v: "AED 70–350", u: "an hour, sold once", src: "heytrainer-dubai-2026" },
  ];
  return `<figure class="ladder${o.compact ? " ladder--compact" : ""}" aria-label="Published Dubai price ranges, then a sample subscription at AED 199 a month">
  <figcaption class="ladder-cap"><span class="eyebrow">Published price guides</span>${o.compact ? "" : '<span class="fine">Not official statistics</span>'}</figcaption>
  <ol class="ladder-rungs">
    ${rows.map((r, i) => `<li class="ladder-rung" style="--i:${i}"><span class="ladder-k">${r.k}</span><span class="ladder-v"><b class="fig">${r.v}</b><span>${r.u}</span></span>${o.compact ? "" : srcBadge(r.src)}</li>`).join("")}
    <li class="ladder-rung ladder-rung--you" style="--i:3"><span class="ladder-k">Your subscription ${sampleLabel("Sample")}</span><span class="ladder-v"><b class="fig">AED 199</b><span>a month, every subscriber, every day</span></span></li>
  </ol>
</figure>`;
}

/** Follower funnel: each step with its published range (not to scale). */
function funnel(o = {}) {
  if (o.thumb) return `<div class="funnel funnel--thumb" aria-hidden="true"><ol class="funnel-rows">${["Followers", "See a Story", "Tap the link", "Pay"].map((k, i) => `<li class="funnel-row"><span class="funnel-bar" style="--w:${[100, 72, 48, 30][i]}%"><span class="funnel-k">${k}</span></span></li>`).join("")}</ol></div>`;
  const rows = [
    { k: "Followers", v: "Your audience", w: 100 },
    { k: "See a Story", v: "about 10%", sub: "1–5K accounts", w: 64, src: "socialinsider-stories" },
    { k: "Tap the link", v: "1–5%", sub: "of viewers", w: 40, src: "creatorflow-link-sticker" },
    { k: "Pay", v: "0.72–6.2%", sub: "of visitors", w: 22, src: "dynamicyield-conversion" },
  ];
  return `<figure class="funnel" aria-label="The follower funnel: about 10% of followers see a Story, 1 to 5% of viewers tap the link, 0.72 to 6.2% of visitors pay. Not to scale.">
  <figcaption class="funnel-cap"><span class="eyebrow">The follower funnel</span><span class="fine">Not to scale</span></figcaption>
  <ol class="funnel-rows">${rows.map((r, i) => `<li class="funnel-row" style="--i:${i}"><span class="funnel-bar" style="--w:${r.w}%"><span class="funnel-k">${r.k}</span></span><span class="funnel-v"><b class="fig">${r.v}</b>${r.sub ? `<span>${r.sub}</span>` : ""}</span>${o.badges === false || !r.src ? "" : srcBadge(r.src)}</li>`).join("")}</ol>
</figure>`;
}

/** Two sample Stories sorted by what the permit reports cover. */
function permitSorter() {
  return `<figure class="sorter" aria-label="Two sample Stories: your own coaching offer is reported as exempt; a gifted product promotion needs a check first">
  <div class="sorter-head"><span class="eyebrow">Which posts?</span>${sampleLabel("Sample")}</div>
  <div class="sorter-grid">
    <div class="story story--own"><div class="story-top"><span class="po-mono" aria-hidden="true">LS</span><b>Layla Strength</b></div><p class="story-t">Strength, planned daily. Join my coaching.</p><span class="story-link">${icon("lock")}<span>layla-strength<wbr>.trainsyou<wbr>.com</span></span><p class="story-v">${chip("Your own coaching", "ok")}<span>Reported as exempt</span></p></div>
    <div class="story story--other"><div class="story-top"><span class="po-mono po-mono--alt" aria-hidden="true">LS</span><b>Layla Strength</b></div><p class="story-t">Gifted protein. Use my code for 20% off.</p><span class="story-link story-link--alt"><span>brand-shop<wbr>.example</span></span><p class="story-v">${chip("Someone else’s product", "off")}<span>Check the rules first</span></p></div>
  </div>
  <p class="fine sorter-foot">From public reports, not legal advice. ${srcBadge("gulfnews-advertiser-permit")}</p>
</figure>`;
}

/** Split a "When…, do…, unless…, because…" rule into its four parts. */
function ruleParts(text) {
  const m = String(text).match(/^When (.+?), (.+?), unless (.+?), because (.+?)\.?$/);
  return m ? { when: m[1], do: m[2], unless: m[3], because: m[4] } : null;
}
const PART_LABELS = [["when", "When"], ["do", "Do"], ["unless", "Unless"], ["because", "Because"]];
function ruleCard(card, o = {}) {
  const p = ruleParts(card.body);
  if (!p) return `<p>${fx(card.body)}</p>`;
  return `<div class="rule${o.cls ? " " + o.cls : ""}">
  <div class="rule-top"><span class="chip chip--ink">${esc(o.label || "Your rule")}</span><b>${esc(card.title)}</b>${chip(card.label || "Illustrative", "line")}</div>
  <dl class="rule-parts">${PART_LABELS.map(([k, l], i) => `<div class="rule-part rule-part--${k}" style="--i:${i}"><dt class="fig">${l}</dt><dd>${esc(p[k])}</dd></div>`).join("")}</dl>
</div>`;
}

/* ===================================================================== */
/* /guides                                                                */
/* ===================================================================== */
function guidesIndex(ctx) {
  CUR = ctx.path;
  const page = ctx.page;
  const list = Object.values(G).map(pageFor);
  const totalMins = list.reduce((n, p) => n + readMins(p), 0);
  const srcCount = new Set(list.flatMap((p) => p.sections.flatMap((s) => s.sources || []))).size;
  const meta = (p) => metaRow([`<b class="fig">${readMins(p)}</b> min read`, `Updated ${fmtDate(p.lastUpdated)}`]);

  const heroHtml = hero({
    eyebrow: "Guides", h1: "Guides for taking your coaching online", mark: "online",
    lede: "Practical, sourced guides for UAE personal trainers: pricing, followers, the advertiser permit and rules your AI can follow.",
    cta: ctaRow({ location: "hero", secondary: { label: "Estimate my earnings", href: "/earnings-calculator" } }),
    visual: `<div class="shelf card card--raised" aria-label="Reading list">
  <div class="shelf-head"><span class="eyebrow">Reading list</span><span class="chip chip--line chip--plain shelf-total"><b class="fig">${totalMins}</b> min in all</span></div>
  <ol class="shelf-list">${list.map((p, i) => `<li><a href="${href(p.path)}"><span class="fig shelf-n">${num2(i + 1)}</span><span class="shelf-t">${esc(GUIDE[p.path].h1)}</span><span class="fig shelf-m">${readMins(p)} min</span></a></li>`).join("")}</ol>
  <p class="fine shelf-foot">These guides cite ${srcCount} published sources, each on the methodology page.</p>
</div>`,
  });

  const pinned = list[0];
  const thumbs = {
    [G.followers]: funnel({ thumb: true }),
    [G.permit]: `<div class="thumb-split" aria-hidden="true"><span class="thumb-own">${okIcon()}Your own coaching</span><span class="thumb-other">${icon("info")}Someone else’s product</span></div>`,
    [G.rules]: `<div class="thumb-rule" aria-hidden="true">${PART_LABELS.map(([, l], i) => `<span class="fig" style="--i:${i}">${l}</span>`).join("")}</div>`,
  };
  const cards = band({
    id: "all-guides", labelledby: "guides-h", cls: "band-rule",
    inner: `${sectionHead({ eyebrow: "Start here", title: "Four guides, one decision each", id: "guides-h" })}
<article class="pin card card--raised reveal" aria-labelledby="pin-t">
  <div class="pin-copy">
    <div class="chip-row"><span class="chip chip--pace">Pinned</span><span class="chip chip--line chip--plain">Guide 01</span></div>
    <h3 id="pin-t" class="pin-t"><a href="${href(pinned.path)}" class="stretch">${esc(GUIDE[pinned.path].h1)}</a></h3>
    <p class="pin-dek">${esc(GUIDE[pinned.path].dek)}</p>
    ${meta(pinned)}
    <span class="link pin-go" aria-hidden="true">Read the guide${icon("arrow")}</span>
  </div>
  <div class="pin-vis">${priceLadder({ compact: true })}${srcList(["heytrainer-dubai-2026", "369mmafit-online-2026"])}</div>
</article>
<div class="gcards reveal" data-stagger>
  ${list.slice(1).map((p, i) => `<article class="gcard card" aria-labelledby="g-${i}">
    <div class="gcard-vis">${thumbs[p.path]}</div>
    <span class="chip chip--line chip--plain">Guide ${num2(i + 2)}</span>
    <h3 id="g-${i}" class="gcard-t"><a class="stretch" href="${href(p.path)}">${esc(GUIDE[p.path].h1)}</a></h3>
    <p class="gcard-dek">${esc(GUIDE[p.path].dek)}</p>
    ${meta(p)}
  </article>`).join("")}
</div>`,
  });

  const tools = band({
    id: "tools", tone: "paper", labelledby: "tools-h",
    inner: `${sectionHead({ eyebrow: "Tools", title: "Two calculators, your numbers", id: "tools-h", lede: "Put your own price and followers in. Every ratio is sourced." })}
<div class="cols-2 tools reveal" data-stagger>
  <a class="tool card" href="earnings-calculator.html" data-cta="tools">
    <span class="eyebrow eyebrow--plain eyebrow--muted">Earnings calculator</span>
    <span class="tool-t">Your price, our share, what you keep</span>
    <span class="tool-vis">${stairs({ labels: ["First 100", "101–300", "301–1,000", "1,001+"] })}</span>
    <span class="link">Estimate my earnings${icon("arrow")}</span>
  </a>
  <a class="tool card" href="follower-calculator.html" data-cta="tools">
    <span class="eyebrow eyebrow--plain eyebrow--muted">Follower calculator</span>
    <span class="tool-t">What your followers could be worth</span>
    <span class="tool-vis tool-scen" aria-hidden="true"><span><b class="fig">Cautious</b><i></i></span><span><b class="fig">Typical</b><i></i></span><span class="is-best"><b class="fig">Best case</b><i></i></span></span>
    <span class="link">See what my followers are worth${icon("arrow")}</span>
  </a>
</div>`,
  });

  return {
    main: [heroHtml, cards, tools].join("\n"),
    title: `${page.title} · trainsyou`,
    closing: { secondary: { label: "Estimate my earnings", href: "/earnings-calculator" } },
  };
}

/* ===================================================================== */
/* Guide articles                                                         */
/* ===================================================================== */
/** Builds a guide: hero, TOC + sections (with per-guide hooks), FAQ, related. */
function guidePage(ctx, o) {
  CUR = ctx.path;
  const page = ctx.page, g = GUIDE[ctx.path];
  const sources = new Set(page.sections.flatMap((s) => s.sources || []));
  const heroHtml = hero({
    crumbs: crumbs(page, pageFor),
    eyebrowHtml: eyebrow("Guide"),
    h1: g.h1, mark: g.mark, lede: g.lede,
    meta: metaRow([`<b class="fig">${readMins(page)}</b> min read`, `Updated ${fmtDate(page.lastUpdated)}`, sources.size ? `<b class="fig">${sources.size}</b> sources` : ""]),
    after: o.heroAfter || "",
    visual: o.visual,
    cls: "ct-hero--guide",
  });
  let n = 0;
  const secs = page.sections.map((s) => {
    const id = "s-" + s.id, title = h2For(ctx.path, s);
    const hook = (o.hooks || {})[s.id] || {};
    const inner = hook.replace ?? [paras(s.body), s.bullets ? (hook.bullets ? hook.bullets(s.bullets) : dashList(s.bullets)) : "", s.steps ? stepList(s.steps) : "", s.note && !s.table ? `<p class="ct-note">${fx(s.note)}</p>` : ""].join("");
    return { id, title, html: section(id, ++n, title, `${hook.before || ""}${inner}${s.sources && !hook.noSources ? srcList(s.sources) : ""}${hook.after || ""}`) };
  });
  const body = `${inShort(page.intro, o.shortExtra || "")}${secs.map((s) => s.html).join("\n")}
<p class="ct-end fine">Updated ${fmtDate(page.lastUpdated)}. ${o.endNote || "Every market figure links to its source on the methodology page."} <a class="inline-link" href="methodology.html">How we source figures</a></p>`;
  return {
    main: `<article class="ct-guide" data-guide="${esc(page.path)}">${heroHtml}${article(toc(secs), body)}</article>\n${faqBand(page.faqs, { title: o.faqTitle || "Questions, answered", prefix: "gq" })}\n${related(page.related)}`,
    title: `${page.title} · trainsyou`,
    closing: { secondary: g.closing },
  };
}

/* -------------------------------------------------- pricing guide */
function pricingGuide(ctx) {
  const page = ctx.page;
  const ranges = sec(page, "ranges");
  const pubId = (label) => (content.sources.find((s) => label.startsWith(s.publisher)) || {}).id;
  const rangeTable = `<div class="table-wrap ct-table"><table class="table"><caption>${esc(ranges.table.caption)}</caption><thead><tr><th scope="col">Service</th><th scope="col">Published range</th><th scope="col">Source</th></tr></thead><tbody>${ranges.table.rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td class="fig">${esc(r[1].replace(/-/g, "–"))}</td><td>${srcBadge(pubId(r[2]))}<span class="fine ct-src-year">${esc(r[2])}</span></td></tr>`).join("")}</tbody></table></div><p class="ct-note">${fx(ranges.note)}</p>`;

  const keep60 = C.compactEarnings(60, 199, 250);
  const tryCard = inlineCta(`<div class="ct-try-copy"><p class="eyebrow">Try it</p><h3 id="try-h">Try your price</h3><p>Step your price. See what 60 subscribers would leave you before card processing.</p>${sampleLabel("Sample: 60 subscribers")}</div>
<div class="ct-try-tool" data-calc="earnings" data-calc-name="guide_pricing">
  <div class="pricer" data-pricer data-min="199" data-max="999" data-step="10" data-calc-name="guide_pricing">
    <button class="pricer-btn" type="button" data-step="-1" aria-label="Lower your price by AED 10" aria-disabled="true">${icon("minus")}</button>
    <div class="pricer-out"><span class="flash">${val("AED 199", { cls: "fig", attrs: "data-pricer-out", w: "8ch", align: "center" })}</span><span class="per">your price, a month</span></div>
    <button class="pricer-btn" type="button" data-step="1" aria-label="Raise your price by AED 10">${icon("plus")}</button>
    <input type="hidden" data-sync="price" value="199" min="199" max="999">
    <span class="sr-only" aria-live="polite" data-live></span>
  </div>
  <input type="hidden" data-in="price" data-sync="price" value="199" min="199" max="999"><input type="hidden" data-in="subscribers" value="60"><input type="hidden" data-in="rate" value="250">
  <div class="ct-try-out flash" data-result><span class="ct-try-l">You keep at 60 subscribers<small>before card processing</small></span>${val(C.aed(keep60.beforeOtherCostsMinor), { out: "keep", cls: "fig keep ct-try-fig", w: "9ch", align: "end" })}</div>
  <div class="chip-row">${statusChip("payments", "subscriber payments")}</div>
  ${paymentsNote()}
  <a class="btn btn--secondary btn--block" href="earnings-calculator.html?price=199&amp;subs=60" data-try-link data-cta="inline">Try my price in the earnings calculator${icon("arrow")}</a>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`, { id: "try" });

  const ex = [[40, 149], [120, 199], [350, 249]].map(([n, p]) => ({ n, p, e: C.compactEarnings(n, p, 250) }));
  const examples = `<div class="chip-row ct-chips">${estimateLabel()}${statusChip("payments", "subscriber payments")}</div>
<div class="wx reveal" data-stagger>${ex.map(({ n, p, e }) => `<dl class="wx-card">
  <div class="wx-head"><dt class="sr-only">Example</dt><dd class="fig wx-t">${C.whole(n)} × AED ${C.whole(p)}</dd></div>
  <div class="wx-row"><dt>Subscriptions</dt><dd class="fig">${C.aed(e.subscriptionMonthlyMinor)}</dd></div>
  <div class="wx-row wx-row--minus"><dt>Our share, ${pct2(e.effectiveCommissionPct)}${e.effectiveCommissionPct < 25 ? " overall" : ""}</dt><dd class="fig">−${C.aed(e.commissionMinor)}</dd></div>
  <div class="wx-keep"><dt>Before other costs</dt><dd class="fig keep">${C.aed(e.beforeOtherCostsMinor)}</dd></div>
  <div class="wx-foot"><dt class="sr-only">Sessions</dt><dd>About ${C.whole(e.equivalentSessions)} sessions at AED 250</dd></div>
</dl>`).join("")}</div>
<p class="ct-note">${fx(sec(page, "examples").note.replace("The last column divides the amount by a AED 250 session rate.", "Sessions divide the amount by an AED 250 session rate."))}</p>${paymentsNote()}`;

  const up = sec(page, "upfront");
  const upE = C.estimateEarnings({ ...C.DEFAULT_EARNINGS_INPUTS, subscribers: 60, billing: "upfront", workoutPriceAed: 540, programmeMonths: 3, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0 });
  const upfront = `<p>${fx(up.body[0])}</p>${statement({
    title: "Three-month programme", period: "60 subscribers · AED 540 upfront", cls: "ct-statement",
    rows: [
      { label: "AED 540 ÷ 3 months", value: C.aed(upE.averageMonthlyMinor) + " a month" },
      { label: "60 × " + C.aed(upE.averageMonthlyMinor), value: C.aed(upE.subscriptionMonthlyMinor) },
      { label: "Our share, first 100 at 25%", value: "−" + C.aed(upE.commissionMinor), sub: true },
    ],
    total: { label: "Before other costs", value: C.aed(upE.beforeOtherCostsMinor) },
  })}<p>${fx(up.body[1])}</p>`;

  const t = C.estimateEarnings({ ...C.DEFAULT_EARNINGS_INPUTS, subscribers: 100, workoutPriceAed: 199, nutritionSharePct: 30, nutritionPriceAed: 299, voiceSharePct: 0, sessionsPerMonth: 0 });
  const tiers = sec(page, "tiers");
  const tierMix = `<figure class="mix reveal" aria-label="Tier mix: 70 subscribers at AED 199 and 30 at AED 299 average AED 229 a month">
  <div class="mix-bar"><span class="mix-a" style="--w:70%"><b class="fig">70</b> at AED 199</span><span class="mix-b" style="--w:30%"><b class="fig">30</b> at AED 299</span></div>
  <div class="mix-out"><span>Average a month</span><b class="fig fig-md">${C.aed(t.averageMonthlyMinor)}</b></div>
  <figcaption class="fine">Workouts at AED 199, workouts and nutrition at AED 299. Subscriptions ${C.aed(t.subscriptionMonthlyMinor)} a month; our share at 25% is ${C.aed(t.commissionMinor)}.</figcaption>
</figure>`;

  return guidePage(ctx, {
    heroAfter: `<div class="ct-hero-strip">${statusStrip({ href: "pricing.html#status" })}</div>`,
    visual: priceLadder(),
    hooks: {
      ranges: { replace: rangeTable, after: tryCard, noSources: true },
      examples: { replace: examples },
      upfront: { replace: upfront },
      tiers: { replace: `<p>${fx(tiers.body[0])}</p>${tierMix}<p>${fx(tiers.body[1])} ${statusChip("voice", "voice add-on")}</p>` },
      position: { bullets: (b) => tickList(b, "ok") },
      commission: { after: `<div class="ct-stairs reveal">${stairs({ labels: ["First 100", "101–300", "301–1,000", "1,001+"] })}<p class="fine">Each rate applies only to the subscribers in its band. We earn only when your subscribers pay.</p></div>` },
      mistakes: { bullets: (b) => tickList(b, "no") },
    },
    faqTitle: "Pricing questions",
  });
}

/* -------------------------------------------------- Instagram guide */
function followersGuide(ctx) {
  const page = ctx.page;
  const fe = C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS).scenarios;
  const funnelSec = sec(page, "funnel");
  const steps = funnelSec.bullets.map((b) => { const i = b.indexOf(":"); return { k: b.slice(0, i), v: b.slice(i + 1).trim() }; });
  const funnelList = `<dl class="fsteps">${steps.map((s, i) => `<div class="fstep"><dt><span class="fig">${num2(i + 1)}</span>${esc(s.k)}</dt><dd>${fx(s.v.charAt(0).toUpperCase() + s.v.slice(1))}</dd></div>`).join("")}</dl>`;

  const mini = inlineCta(`<div class="ct-try-copy"><p class="eyebrow">Try it</p><h3 id="fol-h">What are your followers worth?</h3><p>Type your follower count. Three scenarios, at AED 199 a month and 8 link Stories.</p>${estimateLabel()}</div>
<div class="ct-try-tool" data-calc="follower" data-calc-name="follower_guide">
  ${numberField({ label: "Instagram followers", in: "followers", value: 7000, min: 0, max: 10000000, step: 100, id: "fol-n" })}
  <input type="hidden" data-in="price" data-sync="price" value="199"><input type="hidden" data-in="stories" value="8">
  <div class="mscen" data-result role="list">
    ${[["cautious", "Cautious"], ["typical", "Typical"], ["strong", "Best case"]].map(([k, l]) => `<div class="mscen-col${k === "strong" ? " is-best" : ""}" role="listitem"><span class="mscen-l">${l}</span>${val(C.aed(fe[k].revenueMonth12Minor), { out: k + ".revenue", cls: "fig", w: "9ch" })}<span class="mscen-u">a month at month&nbsp;12</span></div>`).join("")}
  </div>
  <p class="fine">Before platform commission. Best case is for an engaged, growing audience, not a typical result. ${srcBadge("revenuecat-state-2026")}</p>
  <div class="chip-row">${statusChip("payments", "subscriber payments")}</div>
  ${paymentsNote()}
  <a class="btn btn--secondary btn--block" href="follower-calculator.html" data-cta="inline">See what my followers are worth${icon("arrow")}</a>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`, { id: "fol", cls: "ct-try--fol" });

  const reach = `<figure class="seq reveal" aria-label="Story sequence reach: 6.3% for a one-frame Story, 20.5% by the sixth frame">
  <div class="seq-col"><span class="seq-bar" style="--h:31%"></span><b class="fig fig-md">6.3%</b><span>1 frame</span></div>
  <div class="seq-arrow" aria-hidden="true">${icon("arrow")}</div>
  <div class="seq-col"><span class="seq-bar seq-bar--hi" style="--h:100%"></span><b class="fig fig-md">20.5%</b><span>6 frames</span></div>
  <figcaption class="fine">Reach of a Story sequence, by frame. ${srcBadge("socialinsider-stories")}</figcaption>
</figure>`;

  const accounts = [3000, 7000, 30000].map((f) => ({ f, s: C.estimateFollowerConversion({ ...C.DEFAULT_FOLLOWER_INPUTS, followers: f }).scenarios.strong }));
  const version = C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS).assumptionsVersion;
  const cols = ["Followers", "New subscribers, first month", "Active after 12 months", "Sign-ups over 12 months", "A month at month 12"];
  const exTable = `<p>${fx(sec(page, "examples").body[0])}</p>
<div class="chip-row ct-chips"><span class="chip chip--ink">Best case</span>${estimateLabel()}${statusChip("payments", "subscriber payments")}</div>
<div class="ct-rtable-wrap"><table class="table ct-rtable"><caption>Best case for an engaged, growing audience, not a typical result: AED 199 a month, 8 link Stories and 4 keyword Reels a month, 30% yearly cancellations${version ? ` (assumptions ${esc(version)})` : ""}.</caption>
<thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
<tbody>${accounts.map(({ f, s }) => `<tr><th scope="row" class="fig" data-label="${cols[0]}">${C.whole(f)}</th><td class="fig" data-label="${cols[1]}">${C.countLabel(s.month1New)}</td><td class="fig" data-label="${cols[2]}">${C.countLabel(s.activeMonth12)}</td><td class="fig" data-label="${cols[3]}">${C.countLabel(s.signups12)}</td><td class="fig" data-label="${cols[4]}">${C.aed(s.revenueMonth12Minor)}</td></tr>`).join("")}</tbody></table></div>
<p class="fine">Before platform commission. <a class="inline-link" href="methodology.html#s-follower-formula">How we calculate this</a></p>${paymentsNote()}`;

  const eng = sec(page, "engagement");
  const engFig = `<div class="pair reveal"><div class="pair-c"><b class="fig fig-band">2.19%</b><span>engagement, accounts with 1,000–10,000 followers</span>${srcBadge("hypeauditor-2025")}</div><div class="pair-c"><b class="fig fig-band">0.48%</b><span>average across 35 million posts in 2025</span>${srcBadge("socialinsider-engagement")}</div></div>`;

  return guidePage(ctx, {
    heroAfter: `<div class="ct-hero-strip">${statusStrip({ href: "pricing.html#status" })}</div>`,
    visual: funnel(),
    hooks: {
      funnel: { replace: funnelList, after: mini },
      "same-people": { after: reach },
      examples: { replace: exTable },
      engagement: { replace: `${paras(eng.body.slice(0, 1))}${engFig}${paras(eng.body.slice(1))}` },
      honest: { bullets: (b) => tickList(b, "ok") },
    },
    faqTitle: "Follower questions",
  });
}

/* -------------------------------------------------- permit guide */
function permitGuide(ctx) {
  const page = ctx.page;
  const council = sourceFor("uae-media-council-permit");
  const hedge = `<div class="hedge" role="note">${icon("info")}<p><b>Information, not legal advice.</b> This guide summarises public reports. Rules change: confirm your situation with the ${council ? ext(council.url, "UAE Media Council") : "UAE Media Council"} or a legal adviser.</p></div>`;
  const checklist = sec(page, "checklist");
  const checks = `<div class="checks" data-checks>
  <ol class="checks-list">${checklist.steps.map((s, i) => `<li><label class="checks-item"><input type="checkbox" data-check><span class="checks-box" aria-hidden="true">${icon("check")}</span><span class="checks-txt"><b>${esc(s.title)}</b><span>${fx(s.body)}</span></span><span class="fig checks-n" aria-hidden="true">${num2(i + 1)}</span></label></li>`).join("")}</ol>
  <div class="checks-foot"><span class="checks-meter" aria-hidden="true"><i style="--p:0"></i></span><span class="fine" data-checks-out aria-live="polite">0 of ${checklist.steps.length} checked</span></div>
</div>`;
  const others = sec(page, "others");
  return guidePage(ctx, {
    heroAfter: hedge,
    visual: permitSorter(),
    shortExtra: "",
    hooks: {
      summary: { after: council ? `<p class="ct-official">${icon("lock")}<span>Applications are made through the official site: ${ext(council.url, "UAE Media Council")}</span></p>` : "" },
      own: { after: `<div class="verdict verdict--ok">${okIcon()}<p><b>Your offer, your programme, your price, your link.</b> Reports describe this as exempt through your personal account.</p></div>` },
      others: { replace: `${paras(others.body)}<ul class="tick-list ct-ticks ct-ticks--warn">${others.bullets.map((b) => `<li>${icon("info")}<span>${fx(b)}</span></li>`).join("")}</ul>` },
      checklist: { replace: checks },
    },
    endNote: "Summarised from public reports, which may change. Not legal advice.",
    faqTitle: "Permit questions",
  });
}

/* -------------------------------------------------- rules guide */
function rulesGuide(ctx) {
  const page = ctx.page;
  const fmt = sec(page, "format");
  const anatomy = `<dl class="anatomy reveal" data-stagger>${fmt.steps.map((s, i) => `<div class="anatomy-p anatomy-p--${PART_LABELS[i][0]}"><dt class="fig">${esc(s.title)}</dt><dd>${fx(s.body)}</dd></div>`).join("")}</dl>`;
  const ex = sec(page, "example");
  const tabs = `<div class="rtabs" data-rtabs>
  <div class="tabs" role="tablist" aria-label="Example rules" data-tabs>${ex.cards.map((c, i) => `<button class="tab" role="tab" id="rt-${i}" aria-controls="rp-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(c.title)}</button>`).join("")}<span class="tab-ind" aria-hidden="true"></span></div>
  ${ex.cards.map((c, i) => `<div class="tabpanel rtab-panel" role="tabpanel" id="rp-${i}" aria-labelledby="rt-${i}"${i ? " hidden" : ""}>${ruleCard(c)}<p class="rtab-full"><span class="fine">As one sentence:</span> ${esc(c.body)}</p></div>`).join("")}
</div>
${inlineCta(`<div class="ct-try-copy"><p class="eyebrow">Try it</p><h3 id="demo-h">Edit a rule and watch it decide</h3><p>The demo is scripted with a sample trainer. Change the rule, then see where each message goes.</p></div><div class="ct-try-go">${sampleLabel()}<a class="btn" href="demo.html" data-cta="inline">Try editing a rule in the demo${icon("arrow")}</a></div>`, { id: "demo", cls: "ct-try--row" })}`;
  const ten = sec(page, "first-rules");
  return guidePage(ctx, {
    visual: `<div class="rule-hero">${ruleCard(ex.cards[0], { cls: "rule--hero" })}<p class="fine rule-hero-cap">Your AI (we call it your Trainer Brain) applies rules written like this.</p></div>`,
    hooks: {
      format: { replace: anatomy },
      example: { replace: tabs },
      good: { bullets: (b) => tickList(b, "ok") },
      mistakes: { bullets: (b) => tickList(b, "no") },
      "first-rules": { replace: `<ol class="ten reveal" data-stagger>${ten.bullets.map((b, i) => `<li><span class="fig">${num2(i + 1)}</span>${fx(b)}</li>`).join("")}</ol>` },
    },
    faqTitle: "Rule questions",
  });
}

/* ===================================================================== */
/* /faq                                                                   */
/* ===================================================================== */
function faqPage(ctx) {
  CUR = ctx.path;
  const page = ctx.page;
  const from = (path, q) => { const f = (pageFor(path).faqs || []).find((x) => x.q === q); if (!f) throw new Error(`FAQ missing: ${path} ${q}`); return f; };
  const own = (q) => from("/faq", q);
  const frontierQ = content.availabilityLines.find((l) => l.when === "frontier" && l.faq && !l.path);
  const frontierExtra = content.availabilityLines.find((l) => l.when === "frontier" && l.path === "/faq");
  const trained = own("Is the AI trained on my data?");
  const GROUPS = [
    { id: "money", label: "Money", items: [
      { q: "Can subscribers pay me today?", html: `<p>${statusChip("payments", "subscriber payments")}</p><p>Not yet. Subscriber payments are not on yet, and publishing waits for them. Today you can sign up, build your page and app, and teach and test your AI. We’ll show it here when payments are on.</p>` },
      own("Does it cost anything to join?"),
      own("Who sets the subscription price?"),
      { q: "How does money reach me?", html: `<p>${statusChip("payments", "subscriber payments and payouts")}</p><p>Once payments are on: subscribers pay by card in AED. After reconciliation, your earnings are paid monthly to your verified UAE bank account, with a statement from gross to net.</p>` },
      own("Is cancellation the same as a refund?"),
    ] },
    { id: "control", label: "Your AI and control", items: [
      own("Will the AI replace me?"),
      { q: trained.q, html: `<p class="if-frontier-off">${fx(trained.a)}</p><p class="if-frontier-on">${fx(frontierQ ? frontierQ.faq.a : trained.a)}</p>` },
      frontierExtra && { q: frontierExtra.faq.q, a: frontierExtra.faq.a, cls: "if-frontier-on" },
      from("/how-it-works", "What does the Brain do when it is not sure?"),
      from("/trainer-brain", "Can another trainer see or use my Brain?"),
    ] },
    { id: "safety", label: "Safety", items: [own("Will it give bad advice under my name?"), own("What happens when a subscriber reports pain?"), from("/security-and-privacy", "Who can see my subscribers’ data?")] },
    { id: "setup", label: "Setup", items: [
      own("Do I need technical skills?"),
      { q: "What can I connect?", html: `<p>Apple Health exports work today ${chip("Live", "ok")}</p><p>WHOOP, Zepp, your own domain and Instagram show “Not on yet” until they are switched on for the platform ${chip("Not on yet", "off")}</p><p>The voice add-on for subscribers ${statusChip("voice", "")}</p>` },
      own("Does it work offline?"),
      from("/get-started", "Can I see it before subscribers do?"),
    ] },
    { id: "brand", label: "Your brand and followers", items: [own("Will my followers pay?"), own("What does a subscriber get for their money?"), from("/about", "Whose brand do subscribers see?")] },
    { id: "uae", label: "UAE and legal", items: [own("Do I need an advertiser permit to promote my own coaching?"), from("/uae", "Do I need a trade licence?"), from("/uae", "Is it available in Arabic?"), from("/uae", "Do subscribers pay in AED?")] },
  ];
  let k = 0;
  const live = (g) => g.items.filter((f) => f && !f.cls);
  const total = GROUPS.reduce((n, g) => n + live(g).length, 0);
  const groupsHtml = GROUPS.map((g) => {
    const items = g.items.filter(Boolean).map((f) => {
      const q = qfix(f.q), a = f.a ? fix(f.a) : "";
      if (a) budget("FAQ answer", a, 45);
      k++;
      return `<div class="acc${f.cls ? " " + f.cls : ""}" id="fq-${k}" data-q>
  <h3 class="acc-q"><button class="acc-btn" type="button" aria-expanded="false" aria-controls="fq-${k}-a"><span>${esc(q)}</span><span class="acc-icon">${icon("faq")}</span></button></h3>
  <div class="acc-panel" id="fq-${k}-a" role="region" aria-label="${esc(q)}"><div class="acc-inner"><div>${f.html || `<p>${esc(a)}</p>`}</div></div></div>
</div>`;
    }).join("");
    return `<section class="fgroup" id="faq-${g.id}" data-group="${g.id}" aria-labelledby="faq-${g.id}-h"><h2 id="faq-${g.id}-h" class="fgroup-h"><span>${esc(g.label)}</span><span class="fig fgroup-n" aria-hidden="true" data-gcount>${num2(live(g).length)}</span></h2><div class="faq">${items}</div></section>`;
  }).join("");

  const top = [["Can subscribers pay me today?", "money"], ["Will my AI replace me?", "control"], ["What happens when a subscriber reports pain?", "safety"]];
  const qIndex = (q) => { let i = 0; for (const g of GROUPS) for (const f of g.items.filter(Boolean)) { i++; if (qfix(f.q) === q) return i; } return 1; };
  const heroHtml = hero({
    eyebrow: "FAQ", h1: "Questions trainers ask before they start", mark: "start",
    lede: "Short, plain answers to what trainers ask most, grouped by what worries you first.",
    cta: `<div class="cta-row cta-row--stack-sm">${primaryCta({ location: "hero" })}${kamranPill({ location: "hero" })}</div>${H.microLine()}`,
    visual: `<div class="asked card card--raised"><p class="eyebrow">Asked most</p><ol class="asked-list">${top.map(([q], i) => `<li><a href="#fq-${qIndex(q)}" data-open-q><span class="fig">${num2(i + 1)}</span><span>${esc(q)}</span>${icon("arrow")}</a></li>`).join("")}</ol><p class="fine"><span data-total>${total}</span> answers in six groups. Money first.</p></div>`,
  });

  const finder = `<div class="finder" data-finder>
  <div class="field finder-field"><label for="faq-filter">Find a question</label><div class="finder-input"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.7"/><path d="m13.5 13.5 3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input id="faq-filter" class="input" type="search" placeholder="Try “refund” or “pain”" autocomplete="off" data-filter aria-describedby="faq-count"><button type="button" class="finder-clear" data-clear aria-label="Clear search" hidden>${icon("cross")}</button></div></div>
  <div class="topics" role="group" aria-label="Show questions about" data-topics>
    <button type="button" class="topic" aria-pressed="true" data-topic="all">All<span class="fig" data-tcount>${total}</span></button>
    ${GROUPS.map((g) => `<button type="button" class="topic" aria-pressed="false" data-topic="${g.id}">${esc(g.label)}<span class="fig" data-tcount>${live(g).length}</span></button>`).join("")}
    <span class="topic-ind" aria-hidden="true"></span>
  </div>
  <p class="fine finder-count" id="faq-count" data-count aria-live="polite">Showing all ${total} questions</p>
  <div class="finder-k">${kamranPill({ location: "faq", inline: true })}</div>
</div>`;
  const empty = `<div class="finder-empty" data-empty hidden><p class="h4">No question matches that.</p><p class="muted">Try a shorter word, or ask Kamran, our AI voice.</p><div class="cta-row">${kamranPill({ location: "faq-empty" })}<button type="button" class="btn btn--secondary btn--sm" data-clear>Show all questions</button></div></div>`;
  const faqMain = band({
    id: "answers", tone: "paper", label: "All questions",
    inner: `<div class="faqx"><aside class="faqx-side">${finder}</aside><div class="faqx-main" data-faq-list>${groupsHtml}${empty}</div></div>`,
  });
  return {
    main: [heroHtml, faqMain].join("\n"),
    title: `${page.title} · trainsyou`,
    closing: { secondary: { label: "See how it works", href: "/how-it-works" } },
    kamran: true,
  };
}

/* ===================================================================== */
/* /about                                                                 */
/* ===================================================================== */
function aboutPage(ctx) {
  CUR = ctx.path;
  const page = ctx.page;
  const s = (id) => sec(page, id);
  const heroHtml = hero({
    eyebrow: "About", h1: "About trainsyou", mark: "trainsyou", lede: page.lede,
    cta: ctaRow({ location: "hero", secondary: { label: "Read how we source numbers", href: "/methodology" } }),
    visual: `<dl class="facts-card card card--raised">
  <div><dt>Built for</dt><dd><b class="fig fig-md">UAE</b><span>personal trainers with their own method</span></dd></div>
  <div><dt>Prices and payouts</dt><dd><b class="fig fig-md">AED</b><span>you set the price</span></dd></div>
  <div><dt>Our share</dt><dd><b class="fig fig-md">25 → 10%</b><span>falls as you grow</span></dd></div>
  <div><dt>To join</dt><dd><b class="fig fig-md">Free</b><span>nothing to pay upfront</span></dd></div>
</dl>`,
  });

  const founder = band({
    id: "founder", tone: "paper", labelledby: "founder-h",
    inner: `<div class="split split--even about-two">
  <div class="founder-note reveal">
    <div class="fn-photo" aria-hidden="true"><span>Photo</span></div>
    <div><p class="eyebrow eyebrow--muted">Founder note</p><h2 id="founder-h" class="h3">Why I built trainsyou</h2>
    <p class="fn-q">[Founder name, photo, the UAE connection and why they built trainsyou. Owner to supply: decision 2.]</p>
    <p class="fn-k">Kamran is an AI voice of [founder name], used with consent. ${chip("Owner to confirm", "line")}</p>
    <div class="fn-pill">${kamranPill({ location: "about" })}</div>
    <p class="fine">Shown only with the founder’s own words. We never write one for them.</p></div>
  </div>
  <div class="money-card card reveal">
    <p class="eyebrow">Money</p>
    <h2 class="h3">${esc(s("money").heading)}</h2>
    <p class="muted">${fx(s("money").body[0])}</p>
    ${stairs({ labels: ["First 100", "101–300", "301–1,000", "1,001+"] })}
    <p class="money-line">We earn only when your subscribers pay.</p>
    ${secondaryLink({ label: "Pricing in detail", href: "/pricing" })}
  </div>
</div>`,
  });

  const mission = band({
    id: "mission", labelledby: "mission-h",
    inner: `<div class="mission reveal"><h2 id="mission-h" class="eyebrow">Our mission</h2><p class="mission-t">${fx(s("mission").body[0]).replace("affordable", '<span class="ct-mark">affordable</span>')}</p></div>
<div class="cols-3 mission-sub reveal" data-stagger>
  <div><h3 class="h4">What we build</h3><p class="muted">${fx(s("what").body[0])} ${fx(s("what").body[1])}</p><div class="chip-row">${statusChip("payments", "AED payments and paid bookings")}</div></div>
  <div><h3 class="h4">For trainers</h3><p class="muted">${fx(s("who").body[0])}</p></div>
  <div><h3 class="h4">For subscribers</h3><p class="muted">${fx(s("who").body[1])}</p></div>
</div>`,
  });

  const notMap = content.notStatements.map((t) => { const i = t.indexOf(":"); return { k: t.slice(0, i), v: t.slice(i + 1).trim() }; });
  const isNot = s("is-not").bullets;
  const ledger = band({
    id: "is-not", tone: "paper", labelledby: "isnot-h",
    inner: `${sectionHead({ eyebrow: "Plainly", title: "What we are, and are not", id: "isnot-h" })}
<div class="isnot reveal">
  <div class="isnot-col isnot-col--is"><p class="isnot-h">${okIcon()}We are</p><p class="isnot-big">${fx(isNot[0])}</p></div>
  <ul class="isnot-col isnot-col--not"><li class="isnot-h" aria-hidden="true">${noIcon()}We are not</li>${notMap.map((n) => `<li><b>${fx(n.k.replace(/^It (is not|does not)/, (m, a) => (a === "is not" ? "Not" : "Does not")))}</b><span>${fx(n.v.charAt(0).toUpperCase() + n.v.slice(1))}</span></li>`).join("")}</ul>
</div>`,
  });

  const honesty = band({
    id: "results", labelledby: "results-h",
    inner: `<div class="split">
  <div class="reveal">${eyebrow("Honesty")}<h2 id="results-h">${esc(s("honesty").heading)}</h2><p class="lede">Every figure is one you can check.</p><p>${secondaryLink({ label: "Read how we source numbers", href: "/methodology" })}</p></div>
  <ol class="rules-list reveal" data-stagger>${s("honesty").bullets.map((b, i) => `<li><span class="fig">${num2(i + 1)}</span><span>${fx(b)}</span></li>`).join("")}</ol>
</div>`,
  });

  const where = band({
    id: "where", tone: "paper", labelledby: "where-h",
    inner: `<div class="cols-2 where reveal" data-stagger>
  <div class="card card--flat"><p class="eyebrow">UAE</p><h2 id="where-h" class="h3">${esc(s("where").heading)}</h2><p class="muted">${fx(s("where").body[0])}</p><div class="chip-row"><span class="chip chip--line chip--plain">Prices in AED</span><span class="chip chip--line chip--plain">Payouts in AED</span><span class="chip chip--line chip--plain">English and Arabic member controls</span><span class="chip chip--line chip--plain">Right-to-left layouts</span></div></div>
  <div class="card card--flat"><p class="eyebrow">Company and contact</p><h2 class="h3">Who you are dealing with</h2>
    <dl class="contact">${["Company name", "Trade licence", "Registered address", "Support email"].map((t) => `<div><dt>${t}</dt><dd>[owner to supply]</dd></div>`).join("")}</dl>
    <p class="fine">Account holders can reach us today through Support in their account.</p></div>
</div>`,
  });

  return {
    main: [heroHtml, founder, mission, ledger, honesty, where, faqBand(page.faqs, { title: "About us, answered", prefix: "aq", tone: "white" })].join("\n"),
    title: `${page.title} · trainsyou`,
    closing: { secondary: { label: "Read how we source numbers", href: "/methodology" } },
  };
}

/* ===================================================================== */
/* /methodology                                                           */
/* ===================================================================== */
const MODULES = { core: corePages, product: productPages, audience: audiencePages, money: moneyPages };
let USAGE = null;
/** Where each source is used: badges in every rendered page, plus content.json section sources. */
function sourceUsage() {
  if (USAGE) return USAGE;
  USAGE = new Map();
  const warn = console.warn;
  console.warn = () => {};
  const add = (id, path) => { if (!sourceFor(id)) return; if (!USAGE.has(id)) USAGE.set(id, new Set()); USAGE.get(id).add(path); };
  for (const entry of registry) {
    if (entry.path === "/methodology") continue;
    (entry.page.sections || []).forEach((s) => (s.sources || []).forEach((id) => add(id, entry.path)));
    const render = (entry.group === "content" ? pages : MODULES[entry.group] || {})[entry.path];
    if (!render) continue;
    try {
      const out = render({ ...entry, content, C, h: H, href, esc, pageFor, registry, LIVE });
      const html = typeof out === "string" ? out : out.main || "";
      for (const m of html.matchAll(/methodology\.html#([a-z0-9-]+)/g)) add(m[1], entry.path);
    } catch { /* another group's page failed to render: skip its usage */ }
  }
  console.warn = warn;
  CUR = "/methodology";
  return USAGE;
}

function methodologyPage(ctx) {
  CUR = ctx.path;
  const page = ctx.page;
  const usage = sourceUsage();
  CUR = ctx.path;
  const ff = sec(page, "follower-formula"), em = sec(page, "earnings-method");
  const sup = (t) => esc(fix(t)).replace(/\^\(([^)]+)\)/g, "<sup>$1</sup>").replace(/\^([A-Za-z0-9]+)/g, "<sup>$1</sup>");
  const labelOf = (p) => (p.path === "/" ? "Home" : p.navLabel);
  const order = registry.map((r) => r.path);
  const pagesUsing = [...new Set([...usage.values()].flatMap((s) => [...s]))].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const heroHtml = hero({
    eyebrow: "Methodology", h1: "Methodology and sources", mark: "sources",
    lede: "Every figure from outside trainsyou, with its source, the date we retrieved it and how we use it.",
    cta: ctaRow({ location: "hero", secondary: { label: "Back to the follower calculator", href: "/follower-calculator" } }),
    visual: `<div class="ledger-sum card card--raised">
  <p class="eyebrow">The ledger</p>
  <div class="ls-figs"><div><b class="fig fig-band">${content.sources.length}</b><span>published sources</span></div><div><b class="fig fig-band">${new Set(content.sources.map((s) => s.evidence)).size}</b><span>kinds of evidence, labelled</span></div></div>
  <p class="ls-how"><span class="src" aria-hidden="true">Source${icon("arrow")}</span><span>Every badge on the site lands on its row here, and each row links back to the pages that use it.</span></p>
  <p class="fine">Retrieved ${fmtDate(content.sources[0].retrieved)}. Estimates are never promises.</p>
</div>`,
  });

  const principles = band({
    id: "principles", labelledby: "principles-h", cls: "band-rule",
    inner: `${sectionHead({ eyebrow: "Principles", title: sec(page, "principles").heading, id: "principles-h" })}
<ol class="cols-4 princ reveal" data-stagger>${sec(page, "principles").bullets.map((b, i) => `<li><span class="fig princ-n">${num2(i + 1)}</span><p>${fx(b)}</p></li>`).join("")}</ol>`,
  });

  const sc = content.citedAssumptions.scenarios;
  const rows = [
    ["Link taps per Story viewer", "linkClickPct", "creatorflow-link-sticker"],
    ["DM link opens", "dmOpenPct"],
    ["Broadcast link taps", "broadcastClickPct"],
    ["Bio link taps a month", "bioClickPct"],
    ["Visitors who pay", "paidPct", "dynamicyield-conversion"],
    ["New people each month", "audienceRenewalPct"],
  ];
  const assumptions = `<div class="ct-rtable-wrap"><table class="table ct-rtable ct-assume"><caption>The values the calculator uses right now${C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS).assumptionsVersion ? ` (assumptions ${esc(C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS).assumptionsVersion)})` : ""}. Engagement benchmark: ${content.citedAssumptions.engagementBenchmarkPct}% ${srcBadge("socialinsider-engagement")}</caption>
<thead><tr><th scope="col">Rate</th><th scope="col">Cautious</th><th scope="col">Typical</th><th scope="col">Best case</th></tr></thead>
<tbody>${rows.map(([l, k, src]) => `<tr><th scope="row" data-label="Rate">${l} ${src ? srcBadge(src) : ""}</th><td class="fig" data-label="Cautious">${sc.cautious[k]}%</td><td class="fig" data-label="Typical">${sc.typical[k]}%</td><td class="fig" data-label="Best case">${sc.strong[k]}%</td></tr>`).join("")}</tbody></table></div>`;

  const formula = band({
    id: "s-follower-formula", tone: "paper", labelledby: "ff-h",
    inner: `<div class="split mf">
  <div class="mf-side reveal">${eyebrow("Follower estimate")}<h2 id="ff-h">The follower formula</h2><p class="lede">${fx(ff.body[0].split(". ").slice(0, 2).join(". "))}.</p><p class="muted">${fx(ff.body[0].split(". ").slice(2).join(". "))}</p><p class="fine">${fx(ff.body[1])}</p></div>
  <ol class="mf-steps">${ff.steps.map((st, i) => `<li class="reveal"><span class="fig mf-n">${num2(i + 1)}</span><div><h3>${fx(st.title)}</h3><p>${sup(st.body)}</p></div></li>`).join("")}</ol>
</div>
<div class="mf-assume reveal"><h3 class="h3">Current assumptions</h3>${assumptions}</div>`,
  });

  const ex = C.compactEarnings(150, 199, 250);
  const earnings = band({
    id: "s-earnings-method", labelledby: "em-h",
    inner: `<div class="split split--center">
  <div class="reveal">${eyebrow("Earnings estimate")}<h2 id="em-h">The earnings method</h2>${tickList(em.bullets.slice(0, 3), "ok")}</div>
  <div class="em-ex card reveal">
    <div class="tile-head"><p class="eyebrow">Our share, band by band</p>${sampleLabel("Sample: 150 subscribers at AED 199")}</div>
    <div class="em-rows">${ex.bands.filter((b) => b.subscribers).map((b, i) => `<div class="em-row"><span>${C.whole(b.subscribers)} × AED 199 × ${b.ratePct}%</span><b class="fig">${C.aed(b.commissionMinor)}</b></div>`).join("")}<div class="em-row em-row--total"><span>Our share, ${C.pct1(ex.effectiveCommissionPct)} overall</span><b class="fig">${C.aed(ex.commissionMinor)}</b></div></div>
    ${bandMeter(150)}
    <p class="fine">Reaching a new band lowers the rate for the subscribers in that band only.</p>
  </div>
</div>`,
  });

  const evid = [...new Set(content.sources.map((s) => s.evidence))];
  const ledgerRows = content.sources.map((s) => {
    const used = [...(usage.get(s.id) || [])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return `<li class="src-row" id="${esc(s.id)}" data-pages="${esc(used.join(" "))}" tabindex="-1">
  <div class="src-who"><span class="src-pub">${esc(s.publisher)}</span><a class="src-title" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}<span class="sr-only"> (opens in a new tab)</span>${icon("arrow")}</a><span class="chip chip--line chip--plain src-ev">${esc(s.evidence)}</span></div>
  <div class="src-what"><p>${esc(s.claim)}</p><p class="fine"><b>Used for:</b> ${esc(s.usedFor)}</p></div>
  <div class="src-meta"><p class="fine">${s.published ? `Published ${esc(s.published)}<br>` : ""}Retrieved ${fmtDate(s.retrieved)}</p>${used.length ? `<p class="src-used"><span class="fine">Used on</span>${used.map((p) => `<a href="${href(p)}">${esc(labelOf(pageFor(p)))}</a>`).join("")}</p>` : `<p class="fine src-used">Cited in the calculators’ assumptions</p>`}</div>
</li>`;
  }).join("");
  const sources = band({
    id: "sources", labelledby: "sources-h", cls: "band-rule",
    inner: `${sectionHead({ eyebrow: "Sources", title: "Every source, with its label", id: "sources-h", lede: "Filter by the page you came from. Each label says what kind of evidence it is." })}
<div class="lfilter" data-lfilter>
  <div class="field"><label for="lf-page">Show sources used on</label><select id="lf-page" class="input" data-lf-page><option value="">All pages</option>${pagesUsing.map((p) => `<option value="${esc(p)}" data-file="${esc(registry.find((r) => r.path === p).file)}">${esc(labelOf(pageFor(p)))}</option>`).join("")}</select></div>
  <p class="fine lfilter-count" data-lf-count aria-live="polite">Showing all ${content.sources.length} sources</p>
  <details class="legend"><summary>What the labels mean</summary><ul>${evid.map((e) => `<li><span class="chip chip--line chip--plain">${esc(e)}</span></li>`).join("")}</ul><p class="fine">Measured and official figures carry the most weight. Vendor claims show direction, not size.</p></details>
</div>
<ol class="ledger">${ledgerRows}</ol>`,
  });

  const exclude = band({
    id: "exclude", tone: "paper", labelledby: "exclude-h",
    inner: `${sectionHead({ eyebrow: "Left out", title: "What we exclude", id: "exclude-h", lede: "Neither estimate includes these. Your statement will." })}
<div class="cols-2 excl reveal" data-stagger>
  <div class="card card--flat"><h3 class="h4">Follower estimate</h3><ul class="excl-list">${["Trials", "Discounts", "Refunds", "Failed payments", "Platform commission", "Payment processing", "Tax"].map((t) => `<li><span class="strike">${t}</span></li>`).join("")}</ul></div>
  <div class="card card--flat"><h3 class="h4">Earnings estimate</h3><ul class="excl-list">${["Payment processing", "Domain", "Refunds", "Disputes", "Booking fees", "Tax"].map((t) => `<li><span class="strike">${t}</span></li>`).join("")}</ul></div>
</div>`,
  });

  return {
    main: [heroHtml, principles, formula, earnings, sources, exclude, faqBand(page.faqs, { title: "Assumptions, answered", prefix: "mq", tone: "white" })].join("\n"),
    title: `${page.title} · trainsyou`,
    closing: { secondary: { label: "Back to the follower calculator", href: "/follower-calculator" } },
  };
}

/* ===================================================================== */
/* Legal: /terms, /privacy, /ai-disclosure                                */
/* ===================================================================== */
// The published UAE policy pack (owner-authorised, 7 Oct 2026; terms
// re-issued 14 Oct 2026 with the commercial update, migration 098).
const LEGAL_DIR = "/home/user/trainer_what/docs/legal/uae-2026-10";
const LEGAL = {
  "/terms": { file: "terms-2026-10-14.en.md", mark: "service" },
  "/privacy": { file: "privacy.en.md", mark: "Privacy" },
  "/ai-disclosure": { file: "ai-disclosure.en.md", mark: "disclosure" },
};
const AR = /[؀-ۿ]/;
function parseLegal(file) {
  const path = join(LEGAL_DIR, file);
  if (!existsSync(path)) return null;
  const blocks = readFileSync(path, "utf8").replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const doc = { title: "", edition: "", sections: [] };
  for (const b of blocks) {
    if (b.startsWith("# ")) doc.title = b.slice(2).trim();
    else if (b.startsWith("## ")) { const m = b.slice(3).match(/^(\d+)\.\s*(.+)$/); doc.sections.push({ n: m ? m[1] : String(doc.sections.length + 1), title: m ? m[2] : b.slice(3), paras: [] }); }
    else if (!doc.sections.length) doc.edition = doc.edition ? doc.edition + " " + b : b;
    else doc.sections[doc.sections.length - 1].paras.push(b.replace(/\n/g, " "));
  }
  return doc;
}
function legalPage(ctx) {
  CUR = ctx.path;
  const page = ctx.page, cfg = LEGAL[ctx.path], doc = parseLegal(cfg.file);
  const editionDate = doc && (doc.edition.match(/Policy edition:\s*([^.]+)/) || [])[1];
  const mins = doc ? Math.max(1, Math.round(words(doc.sections.flatMap((s) => s.paras).join(" ")) / 220)) : 1;
  const switcher = `<nav class="docs-switch" aria-label="Legal documents">${Object.keys(LEGAL).map((p) => `<a href="${href(p)}"${p === ctx.path ? ' aria-current="page"' : ""}>${esc(pageFor(p).h1)}</a>`).join("")}</nav>`;
  const heroHtml = hero({
    eyebrow: "Legal", h1: page.h1, mark: cfg.mark, sweep: false,
    meta: metaRow([editionDate ? `Version <b>${esc(editionDate)} edition</b>` : "", editionDate ? `Last updated <b>${esc(fmtDate(new Date(editionDate + " 12:00 UTC").toISOString()))}</b>` : "", `<b class="fig">${mins}</b> min read`]),
    after: switcher, cls: "ct-hero--legal",
  });
  if (!doc) {
    return { main: `${heroHtml}<div class="band"><div class="container"><p class="lede">The published text could not be loaded in this prototype.</p></div></div>`, closing: false };
  }
  const items = doc.sections.map((s) => ({ id: `sec-${s.n}`, title: s.title }));
  const body = `<div class="doc-facts"><p>${esc(doc.edition)}</p><p class="fine">This is the published text, shown in full. ${(() => { const n = doc.sections.filter((x) => x.paras.some((q) => AR.test(q) || /^Commercial update/.test(q))).map((x) => x.n); return n.length ? `Section${n.length > 1 ? "s" : ""} ${n.join(" and ")} include${n.length > 1 ? "" : "s"} the commercial update of 14 October 2026, in English and Arabic.` : ""; })()}</p></div>
${doc.sections.map((s) => `<section class="doc-sec" id="sec-${s.n}" aria-labelledby="sec-${s.n}-h"><h2 id="sec-${s.n}-h" class="doc-h2"><span class="fig doc-n">${esc(s.n)}.</span> ${esc(s.title)}</h2>${s.paras.map((p) => (AR.test(p) && !/[A-Za-z]{4}/.test(p.replace(/AED|VAT/g, "")) ? `<p lang="ar" dir="rtl" class="doc-ar">${esc(p)}</p>` : `<p>${esc(p)}</p>`)).join("")}</section>`).join("\n")}
<p class="doc-end fine">${esc(page.h1)} · ${esc(doc.edition.split(".")[0])}. Questions about this document: use the Support page in your account.</p>`;
  return {
    main: `${heroHtml}<div class="band ct-read ct-read--legal"><div class="container ct-article"><aside class="ct-toc-col">${toc(items, { label: "Contents", legal: true })}</aside><div class="ct-body doc">${body}</div></div></div>`,
    title: `${page.title} · trainsyou`,
    closing: false,
    head: ctx.path === "/terms" ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">' : "",
  };
}

/* ===================================================================== */
/* /coaches (C22)                                                         */
/* ===================================================================== */
function coachesPage(ctx) {
  CUR = ctx.path;
  const slots = Array.from({ length: 5 }, (_, i) => i === 0
    ? `<li class="slot slot--sample"><span class="po-mono" aria-hidden="true">LS</span><div><b>Layla Strength</b><span>Strength coaching · from AED 199 a month</span></div><div class="chip-row">${sampleLabel("Sample listing")}${statusChip("publish", "publishing")}</div></li>`
    : `<li class="slot" aria-hidden="true"><span class="slot-dot"></span><span class="slot-l"></span><span class="slot-s"></span></li>`).join("");
  const heroHtml = hero({
    eyebrow: "Find a coach", h1: "Coaches choose to be listed here", mark: "listed",
    lede: "Coaching yourself? Start free and list your page when you publish.",
    cta: ctaRow({ location: "hero", secondary: { label: "See how it works", href: "/how-it-works" } }),
    visual: `<div class="dir card card--raised" aria-label="Coach directory preview: no coaches are listed yet">
  <div class="dir-head"><span class="eyebrow">Coach directory · UAE</span>${chip("No listings yet", "off")}</div>
  <ul class="dir-grid">${slots}</ul>
  <p class="fine dir-foot">Listings appear only after a coach publishes and chooses to be listed. Publishing is not on yet.</p>
</div>`,
  });
  const how = band({
    id: "listing", tone: "paper", labelledby: "listing-h",
    inner: `${sectionHead({ eyebrow: "For coaches", title: "How a listing happens", id: "listing-h" })}
<ol class="cols-3 lsteps reveal" data-stagger>
  <li class="card card--flat"><span class="fig lsteps-n">01</span><h3>Join free</h3><p class="muted">Create your trainer account. No card, nothing to pay upfront.</p>${chip("Live today", "ok")}</li>
  <li class="card card--flat"><span class="fig lsteps-n">02</span><h3>Teach your AI and build your page</h3><p class="muted">Your rules, your brand, your price in AED.</p>${chip("Live today", "ok")}</li>
  <li class="card card--flat"><span class="fig lsteps-n">03</span><h3>Publish and choose to be listed</h3><p class="muted">Listing is your choice. You can leave the directory any time.</p>${statusChip("publish", "publishing")}</li>
</ol>`,
  });
  const claim = band({
    id: "claim", labelledby: "claim-h",
    inner: `<div class="split split--center">
  <div class="reveal">${eyebrow("Your address")}<h2 id="claim-h">Claim your page’s address</h2><p class="lede">Your page lives at your-name.trainsyou.com. Free with every account.</p></div>
  <div class="card reveal">${addressPreview({ id: "addr-coaches", location: "inline" })}</div>
</div>`,
  });
  return {
    main: [heroHtml, how, claim].join("\n"),
    title: "Find a coach · trainsyou",
    closing: { secondary: { label: "See how it works", href: "/how-it-works" } },
  };
}

/* ===================================================================== */
/* 404 (C23): no motion, everything in the first screen                   */
/* ===================================================================== */
function notFound(ctx) {
  CUR = ctx.path;
  const links = [["/", "Home", "Start from the top"], ["/demo", "Demo", "Watch your AI decide"], ["/pricing", "Pricing", "Free to join, your price"], ["/guides", "Guides", "Pricing, followers, rules"]];
  return {
    main: `<section class="page-hero ct-404" data-hero aria-labelledby="h1">
<div class="container ct-404-grid">
  <p class="ct-404-fig fig" aria-hidden="true"><span>4</span><span class="ct-404-o">0</span><span>4</span></p>
  <div class="ct-404-copy">
    ${eyebrow("Page not found")}
    <h1 id="h1">${hl("This page isn’t earning its keep.", "keep")}</h1>
    <p class="lede">Your coaching still can be.</p>
    <div class="cta-row">${primaryCta({ location: "404" })}</div>
    ${H.microLine()}
    <nav class="ct-404-links" aria-label="Popular pages"><ul>${links.map(([p, l, s]) => `<li><a href="${href(p)}"><b>${l}</b><span>${s}</span>${icon("arrow")}</a></li>`).join("")}</ul></nav>
  </div>
</div>
</section>`,
    title: "Page not found · trainsyou",
    closing: false,
    sticky: false,
    bodyClass: "is-404",
  };
}

/* ===================================================================== */
export const pages = {
  "/guides": guidesIndex,
  [G.pricing]: pricingGuide,
  [G.followers]: followersGuide,
  [G.permit]: permitGuide,
  [G.rules]: rulesGuide,
  "/faq": faqPage,
  "/about": aboutPage,
  "/methodology": methodologyPage,
  "/terms": legalPage,
  "/privacy": legalPage,
  "/ai-disclosure": legalPage,
  "/coaches": coachesPage,
  "/404": notFound,
};
