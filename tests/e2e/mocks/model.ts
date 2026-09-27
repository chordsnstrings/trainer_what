/**
 * OpenAI-compatible model double: GET /v1/models and POST /v1/chat/completions
 * with JSON output and token usage.
 *
 * Answer sources, in order:
 *   1. a scripted queue (enqueue),
 *   2. replay: a JSONL file of reviewed answers keyed by the canonical request
 *      hash (see model-normalize.ts),
 *   3. the rule-based responder (model-rules.ts), unless `fallback: "fail"`.
 * Capture mode appends every request (kind, task, canonical messages, answer)
 * to a JSONL file so a reviewer can author answers and judge app output.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { MockServer, bearer, unauthorized } from "./http.ts";
import { classifyPrompt, ruleBasedAnswer, type PromptKind } from "./model-rules.ts";
import { denormalize, normalizeRequest, renormalize } from "./model-normalize.ts";

export type ModelCall = {
  n: number;
  kind: PromptKind;
  task: string | null;
  hash: string;
  source: "queue" | "replay" | "rules" | "none";
  status: number;
  at: string;
  /** Parsed JSON answer that was returned (undefined when none). */
  answer?: unknown;
};
export type ScriptedAnswer = {
  kind?: PromptKind;
  task?: string;
  content?: unknown;
  status?: number;
};
export type ReplayEntry = { hash: string; response: unknown; note?: string };

export class ModelMock {
  readonly server: MockServer;
  readonly calls: ModelCall[] = [];
  private queue: ScriptedAnswer[] = [];
  private replay = new Map<string, ReplayEntry>();
  capturePath: string | null = null;
  fallback: "rules" | "fail" = "rules";
  constructor(
    tlsMaterial: { key: string; cert: string },
    public apiKey: string,
    public modelName: string,
    options: { capturePath?: string; replayPath?: string; fallback?: "rules" | "fail" } = {},
  ) {
    this.server = new MockServer("model", tlsMaterial, { logBodies: false });
    this.capturePath = options.capturePath ?? null;
    if (options.fallback) this.fallback = options.fallback;
    if (options.replayPath) this.loadReplay(options.replayPath);
    this.server.route("GET", "/v1/models", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      return {
        body: {
          object: "list",
          data: [
            { id: this.modelName, object: "model", created: 1767225600, owned_by: "mock" },
            { id: "mock-other-model", object: "model", created: 1767225600, owned_by: "mock" },
          ],
        },
      };
    });
    this.server.route("POST", "/v1/chat/completions", (r) => this.complete(r.json, bearer(r)));
  }
  get url() {
    return this.server.url;
  }
  /** The value to save as MODEL_BASE_URL. */
  get baseUrl() {
    return this.server.url + "/v1";
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
  enqueue(answer: ScriptedAnswer) {
    this.queue.push(answer);
  }
  /** Drops unconsumed scripted answers; returns how many were left. */
  clearQueue() {
    const left = this.queue.length;
    this.queue = [];
    return left;
  }
  loadReplay(path: string) {
    if (!existsSync(path)) return 0;
    let count = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as ReplayEntry;
      if (typeof entry.hash === "string" && entry.response !== undefined) {
        this.replay.set(entry.hash, entry);
        count++;
      }
    }
    return count;
  }

  private complete(body: any, key: string) {
    if (key !== this.apiKey) return unauthorized();
    const n = this.calls.length + 1;
    const { kind, task } = classifyPrompt(body);
    const normalized = normalizeRequest(kind, body);
    const call: ModelCall = {
      n,
      kind,
      task,
      hash: normalized.hash,
      source: "none",
      status: 200,
      at: new Date().toISOString(),
    };
    this.calls.push(call);
    if (body?.model !== this.modelName) {
      call.status = 404;
      return { status: 404, body: { error: { message: "model not found" } } };
    }
    let content: unknown;
    let status = 200;
    const queued = this.queue.findIndex(
      (q) => (!q.kind || q.kind === kind) && (!q.task || q.task === task),
    );
    if (queued >= 0) {
      const [answer] = this.queue.splice(queued, 1);
      call.source = "queue";
      content = answer.content;
      status = answer.status ?? 200;
    } else if (this.replay.has(normalized.hash)) {
      call.source = "replay";
      content = denormalize(this.replay.get(normalized.hash)!.response, normalized.map);
    } else if (this.fallback === "rules") {
      try {
        content = ruleBasedAnswer(body).content;
        call.source = "rules";
      } catch (error) {
        status = 500;
        content = { error: { message: (error as Error).message } };
      }
    } else {
      status = 503;
      content = { error: { message: "No reviewed replay answer for this request (fallback=fail)" } };
    }
    call.status = status;
    const text = typeof content === "string" ? content : JSON.stringify(content);
    if (status === 200) call.answer = typeof content === "string" ? safeParse(content) : content;
    if (this.capturePath)
      appendFileSync(
        this.capturePath,
        JSON.stringify({
          hash: normalized.hash,
          kind,
          task,
          source: call.source,
          status,
          capturedAt: call.at,
          request: normalized.display,
          response:
            status === 200
              ? renormalize(typeof content === "string" ? safeParse(content) : content, normalized.map)
              : null,
        }) + "\n",
      );
    if (status !== 200) return { status, body: content };
    const promptTokens = Math.ceil(JSON.stringify(body.messages ?? []).length / 4);
    const completionTokens = Math.ceil(text.length / 4);
    return {
      status: 200,
      headers: { "x-request-id": `mock-req-${n}` },
      body: {
        id: `chatcmpl-mock-${n}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: this.modelName,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      },
    };
  }
}
function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
