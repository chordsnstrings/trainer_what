"use client";
import { apiError } from "./setup-wizard-model";

/** JSON call to /api/v1 that keeps the server's error `code` and status. */
export async function setupApi(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw apiError(r.status, data);
  return data;
}
