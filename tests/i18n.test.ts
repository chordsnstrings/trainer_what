// Subscriber translations (docs/features/arabic.md): every English message
// has reviewed Arabic with the same placeholders and all six Arabic plural
// forms; values are isolated so right-to-left sentences keep numbers, names,
// ranges and prices in order; dates, numbers and money use UAE Arabic with
// Latin digits; converted member screens render in Arabic with no English
// chrome left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CATALOG } from "../apps/web/lib/i18n/catalog.ts";
import {
  FSI,
  LRI,
  PDI,
  interpolate,
  isolate,
  pluralCategory,
  stripIsolates,
  translator,
  type Locale,
  type Namespace,
} from "../apps/web/lib/i18n/core.ts";
import { errorText } from "../apps/web/lib/i18n/errors.ts";
import { LocaleProvider } from "../apps/web/lib/i18n/react.tsx";
import { money } from "@trainer/domain";
import {
  formatCountdown,
  formatDate,
  formatDateRange,
  formatDuration,
  formatMoney,
  formatNumber,
  formatRange,
  formatRelative,
  formatSetsReps,
  formatTime,
  zoneName,
} from "../apps/web/lib/format.ts";
import {
  lastSyncedText,
  queuedLabel,
  queuedSummary,
} from "../apps/web/components/pwa.ts";
import { MemberShell, MoreScreen } from "../apps/web/components/member-shell.tsx";
import { OfflineScreen } from "../apps/web/components/pwa-ui.tsx";
import { WeekView, ProfileForm, NutritionSubscriber } from "../apps/web/components/nutrition.tsx";
import { MealCapture } from "../apps/web/components/meal-capture.tsx";
import { UpfrontMembership } from "../apps/web/components/programme-membership.tsx";
import { BillingHistory } from "../apps/web/components/finance-completion.tsx";
import { VoiceSessionRunner } from "../apps/web/components/voice-session.tsx";
import {
  APP_SHORTCUTS_AR,
  memberAppDescription,
} from "../packages/contracts/src/discovery.ts";

const SIX = ["zero", "one", "two", "few", "many", "other"] as const;
const placeholders = (text: string) =>
  new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]));
const tags = (text: string) =>
  [...text.matchAll(/<([a-z]+)>/g)].map((m) => m[1]).sort();
const ARABIC_LETTER = /[؀-ۿ]/;

test("catalog: every English key has Arabic of the same shape, with six plural forms", () => {
  let keys = 0;
  for (const [name, namespace] of Object.entries(CATALOG)) {
    const en = namespace.en as Record<string, unknown>,
      ar = namespace.ar as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(ar).sort(),
      Object.keys(en).sort(),
      `${name}: Arabic and English keys differ`,
    );
    for (const [key, message] of Object.entries(en)) {
      keys++;
      const arabic = ar[key];
      const where = `${name}.${key}`;
      if (typeof message === "string") {
        assert.equal(typeof arabic, "string", `${where} is a plain message`);
        continue;
      }
      assert.deepEqual(
        Object.keys(message as object).sort(),
        ["one", "other"],
        `${where}: English plural has one and other`,
      );
      assert.equal(typeof arabic, "object", `${where} is a plural`);
      assert.deepEqual(
        Object.keys(arabic as object).sort(),
        [...SIX].sort(),
        `${where}: Arabic plural needs zero, one, two, few, many and other`,
      );
    }
  }
  assert.ok(keys > 1500, `the catalog holds the subscriber surfaces (${keys} keys)`);
});

test("catalog: placeholders and markup tags match; Arabic text is Arabic", () => {
  for (const [name, namespace] of Object.entries(CATALOG)) {
    const en = namespace.en as Record<string, string | Record<string, string>>,
      ar = namespace.ar as Record<string, string | Record<string, string>>;
    for (const [key, message] of Object.entries(en)) {
      const where = `${name}.${key}`;
      if (typeof message === "string") {
        const arabic = ar[key] as string;
        assert.deepEqual(
          [...placeholders(arabic)].sort(),
          [...placeholders(message)].sort(),
          `${where}: placeholders differ`,
        );
        assert.deepEqual(tags(arabic), tags(message), `${where}: tags differ`);
        // A message of words (not only "{price}" or punctuation) is Arabic.
        if (/[A-Za-z]{2,}/.test(message.replace(/\{[^}]+\}|<[^>]+>/g, "")))
          assert.match(arabic, ARABIC_LETTER, `${where} is not translated`);
        continue;
      }
      const english = new Set([
        ...placeholders(message.one),
        ...placeholders(message.other),
      ]);
      const arabic = ar[key] as Record<string, string>;
      for (const form of SIX) {
        for (const p of placeholders(arabic[form]))
          assert.ok(english.has(p), `${where}.${form}: unknown {${p}}`);
        // "zero" may be a bare value ("{price}") or empty by design.
        if (
          form !== "zero" &&
          /[A-Za-z]{2,}/.test(message.other.replace(/\{[^}]+\}|<[^>]+>/g, ""))
        )
          assert.match(arabic[form] || "ا", ARABIC_LETTER, `${where}.${form}`);
      }
      // The general form carries every value the English one does.
      assert.deepEqual(
        [...placeholders(arabic.other)].sort(),
        [...placeholders(message.other)].sort(),
        `${where}.other: placeholders differ`,
      );
      if (message.other.includes("#"))
        assert.ok(arabic.other.includes("#"), `${where}.other shows the count`);
    }
  }
});

test("catalog: Arabic addresses the member without masculine commands in the chrome", () => {
  // Common masculine imperatives the chrome avoids (gender-neutral wording
  // uses a verbal noun, "يُرجى" or "يمكنك"). Safety instructions to stop
  // exercising stay direct and are listed by key.
  const commands = /(^|[\s«(])(ابدأ|اختر|أدخل|اضغط|انقر|احفظ|أكمل|أرسل|اكتب|جهّز)(\s|$|[.،])/;
  const safety = new Set(["voice.stopNow", "voice.stopped", "voice.painOffline"]);
  for (const [name, namespace] of Object.entries(CATALOG))
    for (const [key, message] of Object.entries(
      namespace.ar as Record<string, string | Record<string, string>>,
    )) {
      if (safety.has(`${name}.${key}`)) continue;
      for (const text of typeof message === "string"
        ? [message]
        : Object.values(message))
        assert.doesNotMatch(text, commands, `${name}.${key}: "${text}"`);
    }
});

test("Arabic plural rules: zero, one, two, few (3–10), many (11–99), other", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 10, 11, 99, 100, 102].map((n) => pluralCategory("ar", n)),
    ["zero", "one", "two", "few", "few", "many", "many", "other", "other"],
  );
  assert.deepEqual(
    [0, 1, 2].map((n) => pluralCategory("en", n)),
    ["other", "one", "other"],
  );
  const t = translator(CATALOG.voice, "ar");
  assert.deepEqual(
    [0, 1, 2, 3, 11, 100].map((n) => stripIsolates(t("reps", { count: n }))),
    ["0 تكرار", "تكرار واحد", "تكراران", "3 تكرارات", "11 تكرارًا", "100 تكرار"],
  );
  const en = translator(CATALOG.voice, "en");
  assert.equal(en("reps", { count: 1 }), "1 rep");
  assert.equal(en("reps", { count: 12 }), "12 reps");
});

test("interpolation: Arabic isolates every value; English output is unchanged", () => {
  assert.equal(
    interpolate("en", "Stay with {name}", { name: "Alex Morgan" }),
    "Stay with Alex Morgan",
  );
  assert.equal(
    interpolate("ar", "البقاء مع {name}", { name: "Alex Morgan" }),
    `البقاء مع ${FSI}Alex Morgan${PDI}`,
  );
  // Numbers read left to right with Latin digits, grouped from 10,000.
  assert.equal(
    interpolate("ar", "{n} قياس", { n: 12500 }),
    `${LRI}12,500${PDI} قياس`,
  );
  assert.equal(interpolate("ar", "سنة {year}", { year: 2026 }), `سنة ${LRI}2026${PDI}`);
  // A "#" inside a value is never taken for the count.
  assert.equal(
    interpolate("en", "{name}: # sets", { name: "Plan #2" }, 3),
    "Plan #2: 3 sets",
  );
  assert.equal(isolate(""), "");
});

test("translator: a key missing in Arabic falls back to English; dynamic keys fall back", () => {
  const partial = {
    en: { hello: "Hello {name}", only: "Only English" },
    ar: { hello: "مرحبًا {name}" },
  } as unknown as Namespace<{ hello: "Hello {name}"; only: "Only English" }>;
  const t = translator(partial, "ar");
  assert.equal(stripIsolates(t("hello", { name: "Sam" })), "مرحبًا Sam");
  assert.equal(t("only"), "Only English");
  const m = translator(CATALOG.membership, "ar");
  assert.equal(m.dynamic("status_active", "active"), "نشط");
  assert.equal(m.dynamic("status_something_new", "Something new"), "Something new");
});

test("request errors: English keeps the server's sentence; Arabic never shows it", () => {
  const error = Object.assign(new Error("The slot is full, sorry."), {
    status: 409,
    code: "SLOT_FULL",
  });
  assert.equal(errorText(error, "en"), "The slot is full, sorry.");
  assert.equal(errorText(error, "ar"), "هذه الجلسة مكتملة.");
  const unknown = Object.assign(new Error("Internal detail"), { status: 503 });
  assert.equal(errorText(unknown, "ar"), "حدث خطأ من جهتنا. يُرجى المحاولة مرة أخرى.");
  assert.equal(
    errorText(Object.assign(new Error("x"), { status: 404 }), "ar"),
    "لم يعد هذا متاحًا.",
  );
  assert.match(errorText(new TypeError("Failed to fetch"), "ar"), /لا يوجد اتصال/);
  assert.equal(
    errorText(Object.assign(new Error("No passkey was selected."), { code: "PASSKEY_NONE" }), "ar"),
    "لم يُختر أي مفتاح مرور.",
  );
});

test("numbers and money: UAE Arabic with Latin digits, isolated; English unchanged", () => {
  assert.equal(formatNumber(1250, "ar"), `${LRI}1,250${PDI}`);
  assert.equal(formatNumber(1250), "1,250");
  assert.equal(formatNumber(12.5, "ar"), `${LRI}12.5${PDI}`);
  const aed = formatMoney(125000, "ar");
  assert.ok(aed.startsWith(FSI) && aed.endsWith(PDI));
  assert.match(aed, /1,250\.00/);
  assert.match(aed, /د\.إ\./);
  assert.doesNotMatch(aed, /[٠-٩]/, "no Arabic-Indic digits");
  // English keeps the product's existing format (a no-break space after AED).
  assert.equal(formatMoney(125000), money(125000));
  assert.equal(formatMoney(125000).replace(/\s/, " "), "AED 1,250.00");
});

test("ranges and set × rep expressions stay in reading order in right to left", () => {
  assert.equal(formatRange(1, 10, "ar"), `${LRI}1–10${PDI}`);
  assert.equal(formatRange(8, 12), "8–12");
  assert.equal(formatSetsReps(3, 10, "ar"), `${LRI}3 × 10${PDI}`);
  assert.equal(formatSetsReps(3, "8–12", "ar"), `${LRI}3 × 8–12${PDI}`);
  assert.equal(formatSetsReps(3, 10), "3 × 10");
  assert.equal(formatCountdown(90, "ar"), `${LRI}1:30${PDI}`);
  assert.equal(formatCountdown(90), "1:30");
});

test("dates and times: Arabic month names, Latin digits, never an ISO date or zone id", () => {
  assert.equal(formatDate("2026-09-29", { locale: "ar" }), `${FSI}29 سبتمبر 2026${PDI}`);
  assert.equal(formatDate("2026-09-29"), "29 Sep 2026");
  assert.equal(
    stripIsolates(formatDate("2026-09-29", { locale: "ar", weekday: true })),
    "الثلاثاء، 29 سبتمبر 2026",
  );
  assert.equal(
    formatTime("2026-09-29T14:05:00Z", { locale: "ar", zone: "UTC" }),
    `${LRI}14:05${PDI}`,
  );
  assert.equal(
    stripIsolates(formatDateRange("2026-10-05", "2026-10-11", { locale: "ar" })),
    "5–11 أكتوبر 2026",
  );
  assert.equal(stripIsolates(formatDuration(90, "ar")), "ساعة و30 دقيقة");
  assert.equal(formatDuration(90), "1 h 30 min");
  assert.equal(
    stripIsolates(formatRelative(Date.now() - 5 * 60000, "ar")),
    "قبل 5 دقائق",
  );
  const zone = zoneName("Asia/Dubai", "ar");
  assert.doesNotMatch(zone, /Asia\/Dubai/);
  assert.match(zone, ARABIC_LETTER);
});

test("device queue and sync lines in Arabic", () => {
  assert.match(queuedLabel("ar"), ARABIC_LETTER);
  assert.equal(queuedLabel("en"), "Saved on this phone — will sync");
  assert.match(stripIsolates(queuedSummary(3, "set", "ar")), /3/);
  assert.match(queuedSummary(3, "set", "ar"), ARABIC_LETTER);
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.match(lastSyncedText(now - 5 * 60000, now, "ar") ?? "", ARABIC_LETTER);
});

test("the Arabic member app manifest: description and shortcuts", () => {
  const description = memberAppDescription("Alex Morgan", true, "ar");
  assert.match(description, ARABIC_LETTER);
  assert.ok(description.includes(`${FSI}Alex Morgan${PDI}`));
  for (const shortcut of Object.values(APP_SHORTCUTS_AR)) {
    assert.match(shortcut.name, ARABIC_LETTER);
    assert.match(shortcut.short_name, ARABIC_LETTER);
    assert.match(shortcut.description, ARABIC_LETTER);
  }
});

// ------------------------------------------------------------------
// Rendered member screens in Arabic
// ------------------------------------------------------------------

/** Brand, product and format names that stay as they are in Arabic. */
const KEEP = new Set(
  [
    "Alex", "Morgan", "Sam", "Taylor", "Strength", "with", "JPEG", "PNG",
    "WebP", "EAN", "UPC", "GTIN", "ODbL", "Open", "Food", "Facts", "Apple",
    "Health", "HTTPS", "PDF", "Salmon", "rice", "Chicken", "salad",
    "Grilled", "Oven", "Hob", "Pan", "fried", "Coach", "Upload",
  ].map((w) => w.toLowerCase()),
);
/** English words a member would read: text and labelled attributes. */
function englishWords(html: string) {
  const visible = html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ");
  const attributes = [
    ...visible.matchAll(/\s(?:aria-label|placeholder|alt|title)="([^"]*)"/g),
  ].map((m) => m[1]);
  const text = visible.replace(/<[^>]+>/g, " ");
  return [...(text + " " + attributes.join(" ")).matchAll(/[A-Za-z]{3,}/g)]
    .map((m) => m[0])
    .filter((w) => !KEEP.has(w.toLowerCase()));
}
const inArabic = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(LocaleProvider, { locale: "ar" as Locale, children: element }),
  );

const plan = {
  id: "p1",
  status: "delivered",
  version: 1,
  data: {
    view: {
      weekStart: "2026-10-05",
      weekEnd: "2026-10-11",
      targetKcal: 2100,
      explanation: "",
      days: [
        {
          date: "2026-10-05",
          totals: { kcal: 2050, protein: 150, carbohydrate: null, fat: 70 },
          meals: [
            {
              slot: "lunch",
              name: "Salmon rice",
              servings: 1,
              nutrients: { kcal: 640 },
              cookingName: "Oven",
              minutes: 35,
              equipment: [],
              ingredients: [
                { grams: 150, food: { id: "f1", name: "Salmon", preparation: "raw" } },
              ],
              steps: [],
              source: "Coach",
            },
          ],
        },
      ],
      groceries: [],
    },
  },
};

test("member screens render in Arabic with no English chrome", () => {
  const nav = { programLabel: "My program", nutrition: true, locale: "ar" as Locale };
  const screens: Array<[string, ReactElement]> = [
    [
      "member shell",
      createElement(MemberShell, {
        path: "/app",
        tenant: { id: "t1", name: "Alex Morgan", theme: {} },
        user: { name: "Sam Taylor", tenantId: "t1", userId: "u1" },
        nav,
        messages: [],
        onSignOut: () => {},
        children: createElement("h1", null, "—"),
      } as never),
    ],
    [
      "more",
      createElement(MoreScreen, { nav, tenantId: "t1", userId: "u1", onSignOut: () => {} } as never),
    ],
    ["offline", createElement(OfflineScreen, { onRetry: () => {}, savedAt: Date.now() - 120000 })],
    ["meal plan week", createElement(WeekView, { plan, onLog: () => {}, onSwap: () => {} })],
    ["food preferences", createElement(ProfileForm, { onSubmit: async () => null })],
    ["nutrition (loading)", createElement(NutritionSubscriber, { userId: "u1", tenantId: "t1" })],
    ["log a meal", createElement(MealCapture)],
    [
      "upfront programme",
      createElement(UpfrontMembership, {
        membership: {
          price_minor: 90000,
          period_end: "2026-12-01T00:00:00Z",
          status: "active",
          data: { programmeDays: 84, modules: ["workout", "nutrition"], upfront: {} },
        },
        offers: [],
      }),
    ],
    ["invoices (loading)", createElement(BillingHistory)],
    ["voice session (loading)", createElement(VoiceSessionRunner, { workoutId: "w1", tenantId: "t1", userId: "u1" })],
  ];
  for (const [name, element] of screens) {
    const html = inArabic(element);
    assert.match(html, ARABIC_LETTER, `${name} renders Arabic`);
    assert.deepEqual(englishWords(html), [], `${name} has English left`);
    assert.doesNotMatch(
      html.replace(/<[^>]+>/g, " "),
      /\b\d{4}-\d{2}-\d{2}\b/,
      `${name} shows an ISO date`,
    );
  }
});

test("the same screens stay English for English members", () => {
  const html = renderToStaticMarkup(createElement(WeekView, { plan }));
  assert.match(html, /Your week of meals/);
  assert.match(html, /5 – 11 Oct 2026|5–11 Oct 2026/);
  assert.match(html, /1 serving · about 640 kcal/);
  assert.doesNotMatch(html, /[⁦-⁩]/, "no isolates in English");
});
