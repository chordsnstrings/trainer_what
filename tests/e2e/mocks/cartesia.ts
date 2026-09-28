/**
 * Cartesia double, test-only (docs/features/trainer-voice.md). Request shapes
 * follow the public API reference (version 2026-08-14):
 * - POST /tts/bytes returns a small silent MP3; Pro voices need a dated model
 *   (voice_model_mismatch otherwise), like the real service;
 * - POST /stt (multipart: file, model ink-whisper) returns a transcript with
 *   word timings and a duration. `TRANSCRIPT:<words>;` inside the audio bytes,
 *   or `nextTranscripts`, choose the words; otherwise "done";
 * - voices: POST /voices/clone (multipart clip, name, language), GET /voices
 *   (q, is_owner), GET and DELETE /voices/:id;
 * - Pro clones: datasets and their files, fine-tunes that answer "training"
 *   for `trainingPolls` polls and then "completed" with one Pro voice, which
 *   Cartesia names itself (not the fine-tune's name). Deleting a fine-tune
 *   leaves its voices (the undocumented worst case).
 * - Lists page with `limit`, `starting_after`, `has_more` and `next_page`;
 *   `listPageSize` forces small pages.
 * Every route checks the key (Authorization: Bearer or X-API-Key) and the
 * Cartesia-Version header. Bodies are not logged (they carry recordings).
 */
import { randomUUID } from "node:crypto";
import { MockServer, type MockRequest, type MockResponse } from "./http.ts";
import { silentMp3 } from "./voice.ts";

type Voice = { id: string; name: string; language: string; isPro: boolean; fineTuneId?: string };
type FineTune = {
  id: string;
  name: string;
  language: string;
  dataset: string;
  polls: number;
  status: "created" | "training" | "completed" | "failed";
  voiceId?: string;
};
export const CARTESIA_PRO_MODELS = ["sonic-3.5-2026-05-04", "sonic-3.6-2026-08-27"];

/** One multipart form, read loosely from the text body (field values and file sizes). */
export function multipartFields(r: MockRequest) {
  const boundary = /boundary=([^;]+)/.exec(String(r.headers["content-type"] ?? ""))?.[1];
  const fields = new Map<string, { value: string; filename?: string; type?: string }>();
  if (!boundary) return fields;
  for (const part of r.rawBody.split("--" + boundary)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (!name) continue;
    const filename = /filename="([^"]*)"/.exec(part)?.[1];
    const type = /Content-Type: ([^\r\n]+)/i.exec(part)?.[1];
    const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
    fields.set(name, { value, filename, type });
  }
  return fields;
}

export class CartesiaMock {
  readonly server: MockServer;
  readonly syntheses: Array<{ voiceId: string; model: string; language: string; characters: number; text: string; version: string; at: string }> = [];
  readonly transcriptions: Array<{ model: string; language: string; bytes: number; text: string; at: string }> = [];
  readonly clones: Array<{ id: string; name: string; language: string; bytes: number; type: string; at: string }> = [];
  readonly uploads: Array<{ dataset: string; filename: string; bytes: number; at: string }> = [];
  readonly deleted: Array<{ kind: "voice" | "dataset" | "fine_tune"; id: string; at: string }> = [];
  readonly voices = new Map<string, Voice>();
  readonly datasets = new Map<string, { id: string; name: string; files: Array<{ id: string; filename: string; size: number }> }>();
  readonly fineTunes = new Map<string, FineTune>();
  /** Polls a fine-tune answers "training" before "completed". */
  trainingPolls = 2;
  /** Makes the next call of a kind answer with this HTTP status. */
  failNext: Partial<Record<"clone" | "tts" | "stt" | "dataset" | "upload" | "fineTune" | "delete", number>> = {};
  /**
   * Processes the next call of a kind and then answers 502, like an answer
   * lost on the way back (the app must reconcile by name, not send again).
   */
  loseNextAnswer = new Set<"clone" | "dataset" | "fineTune">();
  /** Makes the next fine-tune fail with this message. */
  failTraining: string | null = null;
  /**
   * Words the next replies say. A `{ text, language }` entry is recognised
   * only when the request names that language (batch ink-whisper does not
   * detect it); otherwise nothing is recognised.
   */
  nextTranscripts: Array<string | { text: string; language: string }> = [];
  /** Page size for list routes (at most the request's limit). */
  listPageSize = 100;
  /** Voices hidden from lists and name searches, as a lagging list would. */
  readonly hiddenFromLists = new Set<string>();
  /** A completed fine-tune lists no voices yet. */
  withholdProVoices = false;
  constructor(
    tlsMaterial: { key: string; cert: string },
    public apiKey: string,
  ) {
    this.server = new MockServer("cartesia", tlsMaterial, { logBodies: false });
    // A stock voice, as the account's voice library would hold.
    this.voices.set("mock-stock-voice", { id: "mock-stock-voice", name: "Stock narrator", language: "en", isPro: false });
    const route = (method: string, path: string, handler: (r: MockRequest) => MockResponse | Promise<MockResponse>) => {
      for (const p of path.endsWith("/") ? [path, path.slice(0, -1)] : [path])
        this.server.route(method, p, (r) => this.checked(r, handler));
    };
    route("GET", "/voices", (r) => {
      const q = r.query.get("q");
      return {
        body: this.page(
          r,
          [...this.voices.values()].filter((v) => !this.hiddenFromLists.has(v.id) && (!q || v.name.includes(q))),
          (v) => this.voiceBody(v),
          10,
        ),
      };
    });
    route("GET", "/voices/:id", (r) => {
      const v = this.voices.get(r.params.id);
      return v ? { body: this.voiceBody(v) } : this.problem(404, "voice_not_found", "Voice not found");
    });
    route("DELETE", "/voices/:id", (r) => {
      if (this.take("delete")) return this.problem(this.lastStatus, null, "Mock failure");
      if (!this.voices.delete(r.params.id)) return this.problem(404, "voice_not_found", "Voice not found");
      this.deleted.push({ kind: "voice", id: r.params.id, at: new Date().toISOString() });
      return { status: 204 };
    });
    route("POST", "/voices/clone", (r) => {
      if (this.take("clone")) return this.problem(this.lastStatus, null, "Mock failure");
      const f = multipartFields(r);
      const clip = f.get("clip"),
        name = f.get("name")?.value,
        language = f.get("language")?.value;
      if (!clip?.filename || !name || !language)
        return this.problem(400, null, "clip, name and language are required");
      if (f.has("mode") || f.has("enhance")) return this.problem(400, null, "mode and enhance are no longer accepted");
      if (!/^audio\/(mpeg|wav|flac|ogg|webm)$/.test(clip.type ?? ""))
        return this.problem(400, "unsupported_audio_format", "Unsupported audio format");
      const id = randomUUID();
      this.voices.set(id, { id, name, language, isPro: false });
      this.clones.push({ id, name, language, bytes: Buffer.byteLength(clip.value), type: clip.type!, at: new Date().toISOString() });
      if (this.loseNextAnswer.delete("clone")) return this.problem(502, null, "Answer lost");
      return {
        body: { id, access: "private", visibility: "owner", name, tagline: "", description: f.get("description")?.value ?? null, created_at: new Date().toISOString(), language },
      };
    });
    route("POST", "/tts/bytes", (r) => {
      if (this.take("tts")) return this.problem(this.lastStatus, null, "Mock failure");
      const b = r.json ?? {};
      const voiceId = typeof b.voice === "string" ? b.voice : b.voice?.id;
      const voice = this.voices.get(voiceId);
      if (!voice) return this.problem(404, "voice_not_found", "Voice not found");
      if (!b.model_id || typeof b.transcript !== "string" || !b.transcript || b.output_format?.container !== "mp3")
        return this.problem(400, null, "model_id, transcript, voice and an mp3 output_format are required");
      if (voice.isPro && !CARTESIA_PRO_MODELS.includes(b.model_id))
        return this.problem(400, "voice_model_mismatch", "Pro voices need a supported dated model");
      this.syntheses.push({
        voiceId,
        model: b.model_id,
        language: b.language ?? "",
        characters: b.transcript.length,
        text: b.transcript,
        version: String(r.headers["cartesia-version"]),
        at: new Date().toISOString(),
      });
      return { headers: { "content-type": "audio/mpeg", "x-request-id": "tts_" + randomUUID() }, body: silentMp3() };
    });
    route("POST", "/stt", (r) => {
      if (this.take("stt")) return this.problem(this.lastStatus, null, "Mock failure");
      const f = multipartFields(r);
      const file = f.get("file"),
        model = f.get("model")?.value;
      if (!file?.filename || model !== "ink-whisper") return this.problem(400, null, "file and model ink-whisper are required");
      const language = f.get("language")?.value ?? "en";
      const next = /TRANSCRIPT:([^;]*);/.exec(file.value)?.[1] ?? this.nextTranscripts.shift() ?? "done";
      const text = typeof next === "string" ? next : next.language === language ? next.text : "";
      this.transcriptions.push({ model, language, bytes: Buffer.byteLength(file.value), text, at: new Date().toISOString() });
      const words = text.split(/\s+/).filter(Boolean).map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.35 }));
      return {
        body: { type: "transcript", request_id: "stt_" + randomUUID(), text, language, duration: words.length * 0.4 + 0.2, words },
      };
    });
    route("POST", "/datasets/", (r) => {
      if (this.take("dataset")) return this.problem(this.lastStatus, null, "Mock failure");
      if (!r.json?.name || typeof r.json.description !== "string") return this.problem(400, null, "name and description are required");
      const id = "ds_" + randomUUID().replaceAll("-", "");
      this.datasets.set(id, { id, name: r.json.name, files: [] });
      if (this.loseNextAnswer.delete("dataset")) return this.problem(502, null, "Answer lost");
      return { body: { id, name: r.json.name, description: r.json.description, created_at: new Date().toISOString() } };
    });
    route("GET", "/datasets/", (r) => ({
      body: this.page(r, [...this.datasets.values()], (d) => ({ id: d.id, name: d.name, created_at: new Date().toISOString() })),
    }));
    route("POST", "/datasets/:id/files", (r) => {
      if (this.take("upload")) return this.problem(this.lastStatus, null, "Mock failure");
      const dataset = this.datasets.get(r.params.id);
      if (!dataset) return this.problem(404, null, "Dataset not found");
      const f = multipartFields(r);
      const file = f.get("file");
      if (!file?.filename || f.get("purpose")?.value !== "fine_tune") return this.problem(400, null, "file and purpose fine_tune are required");
      dataset.files.push({ id: "file_" + randomUUID().replaceAll("-", ""), filename: file.filename, size: Buffer.byteLength(file.value) });
      this.uploads.push({ dataset: dataset.id, filename: file.filename, bytes: Buffer.byteLength(file.value), at: new Date().toISOString() });
      return { status: 204 };
    });
    route("GET", "/datasets/:id/files", (r) => {
      const dataset = this.datasets.get(r.params.id);
      if (!dataset) return this.problem(404, null, "Dataset not found");
      return { body: this.page(r, dataset.files, (x) => ({ ...x, created_at: new Date().toISOString() })) };
    });
    route("DELETE", "/datasets/:id", (r) => {
      if (!this.datasets.delete(r.params.id)) return this.problem(404, null, "Dataset not found");
      this.deleted.push({ kind: "dataset", id: r.params.id, at: new Date().toISOString() });
      return { status: 204 };
    });
    route("POST", "/fine-tunes/", (r) => {
      if (this.take("fineTune")) return this.problem(this.lastStatus, null, "Mock failure");
      const b = r.json ?? {};
      const dataset = this.datasets.get(b.dataset);
      if (!b.name || !b.language || typeof b.description !== "string" || !dataset)
        return this.problem(400, null, "name, description, language and an existing dataset are required");
      if (!dataset.files.length) return this.problem(400, null, "The dataset has no files");
      const ft: FineTune = { id: "ft_" + randomUUID().replaceAll("-", ""), name: b.name, language: b.language, dataset: dataset.id, polls: 0, status: "created" };
      this.fineTunes.set(ft.id, ft);
      if (this.loseNextAnswer.delete("fineTune")) return this.problem(502, null, "Answer lost");
      return { body: this.fineTuneBody(ft) };
    });
    route("GET", "/fine-tunes/", (r) => ({
      body: this.page(r, [...this.fineTunes.values()], (f) => this.fineTuneBody(f)),
    }));
    route("GET", "/fine-tunes/:id", (r) => {
      const ft = this.fineTunes.get(r.params.id);
      if (!ft) return this.problem(404, null, "Fine-tune not found");
      if (ft.status === "created" || ft.status === "training") {
        ft.polls++;
        if (ft.polls <= this.trainingPolls) ft.status = "training";
        else if (this.failTraining) ft.status = "failed";
        else {
          ft.status = "completed";
          const id = randomUUID();
          this.voices.set(id, { id, name: "Pro voice " + ft.id.slice(3, 11), language: ft.language, isPro: true, fineTuneId: ft.id });
          ft.voiceId = id;
        }
      }
      return { body: this.fineTuneBody(ft) };
    });
    route("GET", "/fine-tunes/:id/voices", (r) => {
      const ft = this.fineTunes.get(r.params.id);
      if (!ft) return this.problem(404, null, "Fine-tune not found");
      const voice = ft.voiceId && !this.withholdProVoices ? this.voices.get(ft.voiceId) : undefined;
      return { body: this.page(r, voice ? [voice] : [], (v) => this.voiceBody(v)) };
    });
    route("DELETE", "/fine-tunes/:id", (r) => {
      if (!this.fineTunes.delete(r.params.id)) return this.problem(404, null, "Fine-tune not found");
      this.deleted.push({ kind: "fine_tune", id: r.params.id, at: new Date().toISOString() });
      return { status: 204 };
    });
  }
  /** One page of a list: `limit` (and listPageSize), after `starting_after`. */
  private page<T extends { id: string }>(r: MockRequest, rows: T[], body: (row: T) => unknown, defaultLimit = 100) {
    const limit = Math.min(this.listPageSize, 100, Number(r.query.get("limit") ?? defaultLimit) || defaultLimit);
    const after = r.query.get("starting_after");
    const start = after ? rows.findIndex((x) => x.id === after) + 1 : 0;
    const slice = rows.slice(start, start + limit);
    const more = start + limit < rows.length;
    return { data: slice.map(body), has_more: more, next_page: more ? slice.at(-1)!.id : null };
  }
  private lastStatus = 500;
  private take(kind: keyof CartesiaMock["failNext"]) {
    const status = this.failNext[kind];
    if (!status) return false;
    delete this.failNext[kind];
    this.lastStatus = status;
    return true;
  }
  private problem(status: number, code: string | null, message: string): MockResponse {
    // The body Cartesia's free tier returned to Clone Voice (live check, 28 September 2026).
    if (status === 402)
      return {
        status,
        body: {
          error_code: "plan_upgrade_required",
          message:
            "This feature is not available on the free tier, please upgrade your subscription at (https://play.cartesia.ai/subscription) or contact us at support@cartesia.ai.",
          title: "Feature not available",
          request_id: randomUUID(),
        },
      };
    return { status, body: { error_code: code, title: "Mock error", message, request_id: "req_" + randomUUID() } };
  }
  private checked(r: MockRequest, handler: (r: MockRequest) => MockResponse | Promise<MockResponse>) {
    const auth = String(r.headers.authorization ?? "");
    if (auth !== `Bearer ${this.apiKey}` && r.headers["x-api-key"] !== this.apiKey)
      return this.problem(401, null, "Invalid API key");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.headers["cartesia-version"] ?? "")))
      return this.problem(400, null, "Cartesia-Version header is required");
    return handler(r);
  }
  private voiceBody(v: Voice) {
    return {
      id: v.id,
      is_owner: true,
      status: "active",
      access: "private",
      visibility: "owner",
      name: v.name,
      tagline: "",
      description: null,
      gender: null,
      created_at: new Date().toISOString(),
      accents: [{ accent: "general-american", locale: v.language, is_native: true }],
      is_pro: v.isPro,
    };
  }
  private fineTuneBody(f: FineTune) {
    return {
      id: f.id,
      name: f.name,
      description: "",
      language: f.language,
      accent: null,
      supported_model_ids: CARTESIA_PRO_MODELS,
      dataset: f.dataset,
      status: f.status,
      user_errors: f.status === "failed" ? [{ code: "training_failed", message: this.failTraining ?? "Training failed" }] : [],
    };
  }
  get url() {
    return this.server.url;
  }
  /** The value to save as VOICE_BASE_URL and STT_BASE_URL. */
  get baseUrl() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
}
