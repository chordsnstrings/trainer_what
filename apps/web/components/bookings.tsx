"use client";
import { useEffect, useState } from "react";
const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    timeZone: "Asia/Dubai",
    dateStyle: "medium",
    timeStyle: "short",
  });
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
export function Bookings({ role }: { role: string }) {
  const [data, setData] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const sub = role === "subscriber";
  const load = () => request("").then(setData);
  useEffect(() => {
    void load().catch((e) => setNotice(e.message));
  }, []);
  async function act(path: string, body: unknown) {
    setBusy(true);
    try {
      await request(path, body);
      setNotice("Your session details are saved.");
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TIME WITH YOUR COACH</p>
          <h1>{sub ? "Make time for progress." : "Your coaching calendar."}</h1>
          <p className="muted">
            All times are shown in Dubai time (UTC+4). Cancel at least 24 hours
            before your session.
          </p>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!sub && (
        <section className="card">
          <h2>Add a session</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act("/slots", {
                title: f.get("title"),
                location: f.get("location"),
                startsAt: new Date(
                  String(f.get("start")) + "+04:00",
                ).toISOString(),
                endsAt: new Date(String(f.get("end")) + "+04:00").toISOString(),
                capacity: Number(f.get("capacity")),
              });
            }}
          >
            <div className="form-grid">
              {[
                ["title", "Session name", "text"],
                ["location", "Location or meeting link", "text"],
                ["start", "Starts (Dubai time)", "datetime-local"],
                ["end", "Ends (Dubai time)", "datetime-local"],
                ["capacity", "Places", "number"],
              ].map(([name, label, type]) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <input
                    name={name}
                    type={type}
                    min={name === "capacity" ? 1 : undefined}
                    max={name === "capacity" ? 50 : undefined}
                    defaultValue={name === "capacity" ? 1 : undefined}
                    required
                  />
                </label>
              ))}
            </div>
            <button className="button" disabled={busy}>
              Add session
            </button>
          </form>
        </section>
      )}
      <section className="card">
        <h2>Upcoming sessions</h2>
        {data?.slots
          .filter((s: any) => new Date(s.starts_at).getTime() > Date.now())
          .map((s: any) => {
            const mine = data.bookings.find(
              (b: any) => b.slot_id === s.id && b.status === "confirmed",
            );
            return (
              <div className="list-row" key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <p>
                    {date(s.starts_at)} · {s.capacity - s.booked} places left
                  </p>
                  <p className="muted">{s.location}</p>
                </div>
                {sub && (
                  <button
                    className="button secondary"
                    disabled={busy || (!mine && s.booked >= s.capacity)}
                    onClick={() =>
                      void act(
                        mine
                          ? "/" + mine.id + "/cancel"
                          : "/slots/" + s.id + "/reserve",
                        {},
                      )
                    }
                  >
                    {mine ? "Cancel reservation" : "Reserve a place"}
                  </button>
                )}
              </div>
            );
          })}
        {data && !data.slots.length && (
          <p className="muted">No sessions have been scheduled yet.</p>
        )}
      </section>
      {!sub && (
        <section className="card">
          <h2>Reservations</h2>
          {data?.bookings.map((b: any) => {
            const slot = data.slots.find((s: any) => s.id === b.slot_id);
            return (
              <div className="list-row" key={b.id}>
                <div>
                  <strong>{b.name}</strong>
                  <p>
                    {slot?.title} · {slot && date(slot.starts_at)} ·{" "}
                    {b.status.replaceAll("_", " ")}
                  </p>
                </div>
                {b.status === "confirmed" && (
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void act("/" + b.id + "/cancel", {})}
                    >
                      Cancel
                    </button>
                    {slot &&
                      new Date(slot.ends_at).getTime() < Date.now() &&
                      ["attended", "no_show"].map((status) => (
                        <button
                          className="button secondary"
                          key={status}
                          disabled={busy}
                          onClick={() =>
                            void act("/" + b.id + "/outcome", { status })
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
        </section>
      )}
    </>
  );
}
