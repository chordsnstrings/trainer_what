/* The Brain showcases' trace data for one page: pure, no DOM, no network.
   The server render (render.ts) and the client mount call the same prepare(),
   so the first frame and the engine read the same data
   (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.3). */
import { index } from "./core.js";

/** Keys whose string values are identifiers or enum values, never shown as
    text. Every other string in the client copy is visible copy, and the trace
    test scans it (tests/marketing-brain-traces.test.ts). */
export const NON_TEXT_KEYS = Object.freeze([
  "format", "updated", "id", "kind", "crew", "icon", "status", "decide", "lane", "lang", "sp", "result", "basis",
  "by", "planMode", "flag", "onWhenFlag", "needs", "controls", "swapSpecialist",
]);
/** Fields only the trace test reads: code references, verification notes and
    the commit the traces were first checked against. */
const INTERNAL = ["code", "verify", "verbatim", "verbatimFrom", "verbatimRef", "fn", "basisCommit"];

const clone = (x) => (typeof structuredClone == "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
/** The data fields only (index() adds lookups, prepare() the flags). */
const dataOf = ({ sp, byId, trace, short, flags, ...data }) => data;
function strings(o, fn) {
  if (Array.isArray(o)) o.forEach((v, i) => (typeof v == "string" ? (o[i] = fn(v)) : strings(v, fn)));
  else if (o && typeof o == "object") for (const k in o) typeof o[k] == "string" ? (o[k] = fn(o[k])) : strings(o[k], fn);
}

/** The client copy of the canonical traces (traces.json → traces.client.json,
    scripts/brain-traces.mjs): no code references, file paths or notes. */
export function stripForClient(full) {
  const d = clone(dataOf(full));
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o == "object") for (const k of Object.keys(o)) INTERNAL.includes(k) ? delete o[k] : walk(o[k]);
  })(d);
  for (const t of d.traces) if (t.basis) delete t.basis.refs;
  return d;
}

/** The traces for one page: a deep copy (the input is never changed, so one
    render's name and flags never leak into the next), the platform name in
    place of {APP_NAME}, and the payments state. While subscriber payments are
    off, the status strip says so and "Try it on yourself" stays; once they
    are on, the strip goes and those items are live, each only with the flag
    it also needs (nutrition or voice). */
export function prepare(raw, o) {
  const d = clone(dataOf(raw)), f = o.flags;
  strings(d, (s) => s.split("{APP_NAME}").join(o.appName));
  if (f.payments) {
    delete d.labels.subscribers;
    for (const x of [...d.specialists, ...d.traces])
      if (x.status == "try_yourself" && (!x.needs || f[x.needs])) (x.status = "live"), delete x.statusTip;
  }
  d.flags = { ...f };
  return index(d);
}
