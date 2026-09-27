/**
 * Canonical, run-independent form of a chat-completion request for the model
 * double's capture/replay mode.
 *
 * Record IDs, datetimes and dates change on every run, and the app often
 * orders prompt arrays by random IDs. The canonical form therefore
 *   1. parses JSON message bodies and hashes inline images,
 *   2. sorts object keys and sorts every array by its content with volatile
 *      tokens masked, and
 *   3. numbers volatile tokens in that canonical order ({{uuid:3}}, {{date:1}}).
 * Equal content therefore gives an equal hash in a later run, and a reviewer's
 * answer written with placeholders maps back onto the current run's IDs.
 */
import { createHash } from "node:crypto";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DATETIME =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const PLACEHOLDER = /\{\{(uuid|datetime|date):(\d+)\}\}/g;

type Kind = "uuid" | "datetime" | "date";
export type TokenMap = {
  forward: Map<string, string>;
  reverse: Map<string, string>;
  counters: Record<Kind, number>;
};

function maskText(value: string) {
  return value
    .replace(DATETIME, "{{datetime}}")
    .replace(DATE, "{{date}}")
    .replace(UUID, "{{uuid}}");
}
function masked(value: any): any {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(masked);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [maskText(key), masked(value[key])]),
    );
  return value;
}
function canonical(value: any): any {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return items
      .map((item, index) => ({ item, index, key: JSON.stringify(masked(item)) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
      .map((entry) => entry.item);
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function numberText(value: string, map: TokenMap) {
  const assign = (kind: Kind) => (token: string) => {
    const known = map.forward.get(token);
    if (known) return known;
    const placeholder = `{{${kind}:${++map.counters[kind]}}}`;
    map.forward.set(token, placeholder);
    map.reverse.set(placeholder, token);
    return placeholder;
  };
  return value
    .replace(DATETIME, assign("datetime"))
    .replace(DATE, assign("date"))
    .replace(UUID, (token) => assign("uuid")(token.toLowerCase()));
}
function numbered(value: any, map: TokenMap): any {
  if (typeof value === "string") return numberText(value, map);
  if (Array.isArray(value)) return value.map((item) => numbered(item, map));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        numberText(key, map),
        numbered(item, map),
      ]),
    );
  return value;
}
function parseContent(content: unknown): unknown {
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
  if (Array.isArray(content))
    return content.map((part: any) =>
      part?.type === "image_url"
        ? {
            type: "image",
            sha256: createHash("sha256")
              .update(String(part.image_url?.url ?? ""))
              .digest("hex"),
          }
        : part?.type === "text"
          ? { type: "text", text: parseContent(part.text) }
          : part,
    );
  return content;
}

export type NormalizedRequest = {
  hash: string;
  /** Messages in their original order with numbered placeholders, for reviewers. */
  display: Array<{ role: string; content: unknown }>;
  map: TokenMap;
};

export function normalizeRequest(kind: string, body: any): NormalizedRequest {
  const messages = (Array.isArray(body?.messages) ? body.messages : []).map(
    (m: any) => ({ role: String(m?.role ?? ""), content: parseContent(m?.content) }),
  );
  const map: TokenMap = {
    forward: new Map(),
    reverse: new Map(),
    counters: { uuid: 0, datetime: 0, date: 0 },
  };
  // Message order (system, user) is meaningful and stable; only their
  // contents are canonicalized.
  const canonicalMessages = numbered(
    messages.map((m: any) => ({ role: m.role, content: canonical(m.content) })),
    map,
  );
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind, messages: canonicalMessages }))
    .digest("hex");
  return { hash, display: numbered(messages, map), map };
}

/** Replace placeholders authored against the canonical request with this run's tokens. */
export function denormalize(value: any, map: TokenMap): any {
  if (typeof value === "string")
    return value.replace(PLACEHOLDER, (placeholder) => map.reverse.get(placeholder) ?? placeholder);
  if (Array.isArray(value)) return value.map((item) => denormalize(item, map));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        denormalize(key, map),
        denormalize(item, map),
      ]),
    );
  return value;
}

/** Express a response with the request's placeholders (tokens the request never had stay literal). */
export function renormalize(value: any, map: TokenMap): any {
  const replace = (text: string) =>
    text
      .replace(DATETIME, (t) => map.forward.get(t) ?? t)
      .replace(DATE, (t) => map.forward.get(t) ?? t)
      .replace(UUID, (t) => map.forward.get(t.toLowerCase()) ?? t);
  if (typeof value === "string") return replace(value);
  if (Array.isArray(value)) return value.map((item) => renormalize(item, map));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [replace(key), renormalize(item, map)]),
    );
  return value;
}
