"use client";
import Link from "next/link";
import { useT } from "../lib/i18n/react";
import { translator, type Locale } from "../lib/i18n/core";
import authMessages from "../lib/i18n/messages/auth";

/**
 * The footer of every page a subscriber sees outside the member app: the
 * coach directory, sign-in, recovery and joining pages, the public legal
 * documents and a coach's own website. It is neutral (the platform's name)
 * or carries the coach's name, and never the trainer-marketing footer
 * (earnings calculator, trainer features, "For trainers").
 *
 * "Analytics preferences" is a button with data-analytics-preferences: the
 * analytics consent (components/acquisition.tsx) opens its panel from it.
 */
export function SubscriberFooter({
  name,
  coach = false,
  directory = true,
  signIn = true,
  analytics = true,
  locale,
}: {
  /** The platform's name, or the coach's on a coach page. */
  name: string;
  /** A coach's page (their website, or sign-in on their own address). */
  coach?: boolean;
  /** Link the coach directory (the platform address only). */
  directory?: boolean;
  /** Link the sign-in page (not on the sign-in page itself). */
  signIn?: boolean;
  /** The analytics preferences entry (not in a trainer's private preview). */
  analytics?: boolean;
  /** A coach website's own language (else the document's). */
  locale?: Locale;
}) {
  const page = useT("auth");
  const t = locale ? translator(authMessages, locale) : page;
  return (
    <footer className="subscriber-footer">
      <nav aria-label={coach ? t("coachLinks", { name }) : t("helpAndLegal")}>
        {directory && <Link href="/coaches">{t("findCoach")}</Link>}
        {signIn && <Link href="/login">{t("memberSignIn")}</Link>}
        <Link href="/terms">{t("terms")}</Link>
        <Link href="/privacy">{t("privacy")}</Link>
        <Link href="/ai-disclosure">{t("digitalCoaching")}</Link>
        {analytics && (
          <button
            type="button"
            className="subscriber-footer-link"
            data-analytics-preferences=""
          >
            {t("analyticsPreferences")}
          </button>
        )}
      </nav>
      <p>
        © {new Date().getFullYear()} <bdi>{name}</bdi>
        {coach ? "" : t("notMedicalAdvice")}
      </p>
    </footer>
  );
}
