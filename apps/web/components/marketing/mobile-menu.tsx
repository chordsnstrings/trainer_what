"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** How long the panel's exit runs (app/marketing.css mk-menu-out, --mk-dur-fast). */
const EXIT_MS = 150;
/** Where the menu shows (app/marketing.css hides it above 1150px). */
const SHOWS = "(max-width: 1150px)";

/**
 * The phone menu (docs/features/marketing-site.md, "Header"). A native
 * <details>, so it opens and closes without JavaScript. With it: closing
 * plays the panel's exit first (the details stays open until it ends), the
 * page behind dims from the header down and stops scrolling, and Escape, a
 * tap outside the panel or a link inside it close the menu. With reduced
 * motion (outside the marketing motion switch's "always") it closes at once.
 * A window or tablet that widens past the menu's breakpoint closes it, so
 * the page cannot stay locked behind a hidden menu.
 */
export function MobileMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const root = document.documentElement;
    let timer = 0;
    const still = () =>
      !menu.closest('[data-mk-motion="always"]') && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      window.clearTimeout(timer);
      menu.removeAttribute("data-closing");
      menu.open = false;
    };
    const close = (returnFocus = false) => {
      if (!menu.open || menu.hasAttribute("data-closing")) return;
      if (returnFocus) menu.querySelector("summary")?.focus();
      if (still()) return finish();
      menu.setAttribute("data-closing", "");
      timer = window.setTimeout(finish, EXIT_MS);
    };
    const toggled = () => {
      if (menu.open) {
        const header = menu.closest(".mk-header");
        root.style.setProperty("--mk-menu-top", `${Math.round(header?.getBoundingClientRect().bottom ?? 0)}px`);
        root.classList.add("mk-menu-open");
      } else root.classList.remove("mk-menu-open");
    };
    const onClick = (event: MouseEvent) => {
      if (!menu.open) return;
      const target = event.target as Element | null;
      if (target?.closest(".mk-mobile-menu > summary") && menu.contains(target)) {
        // "Menu" while open: play the exit instead of snapping shut; while
        // the exit plays, a second tap keeps the menu open.
        event.preventDefault();
        if (menu.hasAttribute("data-closing")) {
          window.clearTimeout(timer);
          menu.removeAttribute("data-closing");
        } else close();
        return;
      }
      // A link inside goes on; the menu closes behind it. The dimmed page
      // (the details itself, outside its panel) or anywhere else closes it.
      if (target?.closest(".mk-mobile-panel a")) close();
      else if (!target?.closest(".mk-mobile-panel")) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.open) close(true);
    };
    const shows = matchMedia(SHOWS);
    const onWidth = () => {
      if (!shows.matches && menu.open) finish();
    };
    menu.addEventListener("toggle", toggled);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    shows.addEventListener("change", onWidth);
    return () => {
      window.clearTimeout(timer);
      menu.removeEventListener("toggle", toggled);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      shows.removeEventListener("change", onWidth);
      root.classList.remove("mk-menu-open");
    };
  }, []);
  return (
    <details className="mk-mobile-menu" ref={ref}>
      {children}
    </details>
  );
}
