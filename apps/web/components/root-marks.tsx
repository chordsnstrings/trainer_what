"use client";
import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Marks on <html> for what the page shows, so the document itself (its
 * background and colour scheme, the member tab bar's inset, the scroll lock
 * behind a sheet) follows the surface inside it. CSS reads a mark as
 * `:root[data-shell~="member"]`. A `:root:has(...)` rule would read the same
 * from the page, but Chromium then restyles the whole document on every
 * element the page adds or removes (a Brain showcase adds several a frame).
 *
 * - data-shell: "public" (the platform's public pages: marketing, directory,
 *   sign-in), "workspace" (the trainer workspace), "member" (the member
 *   shell);
 * - data-scheme: a subscriber surface's appearance ("system", "light",
 *   "dark"; app/appearance.css);
 * - data-open: "sheet" (a bottom sheet), "kitchen" (the nutrition kitchen
 *   sheet, for print).
 *
 * Each mark is a token in a space-separated attribute and stays while any
 * surface holds it, so a surface that replaces another in the same commit,
 * or two surfaces holding the same token, never drop it.
 */
export type RootMarkAttribute = "data-shell" | "data-scheme" | "data-open";

const held = new Map<string, number>();

function setToken(attribute: RootMarkAttribute, token: string, on: boolean) {
  const root = document.documentElement;
  const tokens = root.getAttribute(attribute)?.split(" ").filter(Boolean) ?? [];
  if (tokens.includes(token) === on) return;
  const next = on ? [...tokens, token] : tokens.filter((t) => t !== token);
  if (next.length) root.setAttribute(attribute, next.join(" "));
  else root.removeAttribute(attribute);
}

/** Holds `token` in `attribute` on <html> until the returned release runs. */
export function holdRootMark(attribute: RootMarkAttribute, token: string) {
  const key = `${attribute} ${token}`;
  held.set(key, (held.get(key) ?? 0) + 1);
  setToken(attribute, token, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (held.get(key) ?? 1) - 1;
    if (count > 0) held.set(key, count);
    else {
      held.delete(key);
      setToken(attribute, token, false);
    }
  };
}

/** Holds a mark while the calling component is mounted (none for null). */
export function useRootMark(
  attribute: RootMarkAttribute,
  token: string | null | undefined,
) {
  useLayoutEffect(
    () => (token ? holdRootMark(attribute, token) : undefined),
    [attribute, token],
  );
}

/** The inline script that adds a mark while the server's HTML parses. */
export function rootMarkScript(attribute: RootMarkAttribute, token: string) {
  return `(function(r,a,t){var v=r.getAttribute(a)||"";if((" "+v+" ").indexOf(" "+t+" ")==-1)r.setAttribute(a,v?v+" "+t:t)})(document.documentElement,${JSON.stringify(attribute)},${JSON.stringify(token)})`;
}

const subscribeNothing = () => () => {};

/**
 * What a mark does to the document, for a page read without JavaScript,
 * where its script never runs: the stylesheets' own rules for the mark
 * (globals.css, workspace-system.css, appearance.css) with :root in place
 * of the mark, which tests/root-marks.test.ts keeps equal. The member shell
 * and the open sheets need JavaScript anyway.
 */
export const ROOT_MARK_WITHOUT_SCRIPT: Readonly<Record<string, string>> = {
  "data-shell public":
    ":root{background:var(--ty-white);color-scheme:light;scroll-padding-block-start:82px}" +
    "@media (max-width:1150px){:root{scroll-padding-block-start:77px}}" +
    "@media (max-width:760px){:root{scroll-padding-block-start:73px}}",
  "data-shell workspace": ":root{background:#ffffff;color-scheme:light}",
  "data-scheme system":
    "@media (prefers-color-scheme:dark){:root{background:var(--dark-paper);color-scheme:dark}}",
  "data-scheme dark": ":root{background:var(--dark-paper);color-scheme:dark}",
};

/**
 * A surface's mark, from the first paint: the server's HTML carries it as
 * an inline script (run while the page parses, before anything below it
 * paints), and its rules in a <noscript> for a page read without
 * JavaScript; once hydrated both elements go and the layout effect holds
 * the mark, releasing it when the surface goes (a client-side navigation
 * to another kind of page). Mounted on the client, it renders nothing. Put
 * it first inside the surface's root element.
 */
export function RootMark({
  attribute,
  token,
}: {
  attribute: RootMarkAttribute;
  token: string;
}) {
  useRootMark(attribute, token);
  const fromServer = useSyncExternalStore(
    subscribeNothing,
    () => false,
    () => true,
  );
  const rules = ROOT_MARK_WITHOUT_SCRIPT[`${attribute} ${token}`];
  return fromServer ? (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: rootMarkScript(attribute, token) }}
      />
      {rules && (
        <noscript dangerouslySetInnerHTML={{ __html: `<style>${rules}</style>` }} />
      )}
    </>
  ) : null;
}
