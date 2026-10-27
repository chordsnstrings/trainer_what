// Shared helpers for the content page group (guides, FAQ, about,
// methodology, legal, coaches, 404). Owned by the content builder.
// Styles: site/assets/content.css. Behaviour: site/assets/content.js.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, source } from "./lib/content.mjs";
import { href, pageFor } from "./lib/registry.mjs";
import * as h from "./lib/components.mjs";

const { esc, each, cx } = h;
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The calculators' maths (a 1:1 port of the domain package), for build-time figures. */
export const calc = require(resolve(ROOT, "site/assets/calc.js"));

// ---------------------------------------------------------------------------
// Dates, words, plain-language rewrites

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-09-28" -> "28 Sep 2026" (or "28 September 2026" with long). */
export function fmtDate(iso, { long = false } = {}) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

const words = (s) => (String(s || "").match(/\S+/g) || []).length;
/** Reading time for a guide: every visible text field, at 220 words a minute. */
export function readingMinutes(page) {
  let n = words(page.intro) + words(page.lede);
  for (const s of page.sections || []) {
    n += words(s.heading) + words((s.body || []).join(" ")) + words((s.bullets || []).join(" ")) + words(s.note);
    for (const st of s.steps || []) n += words(st.title) + words(st.body);
    for (const c of s.cards || []) n += words(c.title) + words(c.body);
    if (s.table) n += words(s.table.rows.flat().join(" ")) + 40;
  }
  for (const f of page.faqs || []) n += words(f.q) + words(f.a);
  return Math.max(1, Math.round(n / 220));
}

/**
 * House vocabulary (C0 grade-6 table, "AI" belongs to someone). Applied to
 * content.json strings that predate the copy rules.
 */
export function plain(text) {
  return String(text)
    .replace(/held-out scenarios/g, "your test cases")
    .replace(/\bThe Brain\b/g, "Your AI")
    .replace(/\bthe Brain\b/g, "your AI")
    .replace(/\bYour Brain\b/g, "Your AI")
    .replace(/\byour Brain\b/g, "your AI")
    .replace(/using marginal bands of 25%, 20%, 15% and 10%/g, "that falls for each group of subscribers: 25%, 20%, 15% and 10%")
    .replace(/in marginal bands of 25%, 20%, 15% and 10%/g, "that falls for each group of subscribers: 25%, 20%, 15% and 10%");
}

/** Count words; the build warns when a budgeted string runs long. */
export function budget(label, text, max) {
  const n = words(String(text).replace(/<[^>]+>/g, " "));
  if (n > max) console.warn(`  [content] ${label}: ${n} words (budget ${max})`);
  return text;
}

// ---------------------------------------------------------------------------
// Footnotes: numbered markers in the text, sidenotes in the margin column,
// and a "Notes" list at the end. Every note also carries h.sourceBadge, so
// every market figure links to /methodology#<id>.

export function notes() {
  const order = [];
  const refd = new Set();
  const num = (id) => {
    source(id); // throws on an unknown id
    let i = order.indexOf(id);
    if (i < 0) { order.push(id); i = order.length - 1; }
    return i + 1;
  };
  return {
    /** Superscript markers for one or more source ids. */
    ref(ids = []) {
      return ids.map((id) => {
        const n = num(id), s = source(id);
        const first = !refd.has(id);
        refd.add(id);
        return `<sup class="fn"><a href="#note-${n}"${first ? ` id="ref-${n}"` : ""} aria-label="Note ${n}: ${esc(s.publisher)}">${n}</a></sup>`;
      }).join("");
    },
    /** Sidenote HTML (for a margin note) listing these sources. */
    side(ids = []) {
      return ids.map((id) => {
        const n = num(id), s = source(id);
        return `<p class="snote"><span class="snote-n" aria-hidden="true">${n}</span><span class="snote-t"><b>${esc(s.publisher)}</b>, ${esc(s.title)}${s.published ? ` (${esc(s.published)})` : ""}. <span class="snote-ev">${esc(s.evidence)}</span> ${h.sourceBadge(id)}</span></p>`;
      }).join("");
    },
    /** The closing notes list (empty string when nothing was cited). */
    list() {
      if (!order.length) return "";
      return `<ol class="notes">${each(order, (id, i) => {
        const s = source(id), n = i + 1;
        return `<li class="arrive-row" id="note-${n}"><span class="nl-n" aria-hidden="true">${n}</span><div>
  <p><b>${esc(s.publisher)}</b>, ${extLink(s.url, s.title)}${s.published ? ` (${esc(s.published)})` : ""}. <span class="snote-ev">${esc(s.evidence)}</span></p>
  <p class="fine">Checked ${fmtDate(s.retrieved)}. <a href="${href("/methodology", "#" + id)}">How we use it</a>${refd.has(id) ? ` · <a href="#ref-${n}" aria-label="Back to note ${n} in the text">Back to text <span aria-hidden="true">↩</span></a>` : ""}</p>
</div></li>`;
      })}</ol>`;
    },
    get count() { return order.length; },
  };
}

/** A link to another site: new tab, rel=noopener, announced. */
export const extLink = (url, label, className = "") =>
  `<a class="${cx("ext", className)}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}<span class="ext-ic" aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;

// ---------------------------------------------------------------------------
// Long-form layout: a sticky contents rail (desktop) + the document body.

/** items: [{ id, n, title }]. Active state is set by content.js (instant colour, ink moves by transform). */
export function railToc(items, { label = "Contents", extraHtml = "" } = {}) {
  return `<aside class="doc-rail" aria-label="${esc(label)}">
  <nav class="ctoc" aria-label="On this page" data-ctoc>
    <p class="ctoc-k">${esc(label)}</p>
    <ol>${each(items, (it) => `<li><a href="#${esc(it.id)}"><span class="ctoc-n">${it.n != null ? `§${esc(it.n)}` : ""}</span><span class="ctoc-t">${esc(it.title)}</span></a></li>`)}</ol>
    <span class="ctoc-ink" aria-hidden="true"></span>
  </nav>
  ${extraHtml}
</aside>`;
}
/** The same contents as a native disclosure for <=1100 px. */
export function mobileToc(items, { label = "Contents" } = {}) {
  return `<details class="toc-m">
  <summary><span class="toc-m-k">${esc(label)}</span><span class="toc-m-c">${items.length} sections</span><span class="toc-m-i" aria-hidden="true"></span></summary>
  <ol>${each(items, (it) => `<li><a href="#${esc(it.id)}"><span class="ctoc-n">${it.n != null ? `§${esc(it.n)}` : ""}</span><span>${esc(it.title)}</span></a></li>`)}</ol>
</details>`;
}
export function doc({ items, bodyHtml, railExtraHtml = "", className = "", label }) {
  return `<div class="${cx("doc", className)}">
  ${railToc(items, { extraHtml: railExtraHtml, label })}
  <div class="doc-body">
    ${mobileToc(items, { label })}
    ${bodyHtml}
  </div>
</div>`;
}
/** A numbered document section (anchor target for the TOC). */
export function dsec({ id, n, title, titleHtml, html, className = "" }) {
  return `<section class="${cx("dsec", className)}" id="${esc(id)}" aria-labelledby="${esc(id)}-h">
  ${h.sectionHead({ n, title, titleHtml, id: `${id}-h` })}
  ${html}
</section>`;
}

// ---------------------------------------------------------------------------
// Text blocks

/** A full-width block (wide tables, the rule format strip) with its note underneath. */
export const wide = (html, noteHtml = "") =>
  `<div class="wide" data-reveal>${html}${noteHtml ? `<div class="mnote wide-note" role="note">${noteHtml}</div>` : ""}</div>`;

/** Responsive table: stacks into labelled rows at <=640 px. Cells: string or {html}. */
export function rtable({ caption, captionHtml, columns, rows, numeric = [], className = "", rowHeaders = true }) {
  const cell = (c) => (c && typeof c === "object" ? c.html : esc(c));
  return `<div class="tbl-wrap"><table class="${cx("tbl rtbl", className)}">
  ${captionHtml || caption ? `<caption>${captionHtml || esc(caption)}</caption>` : ""}
  <thead><tr>${each(columns, (c, i) => `<th scope="col"${numeric.includes(i) ? ' class="num"' : ""}>${esc(c)}</th>`)}</tr></thead>
  <tbody>${each(rows, (r) => `<tr>${each(r, (c, i) =>
    i === 0 && rowHeaders
      ? `<th scope="row" data-label="${esc(columns[0])}">${cell(c)}</th>`
      : `<td data-label="${esc(columns[i])}"${numeric.includes(i) ? ' class="num"' : ""}><span class="rv">${cell(c)}</span></td>`,
  )}</tr>`)}</tbody>
</table></div>`;
}

/** Numbered manual steps. markers: { [index]: html appended to that step's body }. */
export function steps(list, { markers = {}, level = 3, className = "", start = 1 } = {}) {
  const H = `h${level}`;
  return `<ol class="${cx("msteps", className)}">${each(list, (s, i) => `<li><span class="mst-n" aria-hidden="true">${i + start}</span><div class="mst-b"><${H} class="mst-t"><span class="sr-only">Step ${i + start}: </span>${esc(plain(s.title))}</${H}><p>${esc(plain(s.body))}${markers[i] || ""}</p></div></li>`)}</ol>`;
}
/** A ruled list. markers: { [index]: html }. */
export function bullets(list, { markers = {}, className = "" } = {}) {
  return `<ul class="${cx("rlist", className)}">${each(list, (b, i) => `<li>${esc(plain(b))}${markers[i] || ""}</li>`)}</ul>`;
}

/**
 * FAQ list with the site.css accordion classes (site.js wires [data-faq]).
 * items: [{ q, a?, aHtml?, chapter? }]. Answers may carry flag spans.
 */
export function faqList(items, { id = "faq", level = 3, start = 1, className = "", attrsHtml = "" } = {}) {
  const H = `h${level}`;
  return `<div class="${cx("faq", className)}" data-faq${attrsHtml}>${each(items, (it, i) => {
    const qid = `${id}-${i}`;
    const a = it.aHtml || `<p>${esc(it.a)}</p>`;
    // Count the live (default) branch only: drop the "on" branch of flagged spans.
    budget(`FAQ "${it.q}"`, (it.aHtml || it.a).replace(/<(span|div) class="if-[a-z]+-(on|open)">[\s\S]*?<\/\1>/g, ""), 45);
    return `<div class="faq-item"${it.chapter ? ` data-chapter="${esc(it.chapter)}"` : ""} data-reveal style="--i:${Math.min(i, 5)}">
  <${H} class="faq-h"><button class="faq-q" type="button" aria-expanded="false" aria-controls="${qid}" id="${qid}-q" data-faq-id="${esc(h.slug(it.q))}"><span class="faq-n">${String(i + start).padStart(2, "0")}</span><span class="faq-qt">${esc(it.q)}</span><span class="faq-icon" aria-hidden="true"></span></button></${H}>
  <div class="faq-a" id="${qid}" role="region" aria-labelledby="${qid}-q"><div>${a}</div></div>
</div>`;
  })}</div>`;
}

/** "Questions" band: accordion + margin column (all questions, Kamran on phones). */
export function faqBand({ items, id = "questions", n, title = "Questions", paper = true, sideHtml = "" }) {
  return h.band({
    id,
    labelledby: `${id}-h`,
    paper,
    contentHtml: `${h.sectionHead({ n, title, id: `${id}-h` })}
    <div class="ms">${faqList(items, { id: `${id}-faq` })}<div class="faq-side">${sideHtml || `<div class="mnote" role="note"><span class="mnote-k">More answers</span>${h.linkArrow("All questions", "/faq")}</div>`}${h.kamranPill({ inline: true, location: "faq" })}</div></div>`,
  });
}

/** "Keep reading" rows to related pages (content.json `related`). */
export function relatedBand(paths, { id = "related", title = "Keep reading", paper = false, n } = {}) {
  const kind = (p) => (p.kind === "guide" ? "Guide" : /calculator/.test(p.path) ? "Tool" : p.group === "legal" ? "Legal" : "Page");
  return h.band({
    id,
    labelledby: `${id}-h`,
    paper,
    contentHtml: `${h.sectionHead({ n, title, id: `${id}-h` })}
    <ul class="rel" data-reveal data-stagger>${each(paths, (path) => {
      const p = pageFor(path);
      return `<li><a class="rel-a" href="${href(path)}"><span class="rel-k">${kind(p)}</span><span class="rel-t">${esc(p.navLabel)}</span><span class="rel-d">${esc(p.description)}</span><span class="rel-arr arr" aria-hidden="true">→</span></a></li>`;
    })}</ul>`,
  });
}

// ---------------------------------------------------------------------------
// Legal documents (the published texts, copied verbatim from
// docs/legal/uae-2026-10: terms-2026-10-14.en.md is the consolidated terms
// source, privacy.en.md and ai-disclosure.en.md as published by migration 090).

/** Parse a policy file: { title, edition, intro[], sections: [{ n, title, paras[] }] }. */
export function legalDoc(file) {
  const text = readFileSync(resolve(here, "content-legal", file), "utf8").replace(/\r/g, "");
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = { title: "", editionLine: "", edition: "", sections: [] };
  for (const b of blocks) {
    if (b.startsWith("# ")) out.title = b.slice(2).trim();
    else if (b.startsWith("## ")) {
      const m = b.slice(3).trim().match(/^(\d+)\.\s+(.*)$/);
      out.sections.push({ n: m ? m[1] : String(out.sections.length + 1), title: m ? m[2] : b.slice(3).trim(), paras: [] });
    } else if (!out.sections.length && /^Policy edition:/.test(b)) {
      out.editionLine = b;
      out.edition = (b.match(/Policy edition:\s*([^.]+)\./) || [])[1] || "";
    } else if (out.sections.length) out.sections[out.sections.length - 1].paras.push(b.replace(/\s*\n\s*/g, " "));
    else throw new Error(`legalDoc(${file}): text before the first section`);
  }
  return out;
}
