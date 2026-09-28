/**
 * Registrar prices per domain ending for trainer searches and checkouts
 * (docs/features/web-addresses.md, "Prices in USD and suggestions"): the
 * one-year USD registration and renewal cost, the ICANN fee included, kept in
 * `registrar_prices` (migration 071) for 24 hours. Searches read the cache
 * (a price up to a week old may still be shown: every checkout asks the
 * registrar again), fetch a missing ending on demand within the caller's
 * call budget, and the worker refreshes the suggested endings before they
 * expire, so a search normally costs one registrar call. An ending the
 * registrar says it does not sell through its API is cached as not offered
 * (for an hour), with the operator-facing reason; any other registrar error
 * (credentials, a client address that is not whitelisted, throttling, an
 * outage) caches nothing and leaves the last good price in place. Trainers
 * only ever see the marked-up price.
 */
import type { Database } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  RegistrarError,
  endingNotSold,
  registrarFromConfig,
  registrarPurchaseProblem,
  type Registrar,
} from "../../../packages/providers/src/registrar.ts";
import {
  purchasableTlds,
  suggestedTlds,
} from "../../../packages/domain/src/web-address.ts";

/** A cached price is fresh this long. */
export const PRICE_TTL_MS = 24 * 3600000;
/** The worker refreshes a suggested ending's price once it is this old. */
export const PRICE_REFRESH_MS = 20 * 3600000;
/**
 * A "not offered" answer is trusted this long: the registrar may start
 * selling the ending, and such an answer must never hide it for a day.
 */
export const NOT_OFFERED_TTL_MS = 3600000;
/** A price this old is never shown, even while it cannot be refreshed. */
export const PRICE_STALE_MS = 7 * 24 * 3600000;
/** How long a cached answer stays fresh (searches) for its kind. */
const freshFor = (price: EndingPrice) =>
  price.kind === "price" ? PRICE_TTL_MS : NOT_OFFERED_TTL_MS;
/** When the worker asks again for its kind. */
const refreshAfter = (price: EndingPrice) =>
  price.kind === "price" ? PRICE_REFRESH_MS : NOT_OFFERED_TTL_MS;

export type EndingPrice =
  | {
      tld: string;
      kind: "price";
      registerUsd: string;
      renewUsd: string;
      fetchedAt: number;
    }
  | { tld: string; kind: "not_offered"; reason: string; fetchedAt: number };

const decimal = (value: unknown) => {
  const text = String(value ?? "");
  // numeric(12,4) arrives as text from PostgreSQL and PGlite.
  return /^\d{1,9}(\.\d{1,4})?$/.test(text) ? text : null;
};
function fromRow(row: Record<string, any>): EndingPrice | null {
  const fetchedAt = Date.parse(String(row.fetched_at));
  if (!Number.isFinite(fetchedAt)) return null;
  if (row.not_offered)
    return {
      tld: row.tld,
      kind: "not_offered",
      reason: String(row.not_offered),
      fetchedAt,
    };
  const registerUsd = decimal(row.register_usd),
    renewUsd = decimal(row.renew_usd);
  return registerUsd && renewUsd
    ? { tld: row.tld, kind: "price", registerUsd, renewUsd, fetchedAt }
    : null;
}

/** Cached prices of these endings at this registrar and environment. */
export async function readPrices(
  db: Database,
  registrar: Registrar,
  tlds: readonly string[],
) {
  const out = new Map<string, EndingPrice>();
  if (!tlds.length) return out;
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT tld,register_usd::text AS register_usd,renew_usd::text AS renew_usd,not_offered,fetched_at FROM registrar_prices WHERE registrar=$1 AND sandbox=$2 AND tld=ANY($3::text[])",
      [registrar.id, registrar.sandbox, [...tlds]],
    ),
  );
  for (const row of rows) {
    const price = fromRow(row);
    if (price) out.set(price.tld, price);
  }
  return out;
}

async function store(db: Database, registrar: Registrar, price: EndingPrice) {
  await db.system((tx) =>
    tx.query(
      "INSERT INTO registrar_prices(registrar,sandbox,tld,register_usd,renew_usd,not_offered,fetched_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(registrar,sandbox,tld) DO UPDATE SET register_usd=EXCLUDED.register_usd,renew_usd=EXCLUDED.renew_usd,not_offered=EXCLUDED.not_offered,fetched_at=now()",
      [
        registrar.id,
        registrar.sandbox,
        price.tld,
        price.kind === "price" ? price.registerUsd : null,
        price.kind === "price" ? price.renewUsd : null,
        price.kind === "not_offered" ? price.reason.slice(0, 300) : null,
      ],
    ),
  );
}

/**
 * Asks the registrar for one ending's price now and caches the answer (when
 * a database is given). Only the registrar's own answer that the ending is
 * not sold through its API (endingNotSold: no one-year product, an
 * unsupported ending, or registrant documents needed) is cached as not
 * offered. Every other error, definitive or not (a refused client address or
 * key, throttling, an unreachable or unreadable registrar), caches nothing,
 * leaves the stored price as it was and is thrown.
 */
export async function fetchPrice(
  db: Database | undefined,
  registrar: Registrar,
  tld: string,
): Promise<EndingPrice> {
  let price: EndingPrice;
  try {
    const answer = await registrar.pricing(tld);
    price = {
      tld,
      kind: "price",
      registerUsd: answer.registerUsd,
      renewUsd: answer.renewUsd,
      fetchedAt: Date.now(),
    };
    if (!decimal(price.registerUsd) || !decimal(price.renewUsd))
      throw new RegistrarError(
        `The registrar's price for .${tld} is not readable`,
        "unknown",
      );
  } catch (error) {
    if (!endingNotSold(error)) throw error;
    price = {
      tld,
      kind: "not_offered",
      reason:
        (error as RegistrarError).message ||
        "Not sold through the registrar's API",
      fetchedAt: Date.now(),
    };
  }
  if (db) await store(db, registrar, price);
  return price;
}

/**
 * Prices for a search: fresh cached prices as they are; a stale one (up to
 * PRICE_STALE_MS) is shown and refreshed while `take` allows another
 * registrar call; a missing one is fetched while `take` allows. Endings left
 * without a usable price are missing from the answer (the search says it is
 * incomplete). Registrar failures never fail the search.
 */
export async function pricesForSearch(
  db: Database | undefined,
  registrar: Registrar,
  tlds: readonly string[],
  take: () => boolean,
) {
  const cached = db
    ? await readPrices(db, registrar, tlds)
    : new Map<string, EndingPrice>();
  const out = new Map<string, EndingPrice>();
  const now = Date.now();
  for (const tld of tlds) {
    const hit = cached.get(tld);
    if (hit && now - hit.fetchedAt < freshFor(hit)) {
      out.set(tld, hit);
      continue;
    }
    if (take())
      try {
        out.set(tld, await fetchPrice(db, registrar, tld));
        continue;
      } catch {
        /* Unknown outcome: fall back to a stale price, if any. */
      }
    if (hit && now - hit.fetchedAt < PRICE_STALE_MS) out.set(tld, hit);
  }
  return out;
}

/**
 * The worker's share: refreshes at most `max` of these endings whose cached
 * price is missing or older than PRICE_REFRESH_MS (missing ones first, then
 * the oldest), so trainer searches find fresh prices. Four a run every 30
 * seconds warms ten endings in about a minute while staying, with the API's
 * own budget, under Namecheap's published 20 calls a minute. Returns how
 * many were refreshed.
 */
export async function refreshPrices(
  db: Database,
  registrar: Registrar,
  tlds: readonly string[],
  max = 4,
) {
  const cached = await readPrices(db, registrar, tlds);
  const due = tlds
    .filter((tld) => {
      const hit = cached.get(tld);
      return !hit || Date.now() - hit.fetchedAt >= refreshAfter(hit);
    })
    .sort(
      (a, b) =>
        (cached.get(a)?.fetchedAt ?? 0) - (cached.get(b)?.fetchedAt ?? 0),
    )
    .slice(0, max);
  let refreshed = 0;
  for (const tld of due)
    try {
      await fetchPrice(db, registrar, tld);
      refreshed++;
    } catch {
      /* Unreachable now: the next run tries again. */
    }
  return refreshed;
}

/**
 * An operator's "refresh prices now" (Super admin, web addresses): asks the
 * registrar again for each ending while `take` allows another call, and
 * says what happened to each. A refused request (a key or client address
 * problem) is reported and changes nothing stored.
 */
export async function refreshPricesNow(
  db: Database,
  registrar: Registrar,
  tlds: readonly string[],
  take: () => boolean,
) {
  const out: Array<{ tld: string; refreshed: boolean; error?: string }> = [];
  for (const tld of tlds) {
    if (!take()) {
      out.push({
        tld,
        refreshed: false,
        error: "The registrar call budget is used up; try again in a minute.",
      });
      continue;
    }
    try {
      await fetchPrice(db, registrar, tld);
      out.push({ tld, refreshed: true });
    } catch (error) {
      out.push({
        tld,
        refreshed: false,
        error:
          error instanceof RegistrarError
            ? error.message.slice(0, 200)
            : "Unexpected failure",
      });
    }
  }
  return out;
}

/**
 * The worker's price upkeep (every web address run, at most four registrar
 * calls): the endings trainers can buy (the suggested ones, then the other
 * allowed ones) at the registrar chosen for new purchases, only while
 * purchases are switched on and that registrar can buy.
 */
export async function refreshSuggestedPrices(
  db: Database,
  deps: { registrar?: Registrar } = {},
) {
  const config = runtimeConfig();
  if (
    config.WEB_ADDRESS_PURCHASES_ENABLED !== "true" ||
    registrarPurchaseProblem(config)
  )
    return 0;
  let registrar: Registrar;
  try {
    registrar = deps.registrar ?? registrarFromConfig(config);
  } catch {
    return 0;
  }
  return refreshPrices(
    db,
    registrar,
    purchasableTlds(
      suggestedTlds(config.WEB_ADDRESS_TLDS),
      config.WEB_ADDRESS_EXTRA_TLDS,
    ),
  );
}
