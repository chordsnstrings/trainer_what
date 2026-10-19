"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  readJoinReturn,
  rememberJoinReturn,
  safeJoinReturn,
} from "../lib/join-intent";
import { useLocale } from "../lib/i18n/react";
import { OfferTerms } from "./programme-offers";

export function JoinRecoveryLink() {
  const locale = useLocale();
  return (
    <Link
      className="text-link"
      href="/forgot-password"
      onClick={() => {
        try {
          rememberJoinReturn(
            window.location.pathname + window.location.search,
            sessionStorage,
          );
        } catch {}
      }}
    >
      {locale === "ar" ? "نسيت كلمة المرور؟" : "Forgot password?"}
    </Link>
  );
}
export function JoinContinuity({ remember = false }: { remember?: boolean }) {
  const [path, setPath] = useState<string | null>(null),
    locale = useLocale();
  const [offer, setOffer] = useState<any>(null),
    [coach, setCoach] = useState("");
  useEffect(() => {
    try {
      const current = safeJoinReturn(
        window.location.pathname + window.location.search,
      );
      const returned = safeJoinReturn(
        new URLSearchParams(window.location.search).get("returnTo"),
      );
      if (remember && current) rememberJoinReturn(current, sessionStorage);
      if (returned) rememberJoinReturn(returned, sessionStorage);
      setPath(current && !remember ? null : readJoinReturn(sessionStorage));
    } catch {}
  }, [remember]);
  useEffect(() => {
    if (!path || remember || !path.startsWith("/join-coach/")) return;
    let active = true;
    const destination = new URL(path, "https://local.invalid");
    fetch(
      `/api/v1/public/trainers/${encodeURIComponent(destination.pathname.split("/")[2])}`,
      { signal: AbortSignal.timeout(20000) },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (active) {
          setCoach(data.trainer.name);
          setOffer(
            data.products?.find(
              (item: any) => item.id === destination.searchParams.get("offer"),
            ) ?? null,
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [path, remember]);
  if (!path || remember) return null;
  return (
    <section className="notice">
      {coach && <strong dir="auto">{coach}</strong>}
      {offer && (
        <div>
          <p dir="auto">{offer.data.name}</p>
          <OfferTerms data={offer.data} />
        </div>
      )}
      <Link href={path}>
        {locale === "ar"
          ? "العودة إلى الانضمام لمدربك"
          : "Return to joining your coach"}
      </Link>
      <p className="muted">
        {locale === "ar"
          ? "اختيار الباقة محفوظ؛ ستراجع السعر الحالي قبل الدفع."
          : "Your offer choice is kept; you’ll review current terms before paying."}
      </p>
    </section>
  );
}
