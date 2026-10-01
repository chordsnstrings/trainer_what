// Public, member and coach-facing text never names the model or its vendor
// (owner, 30 September 2026: "don't mention that we are using Opus. Frontier
// model."). Super admin screens may show real model IDs; they are not scanned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  AVAILABILITY_LINES,
  BRAND_COPY,
  llmsFullTxt,
  llmsTxt,
} from "@trainer/contracts";
import { MARKETING_CONTENT } from "../packages/contracts/src/marketing-content.ts";
import { MARKETING_ASSISTANT_PUBLIC_TEXT } from "../packages/domain/src/marketing-assistant.ts";

/** Model, vendor and hosting-platform names (case-insensitive, whole words). */
export const MODEL_OR_VENDOR =
  /\b(?:seed[\s-]*2(?:\.0)?|seed[\s-]*pro|bytedance|byteplus|modelark|volcengine|doubao|openai|chatgpt|gpt(?:-?\d[\w.]*)?|anthropic|claude|opus|sonnet|haiku|gemini|deepseek|qwen|llama|mistral|grok)\b/i;
/** "Seed" as a capitalised name (the lower-case verb is ordinary English). */
const SEED_NAME = /\bSeed\b/;

const flags = (on: boolean) => ({
  model: true,
  nutrition: on,
  voice: on,
  customDomains: on,
  payments: on,
  payouts: on,
  whoop: on,
  zepp: on,
  instagram: on,
  frontier: on,
});

function scan(where: string, text: string) {
  assert.doesNotMatch(text, MODEL_OR_VENDOR, where);
  assert.doesNotMatch(text, SEED_NAME, where);
}

test("marketing content, legal pages, brand lines and gated lines name no model or vendor", () => {
  for (const page of MARKETING_CONTENT) scan(page.path, JSON.stringify(page));
  scan("BRAND_COPY", JSON.stringify(BRAND_COPY));
  scan("AVAILABILITY_LINES", JSON.stringify(AVAILABILITY_LINES));
  scan("marketing assistant", JSON.stringify(MARKETING_ASSISTANT_PUBLIC_TEXT));
});

test("llms.txt and llms-full.txt name no model or vendor, with every flag off or on", () => {
  for (const on of [false, true]) {
    const ctx = { origin: "https://trainsyou.example", appName: "trainsyou", availability: flags(on) };
    scan(`llms.txt (${on})`, llmsTxt(ctx));
    scan(`llms-full.txt (${on})`, llmsFullTxt(ctx));
  }
});

test("web message catalogs name no model or vendor", async () => {
  const dir = new URL("../apps/web/lib/i18n/messages/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 10);
  for (const file of files) scan(file, await readFile(new URL(file, dir), "utf8"));
});

test("the guard catches the names it is meant to", () => {
  for (const name of ["Seed 2.0 Pro", "ByteDance", "BytePlus", "OpenAI", "ChatGPT", "GPT-5.5", "Anthropic", "Claude", "Opus", "Sonnet"])
    assert.ok(MODEL_OR_VENDOR.test(name) || SEED_NAME.test(name), name);
  assert.ok(!MODEL_OR_VENDOR.test("a frontier model"));
});
