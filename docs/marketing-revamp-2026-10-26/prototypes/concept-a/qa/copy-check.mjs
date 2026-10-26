// Copy budgets (C0): H1 <= 8 words, no colon; H2 <= 6 words; lede <= 25 words; banned terms.
import { readdirSync, readFileSync } from "node:fs";
const SITE = new URL("../site/", import.meta.url).pathname;
const strip = (s) => s.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, "'").replace(/\s+/g, " ").trim();
const words = (s) => s.split(" ").filter((w) => /[A-Za-z0-9]/.test(w)).length;
const BANNED = /\b(seamless|revolutionary|cutting-edge|unlock|empower|game-changing|trusted by|#1|guaranteed|passive income)\b/i;
let n = 0;
for (const f of readdirSync(SITE).filter((x) => x.endsWith(".html")).sort()) {
  const html = readFileSync(SITE + f, "utf8");
  const main = html.split('<main id="main"')[1]?.split("</main>")[0] || "";
  for (const m of main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)) { const t = strip(m[1]); if (words(t) > 8 || t.includes(":")) { n++; console.log("H1", f, words(t), t); } }
  for (const m of main.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)) { const t = strip(m[1]); if (words(t) > 6) { n++; console.log("H2", f, words(t), t); } }
  for (const m of main.matchAll(/<p class="lede"[^>]*>([\s\S]*?)<\/p>/g)) { const t = strip(m[1]); if (words(t) > 25) { n++; console.log("LEDE", f, words(t), t.slice(0, 80)); } }
  const text = strip(main.replace(/<script[\s\S]*?<\/script>/g, ""));
  const b = text.match(BANNED); if (b) { n++; console.log("BANNED", f, b[0], text.slice(Math.max(0, b.index - 60), b.index + 40)); }
  if (/\bthe AI\b/.test(strip((main.match(/<h[1-3]\b[\s\S]*?<\/h[1-3]>/g) || []).join(" ")))) { n++; console.log("THE-AI heading", f); }
}
console.log("copy issues:", n);
