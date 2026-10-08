"use client";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { useLocale } from "../lib/i18n/react";

export type SetupStep = {
  key: string;
  done: boolean;
  owner: string;
  href: string;
};
const labels: Record<string, [string, string]> = {
  membership: ["Choose your membership", "اختر عضويتك"],
  training_profile: [
    "Your goals and training availability",
    "أهدافك وأوقات التدريب",
  ],
  training_plan: ["Your workout plan", "خطتك التدريبية"],
  food_profile: ["Food preferences and permission", "تفضيلات الطعام والموافقة"],
  food_plan: ["Your nutrition plan", "خطتك الغذائية"],
  guided_audio: ["Prepare your guided audio", "حضّر الإرشاد الصوتي"],
};
export function MemberSetupChecklist({ steps }: { steps?: SetupStep[] }) {
  const ar = useLocale() === "ar";
  if (!steps?.length || steps.every((s) => s.done)) return null;
  const next =
    steps.find((s) => !s.done && s.owner === "member") ??
    steps.find((s) => !s.done)!;
  return (
    <section
      className="card member-setup-checklist"
      aria-labelledby="setup-title"
    >
      <div className="page-heading">
        <h2 id="setup-title">{ar ? "جاهز للانطلاق" : "Ready to begin"}</h2>
        <p className="muted">
          {steps.filter((s) => s.done).length} / {steps.length} ·{" "}
          {ar
            ? "حسب ما تتضمنه عضويتك"
            : "Based on what your membership includes"}
        </p>
      </div>
      <details className="member-setup-details"><summary>{ar ? "تفاصيل البداية" : "See setup details"}</summary>
      <ol className="setup-checklist">
        {steps.map((s) => (
          <li key={s.key}>
            <span>
              {s.done && <Check size={16} aria-hidden="true" />}{" "}
              {labels[s.key]?.[ar ? 1 : 0] ?? s.key}
            </span>
            <small className="muted">
              {s.done
                ? ar
                  ? "مكتمل"
                  : "Complete"
                : s.owner === "coach"
                  ? ar
                    ? "بانتظار المدرب"
                    : "With your coach"
                  : ar
                    ? "مطلوب منك"
                    : "Your next steps"}
            </small>
          </li>
        ))}
      </ol>
      </details>
      <Link className="button" href={next.href}>
        {next.owner === "coach"
          ? ar
            ? "متابعة مع مدربك"
            : "Check with your coach"
          : ["training_profile", "food_profile"].includes(next.key)
            ? ar ? "متابعة المحادثة" : "Continue your setup chat"
            : labels[next.key]?.[ar ? 1 : 0]}{" "}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
