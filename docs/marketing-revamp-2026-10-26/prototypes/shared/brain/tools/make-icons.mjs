// Extracts the lucide icons the showcase uses (ISC licence) into icon data.
import { existsSync } from "node:fs";
const DIR = "/home/user/trainer_what/node_modules/lucide-react/dist/esm/icons/";
const ALIAS = { "message-circle-question": ["message-circle-question-mark"] };
const out = {};
for (const n of process.argv.slice(2)) {
  const f = (ALIAS[n] || [n]).map((x) => DIR + x + ".mjs").find(existsSync);
  if (!f) { console.error("missing", n); continue; }
  const m = await import(f).catch((e) => ({ err: e }));
  let node = m.__iconData && m.__iconData.node;
  if (!node) { console.error("no data", n, Object.keys(m)); continue; }
  out[n] = node.map(([tag, a]) => "<" + tag + Object.entries(a).filter(([k]) => k != "key").map(([k, v]) => ` ${k}="${v}"`).join("") + "/>").join("");
}
console.log(JSON.stringify(out));
