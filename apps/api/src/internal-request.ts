import type { FastifyInstance, FastifyRequest } from "fastify";
import { HOST_HEADERS, signHostRequest } from "./host-routing.ts";
import { PREVIEW_API } from "./trainer-preview-access.ts";

/** Re-enter existing routes as the same person and the same verified host. */
export async function forwardWorkspaceRequest(
  app: FastifyInstance, req: FastifyRequest, method: "GET" | "PUT" | "POST", url: string, payload?: unknown,
) {
  if (req.trainerPreview && url.startsWith("/api/v1/") && !url.startsWith(PREVIEW_API + "/"))
    url = PREVIEW_API + url.slice("/api/v1".length);
  const headers: Record<string, string> = {};
  for (const key of ["cookie", "authorization", "origin", "host", "user-agent"]) {
    const value = req.headers[key];
    if (typeof value === "string") headers[key] = value;
  }
  // Edge proofs bind method, target and timestamp. Reusing the incoming proof
  // on a different route fails verification. Sign only the already-verified
  // context; the destination still authenticates, authorizes and scopes it.
  if (req.hostContext?.verifiedProxy) {
    const { host, clientIp } = req.hostContext, time = String(Date.now());
    headers[HOST_HEADERS.host] = host;
    headers[HOST_HEADERS.time] = time;
    if (clientIp) headers[HOST_HEADERS.clientIp] = clientIp;
    headers[HOST_HEADERS.signature] = signHostRequest(host, method, url, time, undefined, clientIp);
  }
  const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as any }) });
  let body: any = null;
  try { body = response.json(); } catch {}
  if (response.statusCode >= 400) throw Object.assign(new Error(body?.message ?? "This could not be saved."), { statusCode: response.statusCode, code: body?.code ?? "APPLY_FAILED" });
  return body;
}
