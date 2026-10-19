"use client";
import { useState } from "react";
import { useLocale } from "../lib/i18n/react";

export function ReadRetry({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="button secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onRetry()
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
    >
      {locale === "ar"
        ? busy
          ? "جارٍ التحديث…"
          : "إعادة تحميل العرض"
        : busy
          ? "Refreshing…"
          : "Refresh view"}
    </button>
  );
}
