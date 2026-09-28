"use client";
import Link from "next/link";

/** Same-origin JSON request that keeps the API error code for the caller. */
export async function governanceApi(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch("/api/v1" + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}

/** An error notice; a step-up refusal links to authenticator verification. */
export function GovernanceError({
  error,
}: {
  error: { message: string; code?: string } | null;
}) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <span>
        {error.message}
        {error.code === "MFA_STEP_UP" && (
          <>
            {" "}
            <Link className="text-link" href="/admin/account-security">
              Verify your authenticator
            </Link>
            , then return here.
          </>
        )}
      </span>
    </div>
  );
}

export const aed = (minor: number | null | undefined) =>
  minor === null || minor === undefined
    ? "—"
    : new Intl.NumberFormat("en-AE", {
        style: "currency",
        currency: "AED",
        maximumFractionDigits: 2,
      }).format(minor / 100);
/**
 * US dollar amounts on every finance screen: four decimals, so small provider
 * costs never read 0.00 on one screen and a real amount on another; a
 * positive amount below 0.0001 shows as "<0.0001".
 */
export const usd = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.0001) return "USD <0.0001";
  return "USD " + n.toFixed(4);
};
/** US cents (a domain charged in dollars) as dollars. */
export const usdCents = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(cents / 100);
export const percent = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
export const when = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Dubai",
      }).format(new Date(value))
    : "—";

/** Links to the governance screens an operator's role may use. */
export function GovernanceLinks({ platformRole }: { platformRole: string }) {
  const links: Array<[string, string]> = [["/admin/alerts", "Operator alerts"]];
  if (["admin", "finance"].includes(platformRole))
    links.push(["/admin/metrics", "Business metrics"]);
  if (["admin", "support"].includes(platformRole))
    links.push(["/admin/governance", "Workspaces and accounts"]);
  if (platformRole === "none") return null;
  return (
    <nav className="governance-links" aria-label="Governance">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="button secondary">
          {label}
        </Link>
      ))}
    </nav>
  );
}
