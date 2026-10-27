/* trainsyou Brain showcase · "Anatomy of a decision" (spec §4).
   open(id, o)  receipt mode for any trace (A's zoom, phone sheet, C);
   stack(el, o) C's exploded 3D stack driven by progress(p) or intro();
   fig(el, o)   Fig. 4 flat plates with the three What-if replays. */
import * as Core from "./brain-core.js";
import * as Dec from "./brain-decide.js";
const B = { ...Core, ...Dec };
import * as U from "./brain-ui.js";
const { esc } = B;

export const COPY = {
  heads: ["The message", "Step by step", "Your rule", "How sure", "What {name} sees", "What you see", "Where this comes from"],
  replay: "Replay", change: "Change this setting", back: "Back to the Brain", cta: "Teach your AI — free",
  fig3: "Fig. 3 — Omar asks to go up in weight. Sample, scripted, no AI model called.",
  card: ["Answered Omar", "Sent on its own, within your rules"],
  whatIf: [["knee", "What if his knee popped?"], ["plan", "What if it's a plan change?"], ["level1", "What if you're at level 1?"]],
  notReached: "Not reached · no AI called", ghosts: "Meanwhile, other members' moments run at the same time. One specialist each.",
  correction: ["Upper body increments", "Confirmed", "About a minute later: check passed · live"],
};
/* C's margin notes for Omar's reply (spec §6 C), (a)–(j). */
export const NOTES = {
  a: ["The message", "Omar logged four sets with 2 reps in reserve. He asks to go up."],
  b: ["Safety rules", "Read first, every time. Pain or red flags stop here. Nine kinds, in English and Arabic."],
  c: ["Your topics", "Topics you chose to answer yourself, like supplements. Not this one."],
  d: ["Memory", "His intake and his last 28 days of training. Facts from your app only."],
  e: ["Rule finder", "Which approved replies fit? One: +2.5 kg. That's 4.2%, inside your 5% cap."],
  f: ["One specialist", "Seven coaching specialists. One is not on yet. Code picks one from the kind of moment. A rule fits, so it's the Reply picker. It picks. It never writes."],
  g: ["Checks after", "Does it cite your rule? Only facts it was shown? Nothing changed meanwhile? All pass."],
  h: ["The lane", "Your Brain is at level 2 and passed its last check. So it sends on its own."],
  i: ["What Omar reads", "Your words, plus one line of numbers from your rule. No AI wording."],
  j: ["Your correction", "Edit any reply. Your AI suggests a rule. You confirm. About a minute later, your AI answers your test cases and code marks them. It goes live only if they pass."],
};
const ARC = [["reply_picker", "a rule fits"], ["draft_writer", "no rule fits"], ["plan_writer", "new plan"], ["week_reviewer", "week ends"], ["meal_photo", "meal photo"], ["voice_lines", "before a voice session"], ["meal_planner", "Not on yet"]];
const L = "abcdefghij";

/* --------------------------------------------------------------- the nine plates */
/** Nine slot plates (a)–(i) for any trace: message, safety, topics, memory,
    rule finder, one specialist, checks after, lane, what they read. */
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
    { k: "i", name: r.memberSees ? `What ${t.member} reads` : "What you see", kind: "msg", state: r.lane, html: r.memberSees ? `<div class="ph-msg">${r.memberSees.parts.map(U.marks).join(" ")}</div>` : U.today(d, t, r) },
  ];
}
const plateHTML = (p, o = {}) => `<div class="ba-plate" data-k="${p.k}" data-kind="${p.kind}" data-state="${p.state}"${o.i != null ? ` style="--i:${o.i}"` : ""}>` +
  `<div class="ba-ph"><span class="ba-l">(${p.k})</span><b>${esc(p.name)}</b>${p.lane ? `<span class="sc-lane" data-lane="${p.lane}">${esc(p.lane == "sent" ? "Sent on its own" : p.lane == "waits" ? "Waits for you" : p.lane == "paused" ? "Training paused" : p.lane == "member" ? "The member confirms" : "New rule")}</span>` : ""}</div>` +
  `<div class="ba-pb">${p.html || `<p${p.lang == "ar" ? ' dir="rtl" lang="ar"' : ""}>${o.hl ? o.hl : esc(p.say)}</p>`}${p.gloss ? `<p class="ba-gloss">${esc(p.gloss)}</p>` : ""}${p.detail ? `<ul>${p.detail.map((x, n) => `<li style="--n:${n}">${esc(x)}</li>`).join("")}</ul>` : ""}</div></div>`;

/* --------------------------------------------------------------- receipt mode */
/** The flat receipt: seven sections, any trace (spec §2 "Receipt sections"). */
export function receiptHTML(d, t, r, o = {}) {
  const H = COPY.heads, ai = r.steps.findIndex((s) => s.sp in d.sp && d.sp[s.sp].kind == "ai" && s.sp != "learner");
  const hit = r.steps.find((s) => s.sp == "safety" && s.result == "hit"), dir = t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : "";
  let msg = esc(t.trigger.text);
  if (hit) for (const w of hit.highlight || []) msg = msg.split(esc(w)).join(`<mark class="bp-hl">${esc(w)}</mark>`);
  const s = (i, body) => `<section class="ba-sec"><h3>${esc(H[i].replace("{name}", t.member))}</h3>${body}</section>`;
  const status = d.labels.status[t.status];
  return `<header class="ba-rh"><div><b id="${o.id || "ba-t"}">${esc(t.member)} · ${esc(t.chip)}</b><span>${esc(t.when)} · sample</span></div>${U.lane(d, r.lane)}${hit ? `<span class="ba-stop">STOP · No AI called</span>` : ""}</header>` +
    U.strip(d) +
    s(0, `<div class="bp-msg ba-msg"><p class="bp-mt"${dir}>${msg}</p>${t.trigger.gloss ? `<p class="bp-gloss">${esc(t.trigger.gloss)}</p>` : ""}</div>`) +
    s(1, `<ol class="ba-steps">${r.steps.map((x, i) => (i == ai ? `<li class="sc-step bp-picks">${esc(d.labels.picks)}</li>` : "") + U.stepRow(d, t, x, { stream: o.stream })).join("")}</ol>`) +
    s(2, U.rule(t) || `<p class="sc-sure-n">No rule needed for this moment.</p>`) +
    s(3, U.sure(d, t, r) + (r.note && !(t.sureNote || "").includes(r.note) ? `<p class="ba-note">${esc(r.note)}</p>` : "")) +
    s(4, U.phone(d, t, r).replace(/<figcaption>.*?<\/figcaption>/, "")) +
    s(5, U.today(d, t, r) || `<p class="sc-sure-n">No Today card.</p>`) +
    s(6, `<p>${esc(t.basis.note)}</p><p><span class="sc-sample">${esc(status)}</span> ${esc(d.sp[U_pick(d, r)]?.statusTip || t.statusNote || "")}</p><p class="ba-note">${esc(d.labels.long)}</p>`);
}
const U_pick = (d, r) => (r.steps.find((s) => s.sp in d.sp && d.sp[s.sp].kind == "ai") || {}).sp;
function trap(box, e) {
  if (e.key != "Tab") return;
  const f = [...box.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"], summary')].filter((x) => x.offsetParent);
  if (!f.length) return;
  const a = f[0], z = f[f.length - 1];
  if (e.shiftKey && document.activeElement == a) e.preventDefault(), z.focus();
  else if (!e.shiftKey && document.activeElement == z) e.preventDefault(), a.focus();
}
let openOne = null, seq = 0;
/** Receipt mode: open(traceId, {from: DOMRect, mount, settings, cta, onChange, onClose}).
    Desktop: a panel (inline in `mount`, else a modal); phones: an 85% bottom sheet.
    600 ms explode of the nine plates, then they lie flat as the receipt. */
export async function open(id, o = {}) {
  const d = await B.load(o.src), t = d.trace(id), S = o.settings || B.defaults(d), r = B.decide(t, S, d);
  if (openOne) openOne.close(true);
  const RM = B.reduced(), sheet = !o.mount && B.phone(), opener = document.activeElement, hid = "ba-h" + ++seq;
  const box = B.h("div.ba-sheet.sc-stage", { role: "dialog", "aria-modal": o.mount ? null : "true", "aria-labelledby": hid, "data-showcase": "receipt", "data-mode": o.mount ? "inline" : sheet ? "sheet" : "modal" });
  const back = o.mount ? null : B.h("div.ba-back", { on: { click: () => api.close() } });
  const plates = slots(d, t, r);
  box.innerHTML = `<div class="ba-burst" aria-hidden="true"><div class="ba-stack">${plates.map((p, i) => plateHTML(p, { i })).join("")}</div></div>` +
    `<div class="ba-receipt">${receiptHTML(d, t, r, { stream: !RM, id: hid })}<div class="ba-btns">` +
    `<button type="button" class="bp-btn" data-a="replay">${U.icon("rotate-ccw")}${esc(COPY.replay)}</button>` +
    (o.onChange ? `<button type="button" class="bp-btn" data-a="change">${U.icon("sliders-horizontal")}${esc(COPY.change)}</button>` : "") +
    `<a class="bp-btn bp-btn-p" href="${esc(o.cta || "signup.html")}">${esc(COPY.cta)}</a><button type="button" class="bp-btn" data-a="back">${esc(COPY.back)}</button></div></div>`;
  if (back) document.body.append(back);
  (o.mount || document.body).append(box);
  if (!o.mount) document.documentElement.classList.add("ba-lock");
  if (o.from && !RM && !sheet && !o.mount) {
    const b = box.getBoundingClientRect(), f = o.from;
    box.style.transformOrigin = `${f.left + f.width / 2 - b.left}px ${f.top + f.height / 2 - b.top}px`;
  }
  const sc = B.scene(box, { idle: 0 });
  let tl = null;
  const play = () => {
    if (tl) tl.stop();
    box.classList.remove("is-flat", "is-boom");
    box.querySelectorAll(".sc-out[data-full]").forEach((p) => (p.textContent = ""));
    tl = B.timeline(sc);
    tl.at(30, () => box.classList.add("is-boom")).at(RM ? 0 : 800, () => box.classList.add("is-flat"));
    let at = 1100;
    box.querySelectorAll(".sc-out[data-full]").forEach((p) => {
      const txt = p.dataset.full, f = U.streamer(p, txt);
      tl.span(at, (txt.length / 40) * 1000, f);
      at += 300;
    });
    tl.play();
    if (RM) tl.skip();
  };
  const onKey = (e) => { if (e.key == "Escape") api.close(); else if (!o.mount) trap(box, e); };
  box.addEventListener("keydown", onKey);
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
      if (tl) tl.stop();
      sc.destroy(); box.remove(); back && back.remove();
      document.documentElement.classList.remove("ba-lock");
      openOne = null;
      if (!quiet && opener && opener.focus) opener.focus();
      o.onClose && o.onClose();
    },
  };
  openOne = api;
  requestAnimationFrame(() => { box.classList.add("is-in"); box.querySelector("#" + hid).setAttribute("tabindex", "-1"); box.querySelector("#" + hid).focus({ preventScroll: true }); });
  play();
  B.say(`${t.member}: ${t.chip}. ${d.labels.lanes[r.lane]}.`);
  return api;
}

/* --------------------------------------------------------------- C: the 3D stack */
const P = 1600, RX = 56, RZ = -32, GAP = 56;
/** C's anatomy: stack(el, {trace: "t1", notes: NOTES, onWhatIf}) → {intro(), progress(p), layout(), destroy()}.
    Desktop: CSS 3D plates, leader anchors projected in JS (no rect reads in the
    scroll loop). Phones (or o.flat): 2D fan-out, notes inline. */
export async function stack(el, o = {}) {
  const d = await B.load(o.src), t = d.trace(o.trace || "t1"), S = o.settings || B.defaults(d), r = B.decide(t, S, d);
  const notes = o.notes || NOTES, plates = slots(d, t, r), flat = o.flat != null ? o.flat : B.phone(), RM = B.reduced();
  const ghosts = [["Aisha", "week_reviewer"], ["Priya", "meal_photo"], ["Noura", "safety"]];
  el.classList.add("ba");
  el.dataset.view = flat ? "flat" : "3d";
  if (!el.hasAttribute("data-showcase")) el.setAttribute("data-showcase", "anatomy");
  el.innerHTML = `<div class="ba-stage sc-stage"><div class="ba-cam"><div class="ba-stack">${plates.map((p, i) => plateHTML(p, { i })).join("")}` +
    `<div class="ba-plate ba-j" data-k="j" data-kind="ai" data-state="lit" style="--i:-1.4"><div class="ba-ph"><span class="ba-l">(j)</span><b>${esc(COPY.correction[0])}</b><span class="ba-stampj">${esc(COPY.correction[1])}</span></div><div class="ba-pb"><p>${esc(COPY.correction[2])}</p></div></div></div>` +
    `<div class="ba-ghosts" aria-hidden="true">${ghosts.map(([n, sp]) => `<div class="ba-ghost" data-sp="${sp}"><span>${n}</span>${["msg", "check", sp, "lane"].map((k) => `<i data-on="${k == sp || (sp == "safety" && k == "check") ? 1 : 0}"${sp == "safety" && k == "check" ? ' data-red="1"' : ""}></i>`).join("")}</div>`).join("")}</div></div>` +
    `<div class="ba-card"><b>${esc(COPY.card[0])}</b>${U.lane(d, r.lane)}</div>` +
    `<div class="ba-arc" aria-hidden="true"><span class="ba-tag">Chat · a rule fits</span>${ARC.map(([sp, m], i) => `<span class="ba-pill" data-sp="${sp}" style="--a:${i}"${sp == "meal_planner" ? " data-off" : ""}><b>${esc(d.sp[sp].name)}</b>${esc(m)}</span>`).join("")}<span class="ba-picks">${esc(d.labels.picks)}</span></div>` +
    `<div class="ba-foot"><p class="ba-cap">${esc(COPY.fig3)}</p>${U.strip(d)}</div><div class="ba-whatif" hidden>${COPY.whatIf.map(([k, l]) => `<button type="button" class="bp-btn" data-w="${k}">${esc(l)}</button>`).join("")}</div></div>` +
    `<ol class="ba-notes">${L.split("").map((k) => `<li data-k="${k}"><span class="ba-l">(${k})</span> <b>${esc(notes[k][0])}</b> ${esc(notes[k][1])}${k == "f" ? `<em>${esc(d.labels.picks)}</em><small>${esc(COPY.ghosts)}</small>` : ""}</li>`).join("")}</ol>` +
    `<svg class="ba-lead" aria-hidden="true"></svg>`;
  const $ = (s) => el.querySelector(s), stg = $(".ba-stage"), stk = $(".ba-stack"), cam = $(".ba-cam"), svg = $(".ba-lead");
  const pl = [...el.querySelectorAll(".ba-stack .ba-plate:not(.ba-j)")], pj = $(".ba-j"), nl = [...el.querySelectorAll(".ba-notes li")];
  [...pl, pj].forEach((n, k) => n.insertAdjacentHTML("beforeend", `<p class="ba-pn">${esc(notes[L[k]][1])}</p>`)); // flat view: notes sit on their plates
  el.querySelector(".ba-whatif").addEventListener("click", (e) => { const b = e.target.closest("[data-w]"); if (b && o.onWhatIf) o.onWhatIf(b.dataset.w); });
  let G = null, cur = { e: 0, i: -1, q: 0 };
  const reason = (pl[5].querySelector(".ba-pb p") || {}), full = (plates[5].step && plates[5].step.out && plates[5].step.out.reason) || plates[5].say;
  function layout() {
    const a = el.getBoundingClientRect(), s = stg.getBoundingClientRect();
    G = { jy: 0, ox: s.left - a.left + s.width / 2, oy: s.top - a.top + s.height / 2, w: pl[0].offsetWidth, top: pl.map((n) => n.offsetTop - pl[0].offsetTop), notes: nl.map((n) => { const b = n.getBoundingClientRect(); return [b.left - a.left - 6, b.top - a.top + 10]; }) };
    svg.setAttribute("viewBox", `0 0 ${a.width} ${a.height}`);
    svg.innerHTML = nl.map(() => `<path/>`).join("");
    render();
  }
  /** Project a plate-local point through rotateX(56) rotateZ(-32), camera scale and perspective 1600. */
  function project(x, y, z, sc) {
    const m = new DOMMatrix().rotate(RX, 0, 0).rotate(0, 0, RZ), p = m.transformPoint(new DOMPoint(x, y, z));
    const k = 1 / (1 - p.z / P);
    return [G.ox + sc * p.x * k, G.oy + G.jy + sc * p.y * k];
  }
  // pure state from p (see the scroll-step table in spec §4)
  function at(p) {
    if (flat) { const i = p < 0.1 ? -1 : Math.min(9, Math.floor((p - 0.1) / 0.15) * 2); return { e: 1, i, q: ((p - 0.1) / 0.15) % 1, j: p >= 0.85, end: p >= 0.95 }; }
    const e = p < 0.9 ? 1 : 1 - (p - 0.9) / 0.1;
    const i = p >= 0.06 && p < 0.78 ? Math.floor((p - 0.06) / 0.08) : -1;
    return { e, i, q: i >= 0 ? ((p - 0.06) / 0.08) % 1 : 0, j: p >= 0.78 && p < 0.9 ? (p - 0.78) / 0.12 : p >= 0.9 ? 1 : 0, end: p >= 0.9 };
  }
  function render() {
    const { e, i, q, j, end } = cur, f = i >= 0 ? B.clamp(Math.min(q / 0.2, (1 - q) / 0.15), 0, 1) : 0; // flatness of the inspected plate
    el.style.setProperty("--e", e.toFixed(3));
    el.classList.toggle("is-end", !!end);
    $(".ba-whatif").hidden = !end;
    const ghost = i == 5 ? f : 0, lift = i == 5 ? -150 : -30, jy = flat ? 0 : 30 * Math.min(1, j * 2) * e;
    el.style.setProperty("--jy", jy.toFixed(1) + "px");
    if (G) G.jy = jy;
    cam.style.transform = flat ? "" : `scale(${(1 - 0.12 * ghost - 0.06 * Math.min(1, j * 2) * e).toFixed(3)})`;
    el.style.setProperty("--g", ghost.toFixed(3));
    pl.forEach((n, k) => {
      const z = (4 - k) * GAP * e, me = k == i;
      n.classList.toggle("is-on", me);
      n.style.opacity = i >= 0 && !me ? 0.35 : 1;
      if (flat) { n.style.transform = G && e < 1 ? `translateY(${(-G.top[k] * (1 - e)).toFixed(1)}px)` : ""; n.style.opacity = i >= 0 && !(k == i || k == i + 1) ? 0.45 : 1; return; }
      n.style.transform = me ? `rotateZ(${(32 * f).toFixed(2)}deg) rotateX(${(-56 * f).toFixed(2)}deg) translate3d(0px, ${(lift * f).toFixed(1)}px, ${(z + (140 - z) * f).toFixed(1)}px)` : `translateZ(${z.toFixed(1)}px)`;
      n.style.setProperty("--q", me ? q.toFixed(3) : 0);
    });
    if (pj) { pj.style.display = flat && !j ? "none" : ""; pj.style.opacity = j ? Math.min(1, j * 3) * (end ? e : 1) : 0; pj.style.transform = flat ? "" : `translateZ(${(5 * GAP * e + (1 - Math.min(1, j * 2)) * 260).toFixed(1)}px)`; pj.classList.toggle("is-stamped", j > 0.45); pj.classList.toggle("is-live", j > 0.75); }
    if (i == 5 && reason.textContent != null) reason.textContent = full.slice(0, Math.round(full.length * B.clamp((q - 0.15) / 0.6, 0, 1))) || " ";
    el.querySelector(".ba-arc").style.opacity = i == 5 ? f : 0;
    el.style.setProperty("--fq", i == 5 ? B.clamp((q - 0.1) / 0.3, 0, 1).toFixed(3) : 0);
    nl.forEach((n, k) => n.toggleAttribute("data-on", k == i || (k == 9 && j > 0)));
    if (!G || flat) return;
    // leader lines: projected plate anchors → note; the inspected one bright, at most 2 animating
    const paths = svg.children;
    for (let k = 0; k < 10; k++) {
      const pth = paths[k];
      if (!pth) continue;
      if (k == 9 ? !j || end : e < 0.98 || end) { pth.setAttribute("d", ""); continue; }
      const z = k == 9 ? 5 * GAP * e : (4 - k) * GAP * e, me = k == i;
      const a = me ? [G.ox + G.w / 2 * (1 + 0.08 * f), G.oy + lift * f] : project(G.w / 2, 0, z, 1 - 0.12 * ghost);
      const b = G.notes[k];
      pth.setAttribute("d", `M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${(b[0] - 24).toFixed(1)} ${b[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
      pth.setAttribute("class", me || (k == 9 && j) ? "is-on" : "");
    }
  }
  const api = {
    el, layout,
    /** Pure function of p in [0, 1]. */
    progress(p) { if (introTl) introTl.stop(), (introTl = null); cur = at(B.clamp(p, 0, 1)); render(); },
    /** One-time 1.2 s burst from the card (0.9 s fan-out on phones). Resolves when done. */
    intro() {
      if (RM) { cur = at(0); render(); return Promise.resolve(); }
      const sc = B.scene(el, { idle: 0 }), dur = flat ? 900 : 1200;
      introTl = B.timeline(sc);
      cur = { e: 0, i: -1, q: 0, j: 0, end: 0 }; render();
      introTl.span(0, dur, (k) => { cur = { ...cur, e: B.ease.out(k) }; render(); if (k >= 1) sc.destroy(); });
      return introTl.play();
    },
    destroy() { ro.disconnect(); el.innerHTML = ""; },
  };
  let introTl = null;
  const ro = new ResizeObserver(layout);
  ro.observe(el);
  cur = at(o.p != null ? o.p : 0);
  if (RM) el.dataset.view = "flat";
  layout();
  return api;
}

/* --------------------------------------------------------------- Fig. 4 */
/** Fig. 4 "Try another moment": flat plates + What-if buttons (2.4 s replays). */
export async function fig(el, o = {}) {
  const d = await B.load(o.src), base = o.settings || B.defaults(d);
  const make = (k) => {
    const t = d.trace(k == "knee" ? "t2" : k == "plan" ? "t8" : "t1"), s = k == "level1" ? { ...base, level: 1 } : base;
    return { t, r: B.decide(t, s, d) };
  };
  const draw = (k) => {
    const { t, r } = make(k), hit = r.steps.find((s) => s.sp == "safety" && s.result == "hit");
    return slots(d, t, r).map((p) => plateHTML(p, p.k == "b" && hit ? { hl: `<span class="ba-stopw">STOP · No AI called</span> ${(hit.highlight || []).map((w) => `<mark class="bp-hl">${esc(w)}</mark>`).join(" · ")}` } : {}));
  };
  el.classList.add("ba-fig");
  if (!el.hasAttribute("data-showcase")) el.setAttribute("data-showcase", "fig");
  el.innerHTML = `<div class="ba-figw" role="group" aria-label="Try another moment">${COPY.whatIf.map(([k, l]) => `<button type="button" class="bp-btn" data-w="${k}" aria-pressed="false">${esc(l)}</button>`).join("")}<button type="button" class="bp-btn" data-w="base" aria-pressed="true">Omar's reply</button></div><div class="ba-flat">${draw("base").join("")}</div><p class="sc-sr" aria-live="polite"></p>`;
  const box = el.querySelector(".ba-flat"), live = el.querySelector("[aria-live]"), sc = B.scene(el, { idle: 0 });
  let tl = null;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]");
    if (!b) return;
    el.querySelectorAll("[data-w]").forEach((x) => x.setAttribute("aria-pressed", String(x == b)));
    const next = draw(b.dataset.w), now = [...box.children];
    if (tl) tl.stop();
    tl = B.timeline(sc);
    next.forEach((h, i) => tl.at(B.reduced() ? 0 : i * 260, () => {
      if (now[i].outerHTML == h) return;
      const n = B.h("div", { html: h }).firstChild;
      n.classList.add("is-new");
      now[i].replaceWith(n);
    }));
    tl.play();
    if (B.reduced()) tl.skip();
    const { t, r } = make(b.dataset.w);
    live.textContent = `${t.member}: ${d.labels.lanes[r.lane]}`;
  });
  return { el };
}

/** Bootstrap entry: <div data-showcase data-sc-module="brain-anatomy.js" data-ba="stack|fig" data-trace="t1">. */
export function mount(el) {
  return el.dataset.ba == "fig" ? fig(el) : stack(el, { trace: el.dataset.trace }).then((s) => (s.intro(), s));
}
