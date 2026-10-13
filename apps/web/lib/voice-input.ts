import type * as Ort from "onnxruntime-web/wasm";
import {
  VoiceDecisionGate,
  type VoiceDecision,
  type VoiceInputMode,
} from "./voice-decision";

export const VOICE_SAMPLE_RATE = 16000;
const ASSETS = "/voice-input-v1/";
type Options = {
  context: AudioContext;
  stream: MediaStream;
  signal: AbortSignal;
  mode: () => VoiceInputMode;
  onFrame: (frame: Float32Array, decision: VoiceDecision) => void;
  onReset: () => void;
  onError: (error: Error) => void;
  /** Benchmarks and own-voice sample collection can compare the browser filter. */
  denoise?: boolean;
};

/** One recurrent model per microphone; inference is strictly serial and bounded. */
export class VoiceInput {
  readonly sampleRate = VOICE_SAMPLE_RATE;
  readonly filter: "neural" | "browser";
  private queue: Array<{
    frame: Float32Array;
    time: number;
    mode: VoiceInputMode;
  }> = [];
  private gate = new VoiceDecisionGate();
  private state: Ort.Tensor;
  private sr: Ort.Tensor;
  private previous = new Float32Array(64);
  private busy = false;
  private disposed = false;
  private released = false;
  private generation = 0;
  private resetPending = false;
  private lastMode: VoiceInputMode = "blocked";
  private overloaded = 0;
  private overloadWindow = -Infinity;
  private source: MediaStreamAudioSourceNode;
  private node: AudioWorkletNode;
  private abortListener = () => this.dispose();

  private constructor(
    private options: Options,
    private ort: typeof Ort,
    private session: Ort.InferenceSession,
    private denoiser?: AudioWorkletNode & { destroy(): void },
  ) {
    this.filter = denoiser ? "neural" : "browser";
    this.state = new ort.Tensor("float32", new Float32Array(256), [2, 1, 128]);
    this.sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
    this.source = options.context.createMediaStreamSource(options.stream);
    this.node = new AudioWorkletNode(options.context, "voice-input-capture", {
      channelCount: 1,
    });
    this.node.onprocessorerror = () =>
      this.fail(
        new Error("Microphone processing stopped. Please start another call."),
      );
    if (denoiser)
      denoiser.onprocessorerror = () =>
        this.fail(
          new Error("Noise filtering stopped. Please start another call."),
        );
    this.source.connect(denoiser ?? this.node);
    denoiser?.connect(this.node);
    this.node.connect(options.context.destination);
    this.node.port.onmessage = (event) => {
      if (this.disposed) return;
      const mode = options.mode();
      if (mode !== this.lastMode) {
        if (mode === "blocked" || this.lastMode === "blocked") this.reset();
        else this.gate.resetInterruption();
        this.lastMode = mode;
      }
      if (mode === "blocked") return;
      const { frame, time } = event.data;
      if (
        !(frame instanceof Float32Array) ||
        frame.length !== 512 ||
        !Number.isFinite(time)
      )
        return;
      if (this.queue.length >= 8 || options.context.currentTime - time > 0.3) {
        this.reset();
        if (options.context.currentTime - this.overloadWindow > 5) {
          this.overloadWindow = options.context.currentTime;
          this.overloaded = 0;
        }
        if (++this.overloaded >= 4)
          this.fail(
            new Error(
              "Voice processing is falling behind. Close other busy tabs and start another call.",
            ),
          );
        return;
      }
      this.queue.push({ frame, time, mode });
      void this.pump();
    };
    options.signal.addEventListener("abort", this.abortListener, {
      once: true,
    });
    if (options.signal.aborted) this.dispose();
  }

  static async create(options: Options): Promise<VoiceInput> {
    let session: Ort.InferenceSession | undefined;
    let denoiser: (AudioWorkletNode & { destroy(): void }) | undefined;
    const valid = () => {
      if (options.signal.aborted || options.context.state === "closed")
        throw new DOMException("Call ended", "AbortError");
    };
    try {
      const ort = await import("onnxruntime-web/wasm");
      valid();
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = ASSETS;
      const response = await fetch(ASSETS + "silero.onnx", {
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(20000)]),
        cache: "force-cache",
      });
      if (!response.ok)
        throw Error(
          "Speech detection could not load. Please try the call again.",
        );
      const model = await response.arrayBuffer();
      valid();
      session = await ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
      });
      valid();
      await options.context.audioWorklet.addModule("/voice-input-worklet.js");
      valid();
      // RNNoise expects 48 kHz. Other rates retain browser suppression + neural VAD.
      if (options.denoise !== false && options.context.sampleRate === 48000) {
        try {
          const { RnnoiseWorkletNode, loadRnnoise } =
            await import("@sapphi-red/web-noise-suppressor");
          valid();
          const wasmBinary = await loadRnnoise(
            {
              url: ASSETS + "rnnoise.wasm",
              simdUrl: ASSETS + "rnnoise_simd.wasm",
            },
            {
              signal: AbortSignal.any([
                options.signal,
                AbortSignal.timeout(8000),
              ]),
              cache: "force-cache",
            },
          );
          await options.context.audioWorklet.addModule(
            ASSETS + "rnnoise-worklet.js",
          );
          valid();
          denoiser = new RnnoiseWorkletNode(options.context, {
            maxChannels: 1,
            wasmBinary,
          });
        } catch (error) {
          valid(); /* Browser suppression remains available; VAD is still required. */
        }
      }
      valid();
      return new VoiceInput(options, ort, session, denoiser);
    } catch (error) {
      denoiser?.destroy();
      denoiser?.disconnect();
      await session?.release().catch(() => {});
      throw error;
    }
  }

  reset() {
    this.generation++;
    this.queue = [];
    this.gate.reset();
    this.resetPending = true;
    this.options.onReset();
  }
  private async pump() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.disposed) {
        if (this.resetPending) {
          this.state.dispose();
          this.state = new this.ort.Tensor(
            "float32",
            new Float32Array(256),
            [2, 1, 128],
          );
          this.previous.fill(0);
          this.resetPending = false;
        }
        const item = this.queue.shift()!,
          generation = this.generation;
        const samples = new Float32Array(576);
        samples.set(this.previous);
        samples.set(item.frame, 64);
        const input = new this.ort.Tensor("float32", samples, [1, 576]);
        let result: Ort.InferenceSession.ReturnType;
        try {
          result = await this.session.run({
            input,
            state: this.state,
            sr: this.sr,
          });
        } finally {
          input.dispose();
        }
        const next = result.stateN,
          output = result.output;
        const probability = Number(output.data[0]);
        output.dispose();
        this.state.dispose();
        this.state = next;
        this.previous.set(item.frame.subarray(448));
        if (
          this.disposed ||
          generation !== this.generation ||
          this.options.mode() !== item.mode
        )
          continue;
        if (this.options.context.currentTime - item.time > 0.3) {
          this.reset();
          continue;
        }
        let sum = 0;
        for (const value of item.frame) sum += value * value;
        this.options.onFrame(
          item.frame,
          this.gate.sample(probability, Math.sqrt(sum / 512), 32, item.mode),
        );
      }
    } catch (error) {
      if (!this.disposed)
        this.fail(
          error instanceof Error ? error : Error("Speech detection stopped."),
        );
    } finally {
      this.busy = false;
      if (this.disposed) void this.release();
    }
  }
  private fail(error: Error) {
    if (this.disposed) return;
    this.dispose();
    this.options.onError(error);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.queue = [];
    this.options.signal.removeEventListener("abort", this.abortListener);
    this.node.port.onmessage = null;
    this.node.port.close();
    this.node.onprocessorerror = null;
    if (this.denoiser) this.denoiser.onprocessorerror = null;
    this.source.disconnect();
    this.node.disconnect();
    this.denoiser?.destroy();
    this.denoiser?.disconnect();
    if (!this.busy) void this.release();
  }
  private async release() {
    if (this.released) return;
    this.released = true;
    this.state.dispose();
    this.sr.dispose();
    await this.session.release().catch(() => {});
  }
}
