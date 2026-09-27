/**
 * ElevenLabs text-to-speech double: POST /text-to-speech/:voiceId returns a
 * small synthetic MP3 stream and a request id; known voices only. Test-only.
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
  readonly syntheses: Array<{ voiceId: string; model: string; characters: number; at: string }> = [];
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
        at: new Date().toISOString(),
      });
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg", "request-id": randomId("tts") },
        body: silentMp3(),
      };
    });
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
