/**
 * Scroll scenes' head script (docs/features/scroll-scenes.md), inline in
 * <head> (app/layout.tsx) so <html class="scenes-on"> is there before the
 * first paint and a pinned section never shifts the layout. Home page only.
 * Off under reduced motion (the device setting or the member's own
 * data-reduce-motion="on"), for crawlers and automated browsers (they get
 * today's page; the browser checks add ?scenes=on), and without
 * IntersectionObserver or sticky positioning. scene-mount.tsx repeats the
 * same test for a client-side navigation to the home page.
 */
export const SCENES_HEAD_SCRIPT = `(function(){try{var d=document.documentElement,l=location,n=navigator;if(l.pathname!=="/")return;if(d.getAttribute("data-reduce-motion")==="on")return;if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;if(!/[?&]scenes=on(&|$)/.test(l.search)&&(n.webdriver||/bot|crawl|spider|slurp|preview|lighthouse/i.test(n.userAgent)))return;if(!("IntersectionObserver" in window)||!(window.CSS&&CSS.supports("position","sticky")))return;d.classList.add("scenes-on")}catch(e){}})();`;
