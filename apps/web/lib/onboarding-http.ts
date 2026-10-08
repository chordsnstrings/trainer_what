export async function onboardingRequest(path: string, body?: unknown, options: { method?: string; signal?: AbortSignal; keepalive?: boolean } = {}) {
  const response = await fetch("/api/v1" + path, {
    method: options.method ?? (body === undefined ? "GET" : "POST"), cache: "no-store", credentials: "same-origin", signal: options.signal, keepalive: options.keepalive,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.message ?? "The connection dropped. Your saved conversation is still here."), { status: response.status });
  return data;
}
export async function fileBase64(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}
export type ChatAppearance = "web" | "ios" | "android";
export function chatAppearance(userAgent: string, platform = "", touchPoints = 0): ChatAppearance {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1)) return "ios";
  return /Android/i.test(userAgent) ? "android" : "web";
}
