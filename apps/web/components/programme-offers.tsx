"use client";
import { useEffect, useState } from "react";
import { money, paymentBreakdown } from "@trainer/domain";
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

type FeeTerms = {
  stripe: { percentBps: number; fixedMinor: number; internationalBps: number };
  /** Null for staff, who set session prices but not the offer. */
  commissionBps: number[] | null;
  bookingFeeBps?: number;
  note: string;
};
let feeTerms: Promise<FeeTerms | null> | null = null;
/** Stripe's fee terms and the commission bands, read once per page. */
function useFeeTerms() {
  const [terms, setTerms] = useState<FeeTerms | null>(null);
  useEffect(() => {
    feeTerms ??= fetch("/api/v1/finance/fees", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((t) => {
        // A failed read is tried again on the next form, not kept.
        if (!t) feeTerms = null;
        return t;
      });
    let live = true;
    void feeTerms.then((t) => {
      if (live) setTerms(t);
    });
    return () => {
      live = false;
    };
  }, []);
  return terms;
}
/**
 * What one member payment leaves the trainer (owner decision, 28 September
 * 2026: trainers pay Stripe's fees and see them plainly before setting a
 * price). An estimate for a card issued in the UAE, with the abroad case.
 */
export function PaymentEstimate({ price }: { price: string }) {
  const terms = useFeeTerms();
  const minor = Math.round(Number(price) * 100);
  const bands = terms?.commissionBps ?? null;
  const valid = !!terms && !!bands?.length && Number.isSafeInteger(minor) && minor > 0;
  const first = valid ? paymentBreakdown(minor, terms!.stripe, bands![0]) : null;
  // One short announcement once typing pauses; the breakdown below is not
  // read out again on every keystroke.
  const [spoken, setSpoken] = useState("");
  const summary = first
    ? `Each payment of ${money(minor)}: you receive about ${money(first.youReceiveMinor)} after Stripe's fee and the platform commission.`
    : "";
  useEffect(() => {
    const timer = setTimeout(() => setSpoken(summary), 900);
    return () => clearTimeout(timer);
  }, [summary]);
  const live = (
    <p className="sr-only" role="status" aria-live="polite">
      {spoken}
    </p>
  );
  if (!valid || !first) return live;
  const last = paymentBreakdown(minor, terms!.stripe, bands![bands!.length - 1]);
  const pct = (bps: number) => `${(bps / 100).toLocaleString("en")}%`;
  const t = terms!;
  return (
    <>
      {live}
      <div className="notice">
        <p>
          <strong>Each payment of <span dir="ltr">{money(minor)}</span>:</strong>{" "}
          Stripe fee, paid by you, about{" "}
          <span dir="ltr">{money(first.stripeFeeMinor)}</span> (
          {pct(t.stripe.percentBps)} + <span dir="ltr">{money(t.stripe.fixedMinor)}</span>
          ; a card issued outside the UAE about{" "}
          <span dir="ltr">{money(first.internationalFeeMinor)}</span>). Platform
          commission <span dir="ltr">{money(first.commissionMinor)}</span> (
          {pct(bands![0])} for your first 100 paying members, down to{" "}
          {pct(bands![bands!.length - 1])}).
        </p>
        <p>
          You receive about{" "}
          <strong>
            <span dir="ltr">{money(first.youReceiveMinor)}</span>
          </strong>{" "}
          (up to <span dir="ltr">{money(last.youReceiveMinor)}</span> in the lowest
          commission band).
        </p>
        <p className="muted">{t.note}</p>
      </div>
    </>
  );
}

/**
 * Stripe's fee terms in one sentence, for prices without commission bands;
 * `bookingFee` adds the platform's booking fee (paid sessions).
 */
export function StripeFeeNote({
  subject,
  bookingFee = false,
}: {
  subject: string;
  bookingFee?: boolean;
}) {
  const terms = useFeeTerms();
  if (!terms) return null;
  const pct = (bps: number) => `${(bps / 100).toLocaleString("en")}%`;
  return (
    <p className="muted">
      Stripe's card fee on {subject} is paid by you: about{" "}
      {pct(terms.stripe.percentBps)} +{" "}
      <span dir="ltr">{money(terms.stripe.fixedMinor)}</span> per payment, and{" "}
      {pct(terms.stripe.internationalBps)} more for a card issued outside the
      UAE.
      {bookingFee &&
        (terms.bookingFeeBps
          ? ` The platform's booking fee is ${pct(terms.bookingFeeBps)} of each paid session.`
          : " The platform charges no booking fee on sessions.")}{" "}
      The actual fee is on your monthly statement.
    </p>
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
  const [price, setPrice] = useState("");
  const [voicePrice, setVoicePrice] = useState("");
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
        <input
          name="price"
          type="number"
          min={1}
          step={0.01}
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </Field>
      <PaymentEstimate price={price} />
      <Field label="Premium voice add-on, monthly (AED, optional)">
        <input
          name="voicePrice"
          type="number"
          min={1}
          max={1000}
          step={0.01}
          value={voicePrice}
          onChange={(e) => setVoicePrice(e.target.value)}
        />
      </Field>
      <PaymentEstimate price={voicePrice} />
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
  const [voicePrice, setVoicePrice] = useState(
    product.data.voiceAddOnMinor ? String(product.data.voiceAddOnMinor / 100) : "",
  );
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
          value={voicePrice}
          onChange={(e) => setVoicePrice(e.target.value)}
        />
      </Field>
      <PaymentEstimate price={voicePrice} />
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
