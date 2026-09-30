"use client";
/**
 * React access to the subscriber message catalogs (docs/features/arabic.md).
 *
 * The language is the document's: the root layout renders `<html lang>`
 * from the request (document-language.ts) and passes the same value to
 * `LocaleProvider`, so the server render and hydration agree. After that
 * `<html lang>` is the source of truth: `MemberLanguage` applies the
 * member's saved language and `PageLanguage` a coach website's, both
 * through `applyDocumentLanguage`, and every `useLocale` re-renders with it.
 * There is no second language setting.
 */
import {
  createContext,
  Fragment,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { parseLanguage } from "../../document-language";
import { CATALOG, type NamespaceName } from "./catalog";
import { errorText } from "./errors";
import {
  interpolate,
  translator,
  type Locale,
  type Messages,
  type Param,
  type Translator,
} from "./core";

const LocaleContext = createContext<Locale>("en");

/** The language the server rendered this page in (the root layout). */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

// One observer of <html lang> for every component that reads the language.
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => listeners.forEach((l) => l()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

/** The current subscriber language: `<html lang>`, else the server's. */
export function useLocale(): Locale {
  const server = useContext(LocaleContext);
  return useSyncExternalStore(
    subscribe,
    () => parseLanguage(document.documentElement.lang) ?? server,
    () => server,
  );
}

/** A translator for one namespace in the current language. */
export function useT<N extends NamespaceName>(
  namespace: N,
): Translator<(typeof CATALOG)[N]["en"]> {
  const locale = useLocale();
  return useMemo(
    () =>
      translator(
        CATALOG[namespace] as never,
        locale,
      ) as unknown as Translator<(typeof CATALOG)[N]["en"]>,
    [namespace, locale],
  );
}

/** A request error as text in the current language (lib/i18n/errors.ts). */
export function useErrorText() {
  const locale = useLocale();
  return useMemo(() => (error: unknown) => errorText(error, locale), [locale]);
}

type TagRenderers = Record<string, (children: ReactNode) => ReactNode>;

/**
 * A message with markup: "Tap <b>Share</b> in Safari's toolbar." Each
 * `<tag>…</tag>` is rendered by `tags[tag]`; the text between is
 * interpolated and isolated like `t()`. Tags do not nest.
 */
export function Rich<E extends Messages, K extends keyof E & string>({
  t,
  k,
  tags,
  params,
}: {
  t: Translator<E>;
  k: K;
  tags: TagRenderers;
  params?: Record<string, Param>;
}) {
  const count =
    params && typeof params.count === "number" ? params.count : undefined;
  const template = t.template(k, count);
  const parts: ReactNode[] = [];
  const pattern = /<([a-z]+)>([\s\S]*?)<\/\1>/g;
  let last = 0,
    match: RegExpExecArray | null;
  const text = (s: string) => interpolate(t.locale, s, params ?? {}, count);
  while ((match = pattern.exec(template))) {
    if (match.index > last) parts.push(text(template.slice(last, match.index)));
    const render = tags[match[1]];
    parts.push(render ? render(text(match[2])) : text(match[2]));
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push(text(template.slice(last)));
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
