/* Concept C boot (sync in <head>, keep tiny): marks JS, restores the dev
   panel's product-state flags and the consent choice before first paint,
   and keeps cross-document View Transition morphs to first-viewport targets. */
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  try {
    var s = JSON.parse(localStorage.getItem("ty-c-flags") || "null");
    if (s) for (var k in s) if (/^(payments|publish|registration|frontier|voice|rtl-preview)$/.test(k)) d.setAttribute("data-" + k, String(s[k]));
    var c = localStorage.getItem("ty-c-consent");
    if (c === "granted" || c === "denied") d.setAttribute("data-consent", c);
  } catch (e) {}
  /* Shared-element morphs only when the named element is in the first
     viewport; otherwise the root crossfade runs (section D). */
  function prune() {
    var els = document.querySelectorAll("[data-vt-name]");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      els[i].style.viewTransitionName = r.top < innerHeight && r.bottom > 0 ? els[i].getAttribute("data-vt-name") : "none";
    }
  }
  addEventListener("pageswap", function (e) { if (e.viewTransition) prune(); });
  addEventListener("pagereveal", function (e) { if (e.viewTransition) prune(); });
})();
