/* A moment's receipt: every step it took, its rule, how sure, what the
   member and the trainer see, and where it comes from. Opened from the
   field (inside its zoom on desktop) and the board; runtime only, reached
   through import("./receipt.js") from field.js.

   Ported from the approved prototype (docs/marketing-revamp-2026-10-26/
   prototypes/shared/brain/brain-anatomy.js, lines 1–156: open, slots,
   receiptHTML) with the changes of docs/marketing-revamp-2026-10-26/phase1/
   PLAN.md §1.1: the dialog and its backdrop mount in the overlay layer, not
   on <body>; the scroll lock is html.sc-lock, and closing (or the field's
   destroy) removes both nodes and the lock; the call to action comes from
   the options; streamed AI output reserves its final size. */
import "./receipt.css";
import * as C from "./core.js";
import { decide, defaults } from "./decide.js";
import * as U from "./ui.js";
const { esc } = C;

export const COPY = {
  heads: ["The message", "Step by step", "Your rule", "How sure", "What {name} sees", "What you see", "Where this comes from"],
  replay: "Replay", change: "Change this setting", back: "Back to the Brain", notReached: "Not reached · no AI called",
};

/* --------------------------------------------------------------- the plates */
/** Nine plates (a)–(i) for any trace: message, safety, topics, memory, rule
    finder, one specialist, checks after, lane, what they read. */
export function slots(d, t, r) {
  const S = r.steps, f = (sp) => S.find((s) => s.sp == sp);
  const nr = (k, name) => ({ k, name, kind: "check", state: "skip", say: COPY.notReached });
  const st = (k, s, name) => (!s ? { k, name, kind: "check", state: "skip", say: "Not part of this moment" }
    : s.result == "skipped" ? nr(k, name) : { k, name, kind: s.sp in d.sp ? d.sp[s.sp].kind : "check", state: s.result, say: s.say, detail: s.detail, basis: s.basis, step: s });
  const sp = S.find((s) => s.sp in d.sp && (d.sp[s.sp].kind == "ai" || s.sp == "set_logger" || s.sp == "recovery") && s.sp != "learner") || f("any_ai");
  const after = S.filter((s) => s.sp == "checker" || s.sp == "confidence"), lane = f("lane_gate");
  const floor = S.some((s) => s.sp == "safety" && s.result == "hit");
  return [
    { k: "a", name: "The message", kind: "msg", state: "read", say: t.trigger.text, lang: t.trigger.lang, gloss: t.trigger.gloss },
    st("b", f("safety"), "Safety rules"), st("c", f("topics"), "Your topics"), st("d", f("memory"), "Memory"), st("e", f("rule_finder"), "Rule finder"),
    sp && sp.sp != "any_ai" ? { ...st("f", sp, d.sp[sp.sp].name), pick: sp.sp } : { ...nr("f", "One specialist"), say: floor ? COPY.notReached : d.labels.noAi },
    after.length ? { k: "g", name: "Checks after", kind: "check", state: after.some((s) => s.result == "warn") ? "warn" : "pass", say: after.map((s) => s.say).join(" · ") } : floor ? nr("g", "Checks after") : { k: "g", name: "Checks after", kind: "check", state: "skip", say: "Not part of this moment" },
    { k: "h", name: "The lane", kind: "check", state: r.lane, say: lane ? lane.say : d.labels.lanes[r.lane], lane: r.lane },
    { k: "i", name: r.memberSees ? `What ${t.member} reads` : "What you see", kind: "msg", state: r.lane },
  ];
}
const LANE = { sent: "Sent on its own", waits: "Waits for you", paused: "Training paused", member: "The member confirms", learn: "New rule" };
const plateHTML = (p, i) => `<div class="ba-plate" data-k="${p.k}" data-kind="${p.kind}" data-state="${p.state}" style="--i:${i}">` +
  `<div class="ba-ph"><span class="ba-l">(${p.k})</span><b>${esc(p.name)}</b>${p.lane ? `<span class="sc-lane" data-lane="${p.lane}">${esc(LANE[p.lane])}</span>` : ""}</div></div>`;

/* --------------------------------------------------------------- the receipt */
/** The flat receipt: seven sections, any trace (SHOWCASE_DESIGN.md §2 "Interactions"). */
export function receiptHTML(d, t, r, o = {}) {
  const H = COPY.heads, ai = r.steps.findIndex((s) => s.sp in d.sp && d.sp[s.sp].kind == "ai" && s.sp != "learner");
  const hit = r.steps.find((s) => s.sp == "safety" && s.result == "hit"), dir = t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : "";
  let msg = esc(t.trigger.text);
  if (hit) for (const w of hit.highlight || []) msg = msg.split(esc(w)).join(`<mark class="bp-hl">${esc(w)}</mark>`);
  const s = (i, body) => `<section class="ba-sec"><h3>${esc(H[i].replace("{name}", t.member))}</h3>${body}</section>`;
  const picked = r.steps.find((x) => x.sp in d.sp && d.sp[x.sp].kind == "ai");
  return `<header class="ba-rh"><div><b id="${esc(o.id)}">${esc(t.member)} · ${esc(t.chip)}</b><span>${esc(t.when)} · sample</span></div>${U.lane(d, r.lane)}${hit ? `<span class="ba-stop">STOP · No AI called</span>` : ""}</header>` +
    U.strip(d) +
    s(0, `<div class="bp-msg ba-msg"><p class="bp-mt"${dir}>${msg}</p>${t.trigger.gloss ? `<p class="bp-gloss">${esc(t.trigger.gloss)}</p>` : ""}</div>`) +
    s(1, `<ol class="ba-steps">${r.steps.map((x, i) => (i == ai ? `<li class="sc-step bp-picks">${esc(d.labels.picks)}</li>` : "") + U.stepRow(d, t, x, { stream: o.stream })).join("")}</ol>`) +
    s(2, U.rule(t) || `<p class="sc-sure-n">No rule needed for this moment.</p>`) +
    s(3, U.sure(d, t, r) + (r.note && !(t.sureNote || "").includes(r.note) ? `<p class="ba-note">${esc(r.note)}</p>` : "")) +
    s(4, U.phone(d, t, r).replace(/<figcaption>.*?<\/figcaption>/, "")) +
    s(5, U.today(d, t, r) || `<p class="sc-sure-n">No Today card.</p>`) +
    s(6, `<p>${esc(t.basis.note)}</p><p><span class="sc-sample">${esc(d.labels.status[t.status])}</span> ${esc((picked && d.sp[picked.sp].statusTip) || t.statusNote || "")}</p><p class="ba-note">${esc(d.labels.long)}</p>`);
}
/** The buttons under a receipt: Replay, Change this setting (the field only), the call to action, back. */
const buttons = (o) => `<div class="ba-btns"><button type="button" class="bp-btn" data-a="replay">${U.icon("rotate-ccw")}${esc(COPY.replay)}</button>` +
  (o.onChange ? `<button type="button" class="bp-btn" data-a="change">${U.icon("sliders-horizontal")}${esc(COPY.change)}</button>` : "") +
  `${U.cta(o)}<button type="button" class="bp-btn" data-a="back">${esc(COPY.back)}</button></div>`;

/** Tab and Shift+Tab cycle through the box's controls, wherever focus is:
    from its heading (the first focus), or from outside, they go to the
    first or the last control. */
function trap(box, e) {
  const f = [...box.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"], summary')].filter((x) => x.offsetParent);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement), n = f.length;
  e.preventDefault();
  f[e.shiftKey ? (i <= 0 ? n - 1 : i - 1) : (i + 1) % n].focus();
}
/** Makes everything outside the overlay layer inert (the layer's ancestors'
    other children): the page behind a modal is out of reach, for focus,
    the pointer and assistive tech. Returns the undo. */
function inertOutside(el) {
  const set = [];
  for (let n = el; n.parentElement && n.parentElement != document.documentElement; n = n.parentElement)
    for (const s of n.parentElement.children) if (s != n && !s.inert && s.tagName != "SCRIPT") s.inert = true, set.push(s);
  return () => set.forEach((s) => (s.inert = false));
}
let openOne = null, seq = 0;
/** Opens a moment's receipt: open(traceId, {d, settings, from (DOMRect), mount,
    layer, id, cta, onChange, onClose}). In `mount` (the field's zoom, desktop)
    it lies inline; otherwise a dialog, or on phones an 85% bottom sheet, in
    the overlay layer over a backdrop. The nine plates burst for 600 ms, then
    lie flat as the receipt. Returns {el, trace, close(quiet)}. */
export function open(id, o) {
  const d = o.d, t = d.trace(id), r = decide(t, o.settings || defaults(d), d);
  if (openOne) openOne.close(true);
  const RM = C.reduced(), inline = !!o.mount, sheet = !inline && C.phone(), opener = document.activeElement, hid = `${o.id}-rx${++seq}`;
  const box = C.h("div.ba-sheet.sc-stage", { role: "dialog", "aria-modal": inline ? null : "true", "aria-labelledby": hid, "data-showcase": "receipt", "data-mode": inline ? "inline" : sheet ? "sheet" : "modal" });
  const back = inline ? null : C.h("div.ba-back", { on: { click: () => api.close() } });
  box.innerHTML = `<div class="ba-burst" aria-hidden="true"><div class="ba-stack">${slots(d, t, r).map(plateHTML).join("")}</div></div>` +
    `<div class="ba-receipt">${receiptHTML(d, t, r, { stream: !RM, id: hid })}${buttons(o)}</div>`;
  // Streamed output keeps its final size: the full text holds the box, the live copy streams over it.
  const outs = [...box.querySelectorAll(".sc-out[data-full]")].map((p) => {
    p.innerHTML = `<span class="ba-of">${esc(p.dataset.full)}</span><span class="ba-ol"></span>`;
    return [p.lastElementChild, p.dataset.full];
  });
  const host = o.mount || o.layer;
  if (back) host.append(back);
  host.append(box);
  // A dialog or sheet is modal: the page behind is inert and scroll-locked, and Esc and Tab are its own.
  const undo = inline ? null : inertOutside(o.layer);
  if (!inline) document.documentElement.classList.add("sc-lock");
  if (o.from && !RM && !sheet && !inline) {
    const b = box.getBoundingClientRect(), f = o.from;
    box.style.transformOrigin = `${f.left + f.width / 2 - b.left}px ${f.top + f.height / 2 - b.top}px`;
  }
  const sc = C.scene(box, { idle: 0 });
  let tl = null, closed = false;
  const play = () => {
    if (tl) tl.stop();
    box.classList.remove("is-flat", "is-boom");
    tl = C.timeline(sc);
    tl.at(30, () => box.classList.add("is-boom")).at(RM ? 0 : 800, () => box.classList.add("is-flat"));
    let at = 1100;
    for (const [el, txt] of outs) {
      tl.span(at, (txt.length / 40) * 1000, U.streamer(el, txt));
      at += 300;
    }
    tl.play();
    if (RM) tl.skip();
  };
  // Inline, the box hears its keys; modal, the document does (first, in the capture phase), so Esc
  // closes it from anywhere, and only it, and Tab never leaves it.
  const key = (e) => {
    if (e.key == "Escape") inline || e.stopPropagation(), api.close();
    else if (e.key == "Tab" && !inline) trap(box, e);
  };
  (inline ? box : document).addEventListener("keydown", key, !inline);
  box.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]");
    if (!a) return;
    if (a.dataset.a == "replay") play();
    if (a.dataset.a == "back") api.close();
    if (a.dataset.a == "change") { api.close(); o.onChange(t); }
  });
  const api = {
    el: box, trace: t,
    close(quiet) {
      if (closed) return;
      closed = true;
      if (tl) tl.stop();
      sc.destroy(); box.remove(); back && back.remove();
      if (!inline) document.removeEventListener("keydown", key, true), undo(), document.documentElement.classList.remove("sc-lock");
      if (openOne == api) openOne = null;
      // the opener's side first (the field's zoom lifts its inert parts), then focus goes back to it
      o.onClose && o.onClose();
      if (!quiet && opener && opener.isConnected && opener.focus) opener.focus();
    },
  };
  openOne = api;
  requestAnimationFrame(() => {
    if (closed) return;
    box.classList.add("is-in");
    back && back.classList.add("is-in");
    const head = box.querySelector("#" + CSS.escape(hid));
    head.setAttribute("tabindex", "-1");
    head.focus({ preventScroll: true });
  });
  play();
  C.say(`${t.member}: ${t.chip}. ${d.labels.lanes[r.lane]}.`);
  return api;
}
