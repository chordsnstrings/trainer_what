"use client";
import { useEffect } from "react";
import { rememberLaunchColour } from "./pwa";

type Install = {
  name: string;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  manifestUrl: string;
  icons: { apple: string; icon: string };
};

type Undo = () => void;

/** Point every matching head element at a new value; undo restores it. */
function swapLinks(
  selector: string,
  rel: string,
  href: string,
  extra: Record<string, string | null> = {},
): Undo {
  const found = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(selector),
  );
  const created = !found.length;
  const links = created ? [document.createElement("link")] : found;
  const saved = links.map((link) => {
    const names = ["href", ...Object.keys(extra)];
    return Object.fromEntries(
      names.map((name) => [name, link.getAttribute(name)]),
    );
  });
  for (const link of links) {
    link.rel = rel;
    link.setAttribute("href", href);
    for (const [name, value] of Object.entries(extra))
      if (value === null) link.removeAttribute(name);
      else link.setAttribute(name, value);
    if (created) document.head.append(link);
  }
  return () =>
    links.forEach((link, i) => {
      // Another screen may have replaced it since; leave that change alone.
      if (link.getAttribute("href") !== href) return;
      if (created) return link.remove();
      for (const [name, value] of Object.entries(saved[i]))
        if (value === null) link.removeAttribute(name);
        else link.setAttribute(name, value);
    });
}
/**
 * Sets every <meta name=…> to the member app's value. The root layout gives
 * theme-color one copy per colour scheme (media queries), so each copy takes
 * the trainer's colour without its query and gets its own value and query
 * back on undo.
 */
function swapMeta(name: string, content: string): Undo {
  const existing = [
    ...document.head.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`),
  ];
  if (!existing.length) {
    const meta = document.createElement("meta");
    meta.name = name;
    meta.content = content;
    document.head.append(meta);
    return () => {
      if (meta.getAttribute("content") === content) meta.remove();
    };
  }
  const saved = existing.map((meta) => ({
    meta,
    content: meta.getAttribute("content"),
    media: meta.getAttribute("media"),
  }));
  for (const meta of existing) {
    meta.content = content;
    meta.removeAttribute("media");
  }
  return () => {
    for (const { meta, content: original, media } of saved) {
      if (meta.getAttribute("content") !== content) continue;
      if (original !== null) meta.setAttribute("content", original);
      if (media !== null) meta.setAttribute("media", media);
    }
  };
}

/**
 * Signed-in members of a workspace install the trainer-branded app, whether or
 * not the public storefront is published. The manifest is member-only, so it
 * is fetched with credentials; anonymous visitors never reach this component
 * and keep the platform manifest.
 */
export function MemberAppManifest({
  tenantId,
  role,
}: {
  tenantId: string;
  role: string;
}) {
  useEffect(() => {
    let cancelled = false;
    const undo: Undo[] = [];
    void fetch("/api/v1/app/install", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const install = (await response.json()) as Install;
        if (cancelled) return;
        // The installed app's next launch paints the coach's surface first.
        if (role === "subscriber") rememberLaunchColour(install.backgroundColor);
        undo.push(
          swapLinks('link[rel="manifest"]', "manifest", install.manifestUrl, {
            crossorigin: "use-credentials",
          }),
          swapLinks(
            'link[rel="apple-touch-icon"]',
            "apple-touch-icon",
            install.icons.apple,
            { sizes: "180x180" },
          ),
          swapLinks('link[rel="icon"]', "icon", install.icons.icon, {
            type: "image/png",
            sizes: "192x192",
          }),
          swapMeta("apple-mobile-web-app-title", install.shortName),
        );
        // A member's browser colour follows their appearance choice
        // (MemberAppearance in components/appearance.tsx); the trainer
        // workspace keeps the trainer's colour in both schemes.
        if (role !== "subscriber")
          undo.push(swapMeta("theme-color", install.themeColor));
        if (role === "subscriber") {
          const original = document.title,
            title = `${install.name} · Coaching`;
          document.title = title;
          undo.push(() => {
            if (document.title === title) document.title = original;
          });
        }
      })
      // Without the member manifest the platform manifest simply stays.
      .catch(() => {});
    return () => {
      cancelled = true;
      for (const step of undo.reverse()) step();
    };
  }, [tenantId, role]);
  return null;
}
