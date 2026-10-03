"use client";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import {
  formatDateTime,
  formatMoney,
  humanize,
  zoneName as zoneLabel,
} from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import bookingMessages from "../lib/i18n/messages/bookings";
import { useEffect, useState } from "react";
import { StripeFeeNote } from "./programme-offers";
import { BottomSheet, Skeleton } from "./phone-ui";
import { fetchWithin, ACCOUNT_READ_TIMEOUT_MS } from "./account-request";
async function request(path: string, body?: unknown) {
  const init: RequestInit = {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  };
  const r = body ? await fetch("/api/v1/bookings" + path, init)
    : await fetchWithin("/api/v1/bookings" + path, init, ACCOUNT_READ_TIMEOUT_MS);
  const data = await r.json();
  if (!r.ok) throw new Error(data.message);
  return data;
}
/** "Gulf Standard Time" for "Asia/Dubai": people never see a raw zone id. */
export const zoneName = (zone: string, locale: Locale = "en") =>
  zoneLabel(zone, locale);
/** "Thu 1 Oct 2026, 09:00" in the booking time zone (lib/format.ts). */
const date = (value: string, zone: string, locale: Locale = "en") =>
  formatDateTime(value, { zone, weekday: true, locale });
const BOOKING_KEYS = [
  "confirmed",
  "payment_pending",
  "canceled",
  "cancelled",
  "attended",
  "no_show",
  "expired",
  "refunded",
] as const;
const PAYMENT_KEYS = [
  "not_required",
  "pending",
  "paid",
  "succeeded",
  "refunded",
  "partially_refunded",
  "failed",
  "canceled",
  "expired",
  "forfeited",
] as const;
/** A booking's status in words, in the reader's language. */
export function bookingStatus(value: string, locale: Locale = "en") {
  const t = translator(bookingMessages, locale);
  return (BOOKING_KEYS as readonly string[]).includes(value)
    ? t(`status_${value as (typeof BOOKING_KEYS)[number]}`)
    : humanize(value);
}
/** A booking's payment in words, in the reader's language. */
export function paymentStatus(value: string, locale: Locale = "en") {
  const t = translator(bookingMessages, locale);
  return (PAYMENT_KEYS as readonly string[]).includes(value)
    ? t(`pay_${value as (typeof PAYMENT_KEYS)[number]}`)
    : humanize(value);
}
/** The English words, for callers that read the maps. */
export const BOOKING_STATUS: Record<string, string> = Object.fromEntries(
  BOOKING_KEYS.map((key) => [key, bookingStatus(key)]),
);
export const PAYMENT_STATUS: Record<string, string> = Object.fromEntries(
  PAYMENT_KEYS.map((key) => [key, paymentStatus(key)]),
);
/** What happens after a missed session, in words. */
export function missedRule(policy: string, locale: Locale = "en") {
  const t = translator(bookingMessages, locale);
  return policy === "forfeit" ? t("missedForfeit") : t("missedReview");
}
const localInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function Bookings({ role }: { role: string }) {
  const [data, setData] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [readError, setReadError] = useState(false),
    [reading, setReading] = useState(false),
    [checkout, setCheckout] = useState(""),
    // A member confirms booking or cancelling in a bottom sheet.
    [sheet, setSheet] = useState<{
      kind: "book" | "cancel";
      slot: any;
      booking?: any;
    } | null>(null);
  const sub = role === "subscriber";
  const t = useT("bookings"),
    common = useT("common"),
    pageLocale = useLocale(),
    toError = useErrorText();
  // Members read their bookings in their language; the coach view is unchanged.
  const locale: Locale = sub ? pageLocale : "en";
  const statusText = (value: string) => bookingStatus(value, locale);
  const paymentText = (value: string) => paymentStatus(value, locale);
  const load = async () => {
    setReading(true);
    try { setData(await request("")); setReadError(false); }
    catch { setReadError(true); }
    finally { setReading(false); }
  };
  useEffect(() => {
    void load();
  }, []);
  async function act(path: string, body: unknown) {
    if (busy || readError) return;
    setBusy(true);
    setCheckout("");
    try {
      const result = await request(path, body);
      const url = result.checkoutUrl ?? result.url;
      if (url) setCheckout(url);
      setNotice(
        result.status === "payment_pending" ? t("held") : t("saved"),
      );
      await load();
      return result;
    } catch (e) {
      // Members read "coach", never "trainer"; other languages get the
      // reviewed sentence for the error (lib/i18n/errors.ts).
      const message = (e as Error).message;
      setNotice(
        sub && locale === "en" && message
          ? message.replace(/\btrainer\b/gi, "coach")
          : toError(e),
      );
    } finally {
      setBusy(false);
    }
  }
  const zone = data?.timezone ?? "Asia/Dubai";
  return (
    <>
      <div className="page-heading">
        <div>
          {!sub && <p className="eyebrow">{t("eyebrow")}</p>}
          <h1>{sub ? t("title") : "Your coaching calendar."}</h1>
          <p className="muted">
            {sub
              ? t("timesMember", { zone: zoneName(zone, locale) })
              : t("timesShown", { zone: zoneName(zone, locale) })}
          </p>
          <a className="button secondary" href="/api/v1/bookings/calendar.ics">
            {t("downloadCalendar")}
          </a>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {readError && (
        <div className="notice error" role="alert">
          <p>{t("loadFailed")}</p>
          <button type="button" className="button secondary" disabled={reading} onClick={() => void load()}>
            {reading ? common("loading") : common("retry")}
          </button>
        </div>
      )}
      {checkout && (
        <p>
          <a className="button" href={checkout}>
            {t("continuePayment")}
          </a>
        </p>
      )}
      {!sub && (
        <section className="card">
          <h2>Add sessions</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act("/slots", {
                title: f.get("title"),
                location: f.get("location"),
                localStart: f.get("start"),
                durationMinutes: Number(f.get("duration")),
                timezone: f.get("timezone"),
                capacity: Number(f.get("capacity")),
                priceMinor: Math.round(Number(f.get("price")) * 100),
                recurrence: {
                  count: Number(f.get("count")),
                  intervalWeeks: Number(f.get("interval")),
                },
              });
            }}
          >
            <div className="form-grid">
              {[
                ["title", "Session name", "text"],
                ["location", "Location or meeting link", "text"],
                [
                  "start",
                  "First start in selected time zone",
                  "datetime-local",
                ],
              ].map(([name, label, type]) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <input
                    name={name}
                    type={type}
                    required
                    minLength={type === "text" ? 3 : undefined}
                    maxLength={name === "title" ? 100 : 300}
                  />
                </label>
              ))}
              <label className="field">
                <span>Time zone</span>
                <input
                  name="timezone"
                  defaultValue={zone}
                  required
                  list="booking-timezones"
                />
              </label>
              <datalist id="booking-timezones">
                {[
                  "Asia/Dubai",
                  "Europe/London",
                  "Europe/Stockholm",
                  "America/New_York",
                  "Asia/Kolkata",
                  "Australia/Sydney",
                ].map((z) => (
                  <option value={z} key={z} />
                ))}
              </datalist>
              {[
                ["duration", "Duration (minutes)", 60, 15, 240],
                ["capacity", "Places", 1, 1, 50],
                ["price", "One-time price (AED)", 0, 0, 100000],
                ["count", "Number of sessions", 1, 1, 26],
                ["interval", "Repeat every (weeks)", 1, 1, 4],
              ].map(([name, label, value, min, max]) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <input
                    name={String(name)}
                    type="number"
                    defaultValue={value}
                    min={min}
                    max={max}
                    step={name === "price" ? "0.01" : 1}
                    required
                  />
                </label>
              ))}
            </div>
            <p className="muted">
              Recurring sessions keep the same local start time. Ambiguous or
              missing daylight-saving times must be changed before saving. A
              price above zero is a separate session payment.
            </p>
            <StripeFeeNote subject="each paid session" bookingFee />
            <button className="button" disabled={busy || readError}>
              Add sessions
            </button>
          </form>
        </section>
      )}
      {role === "owner" && data && (
        <details className="card">
          <summary>Default booking policy</summary>
          <p className="muted">
            Changes apply to new sessions; existing session policies stay as
            offered.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act("/policy", {
                revision: data.policy.revision,
                timezone: f.get("timezone"),
                cancellationHours: Number(f.get("hours")),
                noShowPolicy: f.get("noShowPolicy"),
              });
            }}
            key={data.policy.revision}
          >
            <label className="field">
              <span>Default display time zone</span>
              <input
                name="timezone"
                defaultValue={data.policy.timezone}
                required
              />
            </label>
            <label className="field">
              <span>Member cancellation notice (hours)</span>
              <input
                type="number"
                name="hours"
                min={0}
                max={168}
                defaultValue={data.policy.cancellationHours}
                required
              />
            </label>
            <label className="field">
              <span>No-show policy</span>
              <select
                name="noShowPolicy"
                defaultValue={data.policy.noShowPolicy}
              >
                <option value="coach_review">Coach reviews the outcome</option>
                <option value="forfeit">
                  Session is forfeited; no automatic refund
                </option>
              </select>
            </label>
            <button className="button" disabled={busy || readError}>
              Save defaults
            </button>
          </form>
        </details>
      )}
      <section className="card">
        <h2>{t("upcoming")}</h2>
        {/* Loading: a placeholder, never an empty card. */}
        {!data && !readError && <Skeleton label={t("loading")} lines={3} />}
        {data?.slots
          .filter((s: any) => new Date(s.starts_at).getTime() > Date.now())
          .map((s: any) => {
            const mine = data.bookings.find(
              (b: any) =>
                b.slot_id === s.id &&
                ["confirmed", "payment_pending"].includes(b.status),
            );
            return (
              <div
                className={"list-row" + (sub ? " booking-slot" : "")}
                key={s.id}
              >
                <div>
                  <strong dir="auto">{s.title}</strong>
                  <p dir="auto">
                    {date(s.starts_at, zone, locale)} ·{" "}
                    {/* Booked already: say so here; the details are in
                        Your reservations below. */}
                    {sub && mine?.status === "confirmed"
                      ? t("youreBooked")
                      : s.status === "open"
                      ? t("placesLeft", {
                          count: Math.max(0, s.capacity - s.booked),
                        })
                      : t("canceled")}
                  </p>
                  <p dir="auto">{s.location}</p>
                  <p className="muted" dir="auto">
                    {Number(s.price_minor) > 0
                      ? locale === "en"
                        ? `AED ${(Number(s.price_minor) / 100).toFixed(2)} per session`
                        : t("perSession", {
                            price: formatMoney(s.price_minor, locale),
                          })
                      : t("included")}
                    {t("cancelBefore", { count: Number(s.cancellation_hours) })}
                    {s.series_id ? t("recurring") : ""}
                  </p>
                  {mine?.status === "payment_pending" && (
                    <p>
                      {mine.hold_expires_at
                        ? t("paymentPending", {
                            when: date(mine.hold_expires_at, zone, locale),
                          })
                        : t("reconciliation")}
                    </p>
                  )}
                </div>
                {sub && s.status === "open" && (
                  <div className="button-row">
                    {(!mine || mine.status === "payment_pending") && (
                      <button
                        className="button"
                        disabled={busy || readError || (!mine && s.booked >= s.capacity)}
                        onClick={() =>
                          mine
                            ? void act(`/slots/${s.id}/reserve`, {})
                            : setSheet({ kind: "book", slot: s })
                        }
                      >
                        {mine
                          ? t("resumePayment")
                          : Number(s.price_minor) > 0
                            ? t("reservePay")
                            : t("reserve")}
                      </button>
                    )}
                    {mine && (
                      <button
                        className="button secondary"
                        disabled={busy || readError}
                        onClick={() =>
                          setSheet({ kind: "cancel", slot: s, booking: mine })
                        }
                      >
                        {t("cancelReservation")}
                      </button>
                    )}
                  </div>
                )}
                {!sub && s.status === "open" && (
                  <details>
                    <summary>Edit or cancel</summary>
                    <SlotEditor slot={s} busy={busy || readError} act={act} />
                  </details>
                )}
              </div>
            );
          })}
        {data &&
          !data.slots.some(
            (s: any) => new Date(s.starts_at).getTime() > Date.now(),
          ) && <p className="muted">{t("noUpcoming")}</p>}
      </section>
      <section className="card">
        <h2>{sub ? t("yourReservations") : "Reservations and attendance"}</h2>
        {data?.bookings.map((b: any) => {
          const slot = data.slots.find((s: any) => s.id === b.slot_id);
          return (
            <div className="list-row" key={b.id}>
              <div>
                <strong dir="auto">
                  {sub ? (slot?.title ?? t("session")) : b.name}
                </strong>
                <p dir="auto">
                  {sub ? "" : `${slot?.title ?? "Session"} · `}
                  {slot ? date(slot.starts_at, zone, locale) : ""}
                  {" · "}
                  <span className="badge">{statusText(b.status)}</span>
                </p>
                <p className="muted">
                  {sub
                    ? paymentText(b.payment_status)
                    : `Payment: ${paymentText(b.payment_status)}`}
                  {b.cancel_reason &&
                  !/^Canceled by (member|coach)$/.test(b.cancel_reason)
                    ? " · " + b.cancel_reason
                    : ""}
                </p>
              </div>
              {!sub && b.status === "confirmed" && (
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={busy || readError}
                    onClick={() =>
                      void act(`/${b.id}/cancel`, {
                        revision: b.version,
                        reason: "Canceled by coach",
                      })
                    }
                  >
                    Cancel
                  </button>
                  {slot &&
                    new Date(slot.ends_at).getTime() < Date.now() &&
                    ["attended", "no_show"].map((status) => (
                      <button
                        className="button secondary"
                        disabled={busy || readError}
                        key={status}
                        onClick={() =>
                          void act(`/${b.id}/outcome`, {
                            status,
                            revision: b.version,
                          })
                        }
                      >
                        {bookingStatus(status)}
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {data && !data.bookings.length && (
          <p className="muted">
            {sub ? t("noReservationsMember") : t("noReservations")}
          </p>
        )}
      </section>
      {sub && (
        <BottomSheet
          open={!!sheet}
          onClose={() => setSheet(null)}
          title={
            sheet?.kind === "cancel"
              ? t("cancelTitle")
              : t("bookTitle", { title: sheet?.slot.title ?? t("thisSession") })
          }
          description={
            sheet ? (
              <span dir="auto">
                {date(sheet.slot.starts_at, zone, locale)}
                {sheet.slot.location ? ` · ${sheet.slot.location}` : ""}
              </span>
            ) : undefined
          }
          footer={
            <>
              <button
                type="button"
                className="button secondary"
                onClick={() => setSheet(null)}
              >
                {sheet?.kind === "cancel" ? t("keepPlace") : t("notNow")}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy || readError}
                onClick={() => {
                  if (!sheet) return;
                  const done =
                    sheet.kind === "cancel"
                      ? act(`/${sheet.booking.id}/cancel`, {
                          revision: sheet.booking.version,
                          reason: "Canceled by member",
                        })
                      : act(`/slots/${sheet.slot.id}/reserve`, {});
                  void done.then(() => setSheet(null));
                }}
              >
                {sheet?.kind === "cancel"
                  ? t("cancelReservation")
                  : Number(sheet?.slot.price_minor) > 0
                    ? t("bookPay")
                    : t("bookPlace")}
              </button>
            </>
          }
        >
          {sheet && (
            <ul className="sheet-facts">
              <li>
                {Number(sheet.slot.price_minor) > 0
                  ? t("sheetPaid", {
                      price: formatMoney(sheet.slot.price_minor, locale),
                    })
                  : t("sheetIncluded")}
              </li>
              <li>
                {t("sheetCancel", {
                  count: Number(sheet.slot.cancellation_hours),
                })}
              </li>
              <li>{missedRule(sheet.slot.no_show_policy, locale)}</li>
            </ul>
          )}
        </BottomSheet>
      )}
    </>
  );
}
function SlotEditor({
  slot,
  busy,
  act,
}: {
  slot: any;
  busy: boolean;
  act: (path: string, body: unknown) => Promise<any>;
}) {
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act(`/slots/${slot.id}/update`, {
            revision: slot.version,
            title: f.get("title"),
            location: f.get("location"),
            startsAt: new Date(String(f.get("start"))).toISOString(),
            endsAt: new Date(String(f.get("end"))).toISOString(),
            capacity: Number(f.get("capacity")),
            reason: f.get("reason"),
          });
        }}
      >
        <p className="muted">
          Edit this occurrence only. Dates below use your browser’s local time
          zone.
        </p>
        {[
          ["title", "Session name", "text", slot.title],
          ["location", "Location", "text", slot.location],
          [
            "start",
            "Starts (your local time)",
            "datetime-local",
            localInput(slot.starts_at),
          ],
          [
            "end",
            "Ends (your local time)",
            "datetime-local",
            localInput(slot.ends_at),
          ],
          ["capacity", "Places", "number", slot.capacity],
          ["reason", "Reason for change", "text", ""],
        ].map(([name, label, type, value]) => (
          <label className="field" key={name}>
            <span>{label}</span>
            <input
              name={name}
              type={type}
              defaultValue={value}
              min={type === "number" ? 1 : undefined}
              max={type === "number" ? 50 : undefined}
              required
              minLength={name === "reason" ? 5 : undefined}
            />
          </label>
        ))}
        <button className="button" disabled={busy}>
          Save occurrence
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act(`/slots/${slot.id}/cancel`, {
            revision: slot.version,
            reason: f.get("reason"),
          });
        }}
      >
        <label className="field">
          <span>Reason to cancel this occurrence for everyone</span>
          <input name="reason" minLength={5} required />
        </label>
        <button className="button secondary" disabled={busy}>
          Cancel occurrence
        </button>
      </form>
    </>
  );
}
