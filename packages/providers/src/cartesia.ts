/**
 * Cartesia voice provider (docs/features/trainer-voice.md): text to speech,
 * batch speech to text, Quick (instant) and Pro (fine-tuned) voice clones, and
 * deleting what a clone left at the provider.
 *
 * Request shapes follow the public API reference read on 28 September 2026
 * (API version 2026-08-14; `Cartesia-Version` is pinned by the operator). The
 * API key travels only in the Authorization header: it never appears in an
 * error message, a return value or a log line written here.
 *
 * Every call reports how far it got. `rejected` means the provider answered
 * and refused (nothing to reconcile), `retry` means nothing reached the
 * provider (safe to send again later) and `ambiguous` means the request may
 * have been processed: callers reconcile by name before sending again.
 */
import { randomBytes } from "node:crypto";

export const CARTESIA_BASE_URL = "https://api.cartesia.ai";
export const CARTESIA_API_VERSION = "2026-08-14";
export const CARTESIA_STT_MODEL = "ink-whisper";
/** Clone Voice and Create Fine-Tune language codes (API version 2026-08-14). */
export const CARTESIA_CLONE_LANGUAGES = [
  "en", "fr", "de", "es", "pt", "zh", "ja", "hi", "it", "ko", "nl", "pl",
  "ru", "sv", "tr", "tl", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms",
  "sk", "da", "ta", "uk", "hu", "no", "vi", "bn", "th", "he", "ka", "id",
  "te", "gu", "kn", "ml", "mr", "pa", "or", "ur",
] as const;
export type CartesiaLanguage = (typeof CARTESIA_CLONE_LANGUAGES)[number];
/** Formats Clone Voice and dataset uploads accept, by media type. */
export const CARTESIA_CLIP_TYPES = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
} as const;
export type CartesiaClipType = keyof typeof CARTESIA_CLIP_TYPES;

export type CartesiaSend = (
  url: string,
  init: RequestInit,
  beforeSend?: () => Promise<void>,
) => Promise<Response>;
export type CartesiaAccount = { base: string; key: string; version: string };
export type CartesiaOutcome = "rejected" | "retry" | "ambiguous";

export class CartesiaError extends Error {
  constructor(
    message: string,
    readonly outcome: CartesiaOutcome,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "CartesiaError";
  }
}

export type CartesiaVoice = { id: string; name: string; isPro: boolean };
export type CartesiaFineTune = {
  id: string;
  name: string;
  status: "created" | "training" | "completed" | "failed" | "unknown";
  supportedModelIds: string[];
  errors: string[];
};

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; type: string; data: Buffer };
const SAFE_PART = /^[A-Za-z0-9 _.,:()'\-\[\]/]{0,500}$/;
/** multipart/form-data with code-controlled field names and values. */
export function multipart(parts: Part[]) {
  const boundary = "trainsyou" + randomBytes(12).toString("hex");
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if (!SAFE_PART.test(part.name))
      throw new CartesiaError("Unsupported form field", "rejected");
    if ("data" in part) {
      if (!SAFE_PART.test(part.filename) || !/^audio\/[a-z0-9.+-]+$/.test(part.type))
        throw new CartesiaError("Unsupported form file", "rejected");
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`,
        ),
        part.data,
        Buffer.from("\r\n"),
      );
    } else {
      if (!SAFE_PART.test(part.value))
        throw new CartesiaError("Unsupported form value", "rejected");
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** The provider's own error code and a short message, never the request. */
async function providerProblem(response: Response) {
  const body = (await response.json().catch(() => null)) as any;
  const code =
    typeof body?.error_code === "string" && /^[a-z_]{1,60}$/.test(body.error_code)
      ? body.error_code
      : null;
  const message =
    typeof body?.message === "string"
      ? body.message.replace(/sk_car_[A-Za-z0-9_-]+/g, "[key]").slice(0, 300)
      : null;
  return { code, message };
}
function outcomeOf(status: number): CartesiaOutcome {
  if (status === 429) return "retry";
  if (status === 408 || status >= 500) return "ambiguous";
  return "rejected";
}
const text = (value: unknown, max = 200) =>
  typeof value === "string" ? value.slice(0, max) : "";
function voice(row: any): CartesiaVoice | null {
  return typeof row?.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(row.id)
    ? { id: row.id, name: text(row.name), isPro: row.is_pro === true }
    : null;
}
function fineTune(row: any): CartesiaFineTune {
  if (typeof row?.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id))
    throw new CartesiaError("The provider returned an unexpected fine-tune", "ambiguous");
  // The API reference lists created/training/completed/failed; the guide also
  // shows pending/processing, read here as still training.
  const raw = text(row.status, 40);
  const status =
    raw === "completed" || raw === "failed" || raw === "created"
      ? raw
      : ["training", "pending", "processing", "queued", "running"].includes(raw)
        ? "training"
        : "unknown";
  return {
    id: row.id,
    name: text(row.name),
    status,
    supportedModelIds: (Array.isArray(row.supported_model_ids) ? row.supported_model_ids : [])
      .filter((m: unknown) => typeof m === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(m))
      .slice(0, 20),
    errors: (Array.isArray(row.user_errors) ? row.user_errors : [])
      .map((e: any) => text(e?.message, 200))
      .filter(Boolean)
      .slice(0, 5),
  };
}

export class CartesiaClient {
  constructor(
    private readonly account: CartesiaAccount,
    private readonly send: CartesiaSend,
  ) {}
  private url(path: string, query?: Record<string, string>) {
    const url = new URL(this.account.base.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    return url.toString();
  }
  /**
   * One request. Errors raised by `beforeSend` (the caller's last permission
   * check) propagate unchanged; nothing was sent.
   */
  private async call(
    method: string,
    path: string,
    options: {
      json?: unknown;
      form?: Part[];
      query?: Record<string, string>;
      accept?: string;
      timeoutMs?: number;
      beforeSend?: () => Promise<void>;
    } = {},
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.account.key}`,
      "Cartesia-Version": this.account.version,
      Accept: options.accept ?? "application/json",
    };
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      const form = multipart(options.form);
      headers["Content-Type"] = form.contentType;
      headers["Content-Length"] = String(form.body.length);
      body = form.body;
    }
    let sent = false,
      guardError: unknown = null;
    try {
      return await this.send(
        this.url(path, options.query),
        {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
        },
        async () => {
          try {
            await options.beforeSend?.();
          } catch (error) {
            guardError = error;
            throw error;
          }
          sent = true;
        },
      );
    } catch (error) {
      if (guardError) throw guardError;
      throw new CartesiaError(
        sent
          ? "The voice provider's answer could not be confirmed."
          : "The voice provider could not be reached.",
        sent ? "ambiguous" : "retry",
      );
    }
  }
  private async ok(response: Response, what: string) {
    if (response.ok) return response;
    const problem = await providerProblem(response);
    throw new CartesiaError(
      `${what} was refused (HTTP ${response.status}${problem.code ? ", " + problem.code : ""})${problem.message ? ": " + problem.message : "."}`,
      outcomeOf(response.status),
      response.status,
      problem.code,
    );
  }
  private async json(response: Response, what: string) {
    const body = await (await this.ok(response, what)).json().catch(() => null);
    if (!body || typeof body !== "object")
      throw new CartesiaError(`${what} returned an unexpected answer.`, "ambiguous");
    return body as any;
  }

  /** POST /tts/bytes: MP3 at 44.1 kHz and 128 kbps, like the stored clips. */
  async speech(
    input: { voiceId: string; text: string; model: string; language?: string | null },
    beforeSend?: () => Promise<void>,
  ) {
    const response = await this.ok(
      await this.call("POST", "/tts/bytes", {
        accept: "audio/mpeg",
        json: {
          model_id: input.model,
          transcript: input.text,
          // Valid for 2026-03-01 ({mode,id}) and 2026-08-14 ({id,...}).
          voice: { mode: "id", id: input.voiceId },
          output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
          language: input.language || "en",
        },
        beforeSend,
      }),
      "Speech generation",
    );
    return {
      audio: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "",
      requestId:
        response.headers.get("x-request-id") ?? response.headers.get("request-id"),
    };
  }
  /** POST /stt (batch, ink-whisper) with word timings. */
  async transcribe(
    input: { audio: Buffer; type: string; extension: string; model: string; language?: string },
    beforeSend?: () => Promise<void>,
  ) {
    const body = await this.json(
      await this.call("POST", "/stt", {
        form: [
          { name: "model", value: input.model },
          { name: "language", value: input.language ?? "en" },
          { name: "timestamp_granularities[]", value: "word" },
          { name: "file", filename: "reply." + input.extension, type: input.type, data: input.audio },
        ],
        timeoutMs: 20000,
        beforeSend,
      }),
      "Transcription",
    );
    if (typeof body.text !== "string")
      throw new CartesiaError("Transcription returned an unexpected answer.", "ambiguous");
    const duration = Number(body.duration);
    return {
      text: body.text,
      durationSeconds: Number.isFinite(duration) && duration >= 0 && duration < 86400 ? duration : null,
      language: typeof body.language === "string" ? body.language.slice(0, 12) : null,
      requestId: typeof body.request_id === "string" ? body.request_id.slice(0, 100) : null,
    };
  }
  /** POST /voices/clone: a private Quick clone from one clip. */
  async cloneVoice(
    input: { clip: Buffer; type: CartesiaClipType; name: string; language: string; description: string },
    beforeSend?: () => Promise<void>,
  ) {
    const body = await this.json(
      await this.call("POST", "/voices/clone", {
        form: [
          { name: "name", value: input.name },
          { name: "language", value: input.language },
          { name: "description", value: input.description },
          {
            name: "clip",
            filename: "sample." + CARTESIA_CLIP_TYPES[input.type],
            type: input.type,
            data: input.clip,
          },
        ],
        timeoutMs: 120000,
        beforeSend,
      }),
      "Voice cloning",
    );
    const created = voice(body);
    if (!created)
      throw new CartesiaError("Voice cloning returned an unexpected answer.", "ambiguous");
    return created;
  }
  /** GET /voices: the account check (limit 1) and name lookups for reconciliation. */
  async listVoices(query: { limit?: number; q?: string } = {}) {
    const body = await this.json(
      await this.call("GET", "/voices", {
        query: {
          limit: String(query.limit ?? 100),
          ...(query.q ? { q: query.q, is_owner: "true" } : {}),
        },
      }),
      "The voice list",
    );
    if (!Array.isArray(body.data))
      throw new CartesiaError("The voice list returned an unexpected answer.", "ambiguous");
    return body.data.map(voice).filter(Boolean) as CartesiaVoice[];
  }
  async voicesNamed(name: string) {
    return (await this.listVoices({ q: name })).filter((v) => v.name === name);
  }
  /** DELETE /voices/{id}: "missing" when the provider no longer has it. */
  async deleteVoice(id: string) {
    const response = await this.call("DELETE", "/voices/" + encodeURIComponent(id));
    if (response.status === 404) return "missing" as const;
    await this.ok(response, "Voice deletion");
    return "deleted" as const;
  }
  async createDataset(
    input: { name: string; description: string },
    beforeSend?: () => Promise<void>,
  ) {
    const body = await this.json(
      await this.call("POST", "/datasets/", { json: input, beforeSend }),
      "Dataset creation",
    );
    if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id))
      throw new CartesiaError("Dataset creation returned an unexpected answer.", "ambiguous");
    return { id: body.id as string };
  }
  async datasetsNamed(name: string) {
    const body = await this.json(
      await this.call("GET", "/datasets/", { query: { limit: "100" } }),
      "The dataset list",
    );
    return (Array.isArray(body.data) ? body.data : [])
      .filter((d: any) => d?.name === name && typeof d.id === "string")
      .map((d: any) => ({ id: String(d.id) }));
  }
  /** POST /datasets/{id}/files (purpose fine_tune). */
  async uploadDatasetFile(
    datasetId: string,
    file: { data: Buffer; type: CartesiaClipType; filename: string },
    beforeSend?: () => Promise<void>,
  ) {
    await this.ok(
      await this.call("POST", `/datasets/${encodeURIComponent(datasetId)}/files`, {
        form: [
          { name: "purpose", value: "fine_tune" },
          { name: "file", filename: file.filename, type: file.type, data: file.data },
        ],
        timeoutMs: 180000,
        beforeSend,
      }),
      "Dataset upload",
    );
  }
  async datasetFiles(datasetId: string) {
    const body = await this.json(
      await this.call("GET", `/datasets/${encodeURIComponent(datasetId)}/files`, {
        query: { limit: "100" },
      }),
      "The dataset file list",
    );
    return (Array.isArray(body.data) ? body.data : [])
      .filter((f: any) => typeof f?.filename === "string")
      .map((f: any) => ({ id: String(f.id ?? ""), filename: String(f.filename) }));
  }
  async deleteDataset(id: string) {
    const response = await this.call("DELETE", "/datasets/" + encodeURIComponent(id));
    if (response.status === 404) return "missing" as const;
    await this.ok(response, "Dataset deletion");
    return "deleted" as const;
  }
  /** POST /fine-tunes/: a Pro clone trained from an uploaded dataset. */
  async createFineTune(
    input: { name: string; description: string; language: string; dataset: string },
    beforeSend?: () => Promise<void>,
  ) {
    return fineTune(
      await this.json(
        await this.call("POST", "/fine-tunes/", { json: input, beforeSend }),
        "Pro clone training",
      ),
    );
  }
  async getFineTune(id: string) {
    return fineTune(
      await this.json(
        await this.call("GET", "/fine-tunes/" + encodeURIComponent(id)),
        "The Pro clone status",
      ),
    );
  }
  async fineTunesNamed(name: string) {
    const body = await this.json(
      await this.call("GET", "/fine-tunes/", { query: { limit: "100" } }),
      "The fine-tune list",
    );
    return (Array.isArray(body.data) ? body.data : [])
      .filter((f: any) => f?.name === name)
      .map(fineTune);
  }
  async fineTuneVoices(id: string) {
    const body = await this.json(
      await this.call("GET", `/fine-tunes/${encodeURIComponent(id)}/voices`, {
        query: { limit: "100" },
      }),
      "The Pro clone voices",
    );
    return (Array.isArray(body.data) ? body.data : []).map(voice).filter(Boolean) as CartesiaVoice[];
  }
  async deleteFineTune(id: string) {
    const response = await this.call("DELETE", "/fine-tunes/" + encodeURIComponent(id));
    if (response.status === 404) return "missing" as const;
    await this.ok(response, "Fine-tune deletion");
    return "deleted" as const;
  }
}

/**
 * The TTS model for a Pro clone: the configured model when the fine-tune
 * supports it, else a dated snapshot of the same family, else the newest
 * supported snapshot. Pro clones need a dated snapshot (a bare alias answers
 * voice_model_mismatch).
 */
export function proCloneModel(configured: string, supported: string[]) {
  if (supported.includes(configured) && /\d{4}-\d{2}-\d{2}$/.test(configured))
    return configured;
  const dated = supported.filter((m) => /\d{4}-\d{2}-\d{2}$/.test(m)).sort();
  const family = dated.filter((m) => m.startsWith(configured + "-"));
  return family.at(-1) ?? dated.at(-1) ?? supported[0] ?? null;
}
