// The Brain showcases' head script (docs/marketing-revamp-2026-10-26/phase1/
// PLAN.md §1.2), inline in <head> after the scroll scenes' (app/layout.tsx),
// so its classes are on <html> before the first paint:
// - sc-motion: neither reduced-motion setting is on (the device's or the
//   member's own data-reduce-motion="on"), and the visitor is not a crawler
//   or an automated browser. Only then do results wait for the engine
//   (app/brain-stage.css hides them under html.sc-motion:not(.sc-late)).
//   A crawler is a product token ("Googlebot/2.1", "Slackbot-LinkExpanding",
//   "Slackbot 1.0", "TwitterBot)"), crawl, spider, slurp, preview or
//   lighthouse: never "bot" inside a phone's model, as in-app browsers send
//   it ("CUBOT X50", "FBMF/CUBOT;").
// - sc-pin: the same, with IntersectionObserver and sticky positioning; the
//   anatomy pins only under it.
// - sc-late: 6 s on, if no showcase island has hydrated (html[data-sc-ready]):
//   the final frame shows, and the engine starts from it.
// ?sc=on lets automated browsers in (the browser checks) and stays on for the
// tab (sessionStorage "sc-on"), across client-side navigation too. The
// marketing motion switch (motion-mode.ts) never reaches the showcases.
// brain/mount.tsx repeats the same test for a client-side navigation, and a
// test keeps the two equal (tests/marketing-showcase.test.ts).

/** The pages with a Brain showcase: the only ones the script acts on. */
export const SHOWCASE_PATHS: readonly string[] = ["/", "/trainer-brain", "/demo"];

export const SHOWCASE_HEAD_SCRIPT: string = `(function(){try{var d=document.documentElement,l=location,n=navigator,f=/[?&]sc=on(&|$)/.test(l.search);if(f)try{sessionStorage.setItem("sc-on","1")}catch(e){}if(${JSON.stringify(SHOWCASE_PATHS)}.indexOf(l.pathname)<0)return;try{f=f||sessionStorage.getItem("sc-on")==="1"}catch(e){}if(d.getAttribute("data-reduce-motion")==="on")return;if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;if(!f&&(n.webdriver||/bot[/)-]|bot [0-9]|crawl|spider|slurp|preview|lighthouse/i.test(n.userAgent)))return;d.classList.add("sc-motion");if("IntersectionObserver" in window&&window.CSS&&CSS.supports("position","sticky"))d.classList.add("sc-pin");setTimeout(function(){if(!d.hasAttribute("data-sc-ready"))d.classList.add("sc-late")},6000)}catch(e){}})();`;
