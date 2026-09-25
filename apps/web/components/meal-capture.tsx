"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

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
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "The request could not be completed.");
  return data;
}
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
    [nutrition, setNutrition] = useState<any>(null);
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
    barcodeIntent = useRef<{ code: string; key: string } | null>(null);
  const timezone = nutrition?.profile?.data.profile.timezone ?? "Asia/Dubai";
  async function load() {
    const [s, n] = await Promise.all([
      api("/nutrition/captures"),
      api("/nutrition"),
    ]);
    setSettings(s);
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
    void load().catch((e) => setError(e.message));
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
      setError((e as Error).message);
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
    setPhoto(null);
    setDraft(null);
    setError("");
    setConfirmation(false);
    setLabelUnit("");
    setNotes("");
    if (d.status === "confirmed") {
      setMessage("This meal has already been recorded. Find it in your diary.");
      return;
    }
    if (d.status !== "draft") {
      setMessage(
        d.data.message ||
          (d.status === "running"
            ? "This capture is still being prepared. Refresh the draft shortly; it will not be submitted twice."
            : "This capture could not be prepared. Use manual entry or start a new capture."),
      );
      return;
    }
    setDraft(d);
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
        throw new Error(
          "Choose a JPEG, PNG or WebP photo under 8 MB. It will be resized privately on this device before upload.",
        );
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 16000000) {
        bitmap.close();
        throw new Error("Choose a photo under 16 megapixels.");
      }
      const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        throw new Error("The image could not be prepared on this device.");
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const preview = canvas.toDataURL("image/jpeg", 0.82),
        base64 = preview.split(",")[1];
      if (base64.length > Math.ceil((2 * 1024 * 1024) / 3) * 4)
        throw new Error(
          "The prepared photo is still too large. Choose a smaller photo.",
        );
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
        throw new Error(
          "Camera barcode scanning is unavailable in this browser. Enter the printed numbers below.",
        );
      const supported: string[] = await Detector.getSupportedFormats(),
        formats = ["ean_13", "ean_8", "upc_a", "itf"].filter((f) =>
          supported.includes(f),
        );
      if (!formats.length)
        throw new Error(
          "This browser does not support food barcodes. Enter the printed numbers below.",
        );
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        throw new Error(
          "Camera access was not granted. You can enter the barcode numbers instead.",
        );
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
            setMessage(
              "Barcode captured. Check the digits, then find your product.",
            );
            stopCamera();
            return;
          }
        } catch {
          stopCamera();
          setError(
            "The camera could not read this barcode. Enter its numbers instead.",
          );
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
      setMessage(
        "Meal recorded. Your confirmed estimate is now in your diary and daily totals.",
      );
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
      setMessage(
        "Meal recorded. You can correct it at any time in your diary.",
      );
      await load();
    });
  }
  const permitted =
    settings?.entitled && settings?.processingConsent && !!nutrition?.profile;
  return (
    <div className="meal-capture nutrition">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE CONTEXT, A CLEARER PICTURE</p>
          <h1>Log a meal</h1>
          <p>A photo, a barcode or your own notes. You have the final say.</p>
        </div>
        <Link className="button secondary" href="/app/nutrition">
          Back to nutrition
        </Link>
      </div>
      <div className="capture-methods" aria-label="Choose how to log your meal">
        {(
          [
            ["photo", "01", "Meal photo", "Start with what you see"],
            ["barcode", "02", "Scan a product", "Use the package label"],
            ["manual", "03", "Write it down", "Keep it simple"],
          ] as const
        ).map(([key, number, title, desc]) => (
          <button
            type="button"
            key={key}
            aria-pressed={mode === key}
            className={mode === key ? "selected" : ""}
            onClick={() => {
              setMode(key);
              setDraft(null);
              setError("");
              setEventKey("");
            }}
          >
            <span className="capture-method-number">{number}</span>
            <b>{title}</b>
            <small>{desc}</small>
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
          {message} <Link href="/app/nutrition">Open nutrition →</Link>
        </p>
      )}
      {!settings && (
        <p className="notice" role="status">
          {error ? (
            <button
              className="button secondary"
              onClick={() => void action(load)}
            >
              Reload meal capture
            </button>
          ) : (
            "Loading your nutrition permissions…"
          )}
        </p>
      )}
      {settings && !permitted && (
        <p className="notice">
          {!settings.entitled ? (
            <>
              Workout + nutrition membership is needed for meal logging.{" "}
              <Link href="/app/membership">View your membership.</Link>
            </>
          ) : (
            <>
              Complete your food preferences and nutrition permission first.{" "}
              <Link href="/app/nutrition">Open food preferences.</Link>
            </>
          )}
        </p>
      )}
      {busy && (
        <p className="notice" role="status">
          {photo && mode === "photo"
            ? "Preparing your estimate. Nothing enters your diary until you confirm."
            : "Working on your request…"}
        </p>
      )}
      {!draft && mode === "photo" && (
        <div className="capture-columns">
          <section className="card capture-main">
            <div className="capture-section-label">
              <span>MEAL PHOTO</span>
              <span>Private by default</span>
            </div>
            <h2>What’s on your plate?</h2>
            <p>
              Add a clear overhead photo. A note about portions, sauces or
              cooking oils will make the estimate more useful.
            </p>
            <div
              className={
                photo ? "capture-dropzone has-photo" : "capture-dropzone"
              }
            >
              {photo ? (
                <img
                  src={photo.preview}
                  alt="Your selected meal, ready for review"
                />
              ) : (
                <>
                  <CameraIcon />
                  <b>Take a photo or choose one</b>
                  <small>JPEG, PNG or WebP · up to 8 MB before resizing</small>
                </>
              )}
            </div>
            <div className="capture-photo-actions">
              <label className="button secondary">
                {photo ? "Replace photo" : "Choose meal photo"}
                <input
                  aria-label="Choose meal photo"
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
                  Remove photo
                </button>
              )}
            </div>
            <label className="field">
              <span>Anything the photo doesn’t show?</span>
              <textarea
                value={context}
                maxLength={1000}
                rows={3}
                onChange={(e) => setContext(e.target.value)}
                placeholder="For example: two eggs, a teaspoon of olive oil, dressing on the side…"
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
              <span>
                I choose to send this photo to the connected AI provider for a
                meal estimate. It is not used to teach my coach’s model.
              </span>
            </label>
            {!settings?.photosEnabled && settings && (
              <p className="capture-connection">
                Photo analysis is awaiting the platform’s AI connection. You can
                prepare a photo here or log your meal manually.
              </p>
            )}
            {settings?.photosEnabled && !settings.modelConsent && (
              <p className="capture-connection">
                Turn on nutrition AI permission in Food preferences to use photo
                analysis.
              </p>
            )}
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
              Estimate this meal <span aria-hidden="true">↗</span>
            </button>
          </section>
          <aside className="card capture-aside">
            <span className="capture-overline">YOU’RE IN CONTROL</span>
            <h2>
              An estimate.
              <br />
              Then your edit.
            </h2>
            <ol>
              <li>
                <b>Share what you ate.</b>
                <p>
                  Only the photo you choose is uploaded after you request
                  analysis.
                </p>
              </li>
              <li>
                <b>Fill in the gaps.</b>
                <p>
                  Check food names, quantities, oils and hidden ingredients.
                  Photo calories are approximate.
                </p>
              </li>
              <li>
                <b>Confirm your meal.</b>
                <p>
                  Your edited entry goes straight into your diary. Routine coach
                  approval is not needed.
                </p>
              </li>
            </ol>
            <p className="capture-fine">
              Photo metadata is removed before analysis. The server deletes
              image bytes after analysis; abandoned images expire within 24
              hours. The AI provider’s own retention policy also applies.
            </p>
          </aside>
        </div>
      )}
      {!draft && mode === "barcode" && (
        <div className="capture-columns">
          <section className="card capture-main">
            <div className="capture-section-label">
              <span>PACKAGED FOOD</span>
              <span>Check the exact product</span>
            </div>
            <h2>From label to meal diary.</h2>
            <p>
              Scan the barcode, or enter its printed digits. Then choose how
              much you actually ate.
            </p>
            <div className="capture-dropzone">
              <CameraIcon barcode />
              <b>Point the camera at the barcode</b>
              <small>EAN-8, EAN-13, UPC-A and GTIN-14</small>
              <video
                className={camera ? "capture-camera" : "capture-camera hidden"}
                ref={video}
                muted
                playsInline
                aria-label="Barcode camera preview"
              />
            </div>
            <div className="capture-photo-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy || !permitted || !settings?.barcodeEnabled}
                onClick={() => void scan()}
              >
                Use camera
              </button>
              {camera && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={stopCamera}
                >
                  Stop camera
                </button>
              )}
            </div>
            <label className="field">
              <span>Barcode numbers</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                maxLength={40}
                placeholder="Enter the digits below the bars"
              />
            </label>
            {settings && !settings.barcodeEnabled && (
              <p className="capture-connection">
                Product lookup is awaiting platform activation. You can enter
                the label manually.
              </p>
            )}
            <button
              type="button"
              className="button"
              disabled={
                busy || !permitted || !settings?.barcodeEnabled || !code.trim()
              }
              onClick={() => void findProduct()}
            >
              Find product ↗
            </button>
          </section>
          <aside className="card capture-aside">
            <span className="capture-overline">THE LABEL COMES FIRST</span>
            <h2>
              Your package.
              <br />
              Your portion.
            </h2>
            <p>
              Product records can vary by country and change over time. Compare
              the result with the package in your hand.
            </p>
            <p>
              We use{" "}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noreferrer"
              >
                Open Food Facts
              </a>{" "}
              with attribution. Missing nutrients remain unknown. A missing
              allergen list does not mean a product is safe for an allergy.
            </p>
            <p>
              Only the barcode is sent for lookup. Your name, health profile and
              diary stay private.
            </p>
            <button
              className="button secondary"
              onClick={() => {
                setMode("manual");
                setEventKey("");
              }}
            >
              Enter the label manually
            </button>
          </aside>
        </div>
      )}
      {!draft && mode === "manual" && (
        <section className="card capture-main capture-manual">
          <div className="capture-section-label">
            <span>YOUR OWN NOTES</span>
            <span>No AI needed</span>
          </div>
          <h2>Keep a useful record.</h2>
          <p>
            Portions and calories can be approximate. Leave calories blank when
            you don’t know.
          </p>
          <form onSubmit={manual}>
            <fieldset
              disabled={busy || !permitted}
              className="nutrition-fieldset"
            >
              <div className="capture-form-grid">
                <label className="field">
                  <span>Meal or food</span>
                  <input
                    name="name"
                    required
                    maxLength={160}
                    placeholder="For example: chicken, rice and salad"
                  />
                </label>
                <label className="field">
                  <span>Date · {timezone}</span>
                  <input
                    name="date"
                    type="date"
                    defaultValue={date}
                    key={date}
                    max={nutrition?.today}
                    required
                  />
                </label>
                <label className="field">
                  <span>Portion</span>
                  <input
                    name="portion"
                    maxLength={200}
                    placeholder="One bowl, about 300 g"
                  />
                </label>
                <label className="field">
                  <span>Estimated calories · optional</span>
                  <input
                    name="kcal"
                    type="number"
                    min={0}
                    max={10000}
                    step="any"
                    placeholder="Unknown"
                  />
                </label>
              </div>
              <label className="field">
                <span>Notes · optional</span>
                <textarea
                  name="notes"
                  maxLength={1700}
                  rows={3}
                  placeholder="Preparation, ingredients or anything useful to remember"
                />
              </label>
              <button className="button" type="submit">
                Save my meal
              </button>
            </fieldset>
          </form>
        </section>
      )}
      {draft && (
        <form onSubmit={confirm}>
          <section className="card capture-main">
            <div className="capture-section-label">
              <span>
                REVIEW YOUR{" "}
                {draft.kind === "photo" ? "PHOTO ESTIMATE" : "PRODUCT"}
              </span>
              <span>Not yet in your diary</span>
            </div>
            <h2>A final check, then it’s yours.</h2>
            <p>
              Every value below is editable. Recording this meal does not change
              your coach’s plan or calorie target.
            </p>
            {draft.kind === "photo" && (
              <>
                <p className="notice">
                  Photo estimates cannot establish exact calories, hidden
                  ingredients or allergen safety.
                </p>
                {draft.data.estimate.questions.length > 0 && (
                  <div className="capture-questions">
                    <b>Before you confirm</b>
                    <ul>
                      {draft.data.estimate.questions.map(
                        (q: string, i: number) => (
                          <li key={i}>{q}</li>
                        ),
                      )}
                    </ul>
                    <p>Add your answers in the portions or notes below.</p>
                  </div>
                )}
                {draft.data.estimate.notes && (
                  <p>{draft.data.estimate.notes}</p>
                )}
              </>
            )}
            {draft.kind === "barcode" && (
              <div className="capture-product">
                <div>
                  <span className="capture-overline">
                    {draft.data.product.brand || "PACKAGED FOOD"}
                  </span>
                  <h3>{draft.data.product.name}</h3>
                  <p>
                    Barcode {draft.data.product.code} ·{" "}
                    {draft.data.product.servingLabel
                      ? `Label serving: ${draft.data.product.servingLabel}`
                      : "Label serving not provided"}
                  </p>
                </div>
                <p>
                  <a
                    href={draft.data.product.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source: Open Food Facts ↗
                  </a>{" "}
                  · ODbL · Retrieved{" "}
                  {new Date(
                    draft.data.product.source.retrievedAt,
                  ).toLocaleDateString()}
                </p>
                <p>
                  As sold, per 100 g or 100 ml:{" "}
                  {draft.data.product.nutrientsPer100.kcal === null
                    ? "calories unavailable"
                    : `${draft.data.product.nutrientsPer100.kcal} kcal`}
                  . Verify the unit on your package.
                </p>
                <details>
                  <summary>Ingredients and allergens from the source</summary>
                  <p>
                    {draft.data.product.ingredients ||
                      "Ingredients not supplied. Check the package."}
                  </p>
                  <p>
                    {draft.data.product.allergens?.join(", ") ||
                      "No verified allergen list supplied. This does not establish allergen safety."}
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
                  <span>Diary title</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={160}
                    required
                  />
                </label>
                <label className="field">
                  <span>Date · {timezone}</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    max={nutrition?.today}
                    required
                  />
                </label>
              </div>
              {items.map((item, i) => (
                <div className="capture-food" key={i}>
                  <div className="capture-food-heading">
                    <h3>Food {i + 1}</h3>
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
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="capture-form-grid">
                    <label className="field">
                      <span>Food name</span>
                      <input
                        value={item.name}
                        onChange={(e) => edit(i, { name: e.target.value })}
                        maxLength={160}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Portion description</span>
                      <input
                        value={item.portion}
                        onChange={(e) => edit(i, { portion: e.target.value })}
                        maxLength={200}
                        required
                        placeholder="Describe what you ate"
                      />
                    </label>
                    <label className="field">
                      <span>
                        Amount eaten{" "}
                        {draft.kind === "photo" ? "· optional" : ""}
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
                            : edit(i, { amount: value(e.target.value) })
                        }
                        placeholder="Unknown"
                      />
                    </label>
                    <label className="field">
                      <span>
                        {draft.kind === "barcode"
                          ? "Unit on the label · per 100"
                          : "Portion unit"}
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
                            : edit(i, {
                                unit: (e.target.value as Food["unit"]) || null,
                              })
                        }
                      >
                        <option value="">
                          {draft.kind === "barcode"
                            ? "Choose after checking the label"
                            : "Not known"}
                        </option>
                        <option value="g">Grams (g)</option>
                        <option value="ml">Millilitres (ml)</option>
                        {draft.kind === "photo" && (
                          <option value="portion">Portion</option>
                        )}
                      </select>
                    </label>
                  </div>
                  <div className="capture-nutrients">
                    {(
                      [
                        ["kcal", "Calories · kcal"],
                        ["protein", "Protein · g"],
                        ["carbohydrate", "Carbs · g"],
                        ["fat", "Fat · g"],
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
                          placeholder="Unknown"
                          onChange={(e) =>
                            edit(i, { [key]: value(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="capture-fine">
                    {draft.kind === "photo"
                      ? "Values are totals for this portion. When changing its amount, update the estimates too. "
                      : "Changing the amount or unit recalculates from the source label. You can then correct any value. "}
                    {item.uncertainty}
                  </p>
                </div>
              ))}
              {draft.kind === "photo" && items.length < 12 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setItems((old) => [...old, blank()])}
                >
                  Add a food or hidden ingredient
                </button>
              )}
              <div className="capture-total">
                <span>Recorded meal estimate</span>
                <strong>
                  {total(items, "kcal") === null
                    ? "Partial / unknown calories"
                    : `${total(items, "kcal")} kcal`}
                </strong>
                <small>Unknown nutrients stay unknown, not zero.</small>
              </div>
              <label className="field">
                <span>Portion answers, oils, sauces or corrections</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Anything to clarify before saving"
                />
              </label>
              <label className="capture-check">
                <input
                  type="checkbox"
                  required
                  checked={confirmation}
                  onChange={(e) => setConfirmation(e.target.checked)}
                />
                <span>
                  I checked the food, portion and estimated values. Save this as
                  my own confirmed diary entry.
                </span>
              </label>
              <div className="capture-photo-actions">
                <button
                  className="button"
                  type="submit"
                  disabled={!confirmation}
                >
                  Confirm and log my meal
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    void action(async () => {
                      await api(`/nutrition/captures/${draft.id}`, "DELETE");
                      setDraft(null);
                      setPhoto(null);
                      setMessage("Draft removed. No meal was logged.");
                      await load();
                    })
                  }
                >
                  Discard draft
                </button>
              </div>
            </fieldset>
          </section>
        </form>
      )}
      {settings?.drafts?.length > 0 && !draft && (
        <section className="card capture-drafts">
          <h2>Unfinished captures</h2>
          <p>
            Drafts expire after 24 hours. Nothing here counts towards your diary
            until you confirm it.
          </p>
          {settings.drafts.map((d: Draft) => (
            <div className="capture-draft-row" key={d.id}>
              <div>
                <b>{d.kind === "photo" ? "Meal photo" : "Product barcode"}</b>
                <small>
                  {d.status === "draft"
                    ? "Ready for your review"
                    : d.status === "running"
                      ? "Analysis in progress"
                      : "Could not complete · manual entry available"}
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
                {" "}
                {d.status === "draft" ? "Review" : "Check status"}
              </button>
              <button
                className="capture-remove"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`/nutrition/captures/${d.id}`, "DELETE");
                    await load();
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
