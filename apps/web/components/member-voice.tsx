"use client";
import Link from "./preview-navigation";
import { Headphones, Timer, Music2, ArrowUpRight } from "lucide-react";
import { useLocale } from "../lib/i18n/react";
import { VoiceAddOnCard } from "./programme-membership";
import { ModulePassCards } from "./membership-commerce";

/** A paid capability has its own discovery, availability and billing journey. */
export function MemberVoice() {
  const ar = useLocale() === "ar";
  return (
    <div className="member-voice" data-stagger>
      <header className="page-heading">
        <p className="eyebrow">{ar ? "إضافة اختيارية" : "Optional add-on"}</p>
        <h1>{ar ? "التوجيه الصوتي." : "Voice guidance."}</h1>
        <p className="muted">
          {ar
            ? "تدريبك، مع توجيه مسموع خطوة بخطوة."
            : "Your training, guided one step at a time."}
        </p>
      </header>
      <section className="voice-intro">
        <Headphones size={28} aria-hidden="true" />
        <h2>{ar ? "ركز على الحركة." : "Stay with the movement."}</h2>
        <p>
          {ar
            ? "استمع للتعليمات أثناء الحصة، وأكد كل مجموعة حين تنتهي. تحتاج الميزات الصوتية إلى عضوية تتضمن الصوت أو إضافة مدفوعة، وإلى جاهزية صوت مدربك."
            : "Hear the next cue during your session and confirm each set when you finish. Audio requires an included voice plan or a paid add-on, and your coach’s voice must be ready."}
        </p>
        <Link className="button secondary" href="/app/program">
          {ar ? "عرض حصصك" : "View your sessions"}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </section>
      <ul className="voice-benefits">
        <li>
          <Headphones size={20} aria-hidden="true" />
          <div>
            <strong>{ar ? "إرشاد مسموع" : "Spoken coaching cues"}</strong>
            <p>
              {ar
                ? "تعليمات للحركة والراحة، مع تحكم واضح في الحصة."
                : "Exercise and rest guidance, with deliberate session controls."}
            </p>
          </div>
        </li>
        <li>
          <Music2 size={20} aria-hidden="true" />
          <div>
            <strong>
              {ar ? "الموسيقى بين التعليمات" : "Music between cues"}
            </strong>
            <p>
              {ar
                ? "تنخفض الموسيقى عند الكلام، ويمكن اختيار موسيقاك الخاصة."
                : "Music lowers while guidance speaks. Your own music remains an option."}
            </p>
          </div>
        </li>
        <li>
          <Timer size={20} aria-hidden="true" />
          <div>
            <strong>
              {ar
                ? "المؤقتات متاحة مع التدريب"
                : "Timers stay included with training"}
            </strong>
            <p>
              {ar
                ? "يمكنك استخدام الخطة النصية ومؤقتات الراحة وتسجيل المجموعات دون شراء الصوت."
                : "Use your written plan, rest timers and set logging without buying voice."}
            </p>
          </div>
        </li>
      </ul>
      <VoiceAddOnCard showUnavailable />
      <ModulePassCards only="voice" />
      <Link className="text-button" href="/app/membership">
        {ar
          ? "عرض عضويتك وخيارات الترقية"
          : "Your membership & upgrade options"}
      </Link>
    </div>
  );
}
