/* trainsyou Concept B · boot (sync, in <head>; foundation-owned).
   1. Restores the prototype state onto <html> before first paint.
   2. Handles cross-document view transitions: direction (--dir) and
      shared-element names only for targets in the first viewport. */
(function () {
  var d = document, root = d.documentElement, KEY = "tyB";
  var DEFAULTS = { payments: "off", registration: "open", frontier: "off", voice: "off", publish: "gated", roll: "off", motion: "always", rtl: "off" };
  function readAll() {
    try { var v = localStorage.getItem(KEY); if (v) return JSON.parse(v); } catch (e) {}
    try { var n = JSON.parse(window.name || "{}"); if (n && n[KEY]) return n[KEY]; } catch (e) {}
    return {};
  }
  var saved = readAll(), state = {};
  for (var k in DEFAULTS) state[k] = (saved.state && saved.state[k]) || DEFAULTS[k];
  for (var k2 in state) root.setAttribute("data-" + k2, state[k2]);
  root.classList.add("js");
  window.__tyBoot = { KEY: KEY, DEFAULTS: DEFAULTS, saved: saved };

  function inFirstViewport(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }
  function file(url) { try { var p = new URL(url).pathname; var f = p.slice(p.lastIndexOf("/") + 1); return f || "index.html"; } catch (e) { return ""; } }
  function named() { return d.querySelectorAll("[data-vt]"); }

  /* Old page: name a shared element only when it is on screen and the
     destination is the page it morphs into (data-vt-to). */
  window.addEventListener("pageswap", function (e) {
    if (!e.viewTransition) return;
    var to = e.activation && e.activation.entry ? file(e.activation.entry.url) : "";
    var els = named();
    for (var i = 0; i < els.length; i++) {
      var el = els[i], ok = el.getAttribute("data-vt-to") === to && inFirstViewport(el);
      el.style.viewTransitionName = ok ? el.getAttribute("data-vt") : "none";
    }
  });

  /* New page: direction from the navigation type (back = reversed, RTL
     mirrors), and shared names cleared when the target is not in the
     first viewport or the visitor did not come from the paired page. */
  window.addEventListener("pagereveal", function (e) {
    if (!e.viewTransition) return;
    var dir = 1, act = window.navigation && navigation.activation;
    if (act && act.navigationType === "traverse" && act.from && act.entry && act.entry.index < act.from.index) dir = -1;
    if (root.dir === "rtl") dir = -dir;
    root.style.setProperty("--dir", String(dir));
    var from = act && act.from ? file(act.from.url) : "";
    var els = named();
    for (var i = 0; i < els.length; i++) {
      var el = els[i], ok = el.getAttribute("data-vt-from") === from && inFirstViewport(el);
      el.style.viewTransitionName = ok ? el.getAttribute("data-vt") : "none";
    }
  });
})();
