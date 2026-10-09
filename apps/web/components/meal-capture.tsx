"use client";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "./preview-navigation";
import { StickyActionBar, useTakingLong } from "./phone-ui";
import { unsavedMark } from "./pwa";
import { formatDate, humanize, recentDays } from "../lib/format";
import { scaleCapturedPortion } from "../../../packages/domain/src/nutrition-completion";
import { Rich, useErrorText, useLocale, useT } from "../lib/i18n/react";

type Food = {
  name: string;
  portion: string;
  amount: number | null;
  unit: "g" | "ml" | "portion" | null;
  kcal: number | null;
  protein: number | null;
  carbohydrate: number | null;
  fat: number | null;
  preparation: "raw" | "cooked" | "ready_to_eat" | "unknown";
  uncertainty: string;
};
type Draft = {
  id: string;
  kind: "photo" | "barcode";
  status: string;
  data: any;
  expiresAt: string;
};
const blank = (): Food => ({
  name: "",
  portion: "",
  amount: null,
  unit: null,
  kcal: null,
  protein: null,
  carbohydrate: null,
  fat: null,
  preparation: "unknown",
  uncertainty: "User-provided estimate",
});
const value = (v: string) => (v.trim() === "" ? null : Number(v));
const total = (
  items: Food[],
  key: "kcal" | "protein" | "carbohydrate" | "fat",
) =>
  items.every((i) => i[key] !== null)
    ? Math.round(items.reduce((sum, i) => sum + (i[key] ?? 0), 0) * 100) / 100
    : null;
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(memberApiUrl("/api/v1" + path), {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.message ?? "The request could not be completed."),
      { status: response.status, code: data.code },
    );
  return data;
}
/** A problem found on this device, already in the member's words. */
const local = (text: string) => Object.assign(new Error(text), { local: true });
/** The defaults this screen writes as an item's uncertainty note. */
const UNCERTAINTY_KEYS = {
  "User-provided estimate": "userEstimate",
  "Product label data; verify your exact package and serving unit":
    "labelEstimate",
} as const;
function CameraIcon({ barcode = false }: { barcode?: boolean }) {
  return (
    <svg
      width="42"
      height="42"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {barcode ? (
        <>
          <path d="M7 16V7h9M32 7h9v9M41 32v9h-9M16 41H7v-9M13 14v20M18 14v20M23 14v20M29 14v20M35 14v20" />
          <path d="M5 24h38" opacity=".35" />
        </>
      ) : (
        <>
          <path d="M7 14h10l3-5h8l3 5h10v26H7z" />
          <circle cx="24" cy="26" r="8" />
          <path d="M34 20h2" />
        </>
      )}
    </svg>
  );
}

export function MealCapture() {
  const [mode, setMode] = useState<"photo" | "barcode" | "manual">("photo"),
    [settings, setSettings] = useState<any>(null),
    [nutrition, setNutrition] = useState<any>(null),
    [foodOptions, setFoodOptions] = useState<any[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<{
      preview: string;
      base64: string;
      key: string;
    } | null>(null),
    [photoConsent, setPhotoConsent] = useState(false),
    [context, setContext] = useState("");
  const [code, setCode] = useState(""),
    [camera, setCamera] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [items, setItems] = useState<Food[]>([]),
    [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [date, setDate] = useState(""),
    [labelUnit, setLabelUnit] = useState<"g" | "ml" | "">("");
  const [confirmation, setConfirmation] = useState(false),
    [eventKey, setEventKey] = useState("");
  const stream = useRef<MediaStream | null>(null),
    video = useRef<HTMLVideoElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    barcodeIntent = useRef<{ code: string; key: string } | null>(null),
    // Whether the member picked a method; until then an unavailable photo
    // estimate opens on "Write it down" instead.
    chosen = useRef(false);
  const timezone = nutrition?.profile?.data.profile.timezone ?? "Asia/Dubai";
  const t = useT("capture"),
    locale = useLocale(),
    toError = useErrorText();
  const problem = (e: unknown) =>
    (e as { local?: boolean })?.local ? (e as Error).message : toError(e);
  async function load() {
    const [s, n] = await Promise.all([
      api("/nutrition/captures"),
      api("/nutrition"),
    ]);
    setSettings(s);
    if (!chosen.current && !s.photosEnabled) setMode("manual");
    setNutrition(n);
    setDate((d) => d || n.today);
  }
  function stopCamera() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  useEffect(() => {
    void load().catch((e) => setError(problem(e)));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    stopCamera();
  }, [mode]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(i: number, patch: Partial<Food>) {
    setItems((old) =>
      old.map((food, index) => (index === i ? { ...food, ...patch } : food)),
    );
  }
  function openDraft(d: Draft) {
    if (d.kind === "photo")
      void api("/nutrition/captures/food-options")
        .then(setFoodOptions)
        .catch(() => setFoodOptions([]));
    setPhoto(null);
    setDraft(null);
    setError("");
    setConfirmation(false);
    setLabelUnit("");
    setNotes("");
    if (d.status === "confirmed") {
      setMessage(t("alreadyRecorded"));
      return;
    }
    if (d.status !== "draft") {
      // The server's own explanation is English; Arabic uses the status line.
      setMessage(
        (locale === "en" && d.data.message) ||
          (d.status === "running" ? t("stillPreparing") : t("notPrepared")),
      );
      return;
    }
    setDraft(d);
    chosen.current = true;
    setEventKey(crypto.randomUUID());
    if (d.kind === "photo") {
      setItems(d.data.estimate.items);
      setName(
        d.data.estimate.items
          .map((i: Food) => i.name)
          .join(", ")
          .slice(0, 160),
      );
      setMode("photo");
    } else {
      const p = d.data.product;
      setItems([
        {
          ...blank(),
          name: p.name,
          portion: "",
          preparation: "unknown",
          uncertainty:
            "Product label data; verify your exact package and serving unit",
        },
      ]);
      setName(p.name);
      setMode("barcode");
    }
  }
  async function choosePhoto(file?: File) {
    if (!file) return;
    await action(async () => {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 8 * 1024 * 1024
      )
        throw local(t("photoType"));
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 16000000) {
        bitmap.close();
        throw local(t("photoPixels"));
      }
      const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        throw local(t("photoPrepare"));
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const preview = canvas.toDataURL("image/jpeg", 0.82),
        base64 = preview.split(",")[1];
      if (base64.length > Math.ceil((2 * 1024 * 1024) / 3) * 4)
        throw local(t("photoLarge"));
      setPhoto({ preview, base64, key: crypto.randomUUID() });
      setDraft(null);
      setPhotoConsent(false);
    });
  }
  async function analyse() {
    if (!photo) return;
    await action(async () => {
      const result = await api("/nutrition/captures/photo", "POST", {
        requestKey: photo.key,
        mime: "image/jpeg",
        base64: photo.base64,
        context,
        photoConsent: true,
      });
      openDraft(result);
      await load();
    });
  }
  async function findProduct() {
    await action(async () => {
      if (barcodeIntent.current?.code !== code)
        barcodeIntent.current = { code, key: crypto.randomUUID() };
      openDraft(
        await api("/nutrition/captures/barcode", "POST", {
          requestKey: barcodeIntent.current!.key,
          code,
        }),
      );
      await load();
    });
  }
  async function scan() {
    await action(async () => {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia)
        throw local(t("noScanner"));
      const supported: string[] = await Detector.getSupportedFormats(),
        formats = ["ean_13", "ean_8", "upc_a", "itf"].filter((f) =>
          supported.includes(f),
        );
      if (!formats.length)
        throw local(t("noFormats"));
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        throw local(t("noCamera"));
      }
      stream.current = media;
      setCamera(true);
      const element = video.current;
      if (!element) {
        stopCamera();
        return;
      }
      element.srcObject = media;
      await element.play();
      const detector = new Detector({ formats });
      const detect = async () => {
        if (stream.current !== media) return;
        try {
          const matches = await detector.detect(element);
          if (matches.length && matches[0].rawValue) {
            setCode(String(matches[0].rawValue));
            setMessage(t("barcodeCaptured"));
            stopCamera();
            return;
          }
        } catch {
          stopCamera();
          setError(t("barcodeUnread"));
          return;
        }
        if (stream.current === media)
          timer.current = setTimeout(() => void detect(), 350);
      };
      void detect();
    });
  }
  function scaleLabel(amount: number | null, unit: "g" | "ml" | "") {
    if (!draft || draft.kind !== "barcode") return;
    const p = draft.data.product;
    setLabelUnit(unit);
    setItems((old) =>
      old.map((item, i) =>
        i
          ? item
          : {
              ...item,
              amount,
              unit: unit || null,
              portion: amount && unit ? `${amount} ${unit}` : "",
              ...Object.fromEntries(
                ["kcal", "protein", "carbohydrate", "fat"].map((k) => [
                  k,
                  amount && unit && p.nutrientsPer100[k] !== null
                    ? Math.round(p.nutrientsPer100[k] * amount) / 100
                    : null,
                ]),
              ),
            },
      ),
    );
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    await action(async () => {
      await api(`/nutrition/captures/${draft.id}/confirm`, "POST", {
        eventKey,
        date,
        timezone,
        name,
        notes,
        items,
        confirmed: true,
        ...(draft.kind === "barcode" ? { labelUnit } : {}),
      });
      setDraft(null);
      setPhoto(null);
      setMessage(t("recordedConfirmed"));
      await load();
    });
  }
  async function manual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      key = eventKey || crypto.randomUUID();
    setEventKey(key);
    await action(async () => {
      await api("/nutrition/logs", "POST", {
        eventKey: key,
        date: String(f.get("date")),
        timezone,
        name: String(f.get("name")),
        kcal: value(String(f.get("kcal"))),
        notes: [String(f.get("portion")), String(f.get("notes"))]
          .filter(Boolean)
          .join(" — ")
          .slice(0, 2000),
        deleted: false,
      });
      setEventKey(crypto.randomUUID());
      setMessage(t("recordedManual"));
      await load();
    });
  }
  const permitted =
    settings?.entitled && settings?.processingConsent && !!nutrition?.profile;
  return (
    <div className="meal-capture nutrition">
      <div className="page-heading">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
      </div>
      <div
        className="capture-methods"
        role="group"
        aria-label={t("methods")}
      >
        {(
          [
            ["photo", "01", t("method_photo"), t("method_photo_detail")],
            ["barcode", "02", t("method_barcode"), t("method_barcode_detail")],
            ["manual", "03", t("method_manual"), t("method_manual_detail")],
          ] as const
        ).map(([key, number, title, desc]) => (
          <button
            type="button"
            key={key}
            aria-pressed={mode === key}
            className={mode === key ? "selected" : ""}
            onClick={() => {
              chosen.current = true;
              setMode(key);
              setDraft(null);
              setError("");
              setEventKey("");
            }}
          >
            <span className="capture-method-number">{number}</span>
            <b>{title}</b>
            <small>
              {settings &&
              ((key === "photo" && !settings.photosEnabled) ||
                (key === "barcode" && !settings.barcodeEnabled))
                ? t("notAvailableYet")
                : desc}
            </small>
          </button>
        ))}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}{" "}
          <Link href="/app/nutrition">
            {t("openNutrition")}{" "}
            <span className="bidi-mirror" aria-hidden="true">
              →
            </span>
          </Link>
        </p>
      )}
      {!settings && (
        <p className="notice" role="status">
          {error ? (
            <button
              className="button secondary"
              onClick={() => void action(load)}
            >
              {t("reload")}
            </button>
          ) : (
            <SlowPermissions
              label={t("loadingPermissions")}
              onRetry={() => void action(load)}
            />
          )}
        </p>
      )}
      {settings && !permitted && (
        <p className="notice">
          {!settings.entitled ? (
            <>
              {t("needMembership")}{" "}
              <Link href="/app/membership">{t("viewMembership")}</Link>
            </>
          ) : (
            <>
              {t("completeFirst")}{" "}
              <Link href="/app/nutrition">{t("openPreferences")}</Link>
            </>
          )}
        </p>
      )}
      {busy && (
        <p className="notice" role="status">
          {photo && mode === "photo"
            ? t("preparingEstimate")
            : t("working")}
        </p>
      )}
      {settings?.photoConsent && mode === "photo" && !draft && (
        <section className="card">
          <h2>{t("photoPermission")}</h2>
          <p className="muted">{t("photoPermissionText")}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api("/privacy/consent", "POST", {
                  type: "nutrition_photo",
                  granted: false,
                });
                setDraft(null);
                setPhoto(null);
                setPhotoConsent(false);
                await load();
                setMessage(t("photoWithdrawn"));
              })
            }
          >
            {t("turnOffPhoto")}
          </button>
        </section>
      )}
      {!draft && mode === "photo" && (
        <div className="capture-columns">
          <section className="card capture-main">
            <div className="capture-section-label">
              <span>{t("photoLabel")}</span>
              <span>{t("privateDefault")}</span>
            </div>
            <h2>{t("plateTitle")}</h2>
            <p>{t("plateText")}</p>
            <div
              className={
                photo ? "capture-dropzone has-photo" : "capture-dropzone"
              }
            >
              {photo ? (
                <img
                  src={photo.preview}
                  alt={t("photoAlt")}
                />
              ) : (
                <>
                  <CameraIcon />
                  <b>{t("takePhoto")}</b>
                  <small>{t("photoFormats")}</small>
                </>
              )}
            </div>
            <div className="capture-photo-actions">
              <label className="button secondary">
                {photo ? t("replacePhoto") : t("choosePhoto")}
                <input
                  aria-label={t("choosePhoto")}
                  className="capture-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={busy || !permitted}
                  onChange={(e) => {
                    void choosePhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {photo && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setPhoto(null)}
                >
                  {t("removePhoto")}
                </button>
              )}
            </div>
            <label className="field">
              <span>{t("photoMissing")}</span>
              <textarea
                value={context}
                {...unsavedMark(!!context.trim())}
                maxLength={1000}
                rows={3}
                onChange={(e) => setContext(e.target.value)}
                placeholder={t("photoMissingHint")}
              />
            </label>
            <label className="capture-check">
              <input
                type="checkbox"
                checked={photoConsent}
                disabled={
                  !settings?.photosEnabled ||
                  !settings?.modelConsent ||
                  !permitted ||
                  busy
                }
                onChange={(e) => setPhotoConsent(e.target.checked)}
              />
              <span>{t("photoConsent")}</span>
            </label>
            {!settings?.photosEnabled && settings && (
              <p className="capture-connection">
                {t("photoWaiting")}{" "}
                <button
                  type="button"
                  className="nutrition-text-button"
                  onClick={() => {
                    setMode("manual");
                    setEventKey("");
                  }}
                >
                  {t("writeInstead")}
                </button>
                .
              </p>
            )}
            {settings?.photosEnabled && !settings.modelConsent && (
              <p className="capture-connection">{t("photoNeedsAi")}</p>
            )}
            {/* The step's main action, in thumb reach. */}
            <StickyActionBar
              label={t("photoActions")}
              note={
                !photo
                  ? t("addPhotoFirst")
                  : !photoConsent
                    ? t("tickToSend")
                    : undefined
              }
            >
              <button
                className="button"
                type="button"
                disabled={
                  busy ||
                  !photo ||
                  !photoConsent ||
                  !permitted ||
                  !settings?.photosEnabled ||
                  !settings?.modelConsent
                }
                onClick={() => void analyse()}
              >
                {t("estimate")}
              </button>
            </StickyActionBar>
          </section>
          <aside className="card capture-aside">
            <span className="capture-overline">{t("inControl")}</span>
            <h2>{t("estimateThenEdit")}</h2>
            <ol>
              <li>
                <b>{t("step1")}</b>
                <p>{t("step1Text")}</p>
              </li>
              <li>
                <b>{t("step2")}</b>
                <p>{t("step2Text")}</p>
              </li>
              <li>
                <b>{t("step3")}</b>
                <p>{t("step3Text")}</p>
              </li>
            </ol>
            <p className="capture-fine">{t("photoFine")}</p>
          </aside>
        </div>
      )}
      {!draft && mode === "barcode" && (
        <div className="capture-columns">
          <section className="card capture-main">
            <div className="capture-section-label">
              <span>{t("packaged")}</span>
              <span>{t("checkProduct")}</span>
            </div>
            <h2>{t("labelTitle")}</h2>
            <p>{t("labelText")}</p>
            {settings && !settings.barcodeEnabled ? (
              // One unavailable state: no camera frame that looks tappable,
              // no second copy of the same sentence.
              <div className="capture-connection capture-unavailable">
                <p>{t("lookupWaiting")}</p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setMode("manual");
                    setEventKey("");
                  }}
                >
                  {t("writeLabelInstead")}
                </button>
              </div>
            ) : (
              <>
            <div className="capture-dropzone">
              <CameraIcon barcode />
              <b>{t("pointCamera")}</b>
              <small>{t("barcodeFormats")}</small>
              <video
                className={camera ? "capture-camera" : "capture-camera hidden"}
                ref={video}
                muted
                playsInline
                aria-label={t("cameraPreview")}
              />
            </div>
            <div className="capture-photo-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy || !permitted || !settings?.barcodeEnabled}
                onClick={() => void scan()}
              >
                {t("useCamera")}
              </button>
              {!busy && (!permitted || !settings?.barcodeEnabled) && (
                <p className="control-reason">
                  {!permitted ? t("scanLater") : t("scanUnavailable")}
                </p>
              )}
              {camera && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={stopCamera}
                >
                  {t("stopCamera")}
                </button>
              )}
            </div>
            <label className="field">
              <span>{t("barcodeNumbers")}</span>
              <input
                value={code}
                {...unsavedMark(!!code.trim())}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                maxLength={40}
                placeholder={t("barcodeHint")}
                dir="ltr"
              />
            </label>
            <StickyActionBar
              label={t("productActions")}
              note={!code.trim() ? t("scanFirst") : undefined}
            >
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  !permitted ||
                  !settings?.barcodeEnabled ||
                  !code.trim()
                }
                onClick={() => void findProduct()}
              >
                {t("findProduct")}
              </button>
            </StickyActionBar>
              </>
            )}
          </section>
          <aside className="card capture-aside">
            <span className="capture-overline">{t("labelFirst")}</span>
            <h2>{t("packagePortion")}</h2>
            <p>{t("recordsVary")}</p>
            <p>
              <Rich
                t={t}
                k="offCredit"
                tags={{
                  link: (text) => (
                    <a
                      href="https://world.openfoodfacts.org"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {text}
                    </a>
                  ),
                }}
              />
            </p>
            <p>{t("onlyBarcode")}</p>
            <button
              className="button secondary"
              onClick={() => {
                setMode("manual");
                setEventKey("");
              }}
            >
              {t("enterManually")}
            </button>
          </aside>
        </div>
      )}
      {!draft && mode === "manual" && (
        <section className="card capture-main capture-manual">
          <div className="capture-section-label">
            <span>{t("ownNotes")}</span>
            <span>{t("noAi")}</span>
          </div>
          <h2>{t("usefulRecord")}</h2>
          <p>{t("approximate")}</p>
          <form id="manual-meal-form" onSubmit={manual}>
            <fieldset
              disabled={busy || !permitted}
              className="nutrition-fieldset"
            >
              <div className="capture-form-grid">
                <label className="field">
                  <span>{t("mealOrFood")}</span>
                  <input
                    name="name"
                    required
                    maxLength={160}
                    placeholder={t("mealHint")}
                  />
                </label>
                <label className="field">
                  <span>{t("whenAte")}</span>
                  <select name="date" defaultValue={date} key={date} required>
                    {recentDays(nutrition?.today ?? date, date, 7, locale).map(
                      (d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="field">
                  <span>{t("portion")}</span>
                  <input
                    name="portion"
                    maxLength={200}
                    placeholder={t("portionHint")}
                  />
                </label>
                <label className="field">
                  <span>{t("caloriesOptional")}</span>
                  <input
                    name="kcal"
                    type="number"
                    min={0}
                    max={10000}
                    step="any"
                    placeholder={t("unknown")}
                  />
                </label>
              </div>
              <label className="field">
                <span>{t("notesOptional")}</span>
                <textarea
                  name="notes"
                  maxLength={1700}
                  rows={3}
                  placeholder={t("notesHint")}
                />
              </label>
            </fieldset>
            <StickyActionBar label={t("mealActions")}>
              <button
                className="button"
                type="submit"
                form="manual-meal-form"
                disabled={busy || !permitted}
              >
                {t("saveMeal")}
              </button>
            </StickyActionBar>
          </form>
        </section>
      )}
      {draft && (
        <form id="meal-review-form" onSubmit={confirm} data-unsaved="">
          <section className="card capture-main">
            <div className="capture-section-label">
              <span>
                {draft.kind === "photo" ? t("reviewPhoto") : t("reviewProduct")}
              </span>
              <span>{t("notInDiary")}</span>
            </div>
            <h2>{t("finalCheck")}</h2>
            <p>{t("editable")}</p>
            {draft.kind === "photo" && (
              <>
                <p className="notice">{t("photoLimits")}</p>
                {draft.data.estimate.questions.length > 0 && (
                  <div className="capture-questions">
                    <b>{t("beforeConfirm")}</b>
                    <ul>
                      {draft.data.estimate.questions.map(
                        (q: string, i: number) => (
                          // The estimate's own words: their direction is
                          // their own (a question mark stays at the end).
                          <li key={i} dir="auto">
                            {q}
                          </li>
                        ),
                      )}
                    </ul>
                    <p>{t("addAnswers")}</p>
                  </div>
                )}
                {draft.data.estimate.notes && (
                  <p dir="auto">{draft.data.estimate.notes}</p>
                )}
              </>
            )}
            {draft.kind === "barcode" && (
              <div className="capture-product">
                <div>
                  <span className="capture-overline" dir="auto">
                    {draft.data.product.brand || t("packaged")}
                  </span>
                  <h3 dir="auto">{draft.data.product.name}</h3>
                  <p>
                    {t("barcodeLine", {
                      code: draft.data.product.code,
                      serving: draft.data.product.servingLabel
                        ? t("labelServing", {
                            serving: draft.data.product.servingLabel,
                          })
                        : t("noServing"),
                    })}
                  </p>
                </div>
                <p>
                  <a
                    href={draft.data.product.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("sourceLink")}{" "}
                    <span className="bidi-mirror" aria-hidden="true">
                      ↗
                    </span>
                  </a>{" "}
                  {t("retrieved", {
                    date: formatDate(draft.data.product.source.retrievedAt, {
                      locale,
                    }),
                  })}
                </p>
                <p>
                  {draft.data.product.nutrientsPer100.kcal === null
                    ? t("per100Missing")
                    : t("per100Kcal", {
                        kcal: draft.data.product.nutrientsPer100.kcal,
                      })}{" "}
                  {t("checkUnit")}
                </p>
                <details>
                  <summary>{t("sourceDetails")}</summary>
                  <p>
                    {draft.data.product.ingredients || t("noIngredients")}
                  </p>
                  <p>
                    {draft.data.product.allergens?.join(", ") ||
                      t("noAllergens")}
                  </p>
                </details>
              </div>
            )}
            <fieldset
              className="nutrition-fieldset"
              disabled={busy || !permitted}
            >
              <div className="capture-form-grid">
                <label className="field">
                  <span>{t("diaryTitle")}</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={160}
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("whenAte")}</span>
                  <select
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  >
                    {recentDays(nutrition?.today ?? date, date, 7, locale).map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {items.map((item, i) => (
                <div className="capture-food" key={i}>
                  <div className="capture-food-heading">
                    <h3>
                      {draft.kind === "barcode" ? (
                        t("howMuch")
                      ) : item.name ? (
                        <bdi>{item.name}</bdi>
                      ) : (
                        t("food", { number: i + 1 })
                      )}
                    </h3>
                    {draft.kind === "photo" && items.length > 1 && (
                      <button
                        type="button"
                        className="capture-remove"
                        onClick={() =>
                          setItems((old) =>
                            old.filter((_, index) => index !== i),
                          )
                        }
                      >
                        {t("remove")}
                      </button>
                    )}
                  </div>
                  <div className="capture-form-grid">
                    <label className="field">
                      <span>{t("foodName")}</span>
                      <input
                        value={item.name}
                        onChange={(e) => edit(i, { name: e.target.value })}
                        maxLength={160}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t("portionDescription")}</span>
                      <input
                        value={item.portion}
                        onChange={(e) => edit(i, { portion: e.target.value })}
                        maxLength={200}
                        required
                        placeholder={t("describeEaten")}
                      />
                    </label>
                    <label className="field">
                      <span>
                        {draft.kind === "photo"
                          ? t("amountOptional")
                          : t("amountEaten")}
                      </span>
                      <input
                        type="number"
                        min="0.01"
                        max={10000}
                        step="any"
                        value={item.amount ?? ""}
                        required={draft.kind === "barcode"}
                        onChange={(e) =>
                          draft.kind === "barcode"
                            ? scaleLabel(value(e.target.value), labelUnit)
                            : edit(
                                i,
                                scaleCapturedPortion(
                                  item,
                                  value(e.target.value),
                                ),
                              )
                        }
                        placeholder={t("unknown")}
                      />
                    </label>
                    <label className="field">
                      <span>
                        {draft.kind === "barcode"
                          ? t("labelUnit")
                          : t("portionUnit")}
                      </span>
                      <select
                        value={item.unit ?? ""}
                        required={draft.kind === "barcode"}
                        onChange={(e) =>
                          draft.kind === "barcode"
                            ? scaleLabel(
                                item.amount,
                                e.target.value as "g" | "ml",
                              )
                            : edit(
                                i,
                                scaleCapturedPortion(
                                  item,
                                  item.amount,
                                  (e.target.value as Food["unit"]) || null,
                                ),
                              )
                        }
                      >
                        <option value="">
                          {draft.kind === "barcode"
                            ? t("chooseAfterLabel")
                            : t("notKnown")}
                        </option>
                        <option value="g">{t("grams")}</option>
                        <option value="ml">{t("millilitres")}</option>
                        {draft.kind === "photo" && (
                          <option value="portion">{t("portionOption")}</option>
                        )}
                      </select>
                    </label>
                  </div>
                  {draft.kind === "photo" && (
                    <>
                      <label className="field">
                        <span>{t("matchFacts")}</span>
                        <select
                          defaultValue=""
                          disabled={busy || item.unit !== "g" || !item.amount}
                          onChange={(e) => {
                            const foodId = e.target.value;
                            if (!foodId || !item.amount) return;
                            void action(async () => {
                              const grounded = await api(
                                `/nutrition/captures/${draft.id}/ground`,
                                "POST",
                                { index: i, foodId, grams: item.amount },
                              );
                              setDraft(grounded);
                              edit(i, grounded.data.estimate.items[i]);
                              setMessage(t("factsApplied"));
                            });
                          }}
                        >
                          <option value="">{t("chooseMatch")}</option>
                          {foodOptions.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} ·{" "}
                              {t.dynamic(
                                `prep_${f.preparation}`,
                                humanize(f.preparation),
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                      <small>{t("matchHint")}</small>
                    </>
                  )}
                  <div className="capture-nutrients">
                    {(
                      [
                        ["kcal", t("n_kcal")],
                        ["protein", t("n_protein")],
                        ["carbohydrate", t("n_carbohydrate")],
                        ["fat", t("n_fat")],
                      ] as const
                    ).map(([key, title]) => (
                      <label className="field" key={key}>
                        <span>{title}</span>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step="any"
                          value={item[key] ?? ""}
                          placeholder={t("unknown")}
                          onChange={(e) =>
                            edit(i, { [key]: value(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="capture-fine">
                    {draft.kind === "photo"
                      ? t("photoTotals")
                      : t("labelTotals")}
                    {item.uncertainty in UNCERTAINTY_KEYS
                      ? t(
                          UNCERTAINTY_KEYS[
                            item.uncertainty as keyof typeof UNCERTAINTY_KEYS
                          ],
                        )
                      : <bdi>{item.uncertainty}</bdi>}
                  </p>
                </div>
              ))}
              {draft.kind === "photo" && items.length < 12 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setItems((old) => [...old, blank()])}
                >
                  {t("addFood")}
                </button>
              )}
              <div className="capture-total">
                <span>{t("mealEstimate")}</span>
                <strong>
                  {total(items, "kcal") === null
                    ? t("partialCalories")
                    : t("kcal", { kcal: total(items, "kcal")! })}
                </strong>
                <small>{t("unknownStays")}</small>
              </div>
              <label className="field">
                <span>{t("answers")}</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder={t("answersHint")}
                />
              </label>
              <label className="capture-check">
                <input
                  type="checkbox"
                  required
                  checked={confirmation}
                  onChange={(e) => setConfirmation(e.target.checked)}
                />
                <span>{t("checked")}</span>
              </label>
              <StickyActionBar
                label={t("reviewActions")}
                note={confirmation ? undefined : t("tickChecked")}
              >
                <button
                  className="button"
                  type="submit"
                  form="meal-review-form"
                  disabled={!confirmation}
                >
                  {t("confirmLog")}
                </button>
              </StickyActionBar>
              <div className="capture-photo-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    void action(async () => {
                      await api(`/nutrition/captures/${draft.id}`, "DELETE");
                      setDraft(null);
                      setPhoto(null);
                      setMessage(t("draftRemoved"));
                      await load();
                    })
                  }
                >
                  {t("discardDraft")}
                </button>
              </div>
            </fieldset>
          </section>
        </form>
      )}
      {settings?.drafts?.length > 0 && !draft && (
        <section className="card capture-drafts">
          <h2>{t("unfinished")}</h2>
          <p>{t("draftsExpire")}</p>
          {settings.drafts.map((d: Draft) => (
            <div className="capture-draft-row" key={d.id}>
              <div>
                <b>{d.kind === "photo" ? t("kind_photo") : t("kind_barcode")}</b>
                <small>
                  {d.status === "draft"
                    ? t("draftReady")
                    : d.status === "running"
                      ? t("draftRunning")
                      : t("draftFailed")}
                </small>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    openDraft(await api(`/nutrition/captures/${d.id}`)),
                  )
                }
              >
                {d.status === "draft" ? t("review") : t("checkStatus")}
              </button>
              <button
                className="button secondary capture-remove"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`/nutrition/captures/${d.id}`, "DELETE");
                    await load();
                  })
                }
              >
                {t("remove")}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** "Loading your nutrition permissions…", then Try again if it never answers. */
function SlowPermissions({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  const common = useT("common");
  const slow = useTakingLong(true);
  if (!slow) return <>{label}</>;
  return (
    <>
      {common("slowLoad")}{" "}
      <button type="button" className="button secondary" onClick={onRetry}>
        {common("tryAgain")}
      </button>
    </>
  );
}
