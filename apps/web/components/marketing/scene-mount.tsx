"use client";
// Scroll scenes on the home page (docs/features/scroll-scenes.md): mounts the
// engine (scroll-scenes.ts) and the scene recipes (scenes.ts, journey-scene.ts)
// once the page's sections are in the DOM. Renders nothing. Everything
// depends on <html class="scenes-on">, which the head script in
// app/layout.tsx (SCENES_HEAD_SCRIPT) adds before the first paint; without
// it (reduced motion, the member's own "Reduce motion", no JavaScript,
// crawlers and automated browsers) the page is exactly today's page.
import { useEffect } from "react";
import { mountScenes } from "./scroll-scenes";
import "./scenes";
import { releaseJourneys } from "./journey-scene";

const REDUCE = "(prefers-reduced-motion: reduce)";
const reduced = () =>
  (typeof matchMedia === "function" && matchMedia(REDUCE).matches) ||
  document.documentElement.dataset.reduceMotion === "on";

/** The head script's test, for a client-side navigation to the home page. */
function wanted() {
  const forced = /[?&]scenes=on(&|$)/.test(location.search);
  const robot =
    navigator.webdriver ||
    /bot|crawl|spider|slurp|preview|lighthouse/i.test(navigator.userAgent);
  return (
    location.pathname === "/" &&
    !reduced() &&
    (forced || !robot) &&
    typeof IntersectionObserver === "function" &&
    typeof CSS !== "undefined" &&
    CSS.supports("position", "sticky")
  );
}

/**
 * In-place scenes always finish: one already on screen when the page opens
 * stays complete, and one that the page cannot scroll far enough to finish
 * (near the footer) finishes by the end of the page.
 */
function fitInPlace(spans: Map<HTMLElement, number>, first: boolean) {
  const vh = innerHeight;
  const maxScroll = document.documentElement.scrollHeight - vh;
  for (const el of document.querySelectorAll<HTMLElement>("[data-scene]")) {
    if (el.hasAttribute("data-pin") || el.dataset.mode === "leave") continue;
    if (!spans.has(el)) spans.set(el, parseFloat(el.dataset.span ?? "") || 0.7);
    const span = spans.get(el)!;
    const r = el.getBoundingClientRect();
    if (first && r.top < vh && r.bottom > 0) {
      el.dataset.span = "0.001";
      spans.set(el, 0.001);
      continue;
    }
    // How far into the viewport its top gets at the end of the page.
    const reach = vh - (r.top + scrollY - maxScroll);
    const fit = Math.min(span, Math.max(0.05, reach / vh - 0.02));
    if (fit < span || el.dataset.span) el.dataset.span = String(fit);
  }
}

export function ScrollScenes() {
  useEffect(() => {
    const html = document.documentElement;
    if (!html.classList.contains("scenes-on") && wanted())
      html.classList.add("scenes-on");
    if (!html.classList.contains("scenes-on")) return;
    const spans = new Map<HTMLElement, number>();
    fitInPlace(spans, true);
    // Added before the engine's own resize listener, so it measures the new spans.
    const refit = () => fitInPlace(spans, false);
    addEventListener("resize", refit);
    const unmount = mountScenes();
    // Motion switched off while the page is open: today's page at once.
    const query = typeof matchMedia === "function" ? matchMedia(REDUCE) : null;
    const off = () => {
      html.classList.remove("scenes-on");
      releaseJourneys();
    };
    const check = () => {
      if (reduced()) off();
    };
    query?.addEventListener("change", check);
    const observer = new MutationObserver(check);
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["data-reduce-motion"],
    });
    return () => {
      removeEventListener("resize", refit);
      query?.removeEventListener("change", check);
      observer.disconnect();
      unmount();
      off();
    };
  }, []);
  return null;
}
