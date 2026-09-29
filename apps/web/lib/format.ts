/**
 * One date, time, number and money format for every subscriber screen, in
 * the member's language (docs/features/arabic.md):
 *
 * - English: "29 Sep 2026", "14:05", "29 Sep 2026, 14:05", "Tue 29 Sep";
 * - Arabic (UAE, Latin digits): "29 سبتمبر 2026", "14:05",
 *   "29 سبتمبر 2026، 14:05", "الثلاثاء، 29 سبتمبر".
 *
 * Never seconds, never an ISO date, never a raw time zone id. Every function
 * takes `locale` (default English); Arabic results are wrapped in bidi
 * isolates so they keep their order inside any sentence (`isolate` in
 * lib/i18n/core.ts).
 *
 * Two kinds of value:
 * - an instant (an ISO timestamp, a Date or epoch milliseconds) is shown in
 *   a time zone: the one given, else the device's own;
 * - a calendar date ("2026-09-29", a programme or meal day) is a day, not an
 *   instant, and is never shifted by a time zone.
 */
import { isolate, localeTag, type Locale } from "./i18n/core";

export type { Locale } from "./i18n/core";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Instant = string | number | Date;
type Parts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

function validZone(zone?: string | null) {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}
function rtl(locale: Locale | undefined) {
  return locale === "ar";
}
/** Arabic results keep their own order inside a sentence. */
function wrap(locale: Locale | undefined, text: string) {
  return rtl(locale) && text ? isolate(text) : text;
}

/** The value as a Date, and its calendar parts in the zone; null when invalid. */
function read(value: Instant | null | undefined, zone?: string | null) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && CALENDAR_DATE.test(value)) {
    const d = new Date(value + "T12:00:00Z");
    if (Number.isNaN(d.getTime())) return null;
    return {
      date: d,
      // A calendar day is read in UTC, never shifted by a zone.
      zone: "UTC",
      parts: {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        day: d.getUTCDate(),
        weekday: d.getUTCDay(),
        hour: 12,
        minute: 0,
      } satisfies Parts,
    };
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const valid = validZone(zone);
  const found = new Intl.DateTimeFormat("en-US", {
    timeZone: valid,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) =>
    found.find((part) => part.type === type)?.value ?? "";
  return {
    date: d,
    zone: valid,
    parts: {
      year: Number(get("year")),
      month: Number(get("month")) - 1,
      day: Number(get("day")),
      weekday: WEEKDAYS.indexOf(get("weekday")),
      hour: Number(get("hour")) % 24,
      minute: Number(get("minute")),
    } satisfies Parts,
  };
}
function parts(value: Instant | null | undefined, zone?: string | null) {
  return read(value, zone)?.parts ?? null;
}

export type DateOptions = {
  /** Show the time zone's calendar day (instants only); default: the device. */
  zone?: string | null;
  /** "Tue 29 Sep 2026". */
  weekday?: boolean | "long";
  /** Leave the year out ("29 Sep"); default: shown. */
  year?: boolean;
  /** "29 September 2026". */
  longMonth?: boolean;
  /** Shown for a missing or invalid value; default "". */
  fallback?: string;
  /** The member's language; default English. */
  locale?: Locale;
};

function arabicDate(
  found: NonNullable<ReturnType<typeof read>>,
  options: DateOptions,
) {
  return new Intl.DateTimeFormat(localeTag("ar"), {
    timeZone: found.zone,
    day: "numeric",
    month: "long",
    ...(options.year === false ? {} : { year: "numeric" }),
    ...(options.weekday ? { weekday: "long" } : {}),
  }).format(found.date);
}

/** "29 Sep 2026" (or "Tue 29 Sep", "29 September 2026"); Arabic "29 سبتمبر 2026". */
export function formatDate(
  value: Instant | null | undefined,
  options: DateOptions = {},
) {
  const found = read(value, options.zone);
  if (!found) return options.fallback ?? "";
  if (rtl(options.locale)) return wrap(options.locale, arabicDate(found, options));
  const p = found.parts;
  const month = (options.longMonth ? LONG_MONTHS : MONTHS)[p.month];
  const weekday =
    options.weekday === "long"
      ? LONG_WEEKDAYS[p.weekday] + " "
      : options.weekday
        ? WEEKDAYS[p.weekday] + " "
        : "";
  return `${weekday}${p.day} ${month}${options.year === false ? "" : " " + p.year}`;
}

/** "14:05": 24-hour, never seconds (the same in Arabic, isolated). */
export function formatTime(
  value: Instant | null | undefined,
  options: { zone?: string | null; fallback?: string; locale?: Locale } = {},
) {
  if (typeof value === "string" && CALENDAR_DATE.test(value))
    return options.fallback ?? "";
  const p = parts(value, options.zone);
  if (!p) return options.fallback ?? "";
  const text = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return rtl(options.locale) ? isolate(text, "ltr") : text;
}

/** "29 Sep 2026, 14:05"; Arabic "29 سبتمبر 2026، 14:05". */
export function formatDateTime(
  value: Instant | null | undefined,
  options: DateOptions = {},
) {
  const day = formatDate(value, options);
  if (!day) return options.fallback ?? "";
  return `${day}${rtl(options.locale) ? "، " : ", "}${formatTime(value, options)}`;
}

const WHEN_WORDS = {
  en: { today: "Today", yesterday: "Yesterday", comma: ", " },
  ar: { today: "اليوم", yesterday: "أمس", comma: "، " },
} as const;

/**
 * A short "when" for lists: "Today, 14:05", "Yesterday, 09:30", or the date
 * and time for anything older. `now` is for tests.
 */
export function formatWhen(
  value: Instant | null | undefined,
  options: DateOptions & { now?: Date } = {},
) {
  const p = parts(value, options.zone);
  if (!p) return options.fallback ?? "";
  const words = WHEN_WORDS[options.locale ?? "en"];
  const today = calendarDate(options.now ?? new Date(), options.zone);
  const day = `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const time = formatTime(value, options);
  if (day === today) return `${words.today}${words.comma}${time}`;
  if (day === addCalendarDays(today, -1))
    return `${words.yesterday}${words.comma}${time}`;
  const thisYear = p.year === Number(today.slice(0, 4));
  return formatDateTime(value, { ...options, year: !thisYear });
}

/** "29 Sep – 5 Oct 2026", "1 – 7 Oct 2026", "28 Dec 2026 – 3 Jan 2027". */
export function formatDateRange(
  from: Instant | null | undefined,
  to: Instant | null | undefined,
  options: { zone?: string | null; locale?: Locale } = {},
) {
  const a = read(from, options.zone),
    b = read(to, options.zone);
  if (!a || !b) return formatDate(from ?? to, options);
  if (rtl(options.locale)) {
    const format = new Intl.DateTimeFormat(localeTag("ar"), {
      timeZone: a.zone,
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return wrap(options.locale, format.formatRange(a.date, b.date));
  }
  if (a.parts.year !== b.parts.year)
    return `${formatDate(from, options)} – ${formatDate(to, options)}`;
  if (a.parts.month !== b.parts.month)
    return `${a.parts.day} ${MONTHS[a.parts.month]} – ${b.parts.day} ${MONTHS[b.parts.month]} ${b.parts.year}`;
  if (a.parts.day !== b.parts.day)
    return `${a.parts.day} – ${b.parts.day} ${MONTHS[b.parts.month]} ${b.parts.year}`;
  return formatDate(from, options);
}

/** The calendar date ("2026-09-29") of an instant in a zone (default: the device). */
export function calendarDate(value: Instant, zone?: string | null) {
  const p = parts(value, zone);
  if (!p) return "";
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function addCalendarDays(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The last `days` calendar days up to `today` as picker choices ("Today,
 * Tue 29 Sep", "Yesterday, Mon 28 Sep", "Sun 27 Sep"), newest first, plus
 * `current` when it is older. Replaces a date field that would show a
 * US-style date on some phones.
 */
export function recentDays(
  today: string,
  current?: string | null,
  days = 7,
  locale: Locale = "en",
) {
  const words = WHEN_WORDS[locale];
  const list = Array.from({ length: days }, (_, i) =>
    addCalendarDays(today, -i),
  );
  if (current && CALENDAR_DATE.test(current) && !list.includes(current))
    list.push(current);
  return list.map((value, i) => {
    const day = formatDate(value, { weekday: true, year: false, locale });
    return {
      value,
      label:
        i === 0
          ? `${words.today}${words.comma}${day}`
          : i === 1
            ? `${words.yesterday}${words.comma}${day}`
            : day,
    };
  });
}

/**
 * "Gulf Standard Time" (Arabic "توقيت الخليج") for "Asia/Dubai": people
 * never see a raw zone id.
 */
export function zoneName(zone?: string | null, locale: Locale = "en") {
  const local = locale === "ar" ? "توقيتك المحلي" : "your local time";
  if (!zone) return local;
  try {
    return (
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
        timeZone: zone,
        timeZoneName: "long",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ??
      (locale === "ar" ? "التوقيت المحلي" : "local time")
    );
  } catch {
    return locale === "ar" ? "التوقيت المحلي" : "local time";
  }
}

/** Time zones offered in a picker after the device's and the saved one. */
export const COMMON_TIME_ZONES = [
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Africa/Cairo",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
];
/** The device's own time zone id, or "". */
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
/** "Dubai · Gulf Standard Time" for "Asia/Dubai" (a picker label). */
export function zoneChoiceLabel(zone: string, locale: Locale = "en") {
  if (locale === "ar") return zoneName(zone, "ar");
  const city = zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
  return `${city} · ${zoneName(zone)}`;
}
/** Picker choices: the device's zone first, then `current`, then the region. */
export function timeZoneChoices(current?: string | null, locale: Locale = "en") {
  const device = deviceTimeZone();
  return [...new Set([device, current ?? "", ...COMMON_TIME_ZONES])]
    .filter(Boolean)
    .map((zone) => ({
      value: zone,
      label:
        zone === device
          ? `${locale === "ar" ? "هذا الجهاز" : "This device"} · ${zoneChoiceLabel(zone, locale)}`
          : zoneChoiceLabel(zone, locale),
    }));
}

/** "1 serving", "2 servings", "1 sessions" never. English only: use a catalog plural in Arabic. */
export function plural(count: number, one: string, many = one + "s") {
  return `${count} ${count === 1 ? one : many}`;
}

/** "0:45", "1:30": a rest or countdown in minutes and seconds (isolated in Arabic). */
export function formatCountdown(totalSeconds: number, locale: Locale = "en") {
  const s = Math.max(0, Math.round(totalSeconds));
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return rtl(locale) ? isolate(text, "ltr") : text;
}

/** "1,250", "12.5" in the member's language (Latin digits in Arabic). */
export function formatNumber(
  value: number,
  locale: Locale = "en",
  options: Intl.NumberFormatOptions = {},
) {
  const text = new Intl.NumberFormat(localeTag(locale), {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
  return rtl(locale) ? isolate(text, "ltr") : text;
}

/**
 * A numeric range or expression kept in reading order in any direction:
 * "1–10", "8–12", "3 × 10". One left-to-right isolate around the whole
 * thing; isolating each number separately would still let a right-to-left
 * sentence reverse "1–10" into "10–1".
 */
export function formatRange(
  from: number | string,
  to: number | string,
  locale: Locale = "en",
  separator = "–",
) {
  const text = `${typeof from === "number" ? formatNumber(from, "en") : from}${separator}${typeof to === "number" ? formatNumber(to, "en") : to}`;
  return rtl(locale) ? isolate(text, "ltr") : text;
}
/** "3 × 10", "3 × 8–12": sets by reps, never reversed in right to left. */
export function formatSetsReps(
  sets: number | string,
  reps: number | string,
  locale: Locale = "en",
) {
  return formatRange(sets, reps, locale, " × ");
}

/**
 * Money in minor units (fils): "AED 1,250.00" in English (the product's
 * existing format, `money` in @trainer/domain), "1,250.00 د.إ." in Arabic.
 */
export function formatMoney(
  minor: number | string,
  locale: Locale = "en",
  currency = "AED",
) {
  const text = new Intl.NumberFormat(rtl(locale) ? localeTag("ar") : "en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
  return rtl(locale) ? isolate(text) : text;
}

/**
 * A length of time from minutes: "45 min", "1 h 30 min"; Arabic
 * "45 دقيقة", "ساعة و30 دقيقة" (Intl units, so the Arabic noun agrees
 * with the number).
 */
export function formatDuration(minutes: number, locale: Locale = "en") {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60),
    m = total % 60;
  if (!rtl(locale)) {
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const unit = (value: number, name: "hour" | "minute") =>
    new Intl.NumberFormat(localeTag("ar"), {
      style: "unit",
      unit: name,
      unitDisplay: "long",
    }).format(value);
  const text = !h
    ? unit(m, "minute")
    : m
      ? `${unit(h, "hour")} و${unit(m, "minute")}`
      : unit(h, "hour");
  return isolate(text);
}

/** "5 minutes ago", "yesterday"; Arabic "قبل 5 دقائق", "أمس". */
export function formatRelative(
  value: Instant | null | undefined,
  locale: Locale = "en",
  now = Date.now(),
) {
  const found = read(value);
  if (!found) return "";
  const seconds = (found.date.getTime() - now) / 1000;
  const format = new Intl.RelativeTimeFormat(localeTag(locale), {
    numeric: "auto",
  });
  const abs = Math.abs(seconds);
  const text =
    abs < 3600
      ? format.format(Math.round(seconds / 60), "minute")
      : abs < 86400
        ? format.format(Math.round(seconds / 3600), "hour")
        : format.format(Math.round(seconds / 86400), "day");
  return wrap(locale, text);
}

/** "A, B and C"; Arabic "أ وب وج". */
export function formatList(items: string[], locale: Locale = "en") {
  return new Intl.ListFormat(localeTag(locale), {
    type: "conjunction",
  }).format(items);
}

/**
 * A stored key as words, for a value with no label of its own:
 * "in_progress" → "In progress". Prefer a label map; this is the fallback.
 */
export function humanize(key?: string | null) {
  if (!key) return "";
  const words = String(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** A label from `labels`, else the humanized key. */
export function labelFor(labels: Record<string, string>, key?: string | null) {
  if (!key) return "";
  return labels[key] ?? humanize(key);
}
