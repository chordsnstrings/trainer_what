// Static copy rules for Concept B: H1 <= 8 words and no colon, H2 <= 6 words,
// hero lede <= 25 words, FAQ answers <= 45 words, banned terms, "AI" owned.
// Usage: node tools/copy-check.cjs
const fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/g, "'").replace(/\s+/g, " ").trim();
const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const BANNED = [/seamless/i, /revolutionary/i, /cutting-edge/i, /\bunlock/i, /\bempower/i, /game-changing/i, /trusted by/i, /#1\b/, /guarantee(d)?\b/i, /passive income/i, /\b(OpenAI|GPT|Claude|Anthropic|Gemini|Llama|Mistral|Stripe Connect|Wise|Payoneer)\b/];
const out = [];
for (const f of fs.readdirSync(SITE).filter((x) => x.endsWith(".html")).sort()) {
  const s = fs.readFileSync(path.join(SITE, f), "utf8");
  const main = (s.match(/<main[\s\S]*<\/main>/) || [""])[0];
  for (const m of main.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)) { const t = strip(m[1]); if (words(t) > 8) out.push(`${f}: H1 ${words(t)} words "${t}"`); if (t.includes(":")) out.push(`${f}: H1 colon "${t}"`); }
  for (const m of main.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) { const t = strip(m[1]); if (words(t) > 6) out.push(`${f}: H2 ${words(t)} words "${t}"`); }
  for (const m of s.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g)) { const t = strip(m[1]); if (/\b(an|the) AI\b/i.test(t)) out.push(`${f}: heading AI not owned "${t}"`); }
  const hero = (main.match(/<section class="(page-hero|hero)[\s\S]*?<\/section>/) || [""])[0];
  for (const m of hero.matchAll(/<p class="lede[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) { const t = strip(m[1]); if (words(t) > 25) out.push(`${f}: hero lede ${words(t)} words`); }
  for (const m of main.matchAll(/<div class="acc-inner"><div>([\s\S]*?)<\/div><\/div>/g)) { const t = strip(m[1]); if (words(t) > 45) out.push(`${f}: FAQ answer ${words(t)} words "${t.slice(0, 50)}"`); }
  const text = strip(s.replace(/<head>[\s\S]*<\/head>/, ""));
  for (const b of BANNED) { const m = text.match(b); if (m) out.push(`${f}: banned "${m[0]}" …${text.slice(Math.max(0, m.index - 40), m.index + 40)}…`); }
  if (/Layla/.test(text) && !/Sample/.test(text)) out.push(`${f}: Layla without Sample label`);
  if (/<mark\b/.test(main)) out.push(`${f}: <mark> used`);
}
console.log(out.length ? out.join("\n") : "copy rules: clean");
