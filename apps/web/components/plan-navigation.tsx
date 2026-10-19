"use client";
import Link from "./preview-navigation";
import { useLocale } from "../lib/i18n/react";
export function PlanNavigation({ timeline = false }: { timeline?: boolean }) {
  const ar = useLocale() === "ar";
  return (
    <nav className="tabs" aria-label={ar ? "عرض الخطة" : "Plan view"}>
      <Link
        href="/app/program"
        className={!timeline ? "active" : ""}
        aria-current={!timeline ? "page" : undefined}
      >
        {ar ? "الأسبوع" : "Week"}
      </Link>
      <Link
        href="/app/timeline"
        className={timeline ? "active" : ""}
        aria-current={timeline ? "page" : undefined}
      >
        {ar ? "الجدول الكامل" : "Full timeline"}
      </Link>
    </nav>
  );
}
