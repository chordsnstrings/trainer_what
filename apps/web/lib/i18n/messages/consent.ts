import { defineMessages } from "../core";

/**
 * Optional analytics consent for subscribers (the bar, the preferences
 * sheet and the Profile setting). The marketing site keeps its own English
 * wording (components/acquisition.tsx CONSENT_BAR_TEXT.trainers).
 */
export default defineMessages(
  {
    barText:
      "Optional analytics count which links bring people here. They never include your health or coaching information.",
    privacyPolicy: "Privacy policy",
    optionalAnalytics: "Optional analytics",
    allow: "Allow analytics",
    noThanks: "No thanks",
    close: "Close",
    sheetTitle: "Optional site analytics",
    sheetWhat:
      "If you allow them, we record which link or campaign brought you here, when you sign up or buy, and which wording you saw when we try two versions of a page. Health and coaching information is never included.",
    sheetOff:
      "Everything works without analytics. Turning them off deletes what was recorded for this browser. <link>Read our privacy policy</link>.",
    on: "Analytics are on for this browser.",
    off: "Analytics are off for this browser.",
    sources: "First source: {first}. Last tagged source: {last}.",
    direct: "direct",
    allowOptional: "Allow optional analytics",
    withdraw: "Withdraw analytics consent",
    continueWithout: "Continue without analytics",
    settingText:
      "When this is on, we note which link brought you here and your sign-up and purchase steps. Your health and coaching information is never included.",
    checking: "Checking your choice…",
    settingOn: "On for this browser.",
    settingOff: "Off for this browser.",
    turnOff: "Turn off analytics",
    turnOn: "Turn on analytics",
  },
  {
    barText:
      "تحليلات اختيارية تحسب الروابط التي تجلب الزوار إلى هنا، ولا تتضمن أبدًا معلوماتك الصحية أو معلومات تدريبك.",
    privacyPolicy: "سياسة الخصوصية",
    optionalAnalytics: "تحليلات اختيارية",
    allow: "السماح بالتحليلات",
    noThanks: "لا، شكرًا",
    close: "إغلاق",
    sheetTitle: "تحليلات الموقع الاختيارية",
    sheetWhat:
      "إذا سمحت بها، نسجّل الرابط أو الحملة التي أوصلتك إلى هنا، ووقت التسجيل أو الشراء، والصياغة التي رأيتها عندما نجرّب نسختين من صفحة ما. لا تُضمَّن المعلومات الصحية ومعلومات التدريب أبدًا.",
    sheetOff:
      "كل شيء يعمل دون تحليلات. إيقافها يحذف ما سُجّل لهذا المتصفح. <link>قراءة سياسة الخصوصية</link>.",
    on: "التحليلات مفعّلة لهذا المتصفح.",
    off: "التحليلات متوقفة لهذا المتصفح.",
    sources: "المصدر الأول: {first}. آخر مصدر معلَّم: {last}.",
    direct: "مباشر",
    allowOptional: "السماح بالتحليلات الاختيارية",
    withdraw: "سحب الموافقة على التحليلات",
    continueWithout: "المتابعة دون تحليلات",
    settingText:
      "عند التفعيل، نسجّل الرابط الذي أوصلك إلى هنا وخطوات التسجيل والشراء. لا تُضمَّن معلوماتك الصحية ومعلومات تدريبك أبدًا.",
    checking: "جارٍ التحقق من اختيارك…",
    settingOn: "مفعّلة لهذا المتصفح.",
    settingOff: "متوقفة لهذا المتصفح.",
    turnOff: "إيقاف التحليلات",
    turnOn: "تفعيل التحليلات",
  },
);
