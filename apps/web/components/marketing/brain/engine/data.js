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
    place of {APP_NAME}, and every status as the page's flags make it:
    - not on yet: whatever needs a flag that is off (nutrition, meal photos,
      voice) and, while the AI model is off, every specialist that uses it
      and every moment one of them plays;
    - otherwise "Try it on yourself" until trainers can publish to
      subscribers (publish: sign-ups, subscriber payments and the model, as
      PUBLISH_GATES), live once they can. Until then the status strip says
      why subscribers can't join: payments while they are off (and, with the
      model, that the rest runs in Try my AI), else publishing.
    A missing model flag counts as on, a missing publish flag as payments and
    the model: showcaseOptions() always passes both. */
export function prepare(raw, o) {
  const d = clone(dataOf(raw)), f = o.flags, noModel = f.model === false, publish = f.publish ?? (!!f.payments && !noModel);
  strings(d, (s) => s.split("{APP_NAME}").join(o.appName));
  const ai = new Set(d.specialists.filter((s) => s.kind == "ai" || s.usesAi).map((s) => s.id));
  const off = (x, sps) => (x.needs && !f[x.needs]) || (noModel && sps.some((sp) => ai.has(sp)));
  for (const x of [...d.specialists, ...d.traces]) {
    if (x.status == "not_on_yet") continue;
    if (off(x, x.steps ? x.steps.map((s) => s.sp) : [x.id])) (x.status = "not_on_yet"), delete x.statusTip;
    else if (publish && x.status == "try_yourself") (x.status = "live"), delete x.statusTip;
  }
  const L = d.labels;
  if (publish) delete L.subscribers;
  else if (f.payments) L.subscribers = L.subscribersNoPublish;
  else if (noModel) L.subscribers = L.subscribersNoModel;
  delete L.subscribersNoModel, delete L.subscribersNoPublish;
  d.flags = { ...f };
  return index(d);
}
