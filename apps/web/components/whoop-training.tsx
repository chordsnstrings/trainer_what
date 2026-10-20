"use client";
import { useEffect, useId, useState } from "react";
import { ArrowUpRight, RefreshCw, ChevronRight } from "lucide-react";
import { useLocale } from "../lib/i18n/react";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import Link from "./preview-navigation";
import { Field } from "./field";
import { WHOOP_TRAINING_VERSION } from "../../../packages/domain/src/whoop-training";

async function request(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "PUT",
) {
  const response = await fetch(memberApiUrl("/api/v1" + path), {
    method,
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

/** Recovery is a destination; permission is never inferred from a connection. */
export function WhoopTrainingCard({
  settings = false,
  refreshKey = "",
  compact = false,
  rules = false,
  activeWorkout,
}: {
  settings?: boolean;
  refreshKey?: string;
  compact?: boolean;
  rules?: boolean;
  activeWorkout?: { data?: { recoveryAdjustment?: any } } | null;
}) {
  const t = useWords(),
    locale = useLocale(),
    consentId = useId();
  const ar = locale === "ar";
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "consent" | "sync">("");
  const [retry, setRetry] = useState(0);
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
  const reload = () => setRetry((v) => v + 1);
  const alert = error && (
    <p className="notice error" role="alert">
      {error}{" "}
      <button className="text-button" onClick={reload}>
        {ar ? "إعادة المحاولة" : "Retry WHOOP"}
      </button>
    </p>
  );
  if (!data)
    return (
      <>
        {alert}
        {!error && !compact && (
          <p role="status">
            {ar ? "جارٍ تحميل التعافي…" : "Loading your recovery…"}
          </p>
        )}
      </>
    );
  const recovery = data.recovery ?? {};
  const message =
    data.reason === "ready"
      ? data.rule
        ? t.ready
        : t.unchanged
      : (t[data.reason as keyof typeof t] ?? t.unavailable);
  const date = (value: string) =>
    new Intl.DateTimeFormat(ar ? "ar-AE" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: data.timezone,
    }).format(new Date(value));
  const band = recovery.band
    ? t[recovery.band as "low" | "moderate" | "high"].split(" · ")[0]
    : ar
      ? "بانتظار القراءة"
      : "Awaiting a reading";
  if (compact)
    return (
      <section
        className="whoop-training recovery-summary"
        data-recovery-state={data.reason}
        aria-label={t.title}
      >
        <Link href="/app/recovery" className="recovery-summary-link">
          <span className="recovery-summary-value">
            <bdi>{recovery.score != null ? `${recovery.score}%` : "—"}</bdi>
          </span>
          <span>
            <strong>{data.connected ? band : t.title}</strong>
            <small>
              {recovery.measuredAt
                ? `WHOOP · ${date(recovery.measuredAt)}`
                : message}
            </small>
            {data.reason !== "ready" && recovery.measuredAt && (
              <small>{message}</small>
            )}
          </span>
          <ArrowUpRight
            className="recovery-arrow"
            size={22}
            aria-hidden="true"
          />
        </Link>
        {alert}
      </section>
    );
  if (rules)
    return (
      <div className="member-recovery" data-stagger>
        <header className="page-heading">
          <p className="eyebrow">WHOOP</p>
          <h1>{ar ? "قواعد مدربك" : "Your coach’s rules."}</h1>
          <p className="muted">{t.limits}</p>
        </header>
        <dl className="recovery-rules">
          {(["low", "moderate", "high"] as const).map((key) => (
            <div key={key} data-current={recovery.band === key || undefined}>
              <dt>
                <strong>{t[key]}</strong>
                {recovery.band === key && (
                  <span className="badge">
                    {ar ? "قراءتك الحالية" : "Your current reading"}
                  </span>
                )}
              </dt>
              <dd>
                {key === "high"
                  ? t.unchanged
                  : reductionText(t.lower, data.policy?.values?.[key])}
              </dd>
            </div>
          ))}
        </dl>
        {!data.policy?.values?.enabled && <p className="notice">{t.trainer}</p>}
        <Link className="button secondary" href="/app/recovery">
          {ar ? "العودة إلى التعافي" : "Back to recovery"}
        </Link>
        {alert}
      </div>
    );
  // Connections shows a small route to recovery, not a second permission switch.
  if (settings)
    return (
      <section className="recovery-summary" aria-label={t.title}>
        <Link className="recovery-summary-link" href="/app/recovery">
          <span>
            <strong>
              {ar ? "تعافيك وتدريبك" : "Your recovery & training"}
            </strong>
            <small>
              {ar
                ? "القراءات وقواعد المدرب وتعديلات التمرين"
                : "Readings, coach rules and workout adjustments"}
            </small>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
    );
  return (
    <div
      className="member-recovery"
      data-stagger
      data-recovery-state={data.reason}
    >
      <header className="page-heading">
        <p className="eyebrow">WHOOP</p>
        <h1>{ar ? "تعافيك." : "Your recovery."}</h1>
        <span className="recovery-status">
          {data.connected
            ? ar
              ? "متصل"
              : "Connected"
            : ar
              ? "غير متصل"
              : "Not connected"}
        </span>
      </header>
      {alert}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="recovery-reading" aria-label={t.title}>
        <div className="recovery-hero">
          <p className="recovery-score">
            <bdi>{recovery.score != null ? recovery.score : "—"}</bdi>
            {recovery.score != null && <span>%</span>}
          </p>
          <div>
            <h2>{band}</h2>
            <p className="muted">
              {recovery.measuredAt ? date(recovery.measuredAt) : message}
            </p>
          </div>
        </div>
        {recovery.score != null && (
          <div
            className="recovery-meter"
            role="meter"
            aria-label={t.title}
            aria-valuenow={recovery.score}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              style={{
                transform: `scaleX(${Math.min(100, Math.max(0, recovery.score)) / 100})`,
              }}
            />
          </div>
        )}
        <dl className="recovery-metrics">
          <div>
            <dt>{t.sleep}</dt>
            <dd>
              <bdi>{recovery.sleepHours ?? "—"}</bdi>
              {recovery.sleepHours != null && <small>{t.hours}</small>}
            </dd>
          </div>
          <div>
            <dt>{t.hrv}</dt>
            <dd>
              <bdi>
                {recovery.hrvMs == null ? "—" : Math.round(recovery.hrvMs)}
              </bdi>
              {recovery.hrvMs != null && <small>ms</small>}
            </dd>
          </div>
          <div>
            <dt>{t.heart}</dt>
            <dd>
              <bdi>
                {recovery.restingHeartRate == null
                  ? "—"
                  : Math.round(recovery.restingHeartRate)}
              </bdi>
              {recovery.restingHeartRate != null && <small>bpm</small>}
            </dd>
          </div>
        </dl>
      </section>
      <section
        className="recovery-effect"
        aria-labelledby="recovery-effect-title"
      >
        <p className="eyebrow">
          {ar ? "تأثير التعافي على التدريب" : "Training effect"}
        </p>
        <h2 id="recovery-effect-title">
          {activeWorkout
            ? ar
              ? "تمرينك الحالي محفوظ."
              : "Your current workout is set."
            : data.reason === "ready" && data.rule
              ? ar
                ? "حصة أخف وفق قواعد مدربك."
                : "A lighter session, within your coach’s rules."
              : ar
                ? "خطتك المقررة محفوظة."
                : "Your assigned plan stays in place."}
        </h2>
        <p>{activeWorkout ? t.limits : message}</p>
        {!activeWorkout && data.reason === "ready" && data.rule && (
          <p>{reductionText(t.lower, data.rule)}</p>
        )}
        {activeWorkout?.data?.recoveryAdjustment && (
          <WhoopWorkoutAdjustment
            adjustment={activeWorkout.data.recoveryAdjustment}
          />
        )}
        <Link className="button" href="/app/program">
          {ar ? "عرض تدريب اليوم" : "View today’s training"}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </section>
      <section
        className="recovery-permission"
        aria-labelledby="recovery-permission-title"
      >
        <label className="recovery-switch-row">
          <span>
            <strong id="recovery-permission-title">
              {ar ? "تعديلات التعافي" : "Recovery adjustments"}
            </strong>
            <small role="status">
              {busy === "consent"
                ? ar
                  ? "جارٍ الحفظ…"
                  : "Saving…"
                : data.optedIn
                  ? ar
                    ? "مفعلة للتمرين الجديد"
                    : "On for new workouts"
                  : ar
                    ? "متوقفة — اتباع خطتك المقررة"
                    : "Off — follow your assigned plan"}
            </small>
          </span>
          <input
            className="recovery-switch"
            type="checkbox"
            role="switch"
            aria-labelledby="recovery-permission-title"
            aria-describedby={consentId}
            checked={data.optedIn}
            disabled={
              !!busy || (!data.optedIn && (!data.connected || !data.available))
            }
            onChange={async (e) => {
              const enabled = e.target.checked;
              setBusy("consent");
              setError("");
              setNotice("");
              try {
                setData(
                  await request("/integrations/whoop/training", {
                    enabled,
                    version: data.preferenceVersion,
                    consentVersion: WHOOP_TRAINING_VERSION,
                  }),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Please try again.");
              } finally {
                setBusy("");
              }
            }}
          />
        </label>
        <p id={consentId} className="muted">
          {t.consent}
        </p>
        {!data.connected && (
          <Link className="button secondary" href="/app/wearables">
            {data.hasConnection
              ? ar
                ? "إعادة ربط WHOOP"
                : "Reconnect WHOOP"
              : ar
                ? "ربط WHOOP"
                : "Connect WHOOP"}
          </Link>
        )}
        {data.reason !== "ready" && <p className="muted">{message}</p>}
      </section>
      <footer className="recovery-footer">
        <div>
          <button
            className="text-button recovery-sync"
            disabled={!!busy || !data.connected}
            onClick={async () => {
              setBusy("sync");
              setError("");
              setNotice("");
              try {
                await request("/integrations/whoop/sync", {}, "POST");
                setNotice(
                  ar
                    ? "تم طلب المزامنة. تُعرض أحدث قراءة متاحة."
                    : "Sync requested. Showing the latest available reading.",
                );
                try {
                  setData(await request("/integrations/whoop/training"));
                } catch {
                  setError(
                    ar
                      ? "تم طلب المزامنة. أعد تحميل القراءة."
                      : "Sync was requested. Retry loading the reading.",
                  );
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "Please try again.");
              } finally {
                setBusy("");
              }
            }}
          >
            <RefreshCw
              key={busy === "sync" ? "syncing" : "idle"}
              className={busy === "sync" ? "is-syncing" : ""}
              size={16}
              aria-hidden="true"
            />
            {busy === "sync"
              ? ar
                ? "جارٍ المزامنة…"
                : "Syncing…"
              : ar
                ? "مزامنة WHOOP"
                : "Sync WHOOP"}
          </button>
          {data.lastSyncedAt && (
            <small className="muted">
              {ar ? "آخر مزامنة: " : "Last synced "}
              {date(data.lastSyncedAt)}
            </small>
          )}
        </div>
        <Link className="text-button" href="/app/recovery/rules">
          {ar ? "قواعد مدربك" : "Your coach’s rules"}
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </footer>
      <Link className="recovery-connection-link" href="/app/wearables">
        {ar ? "الاتصال والأذونات" : "Connection & permissions"}
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </div>
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
