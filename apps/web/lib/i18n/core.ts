/**
 * The subscriber-facing message layer (docs/features/arabic.md): typed
 * message catalogs in English and Arabic, `{name}` interpolation, plural
 * forms from `Intl.PluralRules` (English has two, Arabic six) and bidi
 * isolation of every value put into an Arabic sentence.
 *
 * No React and no browser or server-only imports, so the pure navigation
 * rules (member-nav.ts), server components and tests use it directly;
 * components use `useT` from ./react.
 *
 * The language itself is never decided here: it is the document language
 * (document-language.ts: `?lang=`, the device choice, the coach website's
 * language, the member's saved language).
 */
import type { Language } from "../../document-language";

export type Locale = Language;
export const LOCALES: readonly Locale[] = ["en", "ar"];

/** The plural categories a language can use (CLDR). */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
/** An English plural message: "# session" / "# sessions". */
export type EnglishPlural = { one: string; other: string };
/**
 * An Arabic plural message, all six forms: zero (0), one (1), two (2),
 * few (3–10), many (11–99) and other (100+, fractions).
 */
export type ArabicPlural = Record<PluralCategory, string>;
export type EnglishMessage = string | EnglishPlural;
/** The Arabic message required for an English one of the same key. */
export type ArabicMessageFor<M> = M extends string ? string : ArabicPlural;
export type Messages = Record<string, EnglishMessage>;
export type ArabicMessages<E extends Messages> = {
  [K in keyof E]: ArabicMessageFor<E[K]>;
};
export type Namespace<E extends Messages = Messages> = {
  en: E;
  ar: ArabicMessages<E>;
};

/**
 * One namespace of messages. The Arabic object must have every English key
 * (a missing one fails the typecheck; tests/i18n.test.ts checks the same at
 * run time) and all six plural forms wherever English has a plural.
 */
export function defineMessages<const E extends Messages>(
  en: E,
  ar: ArabicMessages<E>,
): Namespace<E> {
  return { en, ar };
}

// ------------------------------------------------------------------
// Bidi isolation
// ------------------------------------------------------------------

/** First strong isolate: the value takes the direction of its first letter. */
export const FSI = "⁨";
/** Left-to-right isolate: numbers, times, "3 × 10", ranges. */
export const LRI = "⁦";
/** Pop directional isolate: closes FSI or LRI. */
export const PDI = "⁩";
const ISOLATES = /[⁦-⁩]/g;

/**
 * Wraps a value so the sentence around it cannot reorder it: "auto" for a
 * name or any text (its own first letter decides), "ltr" for numbers and
 * expressions such as "3 × 10", "10–12" or "1:30".
 */
export function isolate(text: string, direction: "auto" | "ltr" = "auto") {
  if (!text) return text;
  return (direction === "ltr" ? LRI : FSI) + text + PDI;
}
/** The text without isolation marks (tests, accessible comparisons). */
export function stripIsolates(text: string) {
  return text.replace(ISOLATES, "");
}
/** Right-to-left languages isolate every interpolated value. */
export function isRightToLeft(locale: Locale) {
  return locale === "ar";
}

// ------------------------------------------------------------------
// Numbers and plurals
// ------------------------------------------------------------------

/**
 * The formatting locale of a language: British English, and UAE Arabic with
 * Latin digits (0-9), the digits the rest of the product and the coaches'
 * own plans use.
 */
export function localeTag(locale: Locale) {
  return locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB";
}
const pluralRules = new Map<Locale, Intl.PluralRules>();
export function pluralCategory(locale: Locale, count: number): PluralCategory {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) as PluralCategory;
}
const numberFormats = new Map<Locale, Intl.NumberFormat>();
/** "1,250", "12.5"; grouping only from five digits, so years stay "2026". */
export function formatCount(locale: Locale, value: number) {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(localeTag(locale), {
      maximumFractionDigits: 2,
      // ES2023 value; the root typecheck targets the ES2022 option types.
      useGrouping: "min2" as unknown as boolean,
    });
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

// ------------------------------------------------------------------
// Interpolation
// ------------------------------------------------------------------

export type Param = string | number;
type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;
/** The values a message needs: its `{placeholders}`, and `count` for a plural. */
export type ParamsOf<M> = M extends string
  ? Placeholders<M>
  : M extends EnglishPlural
    ? "count" | Placeholders<M["one"]> | Placeholders<M["other"]>
    : never;
/** Keys whose message needs no values (safe to keep in state and show later). */
export type PlainKey<E extends Messages> = {
  [K in keyof E & string]: [ParamsOf<E[K]>] extends [never] ? K : never;
}[keyof E & string];
export type ArgsFor<M> = [ParamsOf<M>] extends [never]
  ? [params?: Record<string, never>]
  : [params: { [P in ParamsOf<M>]: P extends "count" ? number : Param }];

function show(locale: Locale, value: Param | undefined) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    const text = formatCount(locale, value);
    return isRightToLeft(locale) ? isolate(text, "ltr") : text;
  }
  const text = String(value);
  return isRightToLeft(locale) ? isolate(text) : text;
}

/** Fills `{name}` (and `#` in a plural) with the values, isolated in Arabic. */
export function interpolate(
  locale: Locale,
  template: string,
  params: Record<string, Param> = {},
  count?: number,
) {
  // `#` first, so a "#" inside a value (a name) is never replaced.
  const counted =
    count === undefined ? template : template.replace(/#/g, "{\u0000count}");
  return counted.replace(
    /\{(\u0000count|[A-Za-z0-9_]+)\}/g,
    (whole, name: string) =>
      name === "\u0000count"
        ? show(locale, count)
        : Object.hasOwn(params, name)
          ? show(locale, params[name])
          : whole,
  );
}

/** Picks the plural form for `count` (falling back to `other`). */
export function pluralForm(
  locale: Locale,
  message: Partial<Record<PluralCategory, string>>,
  count: number,
) {
  return message[pluralCategory(locale, count)] ?? message.other ?? "";
}

export type Translator<E extends Messages> = {
  <K extends keyof E & string>(key: K, ...args: ArgsFor<E[K]>): string;
  /** The language these messages are in. */
  locale: Locale;
  /** The template before interpolation (for rich text with tags). */
  template<K extends keyof E & string>(key: K, count?: number): string;
  /**
   * The message for a key built at run time (a status or category from the
   * server), or `fallback` when the catalog has no such plain message.
   */
  dynamic(key: string, fallback: string): string;
};

/**
 * A translator for one namespace in one language. A key missing in Arabic
 * (never, if the typecheck passed) falls back to English.
 */
export function translator<E extends Messages>(
  namespace: Namespace<E>,
  locale: Locale,
): Translator<E> {
  const own = (locale === "ar" ? namespace.ar : namespace.en) as Record<
    string,
    EnglishMessage | ArabicPlural
  >;
  const english = namespace.en as Record<string, EnglishMessage>;
  const lookup = (key: string, count?: number) => {
    const message = own[key] ?? english[key];
    const useLocale: Locale = own[key] !== undefined ? locale : "en";
    if (message === undefined) return { text: key, locale: useLocale };
    if (typeof message === "string") return { text: message, locale: useLocale };
    return {
      text: pluralForm(useLocale, message, count ?? 0),
      locale: useLocale,
    };
  };
  const t = ((key: string, params?: Record<string, Param>) => {
    const count =
      params && typeof params.count === "number" ? params.count : undefined;
    const found = lookup(key, count);
    return interpolate(found.locale, found.text, params ?? {}, count);
  }) as unknown as Translator<E>;
  t.locale = locale;
  t.template = (key, count) => lookup(key, count).text;
  t.dynamic = (key, fallback) =>
    typeof english[key] === "string"
      ? (t as unknown as (k: string) => string)(key)
      : fallback;
  return t;
}
