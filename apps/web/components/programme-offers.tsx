"use client";
import { useState } from "react";
import { money } from "@trainer/domain";
import { Field } from "./field";

/**
 * Offer terms and the trainer's offer form (docs/features/programme.md): the
 * trainer sets the billing (monthly or one upfront payment), the programme
 * length (7 to 365 days, or rolling blocks of the Brain default) and the
 * monthly price of the premium voice add-on members may add.
 */
type Row = { id: string; status: string; data: any };

export function offerTermsText(data: any) {
  const upfront = data?.billing === "upfront";
  const days = typeof data?.programmeDays === "number" ? data.programmeDays : null;
  return {
    price: upfront
      ? `${money(data.priceMinor)} for ${days} days`
      : `${money(data.priceMinor)} / month`,
    length: upfront
      ? `One payment for a ${days}-day programme`
      : days
        ? `Renews monthly · ${days}-day programme blocks`
        : "Renews monthly · rolling programme blocks",
    voice:
      data?.premiumVoice === true || data?.voiceIncluded === true
        ? "Premium guided voice included"
        : data?.voiceAddOnMinor
          ? `Add premium guided voice for ${money(data.voiceAddOnMinor)} / month`
          : null,
  };
}

/** Price, length and voice terms of an offer, for members and the trainer. */
export function OfferTerms({ data }: { data: any }) {
  const t = offerTermsText(data);
  return (
    <div className="offer-terms">
      <strong dir="ltr">{t.price}</strong>
      <span className="muted">{t.length}</span>
      {t.voice && <span>{t.voice}</span>}
    </div>
  );
}

export function OfferForm({
  products,
  busy,
  action,
}: {
  products: Row[];
  busy: boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
}) {
  const [billing, setBilling] = useState<"monthly" | "upfront">("monthly");
  const [rolling, setRolling] = useState(true);
  const upfront = billing === "upfront";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const voice = String(f.get("voicePrice") ?? "").trim();
        void action(
          () =>
            fetch("/api/v1/products", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: f.get("name"),
                description: f.get("description"),
                priceMinor: Math.round(Number(f.get("price")) * 100),
                tier: f.get("tier"),
                billing,
                programmeDays:
                  upfront || !rolling ? Number(f.get("programmeDays")) : null,
                voiceAddOnMinor: voice ? Math.round(Number(voice) * 100) : null,
                ...(f.get("baseProductId")
                  ? { baseProductId: f.get("baseProductId") }
                  : {}),
              }),
            }).then(async (r) => {
              const data = await r.json().catch(() => ({}));
              if (!r.ok)
                throw Object.assign(
                  new Error(data.message ?? "The offer could not be saved"),
                  { code: data.code },
                );
              return data;
            }),
          "Offer saved",
        );
      }}
    >
      <Field label="Plan name">
        <input name="name" required />
      </Field>
      <Field label="Subscription tier">
        <select name="tier">
          <option value="workout">Workout only</option>
          <option value="workout_nutrition">Workout + nutrition</option>
        </select>
      </Field>
      <Field label="How members pay">
        <select
          name="billing"
          value={billing}
          onChange={(e) => setBilling(e.target.value as any)}
        >
          <option value="monthly">Monthly, renews until canceled</option>
          <option value="upfront">Upfront, one payment for the programme</option>
        </select>
      </Field>
      <fieldset className="offer-length">
        <legend>Programme length</legend>
        {!upfront && (
          <label>
            <input
              type="checkbox"
              checked={rolling}
              onChange={(e) => setRolling(e.target.checked)}
            />{" "}
            Rolling blocks planned by your Brain
          </label>
        )}
        {(upfront || !rolling) && (
          <label>
            <input
              name="programmeDays"
              type="number"
              min={7}
              max={365}
              step={1}
              defaultValue={upfront ? 84 : 28}
              required
              aria-label="Programme length in days"
            />{" "}
            days {upfront ? "of access" : "per block"}
          </label>
        )}
      </fieldset>
      <Field label="Comparable workout offer (required for the combined tier)">
        <select name="baseProductId">
          <option value="">Choose for combined tier</option>
          {products
            .filter((p) => (p.data.tier ?? "workout") === "workout")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.data.name} · {offerTermsText(p.data).price}
              </option>
            ))}
        </select>
      </Field>
      <Field label="What is included">
        <textarea name="description" rows={3} />
      </Field>
      <Field label={upfront ? "Programme price (AED)" : "Monthly price (AED)"}>
        <input name="price" type="number" min={1} step={0.01} required />
      </Field>
      <Field label="Premium voice add-on, monthly (AED, optional)">
        <input name="voicePrice" type="number" min={1} max={1000} step={0.01} />
      </Field>
      <button className="button" type="submit" disabled={busy}>
        Create offer
      </button>
    </form>
  );
}

/** Set or change the monthly voice add-on price of an offer. */
export function OfferVoicePrice({
  product,
  busy,
  action,
}: {
  product: Row;
  busy: boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
}) {
  const [open, setOpen] = useState(false);
  if (product.data.premiumVoice === true || product.data.voiceIncluded === true)
    return null;
  if (!open)
    return (
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        {product.data.voiceAddOnMinor ? "Change voice add-on price" : "Price a voice add-on"}
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const price = Math.round(
          Number(new FormData(e.currentTarget).get("voicePrice")) * 100,
        );
        void action(
          () =>
            fetch(`/api/v1/products/${product.id}/voice-addon`, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ priceMinor: price }),
            }).then(async (r) => {
              const data = await r.json().catch(() => ({}));
              if (!r.ok)
                throw Object.assign(
                  new Error(data.message ?? "The price could not be saved"),
                  { code: data.code },
                );
              setOpen(false);
              return data;
            }),
          "Voice add-on price saved",
        );
      }}
    >
      <Field label="Voice add-on, monthly (AED)">
        <input
          name="voicePrice"
          type="number"
          min={1}
          max={1000}
          step={0.01}
          required
          defaultValue={
            product.data.voiceAddOnMinor ? product.data.voiceAddOnMinor / 100 : undefined
          }
        />
      </Field>
      <div className="button-row">
        <button className="button" type="submit" disabled={busy}>
          Save price
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
