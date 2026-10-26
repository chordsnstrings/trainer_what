// Content pages for concept C "The Method": the guides (index + 4 articles),
// FAQ, About, Methodology, the three legal documents, /coaches and the 404.
// Copy is the section C proposed copy (pending owner approval, decision 18);
// everything else comes from content.json. Long-form pages share one
// editorial document system: a sticky contents rail, numbered sections,
// footnoted sources with sidenotes in the margin, and pull quotes.
// Helpers: src/lib-content.mjs. Styles: site/assets/content.css.
// Behaviour: site/assets/content.js (contents active state, FAQ filter,
// source filter, arrival highlight).
import { content as C, source } from "./lib/content.mjs";
import { href, pageFor } from "./lib/registry.mjs";
import * as h from "./lib/components.mjs";
import {
  calc, fmtDate, readingMinutes, plain, budget, notes, extLink, doc, dsec, rtable, steps, bullets,
  faqList, faqBand, relatedBand, legalDoc, wide,
} from "./lib-content.mjs";

const {
  esc, each, cx, cta, secondary, linkArrow, microLine, sectionHead, chip, statusChip, whenOn, whenOff, flagged,
  sourceBadge, methodBadge, estimateLabel, sampleLabel, pullQuote, mark, h1Html, msRow, marginNote, band, icon,
  founderLetter, kamranPill, shareButton,
} = h;

const sec = (page, id) => {
  const s = page.sections.find((x) => x.id === id);
  if (!s) throw new Error(`${page.path}: no section ${id}`);
  return s;
};
const faqA = (page, re) => {
  const f = page.faqs.find((x) => re.test(x.q));
  if (!f) throw new Error(`${page.path}: no FAQ matching ${re}`);
  return f.a;
};
const h2 = (title) => budget(`H2 "${title}"`, title, 6);
const uniq = (a) => [...new Set(a)];

// ===========================================================================
// Guide articles
// ===========================================================================

/** Inline next step in context ("worksheet slip"), placed after the first useful section. */
const tryIt = ({ kicker, line, label, path, location = "guide-inline" }) =>
  `<aside class="tryit" data-reveal aria-label="${esc(kicker)}">
  <div class="tryit-copy"><p class="tryit-k">${esc(kicker)}</p><p class="tryit-l">${esc(line)}</p></div>
  <div class="tryit-a">${secondary(label, path, { location, variant: "button" })}</div>
</aside>`;

/** A paragraph row with footnote markers and their sidenotes. */
function pRow(text, fn, ids = [], extraNoteHtml = "") {
  const note = (ids.length ? fn.side(ids) : "") + extraNoteHtml;
  return msRow(`<p>${esc(plain(text))}${fn.ref(ids)}</p>`, note);
}
/** A list row (bullets or steps) with per-item markers and one sidenote block. */
function listRow(kind, list, fn, map = {}, extraNoteHtml = "", opts = {}) {
  const markers = {};
  const ids = [];
  for (const [i, srcs] of Object.entries(map)) { markers[i] = fn.ref(srcs); ids.push(...srcs); }
  const body = kind === "steps" ? steps(list, { markers, ...opts }) : bullets(list, { markers, ...opts });
  return msRow(body, (ids.length ? fn.side(uniq(ids)) : "") + extraNoteHtml);
}

/** Guide hero: breadcrumb, H1, lede, reading meta and a figure of its own. */
function guideHero({ page, cfg, minutes, nSources }) {
  budget(`${page.path} H1`, cfg.h1, 8);
  budget(`${page.path} lede`, cfg.lede, 25);
  return `<section class="hero hero-guide" data-hero aria-labelledby="g-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${href("/guides")}">Guides</a></li><li><span aria-current="page">${esc(page.navLabel)}</span></li></ol></nav>
      <h1 class="display" id="g-h1">${h1Html(cfg.h1, cfg.mark)}</h1>
      <p class="lede">${esc(cfg.lede)}</p>
      <p class="g-meta"><span>${minutes} min read</span><span>Updated ${fmtDate(page.lastUpdated)}</span>${nSources ? `<span>${nSources} sources, footnoted</span>` : "<span>Plain-language method</span>"}</p>
    </div>
    ${cfg.heroFig}
  </div>
</section>`;
}

/**
 * Assemble a guide: hero, "In short", numbered sections (each from
 * cfg.render[id]), notes, FAQ, related. cfg.after[id] adds a pull quote or
 * the inline next step after a section.
 */
function guide(page, cfg) {
  const fn = notes();
  const parts = [];
  const items = [];
  parts.push(`<div class="g-short" data-reveal><p class="g-short-k">In short</p><p class="g-short-p">${esc(plain(page.intro))}</p></div>`);
  page.sections.forEach((s, i) => {
    const n = i + 1;
    const title = h2(cfg.headings?.[s.id] || s.heading);
    const render = cfg.render[s.id];
    if (!render) throw new Error(`${page.path}: no renderer for section ${s.id}`);
    parts.push(dsec({ id: s.id, n, title, html: render(s, fn) }));
    items.push({ id: s.id, n, title });
    if (cfg.after?.[s.id]) parts.push(cfg.after[s.id]);
  });
  if (fn.count) {
    const n = page.sections.length + 1;
    parts.push(dsec({
      id: "notes", n, title: "Notes and sources", className: "dsec--notes",
      html: `<p class="notes-intro">Each note shows how much weight the source can bear. ${linkArrow("How we use every source", "/methodology", { className: "notes-link" })}</p>${fn.list()}`,
    }));
    items.push({ id: "notes", n, title: "Notes and sources" });
  }
  parts.push(`<div class="doc-end"><p class="doc-end-k"><span aria-hidden="true">∎</span> End of guide</p>${shareButton({ className: "btn-sm" })}</div>`);
  const minutes = readingMinutes(page);
  const nSources = fn.count;
  const rail = `<p class="rail-meta">${minutes} min read<br>Updated ${fmtDate(page.lastUpdated)}</p><div class="rail-share">${shareButton({ className: "btn-sm" })}</div>`;
  const body = band({ className: "band--doc", contentHtml: doc({ items, bodyHtml: parts.join("\n"), railExtraHtml: rail }) });
  const faqs = faqBand({
    items: page.faqs.map((f) => ({ q: plain(cfg.faqQ?.[f.q] || f.q), a: plain(cfg.faqA?.[f.q] || f.a) })),
    title: "Questions",
  });
  return {
    main: [guideHero({ page, cfg, minutes, nSources }), body, faqs, relatedBand(page.related, { title: "Keep reading" })].join("\n"),
    title: page.title,
    closing: cfg.closing,
  };
}

// --- /guides/pricing-online-coaching-uae ------------------------------------

function pricingGuide({ page }) {
  const ranges = sec(page, "ranges");
  const SRC = { "Hey Trainer, 2026": "heytrainer-dubai-2026", "Embody Fitness, 2025": "embody-dubai-2025", "369MMAFIT, 2026": "369mmafit-online-2026" };

  const heroFig = `<figure class="g-fig" aria-labelledby="gf-cap">
  <div class="g-fig-body g-anchors">
    <div class="ga"><p class="ga-k">A one-to-one session in Dubai</p><p class="ga-v tnum">AED 70–350</p><p class="ga-s">Premium trainers charge more, up to AED 700+. ${sourceBadge("embody-dubai-2025")}</p><p class="ga-src">${sourceBadge("heytrainer-dubai-2026")}</p></div>
    <div class="ga"><p class="ga-k">A month of online coaching</p><p class="ga-v tnum">AED 400–2,000</p><p class="ga-s">Hybrid, online and in person: AED 1,500–3,000. ${sourceBadge("369mmafit-online-2026")}</p><p class="ga-src">${sourceBadge("369mmafit-online-2026")}</p></div>
  </div>
  <figcaption class="fig-cap" id="gf-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">Published price guides, not official statistics</span></figcaption>
</figure>`;

  // Worked examples, recomputed with the calculator's commission bands.
  const ex = [[40, 149], [120, 199], [350, 249]].map(([n, aed]) => {
    const subs = n * aed * 100;
    const comm = calc.projectedCommission(n, aed * 100);
    const pct = (comm / subs) * 100;
    const kept = subs - comm;
    return [
      `${n} × AED ${aed}`, calc.aedWhole(subs),
      `${calc.aedWhole(comm)} (${pct === 25 ? "25%" : pct.toFixed(2) + "% overall"})`,
      calc.aedWhole(kept), `About ${Math.round(kept / 25000)}`,
    ];
  });
  const exTable = sec(page, "examples").table;
  const contentRows = exTable.rows.map((r) => r.join("|"));
  ex.forEach((r, i) => { if (r.join("|") !== contentRows[i]) console.warn(`  [content] pricing guide example ${i} differs from content.json: ${r.join("|")} vs ${contentRows[i]}`); });

  const render = {
    ranges: (s, fn) => msRow(
      rtable({
        caption: s.table.caption, columns: s.table.columns,
        rows: s.table.rows.map(([a, b, c]) => [a, b, { html: `${esc(c)}${fn.ref([SRC[c]])}` }]),
        numeric: [], className: "tbl--ranges",
      }),
      `<span class="mnote-k">About these figures</span>${esc(s.note)}${fn.side(s.sources)}`,
    ),
    why: (s, fn) => pRow(s.body[0], fn) + pRow(s.body[1], fn),
    steps: (s) => msRow(steps(s.steps), `<span class="mnote-k">Six steps, one sitting</span>Steps 1–5 are decisions. Step 6 checks them with your own numbers.`),
    examples: (s) => wide(
      rtable({ caption: exTable.caption, columns: exTable.columns, rows: ex, numeric: [1, 2, 3, 4], className: "tbl--examples" }),
      `<div class="chips">${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div><span class="mnote-k">Arithmetic, not a forecast</span>${esc(s.note)} ${methodBadge("earnings-method", "Method")}`,
    ),
    upfront: (s, fn) => pRow(s.body[0], fn, [], `<span class="mnote-k">Monthly equivalent</span><span class="eq tnum">AED 540 ÷ 3 months = AED 180</span>The earnings calculator converts upfront prices the same way. ${methodBadge("earnings-method", "Method")}`) + pRow(s.body[1], fn),
    tiers: (s, fn) => pRow(s.body[0], fn, [], `<span class="mnote-k">The average</span><span class="eq tnum">70 × AED 199 + 30 × AED 299 = AED 22,900</span>AED 229 a month on average.`) + pRow(s.body[1], fn, [], `<div class="chips">${chip("addon", "Add-on")}${statusChip("voice", "Not on yet for subscribers", "Live for subscribers")}</div>`),
    position: (s, fn) => listRow("bullets", s.bullets, fn),
    commission: (s, fn) =>
      pRow("Our share of subscription revenue falls for each group of subscribers: 25% for your first 100 paying subscribers, 20% for the next 200, 15% up to 1,000 and 10% beyond. Each group keeps its own rate, so growing never raises the rate on earlier subscribers.", fn, [],
        `<span class="mnote-k">Our share, by group</span><dl class="bands-mini tnum"><div><dt>1–100</dt><dd>25%</dd></div><div><dt>101–300</dt><dd>20%</dd></div><div><dt>301–1,000</dt><dd>15%</dd></div><div><dt>1,001+</dt><dd>10%</dd></div></dl>${linkArrow("The commission maths", "/pricing")}`) +
      pRow(s.body[1], fn),
    mistakes: (s, fn) => listRow("bullets", s.bullets, fn, {}, "", { className: "rlist--x" }),
  };
  return guide(page, {
    h1: page.h1, mark: "price",
    lede: "Price between what followers can afford and what your time is worth. A daily plan can sit well below your session rate.",
    heroFig,
    headings: { why: "Subscriptions aren’t priced like sessions" },
    render,
    after: {
      why: pullQuote(`The price no longer has to cover <span class="nowrap">your ${mark("hour")}.</span>`, { className: "g-pull" }),
      steps: tryIt({ kicker: "Step 6, with your numbers", line: "Put your price and a cautious number of subscribers in. See what remains after our share.", label: "Try my price in the earnings calculator", path: "/earnings-calculator" }),
    },
    closing: { label: "Estimate my earnings", path: "/earnings-calculator" },
  });
}

// --- /guides/instagram-followers-to-clients --------------------------------

function instagramGuide({ page }) {
  const heroFig = `<figure class="g-fig" aria-labelledby="gf-cap">
  <div class="g-fig-body">
    <ol class="fun">
      <li style="--w:1"><span class="fun-bar" aria-hidden="true"><i></i></span><span class="fun-k">Your followers</span><span class="fun-v">Everyone who follows you</span></li>
      <li style="--w:.56"><span class="fun-bar" aria-hidden="true"><i></i></span><span class="fun-k">See one of your Stories</span><span class="fun-v tnum">9.6–10.4% of followers, brand accounts with 1–5K ${sourceBadge("socialinsider-stories")}</span></li>
      <li style="--w:.3"><span class="fun-bar" aria-hidden="true"><i></i></span><span class="fun-k">Tap the link</span><span class="fun-v tnum">1–5% of viewers, per link Story ${sourceBadge("creatorflow-link-sticker")}</span></li>
      <li style="--w:.13"><span class="fun-bar" aria-hidden="true"><i></i></span><span class="fun-k">Pay</span><span class="fun-v tnum">0.72–6.2% of visitors, from proxies ${sourceBadge("dynamicyield-conversion")}${sourceBadge("revenuecat-state-2026")}</span></li>
    </ol>
  </div>
  <figcaption class="fig-cap" id="gf-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">Each step is a small share</span>${chip("neutral", "Bars not to scale")}</figcaption>
</figure>`;

  // Three example accounts in the strong case, computed with the calculator.
  const D = calc.DEFAULT_FOLLOWER_INPUTS;
  const count = (v) => { const c = calc.displayCount(v); return c === null ? "< 1" : calc.whole(c); };
  const exRows = [3000, 7000, 30000].map((followers) => {
    const e = calc.estimateFollowerConversion({ ...D, followers }).scenarios.strong;
    return [calc.whole(followers), count(e.month1New), count(e.activeMonth12), count(e.signups12), calc.aedWhole(e.revenueMonth12Minor)];
  });

  const render = {
    funnel: (s, fn) => listRow("bullets", s.bullets, fn, {
      0: ["socialinsider-stories"], 1: ["creatorflow-link-sticker"], 2: ["dynamicyield-conversion", "revenuecat-state-2026"],
      3: ["passion-creator-rates", "stan-creator-economy"], 4: ["nng-participation"],
    }),
    "same-people": (s, fn) => pRow(s.body[0], fn, ["socialinsider-stories"]) + pRow(s.body[1], fn, ["meta-instagram-ranking"]),
    examples: (s, fn) => pRow(s.body[0], fn) + wide(
      rtable({
        caption: `Strong case, a best case and not a typical result: AED ${D.priceAed} a month, ${D.linkStoriesPerMonth} link Stories and ${D.ctaReelsPerMonth} keyword Reels a month, ${D.yearlyCancelPct}% yearly cancellations (assumptions version ${calc.FOLLOWER_MODEL.version})`,
        columns: ["Followers", "New subscribers, first month", "Active after 12 months", "Sign-ups over 12 months", "A month at month 12"],
        rows: exRows, numeric: [1, 2, 3, 4], className: "tbl--examples",
      }),
      `<div class="chips">${estimateLabel()}${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div><span class="mnote-k">Before platform commission</span>Also before payment processing and tax. Cautious and typical results are lower. ${methodBadge("follower-formula", "How we estimate")}`,
    ),
    steps: (s, fn) => listRow("steps", s.steps, fn, { 3: ["socialinsider-stories"], 4: ["hootsuite-link-stickers"] },
      `<div class="chips">${chip("noton", "Not on yet: connecting Instagram")}</div><p>Step 1 mentions connecting to the calculator. Until that is on, type your numbers in.</p>`),
    engagement: (s, fn) => pRow(s.body[0], fn, ["hypeauditor-2025", "socialinsider-engagement"]) + pRow(s.body[1], fn, [], `<span class="mnote-k">In the calculator</span>Your rate scales Story reach and comments, within limits. ${methodBadge("follower-formula", "How")}`),
    honest: (s, fn) => listRow("bullets", s.bullets.map((b) => b.replace("by your Trainer Brain", "by your AI (we call it your Trainer Brain)")), fn, {}, `<span class="mnote-k">Promoting other brands?</span>${linkArrow("Read the permit guide", "/guides/uae-advertiser-permit")}`),
  };
  return guide(page, {
    h1: page.h1, mark: "paying clients",
    lede: "Some followers see a Story, a few tap, and a few visitors buy. Reach, a clear offer and steady sharing beat follower count.",
    heroFig,
    headings: { "same-people": "Why repeat links level off", steps: "What to do, step by step" },
    render,
    after: {
      funnel: tryIt({ kicker: "Your account, your numbers", line: "Three scenarios from the same benchmarks, side by side. An estimate, not a promise.", label: "See what my followers are worth", path: "/follower-calculator" }),
      "same-people": pullQuote(`Ten link Stories do not reach <span class="nowrap">${mark("ten times")}</span> as many people.`, { className: "g-pull" }),
    },
    faqA: {
      "Why do the calculator’s scenarios differ so much?": "Cautious and typical use published averages from brand accounts, retail and apps. The strong case uses the top values in the research and our assumptions for an engaged, growing audience: a best case, not typical. Your real number depends on your content, offer and price.",
      "Does sharing my link every day help?": "Some. Each Story gives the same viewers another chance to tap, so the gain levels off within a month, and link stickers can reduce engagement. Over months, regular sharing reaches new people. Keyword Reels and your bio link reach new people too.",
      "Can I use my real Instagram numbers?": "Not yet. Once connecting Instagram is on, you can connect a professional account after you sign up to fill in your follower count and recent engagement. We read those numbers once and do not keep access.",
    },
    closing: { label: "See what my followers are worth", path: "/follower-calculator" },
  });
}

// --- /guides/uae-advertiser-permit ------------------------------------------

function permitGuide({ page }) {
  const heroFig = `<figure class="g-fig" aria-labelledby="gf-cap">
  <div class="g-fig-body pm">
    <div class="pm-col"><p class="pm-k">${icon("check", { size: 16 })}Your own coaching</p><p class="pm-t">Reported exempt</p><p class="pm-s">Your offer, programme, price and link, posted through your personal account.</p></div>
    <div class="pm-col pm-col--check"><p class="pm-k"><span class="chip-dot" aria-hidden="true"></span>Someone else’s product</p><p class="pm-t">Reported to need a permit</p><p class="pm-s">Paid or gifted posts for a gym, brand or supplement, paid or not.</p></div>
    <p class="pm-foot">${icon("lock", { size: 16 })}<span>Information, not legal advice. Rules change: check the UAE Media Council. ${sourceBadge("gulfnews-advertiser-permit")}${sourceBadge("uae-media-council-permit")}</span></p>
  </div>
  <figcaption class="fig-cap" id="gf-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">Two kinds of post</span></figcaption>
</figure>`;
  const render = {
    summary: (s, fn) => listRow("bullets", s.bullets, fn,
      { 0: ["gulfnews-advertiser-permit"], 1: ["gulfnews-advertiser-permit"], 2: ["gulfnews-advertiser-permit"], 3: ["gulfnews-advertiser-permit"], 4: ["uae-media-council-permit"] },
      `<p class="hedge">${icon("lock", { size: 16 })}<span>Reports, not rulings. This is information, not legal advice.</span></p>`),
    own: (s, fn) => pRow(s.body[0], fn),
    others: (s, fn) => pRow(s.body[0], fn) + listRow("bullets", s.bullets, fn, {}, `<span class="mnote-k">Before you post</span>Check the current rules with the UAE Media Council.`),
    checklist: (s) => msRow(steps(s.steps, { className: "msteps--check" }), `<span class="mnote-k">Keep it with your posts</span>A record of paid partnerships, what you posted and when, helps if you are asked.`),
    platform: (s, fn) => pRow(s.body[0], fn, [], linkArrow("Taking your coaching online in the UAE", "/uae")),
  };
  return guide(page, {
    h1: "What the UAE advertiser permit means for trainers", mark: "permit",
    lede: "Reports say promoting your own coaching through a personal account is exempt. Rules change, so check the UAE Media Council. Information, not legal advice.",
    heroFig,
    render,
    after: {
      own: pullQuote(`Keep that promotion clearly about <span class="nowrap">${mark("your own")}</span> coaching.`, { className: "g-pull" }),
    },
    closing: { label: "Read the FAQ", path: "/faq" },
  });
}

// --- /guides/writing-coaching-rules -----------------------------------------

/** "When A, B, unless C, because D." -> parts (the content's own sentences). */
function ruleParts(text) {
  const m = String(text).match(/^When (.+?), (.+?), unless (.+?), because (.+?)\.?$/);
  if (!m) throw new Error(`ruleParts: unexpected rule shape: ${text}`);
  return { when: m[1], do: m[2], unless: m[3], because: m[4] };
}
const PARTS = [["when", "When"], ["do", "Do"], ["unless", "Unless"], ["because", "Because"]];
function anatomyCard({ title, text, pins = false, label = "Illustrative", headingLevel = 0 }) {
  const p = ruleParts(text);
  const head = headingLevel ? `<h${headingLevel} class="anat-title">${esc(title)}</h${headingLevel}>` : `<span class="rc-kicker">Rule · ${esc(title)}</span>`;
  return `<div class="anat">
  <div class="rc-head">${head}<span class="rc-sample">${esc(label)}</span></div>
  <dl class="anat-parts">${each(PARTS, ([k, l], i) => `<div><dt>${esc(l)}${pins ? `<span class="pin" aria-hidden="true">${"abcd"[i]}</span>` : ""}</dt><dd>${esc(p[k])}</dd></div>`)}</dl>
</div>`;
}

function rulesGuide({ page }) {
  const ex = sec(page, "example").cards;
  const heroFig = `<figure class="g-fig g-fig--rule" aria-labelledby="gf-cap">
  <div class="g-fig-body anat-hero">
    ${anatomyCard({ title: ex[0].title, text: ex[0].body, pins: true })}
    <div class="hero-notes">
      ${marginNote("The situation, as subscribers say or log it", { pin: "a" })}
      ${marginNote("The action, with your numbers", { pin: "b" })}
      ${marginNote("Where your judgment lives", { pin: "c" })}
      ${marginNote("So similar cases can be told apart", { pin: "d" })}
    </div>
  </div>
  <figcaption class="fig-cap" id="gf-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">The anatomy of a rule</span>${chip("sample", "Illustrative rule")}</figcaption>
</figure>`;
  const render = {
    format: (s) => wide(
      `<ol class="fmt">${each(s.steps, (st, i) => `<li><span class="fmt-w">${esc(st.title)}<span class="fmt-dots" aria-hidden="true">${i < 3 ? " …," : " …"}</span></span><p>${esc(plain(st.body))}</p></li>`)}</ol>`,
      `<span class="mnote-k">Who reads it</span>Your AI (we call it your Trainer Brain) applies rules written in this shape, and cites the source of each.`,
    ),
    example: (s) => `<div class="anat-grid" data-reveal data-stagger>${each(s.cards, (c) => anatomyCard({ title: c.title, text: c.body, label: c.label || "Illustrative", headingLevel: 3 }))}</div>`,
    good: (s, fn) => listRow("bullets", s.bullets, fn),
    mistakes: (s, fn) => listRow("bullets", s.bullets, fn, {}, `<span class="mnote-k">Pain and medical issues</span>Always come to you, enforced in code outside your AI. ${linkArrow("Safety rules", "/features/safety")}`, { className: "rlist--x" }),
    sources: (s, fn) => pRow(s.body[0], fn),
    "first-rules": (s) => msRow(
      `<div class="worksheet"><p class="ws-k">Worksheet · tick as you write</p><ol class="ws-list">${each(s.bullets, (b, i) => `<li><span class="ws-box" aria-hidden="true"></span><span class="ws-n tnum">${String(i + 1).padStart(2, "0")}</span><span>${esc(b)}</span></li>`)}</ol></div>`,
      `<span class="mnote-k">Start with the common ones</span>Anything not covered is handed to you, and your answers become new teaching.`,
    ),
    test: (s, fn) => pRow(s.body[0], fn, [], `<span class="mnote-k">Before automatic sending</span><ul class="mini-checks"><li class="ok">${icon("check", { size: 14 })}8 confirmed quiz answers</li><li class="ok">${icon("check", { size: 14 })}3 cases you wrote</li><li>${icon("circle", { size: 14 })}20 cases and passing checks</li></ul>`) + pRow(s.body[1], fn),
    corrections: (s, fn) => pRow("Once live, your AI hands you anything it is not sure enough about. When you approve or correct it, the correction is recorded with its reason and becomes teaching. The next release is checked against your test cases before it goes live, and you can roll back to an earlier release at any time.", fn, [], linkArrow("How your AI decides", "/trainer-brain")),
  };
  return guide(page, {
    h1: "Writing coaching rules your AI can follow", mark: "rules",
    lede: "Name the situation, the action, the exceptions and the reason, in plain words. Then test it on cases you did not use to write it.",
    heroFig,
    headings: { test: "Test with your own cases" },
    render,
    after: {
      example: tryIt({ kicker: "Try it on a real decision", line: "Edit a rule in the demo and watch where the decision goes: applied, to you, or paused.", label: "Try editing a rule in the demo", path: "/demo" }),
      good: pullQuote(`The exceptions are where your <span class="nowrap">${mark("judgment")}</span> lives.`, { className: "g-pull" }),
    },
    faqQ: { "What does the Brain do with a situation I never taught?": "What does my AI do with a situation I never taught?" },
    closing: { label: "Try the demo", path: "/demo" },
  });
}

// ===========================================================================
// /guides (index)
// ===========================================================================

const GUIDE_LIST = [
  ["/guides/pricing-online-coaching-uae", "Published UAE price ranges, worked AED examples, tiers, upfront programmes and what our share costs.", "price"],
  ["/guides/instagram-followers-to-clients", "Why most followers never see a Story, what benchmarks suggest, and steps that turn followers into clients.", "funnel"],
  ["/guides/uae-advertiser-permit", "What reports say about the permit and promoting your own coaching, with a checklist. Not legal advice.", "permit"],
  ["/guides/writing-coaching-rules", "A plain format your AI can apply: when, do, unless, because. Then test it on your own cases.", "rule"],
];
const H1_FOR = {
  "/guides/uae-advertiser-permit": "What the UAE advertiser permit means for trainers",
  "/guides/writing-coaching-rules": "Writing coaching rules your AI can follow",
};
const VIGNETTE = {
  price: `<div class="vg vg-price"><span class="vg-k">Worked example</span><p class="vg-line tnum"><span>Subscribers × price</span><b>40 × 149</b></p><p class="vg-line tnum"><span>Our share</span><b>25%</b></p><p class="vg-line vg-sum tnum"><span>Before other costs</span><b>AED 4,470</b></p></div>`,
  funnel: `<div class="vg vg-funnel"><span class="vg-k">Followers → clients</span>${each([1, 0.56, 0.3, 0.13], (w, i) => `<span class="vg-bar" style="--w:${w}"><i></i><small>${["Follow", "See", "Tap", "Pay"][i]}</small></span>`)}</div>`,
  permit: `<div class="vg vg-permit"><span class="vg-k">Before you post</span><p class="vg-chk is-ok">${icon("check", { size: 14 })}Your own coaching</p><p class="vg-chk"><span class="vg-box"></span>Someone else’s product</p><p class="vg-chk"><span class="vg-box"></span>Check current rules</p></div>`,
  rule: `<div class="vg vg-rule"><span class="vg-k">Rule</span>${each(["When", "Do", "Unless", "Because"], (w) => `<p class="vg-part"><b>${w}</b><span></span></p>`)}</div>`,
};

function guidesIndex({ page }) {
  budget("/guides H1", "Guides for taking your coaching online", 8);
  const hero = `<section class="hero hero-guides" data-hero aria-labelledby="gi-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Guides</p>
      <h1 class="display" id="gi-h1">Guides for taking your coaching ${mark("online")}</h1>
      <p class="lede">Practical, sourced guides for UAE personal trainers: pricing, followers, the advertiser permit and rules your AI can follow.</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("Estimate my earnings", "/earnings-calculator", { location: "hero" })}</div>
      ${microLine()}
    </div>
    <aside class="gi-how" aria-labelledby="gi-how-h">
      <p class="gi-how-k" id="gi-how-h">How these guides are written</p>
      <dl>
        <div><dt>Sourced</dt><dd>Every market figure is footnoted and links to its source.</dd></div>
        <div><dt>Dated</dt><dd>Each guide shows when we last checked it.</dd></div>
        <div><dt>Honest</dt><dd>Estimates are labelled. Legal points stay hedged.</dd></div>
      </dl>
    </aside>
  </div>
</section>`;
  const sourcesOf = (p) => uniq(p.sections.flatMap((s) => s.sources || [])).length;
  const list = h.band({
    id: "list", labelledby: "list-h",
    contentHtml: `${sectionHead({ n: 1, title: "Four guides", id: "list-h" })}
    <ol class="gx">${each(GUIDE_LIST, ([path, desc, vg], i) => {
      const p = pageFor(path);
      budget(`${path} card`, desc, 18);
      const n = sourcesOf(p);
      return `<li class="gx-row" data-reveal style="--i:${i}">
  <span class="gx-n" aria-hidden="true">${["I", "II", "III", "IV"][i]}</span>
  <div class="gx-copy">
    <h3 class="gx-t"><a class="gx-a" href="${href(path)}">${esc(H1_FOR[path] || p.h1)}</a></h3>
    <p class="gx-d">${esc(desc)}</p>
    <p class="gx-meta"><span>${readingMinutes(p)} min read</span><span>Updated ${fmtDate(p.lastUpdated)}</span><span>${n ? `${n} sources` : "Method guide"}</span></p>
  </div>
  <div class="gx-fig" aria-hidden="true">${VIGNETTE[vg]}</div>
</li>`;
    })}</ol>`,
  });
  const tools = h.band({
    id: "tools", labelledby: "tools-h", paper: true,
    contentHtml: `${sectionHead({ n: 2, title: "Tools", id: "tools-h", lede: "Use your own numbers. Every assumption is shown." })}
    <div class="tools" data-reveal data-stagger>
      ${[
        ["Earnings calculator", "What you keep at your price, after our share, and the sessions it equals.", "Estimate my earnings", "/earnings-calculator", ["Paying subscribers", "Your price", "You keep"]],
        ["Follower calculator", "What your followers could be worth: cautious, typical and best cases, all sourced.", "See what my followers are worth", "/follower-calculator", ["Followers", "Link Stories a month", "Three scenarios"]],
      ].map(([t, d, l, p, lines]) => `<article class="tool">
  <div class="tool-sheet" aria-hidden="true">${each(lines, (x, i) => `<p class="tool-line${i === 2 ? " tool-line--sum" : ""}"><span>${esc(x)}</span><b></b></p>`)}</div>
  <h3 class="h3">${esc(t)}</h3>
  <p>${esc(budget(t, d, 18))}</p>
  <p>${secondary(l, p, { location: "guides-tools" })}</p>
</article>`).join("")}
    </div>
    <p class="tools-foot" data-reveal>${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}<span>Both show estimates, not promises. ${linkArrow("How we source numbers", "/methodology")}</span></p>`,
  });
  return {
    main: [hero, list, tools].join("\n"),
    title: page.title,
    closing: { label: "Estimate my earnings", path: "/earnings-calculator" },
  };
}

// ===========================================================================
// /faq
// ===========================================================================

function faqPage({ page }) {
  const A = (re) => plain(faqA(page, re));
  const about = pageFor("/about"), permit = pageFor("/guides/uae-advertiser-permit");
  const fr = C.availabilityLines.filter((l) => l.when === "frontier" && l.faq);
  const frTrained = fr.find((l) => /trained on my data/.test(l.faq.q)).faq.a;
  const frBetter = fr.find((l) => /better over time/.test(l.faq.q)).faq.a;
  const P = (t) => `<p>${t}</p>`;
  const chapters = [
    { id: "ai", title: "Your AI and control", short: "Your AI", more: linkArrow("How your AI decides", "/trainer-brain"), items: [
      { q: "Will my AI replace me?", a: "No. Your AI (we call it your Trainer Brain) is built from your rules, cases and corrections. It hands you anything it is not sure about, and safety issues always come to you. You can take over any subscriber or conversation at any time." },
      { q: "Is my AI trained on my data?", aHtml: flagged("frontier", P(esc(A(/trained on my data/))), P(esc(plain(frTrained))), "div") },
      { q: "Does it get better over time?", aHtml: flagged("frontier", P("Yes, through you. Your corrections become suggested rules you confirm, and each new version is tested on your test cases before subscribers see it. You can roll back any version."), P(esc(plain(frBetter))), "div") },
    ] },
    { id: "safety", title: "Safety", short: "Safety", more: linkArrow("Safety rules", "/features/safety") + linkArrow("Security and privacy", "/security-and-privacy"), items: [
      { q: "What happens when a subscriber reports pain?", a: A(/reports pain/) },
      { q: "Will it give bad advice under my name?", a: "Until you switch on automatic sending, every reply waits for you. After that, your AI acts alone only where your confirmed rules make it sure enough. Everything else comes to you, and you can correct or roll back any release." },
      { q: "Is trainsyou a medical service?", a: faqA(about, /medical/) },
    ] },
    { id: "money", title: "Money", short: "Money", more: linkArrow("Pricing in detail", "/pricing"), items: [
      { q: "Does it cost anything to join?", a: "No. Joining, building your coaching site and app, and teaching and testing your AI are free. We earn only when your subscribers pay. Your own domain is the only optional purchase; your trainsyou address is free." },
      { q: "Who sets the subscription price?", a: "You do. You set the monthly or upfront price in AED, the programme length, trials and promotions. Our share of subscription revenue falls for each group of subscribers: 25%, 20%, 15% and 10%." },
      { q: "Can subscribers pay me today?", aHtml: flagged("payments", P("Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can sign up, set up your page and app, and teach and test your AI."), P("Yes. Subscribers pay by card in AED on your published page."), "div") },
      { q: "How does money reach me?", aHtml: P(`${whenOff("payments", `${chip("noton", "Not on yet")} `)}Subscribers pay by card in AED. After reconciliation, your earnings are paid monthly to your verified UAE bank account, with a statement from gross to net.`) },
      { q: "Is cancellation the same as a refund?", a: A(/cancellation/) },
    ] },
    { id: "setup", title: "Setup", short: "Setup", more: linkArrow("How it works", "/how-it-works"), items: [
      { q: "Do I need technical skills?", a: A(/technical/) },
      { q: "What can I connect?", aHtml: P(`Today: Apple Health exports. ${flagged("voice", "Not on yet: WHOOP, Zepp, Instagram, your own domain and the voice add-on for subscribers.", "Not on yet: WHOOP, Zepp, Instagram and your own domain. The voice add-on for subscribers is live.")}`) },
      { q: "Does it work offline?", a: A(/offline/) },
    ] },
    { id: "brand", title: "Your brand and followers", short: "Brand", more: linkArrow("The follower calculator", "/follower-calculator"), items: [
      { q: "Whose brand do subscribers see?", a: faqA(about, /brand/) },
      { q: "What does a subscriber get for their money?", aHtml: P(`${esc(A(/subscriber get/))}${whenOff("voice", " Voice for subscribers is not on yet.")}`) },
      { q: "Will my followers pay?", a: "Some may. The follower calculator shows cautious, typical and best cases from published benchmarks, so you can test your offer first. We never promise a number." },
      { q: "Does trainsyou own my method?", a: "No. Your AI is private to your workspace and is never used for another trainer." },
    ] },
    { id: "uae", title: "UAE and legal", short: "UAE and legal", more: linkArrow("The advertiser permit guide", "/guides/uae-advertiser-permit"), items: [
      { q: "Do I need an advertiser permit to promote my own coaching?", a: A(/advertiser permit/) },
      { q: "Does trainsyou give legal advice?", a: faqA(permit, /legal advice/) },
      { q: "Is trainsyou built for the UAE?", aHtml: P(`Yes. Prices are in AED${flagged("payments", ", payouts will go to a UAE bank once they are on", " and payouts go to a UAE bank")}, and member controls come in English and Arabic, right to left. Marketing pages are in English.`) },
    ] },
  ];
  const total = chapters.reduce((n, c) => n + c.items.length, 0);

  const hero = `<section class="hero hero-faq" data-hero aria-labelledby="faq-h1">
  <div class="wrap hero-grid hero-grid--toc">
    <div class="hero-copy">
      <p class="eyebrow">FAQ</p>
      <h1 class="display" id="faq-h1">${h1Html(page.h1, "start")}</h1>
      <p class="lede">Short, plain answers to what trainers ask most, grouped by the worry behind them.</p>
      <div class="hero-actions">${cta({ location: "hero" })}${kamranPill({ inline: true, location: "faq-hero" })}</div>
    </div>
    <nav class="toc fq-toc" aria-label="Chapters">
      <p class="toc-k">Chapters · ${total} questions</p>
      <ol>${each(chapters, (c, i) => `<li><a href="#ch-${c.id}"><span class="toc-n">§${i + 1}</span><span>${esc(c.title)}</span><span class="fq-cnt tnum">${c.items.length}</span></a></li>`)}</ol>
    </nav>
  </div>
</section>`;

  let k = 0;
  const list = `<section class="band band--paper fq-band" aria-labelledby="fq-h">
  <div class="wrap">
    <h2 class="sr-only" id="fq-h">All questions</h2>
    <div class="fq" data-faq-filter>
      <div class="fq-tools">
        <div class="fq-search">
          <label class="field-label" for="fq-q">Find a question</label>
          <div class="input-wrap"><span class="fq-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2L17 17"/></svg></span><input class="input" id="fq-q" type="search" autocomplete="off" placeholder="Try “refund”, “pain” or “price”" data-fq-input aria-describedby="fq-count"></div>
        </div>
        <div class="chapbar" role="group" aria-label="Show a chapter">
          <button class="chapbtn" type="button" aria-pressed="true" data-fq-ch="all">All</button>
          ${each(chapters, (c) => `<button class="chapbtn" type="button" aria-pressed="false" data-fq-ch="${c.id}">${esc(c.short)}</button>`)}
          <span class="chap-ink" aria-hidden="true"></span>
        </div>
        <p class="fq-count" id="fq-count" data-fq-count>All ${total} questions</p><p class="sr-only" aria-live="polite" data-fq-live></p>
      </div>
      ${each(chapters, (c, i) => {
        const html = `<section class="fq-ch" id="ch-${c.id}" data-fq-chapter="${c.id}" aria-labelledby="ch-${c.id}-h">
  <header class="fq-ch-h" data-reveal><span class="fq-ch-n">Chapter ${i + 1}</span><h2 class="h2" id="ch-${c.id}-h">${esc(h2(c.title))}</h2></header>
  <div class="ms">${faqList(c.items.map((it) => ({ ...it, chapter: c.id })), { id: `fq-${c.id}`, start: k + 1 })}<div class="faq-side"><div class="mnote" role="note"><span class="mnote-k">Read deeper</span>${c.more}</div></div></div>
</section>`;
        k += c.items.length;
        return html;
      })}
      <div class="fq-empty" data-fq-empty hidden>
        <p class="fq-empty-t">No question matches that.</p>
        <p>Try another word, ${linkArrow("browse the guides", "/guides")} or ask Kamran.</p>
        ${kamranPill({ inline: true, location: "faq-empty" })}
      </div>
    </div>
  </div>
</section>`;
  return {
    main: [hero, list].join("\n"),
    title: page.title,
    closing: { label: "How to get started", path: "/get-started" },
  };
}

// ===========================================================================
// /about
// ===========================================================================

function aboutPage({ page }) {
  const S = (id) => sec(page, id);
  const hero = `<section class="hero hero-about" data-hero aria-labelledby="ab-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">About</p>
      <h1 class="display" id="ab-h1">About ${mark("trainsyou")}</h1>
      <p class="lede">${esc(budget("about lede", "We help personal trainers coach more people with their own AI, taught by them and working under their name.", 25))}</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("Read how we source numbers", "/methodology", { location: "hero" })}</div>
    </div>
    <figure class="entry" aria-labelledby="entry-cap">
      <p class="entry-w">trainsyou</p>
      <p class="entry-pos"><i>noun</i> · a UAE platform for personal trainers</p>
      <ol class="entry-defs">
        <li>Lets each personal trainer build a bespoke AI trainer, their Trainer Brain, from their own rules, cases and examples.</li>
        <li>Sells personalised, day-by-day coaching to that trainer’s followers, under the trainer’s own brand, priced in AED.</li>
      </ol>
      <figcaption class="entry-cap" id="entry-cap">How we describe ourselves, in two lines</figcaption>
    </figure>
  </div>
</section>`;

  const letter = band({
    id: "founder", labelledby: "founder-h",
    contentHtml: `${sectionHead({ n: 1, title: "From the founder", id: "founder-h" })}
    <div class="ab-letter">
      ${founderLetter()}
      <div class="ab-letter-side" data-reveal>
        <div class="mnote" role="note"><span class="mnote-k">Owner to supply · decision 2</span>Photo, name, the UAE connection and why the founder built trainsyou. We publish none of it until the owner writes it.</div>
        <div class="mnote ab-kamran" role="note"><span class="mnote-k">About Kamran</span>Kamran, the voice on this site, is an AI voice of <span class="placeholder">founder’s name</span>, used with consent.${kamranPill({ inline: true, location: "about" })}</div>
      </div>
    </div>`,
  });

  const mission = band({
    id: "mission", labelledby: "mission-h", paper: true,
    contentHtml: `${sectionHead({ n: 2, title: "Our mission", id: "mission-h" })}
    <div class="ms">
      <blockquote class="pull ab-mission" data-reveal><p>Make personal training affordable to more people by scaling real trainers’ <span class="nowrap">${mark("judgment")}.</span></p></blockquote>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Not by</span>Replacing trainers with a generic app.</div>
    </div>`,
  });

  // content.json notStatements: "It is not X: why." -> the ledger's "Is not" rows.
  const NOT_HEADS = ["A generic workout generator", "A medical service", "A replacement for the trainer"];
  const isNot = C.notStatements.map((s, i) => [NOT_HEADS[i], s.split(": ")[1]]);
  const what = band({
    id: "what", labelledby: "what-h",
    contentHtml: `${sectionHead({ n: 3, title: "What we are and aren’t", id: "what-h" })}
    ${msRow(`<p class="big-p">${esc(S("what").body[0])}</p>`, `<span class="mnote-k">Enforced in code</span>${esc(S("what").body[1])}`)}
    <div class="isnot" data-reveal>
      <p class="isnot-k">The ledger · v1 · 26 Oct 2026</p>
      <ol class="isnot-list" data-stagger>
        <li><span class="isnot-w isnot-w--is">Is</span><span class="isnot-t">${esc(S("is-not").bullets[0])}</span></li>
        ${each(isNot, ([head, why]) => `<li><span class="isnot-w">Is not</span><span class="isnot-t">${esc(head)}<span class="isnot-sub">${esc(why.charAt(0).toUpperCase() + why.slice(1))}</span></span></li>`)}
      </ol>
    </div>`,
  });

  const money = band({
    id: "money", labelledby: "money-h", paper: true,
    contentHtml: `${sectionHead({ n: 4, title: "How we make money", id: "money-h" })}
    <div class="ms">
      <div class="ms-text" data-reveal>
        <p class="big-p">Joining is free for trainers. We earn a share of their subscription revenue, and that share falls as they grow.</p>
        <dl class="ab-bands tnum" data-stagger>${each([["1–100", "25%"], ["101–300", "20%"], ["301–1,000", "15%"], ["1,001+", "10%"]], ([r, p]) => `<div><dt>${r}<small>paying subscribers</small></dt><dd>${p}</dd></div>`)}</dl>
        <p>Optional services, such as your own domain, are itemised. ${linkArrow("The commission maths", "/pricing")}</p>
      </div>
      <div class="mnote" role="note" data-reveal><div class="chips">${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>We earn only when your subscribers pay.</div>
    </div>`,
  });

  const honesty = band({
    id: "results", labelledby: "results-h",
    contentHtml: `${sectionHead({ n: 5, title: "How we talk about results", id: "results-h" })}
    ${msRow(`<ol class="house" data-stagger>${each(S("honesty").bullets, (b, i) => `<li><span class="house-n">Rule ${i + 1}</span><span>${esc(b)}</span></li>`)}</ol>`, `<span class="mnote-k">Check us</span>${linkArrow("Every source, with its label", "/methodology")}${linkArrow("What works today", "/pricing#status")}`)}`,
  });

  const where = band({
    id: "where", labelledby: "where-h", paper: true,
    contentHtml: `${sectionHead({ n: 6, title: "Where we work", id: "where-h" })}
    ${msRow(`<p>${esc(S("where").body[0].replace("prices and payouts in AED", "prices in AED and payouts to UAE banks"))}</p>
      <ul class="facts-row" data-stagger><li><b>AED</b><span>prices</span></li><li><b>EN · AR</b><span>member controls</span></li><li><b>RTL</b><span>right-to-left layouts</span></li><li><b>EN</b><span>marketing pages</span></li></ul>`,
      `<div class="chips">${statusChip("payments", "Not on yet: payouts", "Payouts live")}</div>${linkArrow("Coaching online in the UAE", "/uae")}`)}`,
  });

  const company = band({
    id: "company", labelledby: "company-h",
    contentHtml: `${sectionHead({ n: 7, title: "Company and contact", id: "company-h" })}
    <div class="ms">
      <dl class="colophon" data-reveal>
        <div><dt>Company</dt><dd><span class="placeholder">owner to supply</span></dd></div>
        <div><dt>Licence</dt><dd><span class="placeholder">owner to supply</span></dd></div>
        <div><dt>Registered address</dt><dd><span class="placeholder">owner to supply</span></dd></div>
        <div><dt>Support email</dt><dd><span class="placeholder">owner to supply</span></dd></div>
        <div><dt>Account holders</dt><dd>Use Support in your account.</dd></div>
      </dl>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Decision 2</span>The owner publishes company details and a support email here. We don’t invent them.</div>
    </div>`,
  });

  const faqs = faqBand({
    n: 8,
    items: page.faqs.map((f) => ({ q: f.q, a: /make money/.test(f.q) ? "A share of trainers’ subscription revenue that falls for each group of subscribers: 25%, 20%, 15% and 10%. Joining is free for trainers. Optional services are itemised." : plain(f.a) })),
    sideHtml: `<div class="mnote" role="note"><span class="mnote-k">More answers</span>${linkArrow("All questions", "/faq")}</div>`,
  });

  return {
    main: [hero, letter, mission, what, money, honesty, where, company, faqs].join("\n"),
    title: page.title,
    closing: { label: "Read how we source numbers", path: "/methodology" },
  };
}

// ===========================================================================
// /methodology (the "Sources" appendix)
// ===========================================================================

const RATE_ROWS = [
  ["linkClickPct", "Link-sticker click, per viewer per link Story", "Creator reports 1–5%, no industry benchmark (rule of thumb); IQFluence median 4.1%, strong creators 6–7% (vendor data).", ["creatorflow-link-sticker", "iqfluence-story-links"]],
  ["dmOpenPct", "Keyword commenters who open the DM link", "Vendor claims, no dataset.", ["communipass-auto-dm", "chatautodm-2026"]],
  ["broadcastClickPct", "Broadcast members who open one link message", "Email click medians for sports, health and fitness, all industries (measured; used as a proxy).", ["mailerlite-benchmarks"]],
  ["bioClickPct", "Profile visitors who open the bio link in a month (only when you enter visits)", "Rule of thumb, 1–3%.", ["hopp-bio-link"]],
  ["paidPct", "Visit to paid subscriber", "Luxury retail; Health & Fitness app downloads that turn paid within 35 days, median and upper quartile (measured; used as a proxy, and may overstate). No published benchmark exists for coaching subscriptions.", ["dynamicyield-conversion", "revenuecat-state-2026"]],
  ["audienceRenewalPct", "New people each month: share of each audience new to your link", "Cautious: the same people all year. Typical: about measured yearly follower growth on brand accounts, 11–22% by tier (measured; our rounding). Strong: our assumption for a growing audience.", ["socialinsider-engagement"]],
];
const TIER_BASIS = [
  ["Cautious and typical: Socialinsider image and video reach (measured, brand accounts). Strong: our assumption, the 20.5% a six-frame Story sequence reached, used as a monthly audience.", ["socialinsider-stories"]],
  ["Cautious: image reach, 3.5% (measured). Typical: the 5% vendor floor (vendor claim). Strong: our assumption, the six-frame 20.5%; smaller accounts engage most (vendor data).", ["socialinsider-stories", "iqfluence-engagement", "hypeauditor-2025"]],
  ["Image reach (measured); at least 5% (vendor claim); strong: the IQFluence 5–8% band, lower for larger accounts (vendor claim, no dataset).", ["socialinsider-stories", "iqfluence-engagement"]],
];
const STEP_SOURCES = [
  ["socialinsider-stories", "socialinsider-engagement"], ["creatorflow-link-sticker", "hopp-bio-link"], ["socialinsider-engagement"],
  ["metricool-2026", "socialinsider-reels", "communipass-auto-dm"], ["meta-instagram-ranking", "mailerlite-benchmarks"],
  ["dynamicyield-conversion", "revenuecat-state-2026"], ["revenuecat-renewals", "coachway-2026"],
];
// Sources the follower calculator uses only through the assumption tables on
// this page (no page section lists them in content.json).
const CALC_ONLY = ["unbounce-landing-pages", "meta-instagram-login", "techcrunch-basic-display", "socialinsider-reach", "iqfluence-engagement", "iqfluence-story-links", "chatautodm-2026", "revenuecat-trends-2026", "revenuecat-renewals", "coachway-2026"];
const FILTERS = [["all", "All"], ["follower", "Follower calculator"], ["pricing", "Pricing"], ["uae", "UAE"], ["guides", "Guides"]];
const groupOf = (path) => (path === "/follower-calculator" ? "follower" : path === "/pricing" ? "pricing" : path === "/uae" ? "uae" : path.startsWith("/guides/") ? "guides" : "");

/** Formula text: x^(…) and x^k as superscripts. */
const formula = (t) => esc(t).replace(/\^\(([^)]+)\)/g, "<sup>$1</sup>").replace(/\^([A-Za-z0-9/]+)/g, "<sup>$1</sup>");

function methodologyPage({ page }) {
  const S = (id) => sec(page, id);
  const M = calc.FOLLOWER_MODEL, SC = M.scenarios;
  const srcLink = (ids) => ids.map((id) => `<a class="in-src" href="#${id}">${esc(source(id).publisher)}</a>`).join(", ");

  // Where each source is cited (content.json sections), plus calculator-only sources.
  const citedOn = {};
  for (const p of C.pages) for (const s of p.sections || []) for (const id of s.sources || []) (citedOn[id] = citedOn[id] || new Set()).add(p.path);
  for (const id of CALC_ONLY) (citedOn[id] = citedOn[id] || new Set()).add("/follower-calculator");
  const groups = (id) => uniq([...(citedOn[id] || [])].map(groupOf).filter(Boolean));
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? C.sources.length : C.sources.filter((s) => groups(s.id).includes(k)).length]));

  const hero = `<section class="hero hero-meth" data-hero aria-labelledby="mt-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Methodology · the sources appendix</p>
      <h1 class="display" id="mt-h1">Methodology and ${mark("sources")}</h1>
      <p class="lede">Every figure from outside trainsyou, with its source, the date we checked it and how we use it.</p>
      <p class="g-meta"><span>${C.sources.length} sources</span><span>Assumptions version ${esc(M.version)}</span><span>Updated ${fmtDate(page.lastUpdated)}</span></p>
    </div>
    <aside class="legend" aria-labelledby="legend-h">
      <p class="legend-k" id="legend-h">How much weight a source can bear</p>
      <dl>
        <div><dt>Measured</dt><dd>A dataset with a stated sample.</dd></div>
        <div><dt>Used as a proxy</dt><dd>Measured elsewhere; stands in where no benchmark exists.</dd></div>
        <div><dt>Vendor data or claim</dt><dd>A company’s own dataset, or its word without one.</dd></div>
        <div><dt>Rule of thumb</dt><dd>What practitioners report. Not measured.</dd></div>
        <div><dt>Official, platform, press</dt><dd>What a government, Instagram or the news says.</dd></div>
      </dl>
    </aside>
  </div>
</section>`;

  const items = [
    { id: "principles", n: 1, title: "How we use figures" },
    { id: "follower-formula", n: 2, title: "The follower estimate" },
    { id: "follower-assumptions", n: 3, title: "The values in use now" },
    { id: "earnings-method", n: 4, title: "The earnings estimate" },
    { id: "sources", n: 5, title: "Sources" },
    { id: "exclude", n: 6, title: "What we exclude" },
    { id: "changes", n: 7, title: "What changed" },
  ];

  const principles = dsec({ ...items[0], html: msRow(bullets(S("principles").bullets), `<span class="mnote-k">One rule above all</span>A figure that isn’t listed here doesn’t appear on the site.`) });

  const ff = S("follower-formula");
  const formulaSec = dsec({
    ...items[1], title: "How the follower estimate works",
    html: msRow(`<p>${esc(ff.body[0])}</p>`, `<div class="chips">${estimateLabel()}</div>The headline is the strong case: a best case, not typical.`) +
      `<ol class="eqs">${each(ff.steps, (st, i) => `<li class="eq-row" data-reveal><div class="eq-main"><p class="eq-n">Step ${i + 1}</p><h3 class="eq-t">${esc(st.title)}</h3><p class="eq-b">${formula(st.body)}</p></div><div class="mnote" role="note"><span class="mnote-k">Rests on</span>${srcLink(STEP_SOURCES[i])}</div></li>`)}</ol>`,
  });

  const pctRow = (o) => ["cautious", "typical", "strong"].map((k) => `${o[k]}%`);
  const tierLabel = (i) => {
    const t = M.tiers[i], from = i === 0 ? 0 : M.tiers[i - 1].upTo + 1;
    return t.upTo === null ? `Above ${calc.whole(from - 1)}` : `${calc.whole(from)}–${calc.whole(t.upTo)}`;
  };
  const D = calc.DEFAULT_FOLLOWER_INPUTS;
  const worked = calc.estimateFollowerConversion(D);
  const strong = SC.strong;
  const perStory = Math.round(strong.linkClickPct * strong.paidPct) / 100;
  const signupShare = Math.round((worked.scenarios.strong.signups12 / D.followers) * 1000) / 10;
  const cnt = (v) => calc.countLabel(v);
  const assumptions = dsec({
    ...items[2], title: "The values in use now",
    html: `${wide(rtable({
      caption: `Story audience: % of followers who see at least one of your Stories a month (version ${M.version})`,
      columns: ["Followers", "Cautious", "Typical", "Strong case", "Basis and label"],
      rows: M.tiers.map((t, i) => [tierLabel(i), ...pctRow(t.storyPct), { html: `${esc(TIER_BASIS[Math.min(i, 2)][0])} ${srcLink(TIER_BASIS[Math.min(i, 2)][1])}` }]),
      numeric: [1, 2, 3], className: "tbl--meth",
    }), `<span class="mnote-k">Your own views win</span>If you enter your average Story views, they replace this row.`)}
    ${wide(rtable({
      caption: "Rates per scenario",
      columns: ["Assumption", "Cautious", "Typical", "Strong case", "Basis and label"],
      rows: RATE_ROWS.map(([k, label, basis, ids]) => [label, `${SC.cautious[k]}%`, `${SC.typical[k]}%`, `${SC.strong[k]}%`, { html: `${esc(basis)} ${srcLink(ids)}` }]),
      numeric: [1, 2, 3], className: "tbl--meth",
    }), `<span class="mnote-k">Same arithmetic, three sets of rates</span>Only these values change between scenarios.`)}
    ${wide(rtable({
      caption: "Other assumptions",
      columns: ["Assumption", "Value", "Basis and label"],
      rows: [
        ["Reach of one call-to-action Reel or post, by tier", `Cautious (posts): ${M.tiers.map((t) => t.reelPct.cautious + "%").join(" / ")}. Typical and strong (Reels): ${M.tiers.map((t) => t.reelPct.strong + "%").join(" / ")}`, { html: `Measured, brand accounts. ${srcLink(["socialinsider-reach", "socialinsider-reels"])}` }],
        ["Comments per Reel view, by tier", M.tiers.map((t) => t.commentsPerViewPct + "%").join(" / "), { html: `Measured, brand accounts; our division of published medians. ${srcLink(["socialinsider-engagement"])}` }],
        ["Keyword comments per view", `Comments per view × ${M.keywordCommentFactor}`, { html: `Measured (+202.78% comments with a comment call to action); treating them as keyword comments is our inference. ${srcLink(["metricool-2026"])}` }],
        ["How channels overlap", "Cautious: Reels reach the same people as Stories. Typical and strong: each Reel reaches new people. Stories and broadcast are nested", { html: `Our assumption, from a platform statement. ${srcLink(["meta-instagram-ranking"])}` }],
        ["Average engagement", `${M.engagementBenchmarkPct}%, scaling at most ×${M.engagementFactorMax}`, { html: `Measured, brand accounts. ${srcLink(["socialinsider-engagement"])}` }],
        ["Members who cancel per year", "Your input, 5–80%; 30% unless you change it", { html: `Owner assumption. Published data show more cancellations. ${srcLink(["revenuecat-renewals", "coachway-2026"])}` }],
      ],
      className: "tbl--meth",
    }), "")}
    <div class="calib" data-reveal>
      <p class="calib-k">How the strong case is calibrated</p>
      <ul class="rlist">
        <li>Per link Story, ${strong.linkClickPct}% of viewers tap and ${strong.paidPct}% of them pay: about ${perStory}% of the people who see it each time. Each month ${strong.audienceRenewalPct}% of the audience is new to your link. <span class="lbl">Our assumption; measured proxies</span></li>
        <li>Over 12 months the worked example signs up about ${signupShare}% of its followers, far above published creator averages (${srcLink(["passion-creator-rates", "stan-creator-economy"])}). <span class="lbl">Rule of thumb; vendor data</span></li>
        <li>The strong rates are the top values found in the research: ${strong.linkClickPct}% link clicks, ${strong.dmOpenPct}% of keyword commenters opening the DM link and ${strong.paidPct}% visit to paid. <span class="lbl">Measured; vendor claims; our assumption</span></li>
      </ul>
    </div>
    ${wide(rtable({
      caption: `Worked example: ${calc.whole(D.followers)} followers, AED ${D.priceAed}, ${D.linkStoriesPerMonth} link Stories and ${D.ctaReelsPerMonth} keyword Reels a month, ${D.yearlyCancelPct}% yearly cancellations`,
      columns: ["Scenario", "First month", "Active after 12 months", "Sign-ups over 12 months", "A month at month 12"],
      rows: ["cautious", "typical", "strong"].map((k) => { const r = worked.scenarios[k]; return [{ cautious: "Cautious", typical: "Typical", strong: "Strong case" }[k], cnt(r.month1New), cnt(r.activeMonth12), cnt(r.signups12), calc.aedWhole(r.revenueMonth12Minor)]; }),
      numeric: [1, 2, 3, 4], className: "tbl--examples",
    }), `<div class="chips">${estimateLabel()}${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>Before platform commission, payment processing and tax.`)}`,
  });

  const E = calc.estimateEarnings({ subscribers: 150, billing: "monthly", workoutPriceAed: 199, programmeMonths: 1, nutritionSharePct: 0, nutritionPriceAed: 0, voiceSharePct: 0, voicePriceAed: 0, sessionsPerMonth: 0, sessionPriceAed: 0, yourSessionRateAed: 250 });
  const em = S("earnings-method");
  const earnings = dsec({
    ...items[3], title: "How the earnings estimate works",
    html: msRow(bullets(em.bullets.map((b) => b.replace("the standard marginal bands", "our share for each group of subscribers"))), `<span class="mnote-k">Each group keeps its rate</span>Growing never raises the rate on earlier subscribers.`) +
      msRow(`<div class="wx">
  <div class="wx-top"><span class="wx-k">Worked example · arithmetic, not a forecast</span>${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>
  <ol class="wx-lines">
    <li><span class="wx-l">Given</span><span class="wx-x tnum">150 subscribers × AED 199 a month</span><span class="wx-v tnum">${calc.aedWhole(E.subscriptionMonthlyMinor)}</span></li>
    <li><span class="wx-l">Our share</span><span class="wx-x tnum">first 100 × 25%</span><span class="wx-v tnum">${calc.aedWhole(E.bands[0].commissionMinor)}</span></li>
    <li><span class="wx-l"></span><span class="wx-x tnum">next 50 × 20%</span><span class="wx-v tnum">${calc.aedWhole(E.bands[1].commissionMinor)}</span></li>
    <li class="wx-sum"><span class="wx-l"></span><span class="wx-x">Commission</span><span class="wx-v tnum">${calc.aedWhole(E.commissionMinor)}</span></li>
    <li class="wx-res"><span class="wx-l" aria-label="Therefore">∴</span><span class="wx-x">Before payment processing and other costs</span><span class="wx-v tnum">${calc.aedWhole(E.beforeOtherCostsMinor)}</span></li>
  </ol>
  <p class="wx-foot tnum">About ${E.equivalentSessions} sessions at AED 250.</p>
</div>`, `<span class="mnote-k">Same function as the calculator</span>${linkArrow("Estimate my earnings", "/earnings-calculator")}`),
  });

  const sourcesSec = dsec({
    ...items[4], title: `The ${C.sources.length} sources`,
    html: `<div class="srcf" data-src-filter>
  <div class="chapbar" role="group" aria-label="Show sources cited on">${each(FILTERS, ([k, l], i) => `<button class="chapbtn" type="button" aria-pressed="${i === 0}" data-src-f="${k}">${esc(l)} <span class="cnt tnum">${counts[k]}</span></button>`)}<span class="chap-ink" aria-hidden="true"></span></div>
  <p class="srcf-count" data-src-count>All ${C.sources.length} sources</p><p class="sr-only" aria-live="polite" data-src-live></p>
  <ol class="srcl">${each(C.sources, (s, i) => {
    const on = [...(citedOn[s.id] || [])];
    return `<li class="srci arrive-row" id="${esc(s.id)}" data-on="${groups(s.id).join(" ")}">
  <span class="srci-n tnum" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
  <div class="srci-b">
    <p class="srci-h"><span class="ev">${esc(s.evidence)}</span><span><b>${esc(s.publisher)}</b>, ${extLink(s.url, s.title)}${s.published ? ` (${esc(s.published)})` : ""}</span></p>
    <p class="srci-c">${esc(s.claim)}</p>
    <p class="srci-u"><span class="srci-k">Used for</span>${esc(s.usedFor)}</p>
    <p class="srci-o"><span class="srci-k">Cited on</span>${on.length ? on.map((p) => `<a href="${href(p)}">${esc(pageFor(p).navLabel)}</a>`).join(" · ") : "This page"}<span class="srci-d">Checked ${fmtDate(s.retrieved)}</span></p>
  </div>
</li>`;
  })}</ol>
</div>`,
  });

  const exclude = dsec({
    ...items[5], title: "What we exclude",
    html: msRow(bullets([
      "From the follower estimate: trials, discounts, refunds, failed payments, platform commission, payment processing and tax.",
      "New followers count only through the new people each month.",
      "From the earnings estimate: payment processing, your own domain, refunds, disputes, booking fees and tax.",
      "Customer counts, ratings and testimonials that we cannot show.",
      "Any figure not listed on this page.",
    ]), `<span class="mnote-k">Waiting on the owner</span>Two new figures stay off the site until they are sourced and labelled here. <span class="placeholder">decision 19</span>`),
  });

  const changes = dsec({
    ...items[6], title: "What changed, and when",
    html: `<ol class="log" data-reveal>
  <li><span class="log-v tnum">2026-09-28</span><span>First publication of sources and calculator assumptions.</span></li>
  <li><span class="log-v tnum">.2</span><span>Repeat link Stories reach the same viewers, so visits level off. Visit to paid moved to 0.72% (cautious) and 2.89% (EMEA average): coaching is a considered purchase.</span></li>
  <li><span class="log-v tnum">.3</span><span>Three scenarios instead of one range; Reels, the bio link and broadcast join Stories; yearly cancellations; tier boundaries no longer lower an estimate.</span></li>
  <li><span class="log-v tnum">.4</span><span>New people each month; strong visit to paid is 6.2%, the Health &amp; Fitness upper quartile; engagement no longer raises the strong Story share; an unverified creator figure is no longer a source.</span></li>
</ol>`,
  });

  const body = band({ className: "band--doc", contentHtml: doc({ items, bodyHtml: [principles, formulaSec, assumptions, earnings, sourcesSec, exclude, changes].join("\n") }) });
  const faqs = faqBand({ items: page.faqs.map((f) => ({ q: f.q, a: f.a })), title: "Questions" });
  return {
    main: [hero, body, faqs].join("\n"),
    title: page.title,
    closing: { label: "Back to the follower calculator", path: "/follower-calculator" },
  };
}

// ===========================================================================
// Legal: /terms, /privacy, /ai-disclosure (the published texts, in full)
// ===========================================================================

const LEGAL = [
  ["/terms", "terms-2026-10-14.en.md", { label: "Read the privacy policy", path: "/privacy" }],
  ["/privacy", "privacy.en.md", { label: "Security and privacy", path: "/security-and-privacy" }],
  ["/ai-disclosure", "ai-disclosure.en.md", { label: "How your AI decides", path: "/trainer-brain" }],
];
function legalPage(file, closing) {
  return ({ page }) => {
    const d = legalDoc(file);
    const items = d.sections.map((s) => ({ id: `s${s.n}`, n: s.n, title: s.title }));
    const others = LEGAL.map(([p]) => pageFor(p));
    const hero = `<section class="hero hero-legal" data-hero aria-labelledby="lg-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Legal</p>
      <h1 class="display lg-h1" id="lg-h1">${esc(page.h1)}</h1>
      <dl class="lg-meta">
        <div><dt>Version</dt><dd>Policy edition of ${esc(d.edition)}</dd></div>
        <div><dt>Last updated</dt><dd>${esc(d.edition)}</dd></div>
        <div><dt>Language</dt><dd>English, as published by the platform</dd></div>
        ${d.title !== page.h1 ? `<div><dt>Published as</dt><dd>${esc(d.title)}</dd></div>` : ""}
      </dl>
    </div>
    <nav class="lg-docs" aria-label="Platform documents">
      <p class="toc-k">Platform documents</p>
      <ol>${each(others, (p, i) => `<li><a href="${href(p.path)}"${p.path === page.path ? ' aria-current="page"' : ""}><span class="toc-n">${["I", "II", "III"][i]}</span><span>${esc(p.h1)}</span></a></li>`)}</ol>
    </nav>
  </div>
</section>`;
    const bodyHtml = `<p class="lg-edition">${esc(d.editionLine)}</p>
${each(d.sections, (s) => `<section class="lg-sec" id="s${s.n}" aria-labelledby="s${s.n}-h">
  <h2 class="lg-h" id="s${s.n}-h"><span class="lg-n">§${esc(s.n)}</span><span>${esc(s.title)}</span></h2>
  ${each(s.paras, (p) => `<p>${esc(p)}</p>`)}
</section>`)}
<p class="lg-end"><span aria-hidden="true">∎</span> End of document</p>`;
    const body = band({ className: "band--doc band--legal", contentHtml: doc({ items, bodyHtml, className: "doc--legal" }) });
    return { main: [hero, body].join("\n"), title: page.title, closing, sticky: false, kamran: false };
  };
}

// ===========================================================================
// /coaches (empty, trainer-facing; noindex and out of the footer, decision 11)
// ===========================================================================

function coachesPage({ page }) {
  const hero = `<section class="hero hero-coaches" data-hero aria-labelledby="co-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Coaches</p>
      <h1 class="display" id="co-h1">Find a ${mark("coach")}</h1>
      <p class="lede">Coaches choose to be listed here. There are no listings yet.</p>
      <p class="status-strip">${flagged("publish", `<span class="chip-dot" aria-hidden="true"></span>Publishing is not on yet, so no coach can be listed today.`, `${icon("check", { size: 16 })}Publishing is live. Listings appear as coaches choose to be listed.`)}</p>
    </div>
    <figure class="co-dir" aria-labelledby="co-cap">
      <div class="co-sheet">
        <div class="co-head"><span>Directory</span><span>Listings</span></div>
        <ol class="co-rows" aria-hidden="true">${each([0, 1, 2, 3], () => `<li><span class="co-ph"></span><span class="co-ln"></span><span class="co-ln co-ln--s"></span></li>`)}</ol>
        <p class="co-empty"><span>No listings yet</span></p>
      </div>
      <figcaption class="fig-cap" id="co-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">An empty directory, on purpose</span></figcaption>
    </figure>
  </div>
</section>`;
  const listing = `<div class="co-card">
  <div class="co-card-top"><span class="app-icon">LS</span><div><p class="co-name">Layla Strength</p><p class="co-url">layla-strength.trainsyou.com</p></div></div>
  <p class="co-spec">Strength · Dubai · English and Arabic</p>
  <p class="co-price tnum">From AED 199 <small>a month</small></p>
  <div class="chips">${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>
</div>`;
  const yourself = band({
    id: "yourself", labelledby: "yourself-h", paper: true,
    contentHtml: `${sectionHead({ n: 1, title: "Coaching yourself?", id: "yourself-h" })}
    <div class="co-you">
      <div class="co-you-copy" data-reveal>
        <p class="big-p">Start free and list your page when you publish.</p>
        <p>Your page, your app and your AI come first. Listing here is a choice you make later.</p>
        <div class="hero-actions">${cta({ location: "coaches" })}${secondary("How it works", "/how-it-works", { location: "coaches" })}</div>
        ${microLine()}
      </div>
      ${h.figure({ n: 2, caption: "How a listing could look", bodyHtml: listing, className: "co-fig" })}
    </div>`,
  });
  return { main: [hero, yourself].join("\n"), title: page.title };
}

// ===========================================================================
// 404 (no motion; everything in the first screen)
// ===========================================================================

function notFound({ page }) {
  const idx = [
    ["Demo", "Watch your AI decide, then change a rule", "/demo"],
    ["Guides", "Pricing, followers, the permit, rules", "/guides"],
    ["Home", "Start at the beginning", "/"],
    ["Pricing", "Free to join; you set the price", "/pricing"],
  ];
  return {
    main: `<section class="hero hero-404" data-hero aria-labelledby="nf-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">404 · Not found</p>
      <h1 class="display" id="nf-h1">${esc(page.h1.replace("'", "’"))}</h1>
      <p class="lede">Your coaching still can be.</p>
      <div class="hero-actions">${cta({ location: "404" })}</div>
      ${microLine()}
    </div>
    <nav class="nf-index" aria-labelledby="nf-ix">
      <p class="nf-k" id="nf-ix">Index</p>
      <ol>${each(idx, ([t, d, p]) => `<li><a href="${href(p)}"><span class="nf-t">${esc(t)}</span><span class="nf-dots" aria-hidden="true"></span><span class="nf-d">${esc(d)}</span><span class="arr" aria-hidden="true">→</span></a></li>`)}</ol>
    </nav>
  </div>
</section>`,
    title: page.title,
    closing: false,
    sticky: false,
    kamran: false,
  };
}

// ===========================================================================

export const pages = {
  "/guides": guidesIndex,
  "/guides/pricing-online-coaching-uae": pricingGuide,
  "/guides/instagram-followers-to-clients": instagramGuide,
  "/guides/uae-advertiser-permit": permitGuide,
  "/guides/writing-coaching-rules": rulesGuide,
  "/faq": faqPage,
  "/about": aboutPage,
  "/methodology": methodologyPage,
  ...Object.fromEntries(LEGAL.map(([path, file, closing]) => [path, legalPage(file, closing)])),
  "/coaches": coachesPage,
  "/404": notFound,
};
