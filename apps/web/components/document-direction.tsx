"use client";
import { useEffect } from "react";
import {
  LANGUAGE_COOKIE,
  MEMBER_LANGUAGE_COOKIE,
  directionOf,
  languageCookie,
  languageFromCookieHeader,
  parseLanguage,
  resolveDocumentLanguage,
  type Language,
} from "../document-language";

/** Sets `<html lang dir>` without a reload (client-side navigation). */
export function applyDocumentLanguage(language: Language) {
  const root = document.documentElement;
  if (root.lang !== language) root.lang = language;
  const dir = directionOf(language);
  if (root.dir !== dir) root.dir = dir;
}
/**
 * Applies a signed-in member's saved language now and mirrors it into the
 * member language cookie, so the next server render of the workspace starts
 * in it. It never touches the visitor's explicit device choice (`?lang=`), so
 * public pages and coach websites keep their own precedence.
 */
export function rememberMemberLanguage(language: Language) {
  document.cookie = languageCookie(
    language,
    location.protocol === "https:",
    MEMBER_LANGUAGE_COOKIE,
  );
  applyDocumentLanguage(language);
}
/** The language of a page outside a coach website, from this device's cookies. */
function deviceLanguage() {
  return resolveDocumentLanguage({
    cookie: languageFromCookieHeader(document.cookie, LANGUAGE_COOKIE),
    member: languageFromCookieHeader(document.cookie, MEMBER_LANGUAGE_COOKIE),
  }).lang;
}

/**
 * Keeps `<html>` in step with a public page whose language differs from the
 * device's (a coach website written in Arabic) during client-side
 * navigation; leaving the page returns to the device's language.
 */
export function PageLanguage({ language }: { language: Language }) {
  useEffect(() => {
    applyDocumentLanguage(language);
    return () => applyDocumentLanguage(deviceLanguage());
  }, [language]);
  return null;
}

/**
 * Applies the signed-in member's saved language (notification preferences,
 * per workspace) to the whole workspace and mirrors it into the member
 * language cookie. The mirrored value applies at once (a client-side
 * navigation into the workspace); a failed read keeps it.
 */
export function MemberLanguage({ member }: { member: string }) {
  useEffect(() => {
    let current = true;
    const mirrored = languageFromCookieHeader(
      document.cookie,
      MEMBER_LANGUAGE_COOKIE,
    );
    if (mirrored) applyDocumentLanguage(mirrored);
    void fetch("/api/v1/notifications/preferences", {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        const language = parseLanguage(value?.data?.language);
        if (current && language) rememberMemberLanguage(language);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [member]);
  return null;
}
