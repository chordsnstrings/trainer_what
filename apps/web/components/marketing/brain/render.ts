// The Brain showcases' first frame, on the server
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.2): the showcase root
// around the static inner HTML its render module returns. It imports the
// render modules, the engine's pure modules and the client traces only:
// nothing here loads CSS or a runtime module (tests/marketing-showcase.test.ts
// walks its imports).
import raw from "./data/traces.client.json";
import { esc } from "./engine/core.js";
import { prepare } from "./engine/data.js";
import * as anatomy from "./engine/anatomy.render.js";
import * as field from "./engine/field.render.js";
import * as play from "./engine/play.render.js";
import type {
  RawBrainData,
  RenderOptions,
  ShowcaseKind,
  ShowcaseMode,
} from "./engine/types";

const RENDER: Record<ShowcaseKind, typeof field> = {
  field,
  board: field,
  play,
  anatomy,
};
const TRACES = raw as unknown as RawBrainData;

// Pages render per request; equal options give equal HTML, so the last few
// are kept (a flag change gives new options, hence a new entry).
const cache = new Map<string, string>();
const CACHE_MAX = 32;

/**
 * The showcase root and its static inner HTML. The root is labelled by the
 * page's H2 (labelledBy) or carries the label; data-nosnippet keeps the
 * sample lines out of search snippets. Live: data-sc="pre" until the engine
 * plays (nothing is hidden without html.sc-motion, app/brain-stage.css).
 * Static (MARKETING_SHOWCASE=static): data-sc="off", and the anatomy flat.
 * Every text, the platform name included, is HTML-escaped.
 */
export function renderShowcase(
  kind: ShowcaseKind,
  o: RenderOptions,
  mode: ShowcaseMode,
): string {
  const key = JSON.stringify([kind, o, mode]);
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const module = RENDER[kind];
  const state =
    mode === "static"
      ? ` data-sc="off"${kind === "anatomy" ? " data-sc-flat" : ""}`
      : ' data-sc="pre"';
  const name = o.labelledBy
    ? ` aria-labelledby="${esc(o.labelledBy)}"`
    : o.label
      ? ` aria-label="${esc(o.label)}"`
      : "";
  const inner = module.renderStatic(prepare(TRACES, o), { ...o, kind });
  const html = `<section class="${module.ROOT[kind]}" data-showcase="${kind}"${state} data-nosnippet${name}>${inner}</section>`;
  cache.set(key, html);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return html;
}

/**
 * The 32-bit FNV-1a hash of the showcase HTML, as the key the host and the
 * island share (inline: node:crypto would fail the marketing import guard).
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
