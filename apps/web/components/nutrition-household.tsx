"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Field } from "./field";
import { useLocale } from "../lib/i18n/react";
import { translator } from "../lib/i18n/core";
import copy from "../lib/i18n/messages/nutrition-household";
import { formatDate, formatDateRange, formatDuration } from "../lib/format";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import type { NutritionProfile } from "../../../packages/domain/src/nutrition";
import type { NutritionKitchenPack } from "../../../packages/domain/src/nutrition-household";

const list = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[,،]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
export function nutritionPreferencesFromForm(f: FormData) {
  return {
    ...(f.get("energyEstimate") === "on"
      ? {
          energy: {
            heightCm: Number(f.get("heightCm")),
            equationSex: f.get("equationSex"),
            activity: f.get("activity"),
          },
        }
      : {}),
    preferences: {
      cuisines: list(f.get("cuisines")),
      likedFoods: list(f.get("likedFoods")),
      halal: f.get("halal") === "on",
      batchCooking: f.get("batchCooking") === "on",
    },
    kitchen: {
      cook: f.get("cook"),
      portions: Number(f.get("kitchenPortions")),
      language: f.get("kitchenLanguage"),
      region: f.get("region"),
      instructions: String(f.get("kitchenInstructions") ?? ""),
    },
  };
}

export function NutritionPreferencesFields({
  initial,
}: {
  initial?: NutritionProfile;
}) {
  const locale = useLocale(),
    t = translator(copy, locale),
    [energy, setEnergy] = useState(!!initial?.energy);
  return (
    <>
      <details className="nutrition-personal-fields" open={!!initial?.energy}>
        <summary>{t("energyInputs")}</summary>
        <label className="check">
          <input
            name="energyEstimate"
            type="checkbox"
            checked={energy}
            onChange={(e) => setEnergy(e.target.checked)}
          />
          {t("energyOptIn")}
        </label>
        {energy && (
          <div className="nutrition-form-grid">
            <Field label={t("height")}>
              <input
                name="heightCm"
                type="number"
                min={120}
                max={230}
                step="0.1"
                defaultValue={initial?.energy?.heightCm ?? ""}
                required
              />
            </Field>
            <Field label={t("sex")}>
              <select
                name="equationSex"
                defaultValue={initial?.energy?.equationSex ?? ""}
                required
              >
                <option value="">{t("choose")}</option>
                <option value="female">{t("female")}</option>
                <option value="male">{t("male")}</option>
              </select>
            </Field>
            <Field label={t("activity")}>
              <select
                name="activity"
                defaultValue={initial?.energy?.activity ?? ""}
                required
              >
                <option value="">{t("choose")}</option>
                {(["low", "light", "moderate", "high"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <p className="muted">{t("inputHelp")}</p>
      </details>
      <details className="nutrition-personal-fields">
        <summary>{t("preferences")}</summary>
        <div className="nutrition-form-grid">
          <Field label={t("cuisines")}>
            <input
              name="cuisines"
              defaultValue={initial?.preferences?.cuisines.join(", ")}
              placeholder={t("cuisinesHint")}
              maxLength={1000}
            />
          </Field>
          <Field label={t("likedFoods")}>
            <input
              name="likedFoods"
              defaultValue={initial?.preferences?.likedFoods.join(", ")}
              maxLength={1000}
            />
          </Field>
          <Field label={t("cook")}>
            <select name="cook" defaultValue={initial?.kitchen?.cook ?? "self"}>
              {(["self", "family", "helper", "chef"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("portions")}>
            <input
              name="kitchenPortions"
              type="number"
              min={1}
              max={12}
              defaultValue={initial?.kitchen?.portions ?? 1}
              required
            />
          </Field>
          <Field label={t("language")}>
            <select
              name="kitchenLanguage"
              defaultValue={initial?.kitchen?.language ?? locale}
            >
              <option value="en">{t("english")}</option>
              <option value="ar">{t("arabic")}</option>
            </select>
          </Field>
          <Field label={t("region")}>
            <select
              name="region"
              defaultValue={initial?.kitchen?.region ?? "AE"}
            >
              <option value="AE">{t("uae")}</option>
              <option value="other">{t("elsewhere")}</option>
            </select>
          </Field>
        </div>
        <p className="muted">{t("portionsHelp")}</p>
        <label className="check">
          <input
            name="halal"
            type="checkbox"
            defaultChecked={initial?.preferences?.halal}
          />
          {t("halal")}
        </label>
        <label className="check">
          <input
            name="batchCooking"
            type="checkbox"
            defaultChecked={initial?.preferences?.batchCooking}
          />
          {t("batch")}
        </label>
        <Field label={t("instructions")}>
          <textarea
            name="kitchenInstructions"
            defaultValue={initial?.kitchen?.instructions ?? ""}
            maxLength={1000}
          />
        </Field>
        <p className="muted">{t("instructionsHelp")}</p>
      </details>
    </>
  );
}

export function NutritionGuidance({ guidance }: { guidance: any }) {
  const t = translator(copy, useLocale()),
    e = guidance?.energy;
  return (
    <details className="nutrition-card nutrition-guidance">
      <summary>{t("guide")}</summary>
      <p>{t("principle")}</p>
      {guidance?.state === "review" ? (
        <p>{t("review")}</p>
      ) : (
        <>
          {e ? (
            <>
              <h3>{t("estimate", { kcal: e.maintenanceKcal })}</h3>
              <p>
                {t("resting", {
                  kcal: e.restingKcal,
                  factor: e.activityFactor,
                })}
              </p>
              <p>
                {e.adjustmentKcal < 0
                  ? t("deficit", {
                      kcal: e.targetKcal,
                      delta: -e.adjustmentKcal,
                    })
                  : e.adjustmentKcal > 0
                    ? t("surplus", {
                        kcal: e.targetKcal,
                        delta: e.adjustmentKcal,
                      })
                    : t("maintenance", { kcal: e.targetKcal })}
              </p>
              {!e.personalized && <p>{t("standard")}</p>}
              <p className="muted">{t("uncertainty")}</p>
            </>
          ) : (
            <p>{t("noEstimate")}</p>
          )}
          <p>{t("dietHelp")}</p>
          <ul>
            {guidance?.diets?.map((d: any) => (
              <li key={d.diet}>
                <p>
                  {t("dietFits", {
                    diet: d.diet,
                    count: d.recipes,
                    cuisines: d.cuisineMatches,
                  })}
                </p>
                {d.missingSlots.length > 0 && (
                  <p>{t("dietGap", { slots: d.missingSlots.join(", ") })}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="muted">{t("dietNote")}</p>
        </>
      )}
    </details>
  );
}

type Pack = NutritionKitchenPack & {
  planId: string;
  version: number;
  sample: boolean;
};
async function readPack(planId: string): Promise<Pack> {
  const response = await fetch(
    memberApiUrl("/api/v1/nutrition/kitchen/" + planId),
    { cache: "no-store", credentials: "same-origin" },
  );
  if (!response.ok) throw Error("kitchen_unavailable");
  return response.json();
}
export function NutritionKitchenButton({
  planId,
  disabled = false,
}: {
  planId: string;
  disabled?: boolean;
}) {
  const t = translator(copy, useLocale()),
    [pack, setPack] = useState<Pack | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  return (
    <div className="nutrition-kitchen-action">
      <button
        type="button"
        className="button secondary"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            setPack(await readPack(planId));
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t(busy ? "loading" : "printOpen")}
      </button>
      {error && <p role="alert">{t("error")}</p>}
      {pack &&
        createPortal(
          <KitchenDialog
            pack={pack}
            refresh={async () => {
              const next = await readPack(planId);
              flushSync(() => setPack(next));
              return next;
            }}
            close={() => setPack(null)}
          />,
          document.body,
        )}
    </div>
  );
}

function KitchenDialog({
  pack,
  close,
  refresh,
}: {
  pack: Pack;
  close: () => void;
  refresh: () => Promise<Pack>;
}) {
  const [locale, setLocale] = useState(pack.kitchen.language);
  const t = translator(copy, locale),
    dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    document.body.classList.add("nutrition-kitchen-open");
    return () => document.body.classList.remove("nutrition-kitchen-open");
  }, []);
  const date = (value: string) =>
    formatDate(value, { locale, weekday: true, year: false });
  const preparation = (value: string) => t.dynamic(value, value);
  async function output(csv: boolean) {
    setBusy(true);
    setError(false);
    try {
      const current = await refresh();
      if (csv) {
        const quote = (value: unknown) =>
          '"' +
          String(value ?? "")
            .replace(/^[\s]*[=+@-]/, "'")
            .replaceAll('"', '""') +
          '"';
        const rows = [
          [
            t("ingredient"),
            t("basis"),
            t("needed"),
            t("available"),
            t("remaining"),
            t("buy"),
            t("conversion"),
          ],
          ...current.shopping.map((g) => [
            g.name,
            preparation(g.preparation),
            g.grams,
            g.availableGrams,
            g.remainingGrams,
            g.purchasedGrams ?? "",
            g.purchaseLabel ?? t("noConversion"),
          ]),
        ];
        const url = URL.createObjectURL(
          new Blob(
            [
              "\uFEFF" +
                rows.map((row) => row.map(quote).join(",")).join("\r\n"),
            ],
            { type: "text/csv;charset=utf-8" },
          ),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "household-groceries-" + current.weekStart + ".csv";
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await document.fonts.ready;
        window.print();
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="nutrition-kitchen"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      aria-labelledby="nutrition-kitchen-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      {/* A mounted-only page rule also applies to a modal in the top layer. */}
      <style media="print">{"@page { size: A4; margin: 14mm; }"}</style>
      <div className="nutrition-kitchen-toolbar">
        <Field label={t("language")}>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as "en" | "ar")}
          >
            <option value="en">{t("english")}</option>
            <option value="ar">{t("arabic")}</option>
          </select>
        </Field>
        <button
          className="button"
          disabled={busy}
          onClick={() => void output(false)}
        >
          {t("print")}
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void output(true)}
        >
          {t("download")}
        </button>
        <button className="button secondary" onClick={close}>
          {t("close")}
        </button>
      </div>
      {error ? <p role="alert">{t("error")}</p> : null}
      <div hidden={error}>
        <header>
          <h1 id="nutrition-kitchen-title">{t("printTitle")}</h1>
          <p>{formatDateRange(pack.weekStart, pack.weekEnd, { locale })}</p>
          <p>
            {t("forCook", { cook: t(pack.kitchen.cook) })} ·{" "}
            {t("scale", { count: pack.kitchen.portions })}
          </p>
          {pack.sample && <strong>{t("sample")}</strong>}
          <p>{t("handoff")}</p>
        </header>
        <section className="nutrition-kitchen-restrictions">
          <h2>{t("restrictions")}</h2>
          <p>
            {t("allergens", {
              items: pack.restrictions.allergens.join(", ") || t("none"),
            })}
          </p>
          <p>
            {t("exclusions", {
              items: pack.restrictions.exclusions.join(", ") || t("none"),
            })}
          </p>
          {pack.restrictions.halal && <p>{t("halal")}</p>}
          <p>{t("labelCheck")}</p>
          {pack.kitchen.instructions && (
            <p dir="auto">{pack.kitchen.instructions}</p>
          )}
        </section>
        <section>
          <h2>{t("calendar")}</h2>
          <div className="nutrition-kitchen-days">
            {pack.days.map((day) => (
              <article key={day.date}>
                <h3>{date(day.date)}</h3>
                <ul>
                  {day.meals.map((meal) => (
                    <li key={meal.slot}>
                      <bdi>
                        {meal.slot}: {meal.name}
                      </bdi>{" "}
                      — {t("recipeNumber", { number: meal.recipe })}
                      <br />
                      {t("yourPortion")}: {meal.memberServings} ·{" "}
                      {t("cookPortion")}: {meal.cookServings}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
        <section className="nutrition-kitchen-recipes">
          <h2>{t("recipes")}</h2>
          {pack.recipes.map((r) => (
            <article key={r.number} className="nutrition-kitchen-recipe">
              <h3>
                {t("recipeNumber", { number: r.number })} · <bdi>{r.name}</bdi>
              </h3>
              <p>
                {t("repeated", {
                  uses: r.uses
                    .map((u) => `${date(u.date)} · ${u.slot}`)
                    .join("; "),
                })}
              </p>
              <p>
                <bdi>{r.cookingName}</bdi> · {formatDuration(r.minutes, locale)}{" "}
                · <bdi>{r.equipment.join(", ")}</bdi>
              </p>
              {r.originalYield !== null && (
                <p>{t("original", { servings: r.originalYield })}</p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>{t("ingredient")}</th>
                    <th>{t("basis")}</th>
                    <th>{t("memberAmount")}</th>
                    <th>{t("cookingAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.ingredients.map((i, index) => (
                    <tr key={index}>
                      <td dir="auto">{i.name}</td>
                      <td>{preparation(i.preparation)}</td>
                      <td>{i.memberGrams}</td>
                      <td>{i.cookGrams}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>{t("stepsNote")}</p>
              <ol>
                {r.steps.map((step, i) => (
                  <li key={i} dir="auto">
                    {step}
                  </li>
                ))}
              </ol>
              <p>
                <strong>{t("storage")}: </strong>
                <bdi>{r.storageNote || t("storageMissing")}</bdi>
              </p>
            </article>
          ))}
        </section>
        <section className="nutrition-kitchen-shopping">
          <h2>{t("shopping")}</h2>
          <p>{t("shoppingHelp")}</p>
          {pack.shopping.map((g, i) => (
            <article key={i}>
              <h3>
                ☐ <bdi>{g.name}</bdi> · {preparation(g.preparation)}
              </h3>
              <p>
                {t("needed")}: {g.grams} · {t("available")}: {g.availableGrams}{" "}
                · {t("remaining")}: {g.remainingGrams}
              </p>
              <p>
                {g.purchaseGrams === null
                  ? t("noConversion")
                  : g.packs !== null
                    ? t("packs", { packs: g.packs, grams: g.purchasedGrams! })
                    : t("grams", { grams: g.purchaseGrams })}{" "}
                <bdi>{g.purchaseLabel ?? ""}</bdi>
              </p>
              {g.conversionSource && (
                <p className="muted">
                  {t("conversion")}: <bdi>{g.conversionSource}</bdi>
                </p>
              )}
            </article>
          ))}
          <p>{t("fullWeek")}</p>
          {pack.kitchen.region === "AE" && (
            <>
              <p>{t("uaeTip")}</p>
              <a
                href="https://www.dm.gov.ae/municipality-business/for-consumers-in-dubai/"
                target="_blank"
                rel="noreferrer"
              >
                {t("source")}
              </a>
            </>
          )}
        </section>
        <footer>
          <p>{t("dated")}</p>
        </footer>
      </div>
    </dialog>
  );
}
