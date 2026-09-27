"use client";
import { useEffect } from "react";
import {
  DEFAULT_LANGUAGE,
  directionOf,
  languageCookie,
  languageFromCookieHeader,
  parseLanguage,
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
 * Saves the device language (the next server render starts in it) and
 * applies it now. Used for a signed-in member's saved language.
 */
export function rememberLanguage(language: Language) {
  document.cookie = languageCookie(language, location.protocol === "https:");
  applyDocumentLanguage(language);
}
/** The visitor's explicit device choice, else English. */
function deviceLanguage() {
  return languageFromCookieHeader(document.cookie) ?? DEFAULT_LANGUAGE;
}

/**
 * Keeps `<html>` in step with a public page whose language differs from the
 * device choice (a coach website written in Arabic) during client-side
 * navigation; leaving the page returns to the device choice.
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
 * per workspace) to the whole workspace and mirrors it into the device
 * cookie. A failed read keeps the current direction.
 */
export function MemberLanguage({ member }: { member: string }) {
  useEffect(() => {
    let current = true;
    void fetch("/api/v1/notifications/preferences", {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        const language = parseLanguage(value?.data?.language);
        if (current && language) rememberLanguage(language);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [member]);
  return null;
}
