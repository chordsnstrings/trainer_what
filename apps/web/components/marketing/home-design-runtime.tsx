"use client";
// The script of the owner's home design (components/marketing/home-design.tsx),
// with the page's classes and an undo for every listener, observer, timer and
// animation, because the marketing site navigates between pages in place.
// Two of the design's GSAP entrances (the hero copy rising and the sample
// feed turning in) run as CSS animations in app/home-design.css with the
// same timing and easing, so they play from the first paint.
import { useEffect, useLayoutEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const PASS_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ttclid", "ref"];

type DataLayerWindow = Window & { dataLayer?: Array<Record<string, unknown>> };

export function HomeDesignRuntime({ bands }: { bands: Array<[number, number]> }) {
  // On a navigation in place there is no first-paint script: mark the page
  // before the browser paints it.
  useLayoutEffect(() => {
    document.getElementById("tyh")?.classList.add("tyh-js");
  }, []);
  useEffect(() => {
    const root = document.getElementById("tyh");
    if (!root) return;
    const undo: Array<() => void> = [];
    const listen = <T extends EventTarget>(target: T, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, options);
      undo.push(() => target.removeEventListener(type, fn, options));
    };
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };
    undo.push(() => timers.forEach((id) => clearTimeout(id)));
    const observe = (callback: IntersectionObserverCallback, threshold: number) => {
      const io = new IntersectionObserver(callback, { threshold });
      undo.push(() => io.disconnect());
      return io;
    };
    const $ = <E extends Element = HTMLElement>(selector: string) => root.querySelector<E & Element>(selector);
    const $$ = <E extends Element = HTMLElement>(selector: string) => [...root.querySelectorAll<E & Element>(selector)];
    const byId = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

    const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer || [];
    const track = (event: string, data?: Record<string, unknown>) => {
      try {
        w.dataLayer!.push(Object.assign({ event }, data || {}));
      } catch {}
    };

    // Campaign parameters travel with every sign-up link.
    const pass = new URLSearchParams();
    const query = new URLSearchParams(location.search);
    PASS_KEYS.forEach((k) => {
      const v = query.get(k);
      if (v) pass.set(k, v);
    });
    const withPass = (href: string) => {
      const u = new URL(href, location.href);
      pass.forEach((v, k) => u.searchParams.set(k, v));
      return u.toString();
    };
    const signups = $$<HTMLAnchorElement>("[data-signup]");
    const signupBase = signups[0]?.getAttribute("href") ?? "/signup";
    if ([...pass].length) signups.forEach((a) => (a.href = withPass(a.href)));

    listen(document, "click", (e) => {
      const a = (e.target as Element | null)?.closest?.("[data-cta],[data-login]") as HTMLElement | null;
      if (a && root.contains(a))
        track(a.hasAttribute("data-login") ? "login_click" : "cta_click", { cta: a.dataset.cta || "nav" });
    });
    $$<HTMLDetailsElement>(".tyh-qa").forEach((d) =>
      listen(d, "toggle", () => {
        if (d.open) track("faq_open", { q: d.querySelector("summary span")?.textContent });
      }),
    );
    const seen = new Set<string>();
    const sections = observe(
      (es) =>
        es.forEach((en) => {
          const id = (en.target as HTMLElement).id;
          if (en.isIntersecting && !seen.has(id)) {
            seen.add(id);
            track("section_view", { section: id });
          }
        }),
      0.3,
    );
    $$("main section").forEach((s) => sections.observe(s));

    // Phone menu.
    const mm = byId("mm"),
      burger = byId<HTMLButtonElement>("burger");
    const closeMenu = () => {
      mm.classList.remove("tyh-open");
      burger.setAttribute("aria-expanded", "false");
    };
    listen(burger, "click", () => {
      const open = mm.classList.toggle("tyh-open");
      burger.setAttribute("aria-expanded", String(open));
    });
    mm.querySelectorAll("a").forEach((a) => listen(a, "click", closeMenu));
    listen(window, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape" && mm.classList.contains("tyh-open")) {
        closeMenu();
        burger.focus();
      }
    });

    const reveal = observe(
      (es) =>
        es.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("tyh-on");
            reveal.unobserve(en.target);
          }
        }),
      0.15,
    );
    $$(".tyh-rv").forEach((e) => reveal.observe(e));

    // Earnings calculator: marginal commission bands.
    const pR = byId<HTMLInputElement>("priceR"),
      pN = byId<HTMLInputElement>("priceN"),
      sR = byId<HTMLInputElement>("subsR"),
      sN = byId<HTMLInputElement>("subsN");
    const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
    const bandEls = $$(".tyh-band"),
      calcCta = $<HTMLAnchorElement>('[data-cta="calculator"]');
    let calcT = 0;
    undo.push(() => clearTimeout(calcT));
    const fillR = (r: HTMLInputElement) =>
      r.style.setProperty("--p", ((+r.value - +r.min) / (+r.max - +r.min)) * 100 + "%");
    function calc(src: "r" | "n") {
      let price = cl(parseInt(pN.value) || 0, 0, 100000),
        subs = cl(parseInt(sN.value) || 0, 0, 100000);
      if (src === "r") {
        price = +pR.value;
        subs = +sR.value;
        pN.value = String(price);
        sN.value = String(subs);
      } else {
        pR.value = String(cl(price, +pR.min, +pR.max));
        sR.value = String(cl(subs, +sR.min, +sR.max));
      }
      fillR(pR);
      fillR(sR);
      let left = subs,
        fee = 0;
      bandEls.forEach((el, i) => {
        const [size, rate] = bands[i],
          n = Math.max(0, Math.min(left, size));
        left -= n;
        fee += n * price * rate;
        el.querySelector("i")!.style.width =
          (size === Infinity ? (n ? Math.min(100, n / 10) : 0) : (n / size) * 100) + "%";
        el.classList.toggle("tyh-act", n > 0);
      });
      const gross = price * subs;
      byId("gross").textContent = fmt(gross);
      byId("fee").textContent = fmt(fee);
      byId("keep").textContent = fmt(gross - fee);
      byId("rate").textContent = gross ? ((fee / gross) * 100).toFixed(1) : "0.0";
      clearTimeout(calcT);
      calcT = window.setTimeout(() => track("calc_change", { price, subs }), 600);
      if (calcCta) {
        const u = new URL(withPass(signupBase));
        u.searchParams.set("price_aed", String(price));
        calcCta.href = u.toString();
      }
    }
    [pR, sR].forEach((r) => listen(r, "input", () => calc("r")));
    [pN, sN].forEach((n) => listen(n, "input", () => calc("n")));
    calc("r");

    // Sticky phone bar: between the hero and the closing block.
    const mbar = byId("mbar"),
      heroS = $(".tyh-hero")!,
      endS = $(".tyh-end")!;
    let tk = false,
      raf = 0;
    const frame = () => {
      tk = false;
      const er = endS.getBoundingClientRect();
      mbar.classList.toggle(
        "tyh-on",
        heroS.getBoundingClientRect().bottom < 0 && !(er.top < innerHeight && er.bottom > 0),
      );
    };
    listen(
      window,
      "scroll",
      () => {
        if (!tk) {
          tk = true;
          raf = requestAnimationFrame(frame);
        }
      },
      { passive: true },
    );
    undo.push(() => cancelAnimationFrame(raf));
    frame();

    // Hero feed: four decisions appear once; the last one gets approved.
    // Replay on demand.
    const fds = $$(".tyh-fd"),
      replay = byId<HTMLButtonElement>("replay");
    let feedT: number[] = [];
    const lastFd = fds[3],
      chip = lastFd.querySelector<HTMLElement>(".tyh-chip")!;
    function playFeed() {
      feedT.forEach(clearTimeout);
      feedT = [];
      replay.classList.remove("tyh-on");
      fds.forEach((f) => f.classList.remove("tyh-on", "tyh-done"));
      chip.className = "tyh-chip tyh-warn";
      chip.textContent = "Waiting for you";
      if (reduce) {
        fds.forEach((f) => f.classList.add("tyh-on"));
        chip.className = "tyh-chip tyh-ok";
        chip.textContent = "Approved";
        lastFd.classList.add("tyh-done");
        replay.classList.add("tyh-on");
        return;
      }
      fds.forEach((f, i) => feedT.push(later(() => f.classList.add("tyh-on"), 300 + i * 650)));
      feedT.push(later(() => lastFd.classList.add("tyh-done"), 300 + 3 * 650 + 1100));
      feedT.push(
        later(() => {
          chip.className = "tyh-chip tyh-ok";
          chip.textContent = "Approved";
          lastFd.style.borderInlineStartColor = "var(--ok)";
          replay.classList.add("tyh-on");
        }, 300 + 3 * 650 + 1500),
      );
    }
    listen(replay, "click", () => {
      lastFd.style.borderInlineStartColor = "";
      playFeed();
      track("feed_replay");
    });
    playFeed();

    // Stat count-up (numbers only), once.
    let countRaf = 0;
    undo.push(() => cancelAnimationFrame(countRaf));
    const counts = observe(
      (es) =>
        es.forEach((en) => {
          if (!en.isIntersecting) return;
          counts.unobserve(en.target);
          const el = en.target as HTMLElement,
            raw = el.dataset.count ?? "";
          if (reduce || !/^\d+$/.test(raw)) return;
          const n = +raw;
          if (n === 0) return;
          const t0 = performance.now(),
            D = 700;
          const step = (t: number) => {
            const k = Math.min(1, (t - t0) / D);
            el.textContent = String(Math.round(n * (1 - Math.pow(1 - k, 3))));
            if (k < 1) countRaf = requestAnimationFrame(step);
          };
          step(t0);
        }),
      0.6,
    );
    $$("[data-count]").forEach((e) => counts.observe(e));

    // Tools strike-through on reveal.
    const strike = observe(
      (es) =>
        es.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("tyh-on");
            strike.unobserve(en.target);
          }
        }),
      0.3,
    );
    strike.observe(byId("tls"));

    if (!reduce) {
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {}, root);
      const mq = gsap.matchMedia(root);
      undo.push(() => {
        mq.revert();
        ctx.revert();
      });
      ctx.add(() => {
        const ioEl = (s: string) => gsap.utils.toArray<HTMLElement>(s, root).forEach((e) => e.classList.remove("tyh-rv"));
        // Hero: the feed panel sits slightly tilted and settles flat as you scroll.
        const feed = $(".tyh-feed");
        mq.add("(min-width: 1081px)", () => {
          gsap.fromTo(
            feed,
            // The rest as in the design: GSAP would otherwise read them from
            // the CSS entrance still running on the panel.
            { x: 0, y: 0, rotation: 0, skewX: 0, scale: 1, rotationX: 10, rotationY: -14, z: -40 },
            {
              rotationX: 0,
              rotationY: 0,
              z: 0,
              ease: "none",
              scrollTrigger: { trigger: ".tyh-hero", start: "top top", end: "bottom 30%", scrub: 1 },
            },
          );
        });
        // Numbers band: each stat lifts in.
        ioEl(".tyh-sx");
        gsap.from(".tyh-sx", {
          y: 30,
          opacity: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: ".tyh-sxs", start: "top 92%", end: "top 60%", scrub: 1 },
        });
        // How it works: cards tip up from below.
        ioEl(".tyh-hw");
        gsap.from(".tyh-hw", {
          rotationX: 28,
          y: 60,
          opacity: 0,
          transformOrigin: "50% 100%",
          stagger: 0.12,
          ease: "none",
          scrollTrigger: { trigger: ".tyh-hws", start: "top 92%", end: "top 45%", scrub: 1 },
        });
        // Seven tools: rows unfold one by one.
        gsap.from(".tyh-tl", {
          rotationX: -75,
          opacity: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: "#tls", start: "top 85%", end: "bottom 70%", scrub: 1 },
        });
        // Four parts: columns swing in.
        ioEl(".tyh-pt");
        gsap.from(".tyh-pt", {
          rotationY: -28,
          x: -30,
          opacity: 0,
          transformOrigin: "0% 50%",
          stagger: 0.1,
          ease: "none",
          scrollTrigger: { trigger: ".tyh-pts", start: "top 90%", end: "top 45%", scrub: 1 },
        });
        ioEl(".tyh-ad");
        gsap.from(".tyh-ad", {
          y: 40,
          opacity: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: ".tyh-ads", start: "top 95%", end: "top 70%", scrub: 1 },
        });
        // Earnings: the two cards turn in from each side.
        ioEl(".tyh-fol");
        mq.add("(min-width: 1081px)", () => {
          gsap.from("#calc", {
            rotationY: 20,
            x: -40,
            opacity: 0,
            transformOrigin: "100% 50%",
            ease: "none",
            scrollTrigger: { trigger: ".tyh-earn-g", start: "top 90%", end: "top 45%", scrub: 1 },
          });
          gsap.from(".tyh-fol", {
            rotationY: -20,
            x: 40,
            opacity: 0,
            transformOrigin: "0% 50%",
            ease: "none",
            scrollTrigger: { trigger: ".tyh-earn-g", start: "top 90%", end: "top 45%", scrub: 1 },
          });
        });
        mq.add("(max-width: 1080px)", () => {
          gsap.from(["#calc", ".tyh-fol"], {
            y: 40,
            opacity: 0,
            stagger: 0.1,
            ease: "none",
            scrollTrigger: { trigger: ".tyh-earn-g", start: "top 92%", end: "top 55%", scrub: 1 },
          });
        });
        // Control rows slide in.
        ioEl(".tyh-gd");
        gsap.from(".tyh-gd", {
          x: 40,
          opacity: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: ".tyh-gds", start: "top 90%", end: "top 50%", scrub: 1 },
        });
        // Pricing: bars grow with the scroll.
        const bv = $(".tyh-bands-v")!;
        bv.classList.remove("tyh-rv");
        bv.classList.add("tyh-on");
        gsap.set(".tyh-bv i", { transition: "none" });
        gsap.fromTo(
          ".tyh-bv i",
          { scaleY: 0 },
          {
            scaleY: 1,
            transformOrigin: "50% 100%",
            stagger: 0.08,
            ease: "none",
            scrollTrigger: { trigger: bv, start: "top 90%", end: "top 45%", scrub: 1 },
          },
        );
        gsap.from(".tyh-bv b", {
          y: 20,
          opacity: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: bv, start: "top 90%", end: "top 50%", scrub: 1 },
        });
        // End block: rises and settles.
        gsap.from(".tyh-end-box", {
          rotationX: 18,
          scale: 0.94,
          y: 40,
          opacity: 0.4,
          ease: "none",
          transformPerspective: 1200,
          scrollTrigger: { trigger: ".tyh-end", start: "top 95%", end: "top 55%", scrub: 1 },
        });
        // Buttons: gentle magnetic pull on desktop (primary buttons only).
        mq.add("(hover: hover) and (min-width: 1081px)", () => {
          const offs: Array<() => void> = [];
          gsap.utils.toArray<HTMLElement>(".tyh-hero .tyh-b-pace,.tyh-end-box .tyh-b-pace", root).forEach((b) => {
            const xTo = gsap.quickTo(b, "x", { duration: 0.4, ease: "power3.out" }),
              yTo = gsap.quickTo(b, "y", { duration: 0.4, ease: "power3.out" });
            const mv = (e: PointerEvent) => {
              const r = b.getBoundingClientRect();
              xTo((e.clientX - r.left - r.width / 2) * 0.2);
              yTo((e.clientY - r.top - r.height / 2) * 0.3);
            };
            const lv = () => {
              xTo(0);
              yTo(0);
            };
            b.addEventListener("pointermove", mv);
            b.addEventListener("pointerleave", lv);
            offs.push(() => {
              b.removeEventListener("pointermove", mv);
              b.removeEventListener("pointerleave", lv);
              gsap.set(b, { x: 0, y: 0 });
            });
          });
          return () => offs.forEach((f) => f());
        });
      });
      const refresh = () => ScrollTrigger.refresh();
      document.fonts?.ready.then(() => {
        if (root.isConnected) refresh();
      });
      if (document.readyState === "complete") refresh();
      else listen(window, "load", refresh);
    }
    return () => undo.reverse().forEach((f) => f());
  }, [bands]);
  return null;
}
