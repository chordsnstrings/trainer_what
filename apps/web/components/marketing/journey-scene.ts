// The home walkthrough's scroll scene ("journey", docs/features/scroll-scenes.md):
// the band pins and scroll replaces the player's clock. The player
// (journey-player.tsx) owns its chapters and animations, so this scene only
// reports progress to it ("mk-scene" events on .mk-walk) and scrolls the page
// when one of its controls asks to go somewhere ("mk-scene:seek").
//
// The pin exists only where app/scroll-scenes.css makes the stage sticky
// (scenes on, viewport at least 700px tall); otherwise the scene stays off
// and the player auto-plays as it always has.
import { registerScene } from "./scroll-scenes";

type Detail = { active: boolean; q: number };

/** One set of listeners per band, replaced when the scenes mount again. */
const listening = new WeakMap<HTMLElement, AbortController>();

registerScene("journey", (el, stage) => {
  const walk = () => stage.querySelector<HTMLElement>(".mk-walk");
  const pinned = () => getComputedStyle(stage).position === "sticky";
  let last: Detail = { active: false, q: 0 };
  const send = () =>
    walk()?.dispatchEvent(new CustomEvent<Detail>("mk-scene", { detail: last }));

  listening.get(el)?.abort();
  const controller = new AbortController();
  listening.set(el, controller);
  // The player asks for the current state once it listens.
  el.addEventListener("mk-scene:hello", send, { signal: controller.signal });
  // A control asks for progress q: scroll there at once (a smooth scroll
  // would play every chapter on the way).
  el.addEventListener(
    "mk-scene:seek",
    (e) => {
      if (!last.active) return;
      const q = (e as CustomEvent<{ q: number }>).detail.q;
      const cs = getComputedStyle(el);
      const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
      const padB =
        parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
      const top = parseFloat(getComputedStyle(stage).top) || 0;
      const r = el.getBoundingClientRect();
      const y =
        scrollY + r.top + padT - top + q * (r.height - padT - padB - stage.offsetHeight);
      scrollTo({ top: q >= 1 ? Math.ceil(y) : Math.round(y), behavior: "instant" });
    },
    { signal: controller.signal },
  );

  return (c) => {
    const on = pinned() && Number.isFinite(c.p);
    const next: Detail = { active: on, q: on ? c.p : 0 };
    if (next.active === last.active && next.q === last.q) return;
    last = next;
    send();
  };
});

/** Scenes switched off at runtime: every walkthrough goes back to its own clock. */
export function releaseJourneys() {
  document
    .querySelectorAll<HTMLElement>("[data-scene='journey'] .mk-walk")
    .forEach((walk) =>
      walk.dispatchEvent(
        new CustomEvent<Detail>("mk-scene", { detail: { active: false, q: 0 } }),
      ),
    );
}
