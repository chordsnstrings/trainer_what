/**
 * A request error in the member's language. English keeps the server's
 * own sentence (it is written for people); Arabic uses the reviewed text for
 * the error code, else a plain sentence for the HTTP status, so an Arabic
 * screen never shows an English server message.
 */
import { translator, type Locale } from "./core";
import errors from "./messages/errors";

type ErrorKey = keyof typeof errors.en;
type RequestError = {
  message?: string;
  status?: number;
  statusCode?: number;
  code?: string;
  name?: string;
};

export function errorText(error: unknown, locale: Locale = "en"): string {
  const e = (error ?? {}) as RequestError;
  const t = translator(errors, locale);
  const status = e.status ?? e.statusCode;
  const network = error instanceof TypeError && status === undefined;
  if (locale === "en") {
    if (network) return t("network");
    return e.message || t("status500");
  }
  if (network) return t("network");
  if (e.code && Object.hasOwn(errors.en, e.code)) return t(e.code as ErrorKey);
  if (status === 413) return t("status413");
  if (status === 429) return t("status429");
  if (status && status >= 500) return t("status500");
  if (status === 401 || status === 403 || status === 404 || status === 409)
    return t(`status${status}` as ErrorKey);
  if (status && status >= 400) return t("status400");
  return t("status500");
}
