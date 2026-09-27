"use client";
import { useEffect, useState } from "react";
async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1/bookings" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message);
  return data;
}
const date = (value: string, zone: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  });
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
    [checkout, setCheckout] = useState("");
  const sub = role === "subscriber";
  const load = () => request("").then(setData);
  useEffect(() => {
    void load().catch((e) => setNotice(e.message));
  }, []);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setCheckout("");
    try {
      const result = await request(path, body);
      const url = result.checkoutUrl ?? result.url;
      if (url) setCheckout(url);
      setNotice(
        result.status === "payment_pending"
          ? "Your place is held while payment is completed."
          : "Your session details are saved.",
      );
      await load();
      return result;
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const zone = data?.timezone ?? "Asia/Dubai";
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TIME WITH YOUR COACH</p>
          <h1>{sub ? "Make time for progress." : "Your coaching calendar."}</h1>
          <p className="muted">
            Times are displayed in {zone}. Each session retains the cancellation
            and no-show rules shown when it was offered.
          </p>
          <a className="button secondary" href="/api/v1/bookings/calendar.ics">
            Download calendar
          </a>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {checkout && (
        <p>
          <a className="button" href={checkout}>
            Continue to secure payment
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
            <button className="button" disabled={busy}>
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
            <button className="button" disabled={busy}>
              Save defaults
            </button>
          </form>
        </details>
      )}
      <section className="card">
        <h2>Upcoming sessions</h2>
        {data?.slots
          .filter((s: any) => new Date(s.starts_at).getTime() > Date.now())
          .map((s: any) => {
            const mine = data.bookings.find(
              (b: any) =>
                b.slot_id === s.id &&
                ["confirmed", "payment_pending"].includes(b.status),
            );
            return (
              <div className="list-row" key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <p>
                    {date(s.starts_at, zone)} ·{" "}
                    {s.status === "open"
                      ? `${Math.max(0, s.capacity - s.booked)} places left`
                      : "Canceled"}
                  </p>
                  <p>{s.location}</p>
                  <p className="muted">
                    {Number(s.price_minor) > 0
                      ? `AED ${(Number(s.price_minor) / 100).toFixed(2)} per session`
                      : "Included"}{" "}
                    · Cancel {s.cancellation_hours} hours before · No-show:{" "}
                    {s.no_show_policy === "forfeit"
                      ? "session forfeited"
                      : "coach review"}
                    {s.series_id ? " · recurring series" : ""}
                  </p>
                  {mine?.status === "payment_pending" && (
                    <p>
                      Payment pending · hold until{" "}
                      {mine.hold_expires_at
                        ? date(mine.hold_expires_at, zone)
                        : "reconciliation"}
                    </p>
                  )}
                </div>
                {sub && s.status === "open" && (
                  <div className="button-row">
                    {(!mine || mine.status === "payment_pending") && (
                      <button
                        className="button"
                        disabled={busy || (!mine && s.booked >= s.capacity)}
                        onClick={() => void act(`/slots/${s.id}/reserve`, {})}
                      >
                        {mine
                          ? "Resume payment"
                          : Number(s.price_minor) > 0
                            ? "Reserve and pay"
                            : "Reserve a place"}
                      </button>
                    )}
                    {mine && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(`/${mine.id}/cancel`, {
                            revision: mine.version,
                            reason: "Canceled by member",
                          })
                        }
                      >
                        Cancel reservation
                      </button>
                    )}
                  </div>
                )}
                {!sub && s.status === "open" && (
                  <details>
                    <summary>Edit or cancel</summary>
                    <SlotEditor slot={s} busy={busy} act={act} />
                  </details>
                )}
              </div>
            );
          })}
        {data &&
          !data.slots.some(
            (s: any) => new Date(s.starts_at).getTime() > Date.now(),
          ) && <p className="muted">No upcoming sessions.</p>}
      </section>
      <section className="card">
        <h2>{sub ? "Your reservations" : "Reservations and attendance"}</h2>
        {data?.bookings.map((b: any) => {
          const slot = data.slots.find((s: any) => s.id === b.slot_id);
          return (
            <div className="list-row" key={b.id}>
              <div>
                <strong>{sub ? (slot?.title ?? "Session") : b.name}</strong>
                <p>
                  {slot?.title} · {slot && date(slot.starts_at, zone)} ·{" "}
                  {b.status.replaceAll("_", " ")}
                </p>
                <p className="muted">
                  Payment: {b.payment_status.replaceAll("_", " ")}
                  {b.cancel_reason ? " · " + b.cancel_reason : ""}
                </p>
              </div>
              {!sub && b.status === "confirmed" && (
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={busy}
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
                        disabled={busy}
                        key={status}
                        onClick={() =>
                          void act(`/${b.id}/outcome`, {
                            status,
                            revision: b.version,
                          })
                        }
                      >
                        {status.replaceAll("_", " ")}
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {data && !data.bookings.length && (
          <p className="muted">No reservations yet.</p>
        )}
      </section>
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
