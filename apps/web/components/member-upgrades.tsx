"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { BottomSheet } from "./phone-ui";
import { formatDate, formatMoney } from "../lib/format";
import { useErrorText, useLocale } from "../lib/i18n/react";
const upgradeReasonsArabic: Record<string, string> = {
  "A monthly paid membership is needed to change packages. Prepaid members can add a one-month module pass below.":
    "تتطلب ترقية الباقة اشتراكًا شهريًا مدفوعًا. يمكن لأصحاب الباقات المدفوعة مقدمًا إضافة تصريح لمدة شهر أدناه.",
  "Turn renewal back on before upgrading.": "أعد تفعيل التجديد قبل الترقية.",
  "This package is not available for a monthly upgrade.":
    "هذه الباقة غير متاحة للترقية الشهرية.",
  "Choose a higher package to upgrade.": "اختر باقة أعلى للترقية.",
  "This package’s price needs to be updated by your coach.":
    "يحتاج مدربك إلى تحديث سعر هذه الباقة.",
  "An upgrade must add features and keep everything already included.":
    "يجب أن تضيف الترقية ميزات مع الاحتفاظ بكل ما تتضمنه باقتك الحالية.",
  "This package uses a different programme length. Ask your coach to arrange the change.":
    "مدة برنامج هذه الباقة مختلفة. اطلب من مدربك ترتيب التغيير.",
  "Your separate voice subscription must end before moving to a package that includes voice.":
    "يجب أن ينتهي اشتراكك الصوتي المنفصل قبل الانتقال إلى باقة تشمل الصوت.",
  "Your active module pass must end before moving to a package that includes the same feature.":
    "يجب أن ينتهي التصريح النشط قبل الانتقال إلى باقة تتضمن الميزة نفسها.",
};
async function request(path: string, body?: unknown) {
  const r = await fetch(`/api/v1/membership/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const d = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(d.message ?? "Please try again."), {
      code: d.code,
    });
  return d;
}
export function MemberUpgrades({
  onChanged,
}: {
  onChanged: () => Promise<void> | void;
}) {
  const locale = useLocale(),
    ar = locale === "ar",
    toError = useErrorText();
  const [data, setData] = useState<any>();
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(() => request("upgrades").then(setData), []);
  useEffect(() => {
    void load().catch(() =>
      setError(
        ar ? "تعذر تحميل خيارات الترقية." : "Could not load upgrade options.",
      ),
    );
  }, [load, ar]);
  const review = async (id: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setQuote(await request("change-plan", { productId: id }));
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await request(
        confirm ? "upgrades/confirm" : "upgrades/reconcile",
        confirm ? { quoteId: quote.id } : {},
      );
      setQuote(null);
      setNotice(
        r.status === "succeeded"
          ? ar
            ? "تم تأكيد الترقية. تُحدَّث عضويتك."
            : "Upgrade confirmed. Your membership is updating."
          : r.status === "failed"
            ? ar
              ? "لم تُطبَّق الترقية. تبقى عضويتك الحالية."
              : "The upgrade was not applied. Your current membership remains."
            : ar
              ? "جارٍ تأكيد الدفع. لم تبدأ عملية دفع ثانية."
              : "Payment is being confirmed. No second payment has been started.",
      );
      if (r.url) window.location.assign(r.url);
      await onChanged();
    } catch (e) {
      setQuote(null);
      setError(toError(e));
    } finally {
      await load().catch(() => {});
      setBusy(false);
    }
  };
  const features = (ms: string[]) =>
    ms.map((m) =>
      m === "voice"
        ? ar
          ? "التوجيه الصوتي"
          : "Voice guidance"
        : m === "nutrition"
          ? ar
            ? "التغذية"
            : "Nutrition"
          : ar
            ? "التدريب"
            : "Training",
    );
  return (
    <section className="card member-upgrades" aria-labelledby="upgrade-title">
      <p className="eyebrow">{ar ? "مساحة للمزيد" : "Make room for more"}</p>
      <h2 id="upgrade-title">{ar ? "ترقية باقتك" : "Upgrade your package"}</h2>
      <p className="muted">
        {ar
          ? "راجع المبلغ المستحق اليوم والسعر الشهري الجديد قبل التأكيد. تبقى عضويتك الحالية حتى نجاح الدفع."
          : "Review what is due today and your new monthly price before confirming. Your current package stays in place until payment succeeds."}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!data && (
        <button
          className="button secondary"
          onClick={() => void load().catch(() => {})}
        >
          {ar ? "تحميل الخيارات" : "Load options"}
        </button>
      )}
      {data?.pending && (
        <div className="notice">
          <strong>
            {ar ? "ترقية بانتظار التأكيد" : "Upgrade awaiting confirmation"}
          </strong>
          <p>{data.pending.name}</p>
          <div className="button-row">
            {data.pending.url && (
              <a className="button" href={data.pending.url}>
                {ar ? "إكمال الدفع الآمن" : "Complete secure payment"}
              </a>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void finish(false)}
            >
              {ar ? "التحقق من الحالة" : "Check status"}
            </button>
          </div>
        </div>
      )}
      {data?.prepaid && (
        <p className="notice">
          {ar
            ? "باقتك مدفوعة مقدمًا. أضف التغذية أو الصوت بتصريح شهري أدناه؛ تحتفظ بمدة تدريبك المدفوعة وخصمك."
            : "Your package is prepaid. Add nutrition or voice with a monthly pass below while keeping your paid training term and discount."}
        </p>
      )}
      {data && !data.prepaid && data.offers.length === 0 && (
        <p>
          {ar
            ? "أنت على أعلى باقة متاحة من مدربك حاليًا."
            : "You’re on the highest package your coach currently offers."}
        </p>
      )}
      {!data?.prepaid &&
        data?.offers.map((o: any) => (
          <article className="upgrade-option" key={o.id}>
            <div>
              <h3>{o.name}</h3>
              <p className="upgrade-price">
                {formatMoney(o.priceMinor, locale)}{" "}
                <small>{ar ? "/ شهر" : "/ month"}</small>
              </p>
              <ul>
                {features(o.modules).map((f) => (
                  <li key={f}>
                    <Check size={16} aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              {o.reason && (
                <p className="muted">
                  {ar
                    ? (upgradeReasonsArabic[o.reason] ??
                      "هذه الباقة غير متاحة للترقية حاليًا. تواصل مع مدربك.")
                    : o.reason}
                </p>
              )}
            </div>
            <button
              className="button secondary"
              disabled={busy || data.blocked || !!o.reason}
              onClick={() => void review(o.id)}
            >
              {ar ? "مراجعة الترقية" : "Review upgrade"}
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          </article>
        ))}
      <BottomSheet
        open={!!quote}
        onClose={() => {
          if (!busy) setQuote(null);
        }}
        title={ar ? "مراجعة الترقية" : "Review your upgrade"}
        footer={
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setQuote(null)}
            >
              {ar ? "ليس الآن" : "Not now"}
            </button>
            <button
              className="button"
              disabled={busy || !quote}
              onClick={() => void finish(true)}
            >
              {busy
                ? ar
                  ? "جارٍ التأكيد…"
                  : "Confirming…"
                : ar
                  ? `تأكيد ودفع ${formatMoney(quote?.amountMinor ?? 0, locale)}`
                  : `Confirm & pay ${formatMoney(quote?.amountMinor ?? 0, locale)}`}
            </button>
          </>
        }
      >
        {quote && (
          <div>
            <h3>{quote.name}</h3>
            <dl className="upgrade-quote">
              <div>
                <dt>{ar ? "المستحق اليوم" : "Due today"}</dt>
                <dd>{formatMoney(quote.amountMinor, locale)}</dd>
              </div>
              <div>
                <dt>{ar ? "السعر الشهري الجديد" : "New monthly price"}</dt>
                <dd>{formatMoney(quote.monthlyPriceMinor, locale)}</dd>
              </div>
              <div>
                <dt>{ar ? "موعد التجديد" : "Renewal date"}</dt>
                <dd>{formatDate(quote.renewalAt, { locale })}</dd>
              </div>
            </dl>
            <p>
              {ar
                ? "يشمل المبلغ تسوية الفترة الحالية. ستُستخدم طريقة الدفع المحفوظة، وقد يلزم إكمال تأكيد آمن. يبقى تاريخ التجديد كما هو."
                : "Today’s amount includes the adjustment for this billing period. Your saved payment method will be used; secure confirmation may be required. Your renewal date stays the same."}
            </p>
            <p className="muted">
              {ar
                ? "العرض صالح لخمس دقائق. لا تفتح دفعة أخرى إذا بقيت النتيجة معلقة."
                : "This quote is valid for five minutes. If payment is pending, check its status before trying another upgrade."}
            </p>
          </div>
        )}
      </BottomSheet>
    </section>
  );
}
