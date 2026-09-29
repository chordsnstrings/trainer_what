/**
 * One date, time and wording format for every subscriber screen
 * (docs/features/member-screens.md): "29 Sep 2026", "14:05",
 * "29 Sep 2026, 14:05", "Tue 29 Sep". Never seconds, never an ISO date,
 * never a raw time zone id. English today; the Arabic track adds locale
 * support here, so screens keep calling these helpers.
 *
 * Two kinds of value:
 * - an instant (an ISO timestamp, a Date or epoch milliseconds) is shown in
 *   a time zone: the one given, else the device's own;
 * - a calendar date ("2026-09-29", a programme or meal day) is a day, not an
 *   instant, and is never shifted by a time zone.
 */
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

/** The calendar parts of a value; null when it is not a date. */
function parts(value: Instant | null | undefined, zone?: string | null) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && CALENDAR_DATE.test(value)) {
    const d = new Date(value + "T12:00:00Z");
    if (Number.isNaN(d.getTime())) return null;
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      weekday: d.getUTCDay(),
      hour: 12,
      minute: 0,
    } satisfies Parts;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const read = new Intl.DateTimeFormat("en-US", {
    timeZone: validZone(zone),
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) =>
    read.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")) - 1,
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  } satisfies Parts;
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
};

/** "29 Sep 2026" (or "Tue 29 Sep", "29 September 2026"). */
export function formatDate(
  value: Instant | null | undefined,
  options: DateOptions = {},
) {
  const p = parts(value, options.zone);
  if (!p) return options.fallback ?? "";
  const month = (options.longMonth ? LONG_MONTHS : MONTHS)[p.month];
  const weekday =
    options.weekday === "long"
      ? LONG_WEEKDAYS[p.weekday] + " "
      : options.weekday
        ? WEEKDAYS[p.weekday] + " "
        : "";
  return `${weekday}${p.day} ${month}${options.year === false ? "" : " " + p.year}`;
}

/** "14:05": 24-hour, never seconds. */
export function formatTime(
  value: Instant | null | undefined,
  options: { zone?: string | null; fallback?: string } = {},
) {
  if (typeof value === "string" && CALENDAR_DATE.test(value))
    return options.fallback ?? "";
  const p = parts(value, options.zone);
  if (!p) return options.fallback ?? "";
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "29 Sep 2026, 14:05" (the year is left out when `year: false`). */
export function formatDateTime(
  value: Instant | null | undefined,
  options: DateOptions = {},
) {
  const day = formatDate(value, options);
  if (!day) return options.fallback ?? "";
  return `${day}, ${formatTime(value, options)}`;
}

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
  const today = calendarDate(options.now ?? new Date(), options.zone);
  const day = `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const time = formatTime(value, options);
  if (day === today) return `Today, ${time}`;
  if (day === addCalendarDays(today, -1)) return `Yesterday, ${time}`;
  const thisYear = p.year === Number(today.slice(0, 4));
  return formatDateTime(value, { ...options, year: !thisYear ? true : false });
}

/** "29 Sep – 5 Oct 2026", "1 – 7 Oct 2026", "28 Dec 2026 – 3 Jan 2027". */
export function formatDateRange(
  from: Instant | null | undefined,
  to: Instant | null | undefined,
  options: { zone?: string | null } = {},
) {
  const a = parts(from, options.zone),
    b = parts(to, options.zone);
  if (!a || !b) return formatDate(from ?? to, options);
  if (a.year !== b.year)
    return `${formatDate(from, options)} – ${formatDate(to, options)}`;
  if (a.month !== b.month)
    return `${a.day} ${MONTHS[a.month]} – ${b.day} ${MONTHS[b.month]} ${b.year}`;
  if (a.day !== b.day)
    return `${a.day} – ${b.day} ${MONTHS[b.month]} ${b.year}`;
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
export function recentDays(today: string, current?: string | null, days = 7) {
  const list = Array.from({ length: days }, (_, i) =>
    addCalendarDays(today, -i),
  );
  if (current && CALENDAR_DATE.test(current) && !list.includes(current))
    list.push(current);
  return list.map((value, i) => {
    const day = formatDate(value, { weekday: true, year: false });
    return {
      value,
      label: i === 0 ? `Today, ${day}` : i === 1 ? `Yesterday, ${day}` : day,
    };
  });
}

/**
 * The next `days` calendar days from `today` as picker choices ("Today, Wed
 * 30 Sep", "Tomorrow, Thu 1 Oct", "Fri 2 Oct"), for choosing a future day
 * without a date field.
 */
export function nextDays(today: string, days = 14) {
  return Array.from({ length: days }, (_, i) => {
    const value = addCalendarDays(today, i);
    const day = formatDate(value, { weekday: true, year: false });
    return {
      value,
      label: i === 0 ? `Today, ${day}` : i === 1 ? `Tomorrow, ${day}` : day,
    };
  });
}

/** "Gulf Standard Time" for "Asia/Dubai": people never see a raw zone id. */
export function zoneName(zone?: string | null) {
  if (!zone) return "your local time";
  try {
    return (
      new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "long" })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? "local time"
    );
  } catch {
    return "local time";
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
export function zoneChoiceLabel(zone: string) {
  const city = zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
  return `${city} · ${zoneName(zone)}`;
}
/** Picker choices: the device's zone first, then `current`, then the region. */
export function timeZoneChoices(current?: string | null) {
  const device = deviceTimeZone();
  return [...new Set([device, current ?? "", ...COMMON_TIME_ZONES])]
    .filter(Boolean)
    .map((zone) => ({
      value: zone,
      label:
        zone === device
          ? `This device · ${zoneChoiceLabel(zone)}`
          : zoneChoiceLabel(zone),
    }));
}

/** "1 serving", "2 servings", "1 sessions" never. */
export function plural(count: number, one: string, many = one + "s") {
  return `${count} ${count === 1 ? one : many}`;
}

/** "0:45", "1:30": a rest or countdown in minutes and seconds. */
export function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
