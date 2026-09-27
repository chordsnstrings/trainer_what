import { headers } from "next/headers";
import { verifiedProxyHeaders } from "../host-proxy";

// Server-only helpers for discovery pages and crawler files. proxy.ts removes
// any client-supplied x-trainer-* headers before it sets these, so they are
// trustworthy inside the web server.

/** The public origin of the host that served this request. */
export async function requestOrigin(): Promise<{
  origin: string;
  coachHost: boolean;
}> {
  const incoming = await headers();
  const coach = incoming.get("x-trainer-site-origin");
  return {
    origin: new URL(
      coach ?? process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
    ).origin,
    coachHost: !!coach,
  };
}

/** A GET to the API signed for this request's host, like the coach website. */
export async function signedApiGet(target: string): Promise<Response> {
  const incoming = await headers();
  const { origin } = await requestOrigin();
  return fetch(
    new URL(target, process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"),
    {
      headers: verifiedProxyHeaders(
        new Headers(),
        new URL(origin).host,
        "GET",
        target,
        process.env.INTERNAL_PROXY_SECRET,
        Date.now(),
        incoming.get("x-trainer-client-ip"),
      ),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
}
