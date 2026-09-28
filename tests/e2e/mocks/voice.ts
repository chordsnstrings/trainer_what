/**
 * ElevenLabs double, test-only:
 * - text-to-speech: POST /text-to-speech/:voiceId returns a small synthetic MP3
 *   stream and a request id; known voices only;
 * - speech-to-text: POST /speech-to-text (multipart: model_id + file) returns a
 *   transcript. A test chooses the words by embedding `TRANSCRIPT:<words>;` in
 *   the audio bytes, or by queueing `nextTranscripts`; otherwise "done". The
 *   audio itself is discarded, like the real zero-retention mode;
 * - GET /models (the connection check) and GET /voices/:voiceId.
 */
import { MockServer, randomId } from "./http.ts";

/** A silent MPEG-1 Layer III frame (128 kbps, 44.1 kHz) repeated; plays as silence. */
export function silentMp3(frames = 8) {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([id3, ...Array.from({ length: frames }, () => frame)]);
}

export class VoiceMock {
  readonly server: MockServer;
  readonly syntheses: Array<{ voiceId: string; model: string; characters: number; text: string; at: string }> = [];
  readonly transcriptions: Array<{ model: string; bytes: number; zeroRetention: boolean; text: string; at: string }> = [];
  /** Transcripts returned in order when the audio carries no marker. */
  nextTranscripts: string[] = [];
  /** Set to make the next speech-to-text call fail with this HTTP status. */
  failTranscription: number | null = null;
  voices = new Set<string>();
  constructor(
    tlsMaterial: { key: string; cert: string },
    public apiKey: string,
  ) {
    this.server = new MockServer("voice", tlsMaterial);
    this.server.route("POST", "/v1/text-to-speech/:voiceId", (r) => {
      if (r.headers["xi-api-key"] !== this.apiKey)
        return { status: 401, body: { detail: { status: "invalid_api_key" } } };
      if (!this.voices.has(r.params.voiceId))
        return { status: 404, body: { detail: { status: "voice_not_found" } } };
      const text = String(r.json?.text ?? "");
      if (!text || !r.json?.model_id)
        return { status: 422, body: { detail: { status: "invalid_request" } } };
      this.syntheses.push({
        voiceId: r.params.voiceId,
        model: r.json.model_id,
        characters: text.length,
        text,
        at: new Date().toISOString(),
      });
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg", "request-id": randomId("tts") },
        body: silentMp3(),
      };
    });
    this.server.route("POST", "/v1/speech-to-text", (r) => {
      if (r.headers["xi-api-key"] !== this.apiKey)
        return { status: 401, body: { detail: { status: "invalid_api_key" } } };
      if (this.failTranscription) {
        const status = this.failTranscription;
        this.failTranscription = null;
        return { status, body: { detail: { status: "mock_failure" } } };
      }
      const boundary = /boundary=([^;]+)/.exec(String(r.headers["content-type"] ?? ""))?.[1];
      if (!boundary) return { status: 422, body: { detail: { status: "invalid_request" } } };
      const parts = r.rawBody.split("--" + boundary);
      const field = (name: string) =>
        parts
          .find((p) => p.includes(`name="${name}"`))
          ?.split("\r\n\r\n")
          .slice(1)
          .join("\r\n\r\n")
          .replace(/\r\n$/, "");
      const model = field("model_id"),
        file = field("file");
      if (!model || !file) return { status: 422, body: { detail: { status: "invalid_request" } } };
      const text = /TRANSCRIPT:([^;]*);/.exec(file)?.[1] ?? this.nextTranscripts.shift() ?? "done";
      this.transcriptions.push({
        model,
        bytes: Buffer.byteLength(file),
        zeroRetention: r.query.get("enable_logging") === "false",
        text,
        at: new Date().toISOString(),
      });
      return {
        headers: { "request-id": randomId("stt") },
        body: { language_code: "eng", language_probability: 0.99, text, words: [] },
      };
    });
    this.server.route("GET", "/v1/models", (r) =>
      r.headers["xi-api-key"] !== this.apiKey
        ? { status: 401, body: {} }
        : {
            body: [
              { model_id: "eleven_multilingual_v2", can_do_text_to_speech: true },
              { model_id: "scribe_v1", can_do_text_to_speech: false },
            ],
          },
    );
    this.server.route("GET", "/v1/voices/:voiceId", (r) =>
      r.headers["xi-api-key"] !== this.apiKey
        ? { status: 401, body: {} }
        : this.voices.has(r.params.voiceId)
          ? { body: { voice_id: r.params.voiceId, name: "Mock trainer voice", category: "professional" } }
          : { status: 404, body: {} },
    );
  }
  get url() {
    return this.server.url;
  }
  /** The value to save as VOICE_BASE_URL. */
  get baseUrl() {
    return this.server.url + "/v1";
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
}
