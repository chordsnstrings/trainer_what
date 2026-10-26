/* Concept B · Home and Pricing scripts (foundation-owned). Uses window.TY. */
(function () {
  "use strict";
  var TY = window.TY, $ = TY.$, $$ = TY.$$;

  /* Home hero: one short change after first paint (replayable).
     1. our first band highlights ("your first 100"), 2. the price flashes
     on the tile, then on the offer page: your price, on your page. */
  var tile = $(".price-tile");
  if (tile) {
    var here = $(".stair", tile);
    TY.onHero(function (hero, replay) {
      if (replay && here) here.classList.remove("is-here");
      var t0 = replay ? 180 : 0;
      setTimeout(function () { if (here) here.classList.add("is-here"); }, t0);
      setTimeout(function () { TY.flash($("[data-flash-tile]", tile)); }, t0 + 360);
      setTimeout(function () { TY.flash($("[data-flash-price]")); }, t0 + 540);
    });
    document.addEventListener("ty:price", function () { TY.flash($("[data-flash-price]")); });
  }

  /* Pricing: quick jumps on the blended-rate slider. */
  $$("[data-share-n]").forEach(function (b) {
    b.addEventListener("click", function () {
      var r = $("#share-n"); if (!r) return;
      r.value = b.getAttribute("data-share-n");
      r.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
})();
