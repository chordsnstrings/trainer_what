"use client";
import { useEffect, useId, useState } from "react";
import { useLocale } from "../lib/i18n/react";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import Link from "./preview-navigation";
import { Field } from "./field";
import { WHOOP_TRAINING_VERSION } from "../../../packages/domain/src/whoop-training";

async function request(path: string, body?: unknown) {
  const response = await fetch(memberApiUrl("/api/v1" + path), {
    method: body === undefined ? "GET" : "PUT",
    credentials: "same-origin",
    cache: "no-store",
    signal: body === undefined ? AbortSignal.timeout(20000) : undefined,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Please try again.");
  return data;
}
const words = {
  en: {
    title: "WHOOP recovery",
    rules: "How recovery changes training",
    intro:
      "Choose how a lower recovery changes a session. These rules apply when a subscriber starts a workout and has given permission.",
    enable: "Use my recovery rules",
    low: "Low recovery · 0–33%",
    moderate: "Moderate recovery · 34–66%",
    high: "High recovery · 67–100%",
    load: "Reduce weight by (%)",
    volume: "Reduce reps, seconds or distance by (%)",
    limits:
      "High recovery keeps your plan. Exercise order, sets, rest, warm-up and cool-down stay the same. A workout already started does not change.",
    save: "Save recovery rules",
    saved: "Recovery rules saved.",
    pending:
      "The platform needs to finish WHOOP setup before subscribers can use these rules.",
    allow: "Use recovery for my workouts",
    consent:
      "I allow this coaching space to use my WHOOP recovery to adjust workouts within my trainer’s rules. My adjusted workouts can be used by my coaching and voice features. I can switch this off at any time.",
    ready:
      "Your trainer’s rule will be checked when you start today’s workout.",
    unchanged: "Your assigned workout stays the same.",
    lower:
      "Up to {load}% less weight and {volume}% less reps, time or distance for today’s main work.",
    applied: "Adjusted for your recovery",
    appliedText:
      "Your trainer’s WHOOP rule reduced this workout. Your original programme is kept.",
    details: "See what changed",
    connections: "Manage WHOOP",
    sleep: "Sleep",
    hrv: "HRV",
    heart: "Resting heart rate",
    hours: "hours",
    measured: "Reading from",
    permission:
      "Turn on recovery adjustments in Connections to use your trainer’s rules.",
    trainer: "Your trainer has not enabled recovery adjustments.",
    platform:
      "WHOOP recovery adjustments are not enabled on this platform yet.",
    connection: "Connect WHOOP to use recovery adjustments.",
    stale:
      "This reading is not fresh enough for today. Sync WHOOP; your workout stays unchanged until a fresh reading is available.",
    missing:
      "No scored recovery is available yet. Your workout stays unchanged.",
    calibrating: "WHOOP is still calibrating. Your workout stays unchanged.",
    unavailable:
      "A scored recovery linked to today’s main sleep is needed. Your workout stays unchanged.",
  },
  ar: {
    title: "التعافي من WHOOP",
    rules: "كيف يؤثر التعافي على التدريب",
    intro:
      "اختر كيف تُخفَّف الحصة عند انخفاض التعافي. تُطبَّق القواعد عند بدء المشترك للتمرين وبعد موافقته.",
    enable: "تفعيل قواعد التعافي",
    low: "تعافٍ منخفض · 0–33%",
    moderate: "تعافٍ متوسط · 34–66%",
    high: "تعافٍ مرتفع · 67–100%",
    load: "تقليل الوزن بنسبة (%)",
    volume: "تقليل التكرارات أو الثواني أو المسافة بنسبة (%)",
    limits:
      "التعافي المرتفع يُبقي خطتك كما هي. لا يتغير ترتيب التمارين أو المجموعات أو الراحة أو الإحماء أو التهدئة. التمرين الذي بدأ يبقى ثابتًا.",
    save: "حفظ قواعد التعافي",
    saved: "تم حفظ قواعد التعافي.",
    pending:
      "يجب إكمال إعداد WHOOP على المنصة قبل استخدام المشتركين لهذه القواعد.",
    allow: "استخدام التعافي لتماريني",
    consent:
      "أسمح لمساحة التدريب باستخدام تعافي WHOOP لتعديل تماريني وفق قواعد مدربي. يمكن استخدام التمارين المعدّلة في ميزات التدريب والتوجيه الصوتي. يمكنني إيقاف ذلك في أي وقت.",
    ready: "ستُراجع قاعدة مدربك عند بدء تمرين اليوم.",
    unchanged: "يبقى تمرينك المقرر كما هو.",
    lower:
      "وزن أقل حتى {load}% وتكرارات أو وقت أو مسافة أقل حتى {volume}% في الجزء الرئيسي من تمرين اليوم.",
    applied: "عُدّل وفق تعافيك",
    appliedText:
      "خفّفت قاعدة WHOOP التي وضعها مدربك هذا التمرين. برنامجك الأصلي محفوظ.",
    details: "عرض التغييرات",
    connections: "إدارة WHOOP",
    sleep: "النوم",
    hrv: "تباين نبض القلب",
    heart: "نبض الراحة",
    hours: "ساعات",
    measured: "القراءة بتاريخ",
    permission: "فعّل تعديلات التعافي من صفحة الاتصالات لاستخدام قواعد مدربك.",
    trainer: "لم يفعّل مدربك تعديلات التعافي.",
    platform: "تعديلات التعافي من WHOOP غير مفعّلة على المنصة بعد.",
    connection: "اربط WHOOP لاستخدام تعديلات التعافي.",
    stale:
      "هذه القراءة ليست حديثة بما يكفي لليوم. زامن WHOOP؛ يبقى تمرينك كما هو حتى تتوفر قراءة حديثة.",
    missing: "لا تتوفر نتيجة تعافٍ بعد. يبقى تمرينك كما هو.",
    calibrating: "لا يزال WHOOP في مرحلة المعايرة. يبقى تمرينك كما هو.",
    unavailable:
      "يلزم تعافٍ مُقيَّم مرتبط بالنوم الرئيسي لليوم. يبقى تمرينك كما هو.",
  },
};
function useWords() {
  return words[useLocale() === "ar" ? "ar" : "en"];
}
const reductionText = (text: string, rule: any) =>
  text
    .replace("{load}", String(rule?.loadPercent ?? 0))
    .replace("{volume}", String(rule?.volumePercent ?? 0));

export function WhoopTrainerRules() {
  const t = useWords(),
    [data, setData] = useState<any>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void request("/brain/whoop-training")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="card" aria-label={t.rules}>
      <h2>{t.rules}</h2>
      <p className="muted">{t.intro}</p>
      {message && <p role="status">{message}</p>}
      {data && (
        <form
          key={data.version}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setMessage("");
            void request("/brain/whoop-training", {
              version: data.version,
              values: {
                enabled: form.get("enabled") === "on",
                low: {
                  loadPercent: Number(form.get("low-load")),
                  volumePercent: Number(form.get("low-volume")),
                },
                moderate: {
                  loadPercent: Number(form.get("moderate-load")),
                  volumePercent: Number(form.get("moderate-volume")),
                },
              },
            })
              .then((d) => {
                setData(d);
                setMessage(t.saved);
              })
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={data.values.enabled}
            />{" "}
            {t.enable}
          </label>
          {(["low", "moderate"] as const).map((band) => (
            <fieldset key={band}>
              <legend>{t[band]}</legend>
              <div className="form-grid">
                <Field label={t.load}>
                  <input
                    type="number"
                    name={`${band}-load`}
                    min={0}
                    max={30}
                    step={1}
                    defaultValue={data.values[band].loadPercent}
                    required
                  />
                </Field>
                <Field label={t.volume}>
                  <input
                    type="number"
                    name={`${band}-volume`}
                    min={0}
                    max={50}
                    step={1}
                    defaultValue={data.values[band].volumePercent}
                    required
                  />
                </Field>
              </div>
            </fieldset>
          ))}
          <p className="muted">{t.limits}</p>
          {!data.available && <p className="muted">{t.pending}</p>}
          <button className="button" disabled={busy}>
            {t.save}
          </button>
        </form>
      )}
    </section>
  );
}

export function WhoopTrainingCard({
  settings = false,
  refreshKey = "",
  compact = false,
}: {
  settings?: boolean;
  refreshKey?: string;
  compact?: boolean;
}) {
  const t = useWords(),
    locale = useLocale(),
    consentId = useId(),
    [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void request("/integrations/whoop/training")
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, retry]);
  if (!data?.hasConnection)
    return error ? <div className="notice" role="alert">{error}<button className="text-button" onClick={() => setRetry(v => v + 1)}>{locale === "ar" ? "إعادة المحاولة" : "Retry WHOOP"}</button></div> : null;
  const recovery = data.recovery;
  const message =
    data.reason === "ready"
      ? data.rule
        ? t.ready
        : t.unchanged
      : (t[data.reason as keyof typeof t] ?? t.unavailable);
  if (compact) return <section className="card whoop-training is-compact" data-recovery-state={data.reason} aria-label={t.title}>
    <h2>{t.title}</h2><div className="whoop-summary">{recovery.score != null && <strong><bdi>{recovery.score}%</bdi></strong>}{recovery.sleepHours != null && <span>{t.sleep}: <bdi>{recovery.sleepHours} {t.hours}</bdi></span>}</div>
    <p>{message}</p>
    <details><summary>{locale === "ar" ? "لماذا؟ عرض القراءة وتأثيرها" : "Why? Reading and training effect"}</summary>
      {recovery.measuredAt && <p className="muted">{t.measured} <bdi>{new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: data.timezone }).format(new Date(recovery.measuredAt))}</bdi></p>}
      {data.reason === "ready" && data.rule && <p>{reductionText(t.lower, data.rule)}</p>}
      <p>{t.limits}</p><Link className="text-button" href="/app/wearables">{t.connections}</Link>
    </details>
  </section>;
  return (
    <section className="card whoop-training" aria-label={t.title}>
      <h2>{t.title}</h2>
      {settings && <p className="badge">{data.connected ? (locale === "ar" ? "متصل بـ WHOOP" : "Connected to WHOOP") : (locale === "ar" ? "يلزم إعادة الربط" : "Reconnect WHOOP")}</p>}
      {recovery.score != null && (
        <p>
          <strong>
            <bdi>{recovery.score}%</bdi>
          </strong>{" "}
          · {t[recovery.band as "low" | "moderate" | "high"]}
        </p>
      )}
      {recovery.measuredAt && (
        <p className="muted">
          {t.measured}{" "}
          <bdi>
            {new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: data.timezone,
            }).format(new Date(recovery.measuredAt))}
          </bdi>
        </p>
      )}
      <p>{message}</p>
      {data.reason === "ready" && data.rule && <p>{reductionText(t.lower, data.rule)}</p>}
      {(recovery.sleepHours != null ||
        recovery.hrvMs != null ||
        recovery.restingHeartRate != null) && (
        <dl className="form-grid">
          {recovery.sleepHours != null && (
            <div>
              <dt>{t.sleep}</dt>
              <dd>
                {recovery.sleepHours} {t.hours}
              </dd>
            </div>
          )}
          {recovery.hrvMs != null && (
            <div>
              <dt>{t.hrv}</dt>
              <dd>
                <bdi>{Math.round(recovery.hrvMs)} ms</bdi>
              </dd>
            </div>
          )}
          {recovery.restingHeartRate != null && (
            <div>
              <dt>{t.heart}</dt>
              <dd>
                <bdi>{Math.round(recovery.restingHeartRate)} bpm</bdi>
              </dd>
            </div>
          )}
        </dl>
      )}
      {settings ? (
        <div>
          <label>
            <input
              type="checkbox"
              aria-describedby={consentId}
              checked={data.optedIn}
              disabled={
                busy || (!data.optedIn && (!data.connected || !data.available))
              }
              onChange={(e) => {
                setBusy(true);
                setError("");
                void request("/integrations/whoop/training", {
                  enabled: e.target.checked,
                  version: data.preferenceVersion,
                  consentVersion: WHOOP_TRAINING_VERSION,
                })
                  .then(setData)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            />{" "}
            <strong>{t.allow}</strong>
          </label>
          <p className="muted" id={consentId}>
            {t.consent}
          </p>
        </div>
      ) : (
        <Link className="text-link" href="/app/wearables">
          {t.connections}
        </Link>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function WhoopWorkoutAdjustment({ adjustment }: { adjustment?: any }) {
  const t = useWords(),
    locale = useLocale();
  if (!adjustment?.changes?.length) return null;
  const units: Record<string, string> =
    locale === "ar"
      ? {
          loadKg: "كغ",
          reps: "تكرارات",
          durationSeconds: "ثانية",
          distanceMeters: "م",
        }
      : {
          loadKg: "kg",
          reps: "reps",
          durationSeconds: "s",
          distanceMeters: "m",
        };
  return (
    <section className="card" aria-label={t.applied}>
      <h2>{t.applied}</h2>
      <p>{t.appliedText}</p>
      <details>
        <summary>{t.details}</summary>
        <ul>
          {adjustment.changes.map((change: any) => (
            <li key={change.index}>
              <strong dir="auto">{change.name}</strong>
              {" · "}
              {Object.keys(change.after).map((key, i) => (
                <span key={key}>
                  {i ? " · " : ""}
                  <bdi>
                    {change.before[key]} → {change.after[key]}{" "}
                    {units[key] ?? key}
                  </bdi>
                </span>
              ))}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
