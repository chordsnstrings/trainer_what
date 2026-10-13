import { VoiceInput } from "../apps/web/lib/voice-input";
import { SpeechGate, speechBand } from "../apps/web/lib/speech-gate";
import { ConversationAudio } from "../apps/web/lib/conversation-audio";

(window as any).runNoiseCheck = async () => {
  const context = new AudioContext({ sampleRate: 48000 });
  await context.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const abort = new AbortController();
  const report: any = {
    legacy: { turns: 0, speechMs: 0 },
    silero: {
      turns: 0,
      speechMs: 0,
      peak: 0,
      interrupts: 0,
      energy: 0,
      samples: 0,
    },
    denoised: {
      turns: 0,
      speechMs: 0,
      peak: 0,
      interrupts: 0,
      energy: 0,
      samples: 0,
    },
    errors: [],
  };
  let enabled = false;
  const inputs: VoiceInput[] = [];
  try {
    for (const name of ["silero", "denoised"]) {
      const capture = new ConversationAudio(16000, 20, 224);
      let wasInterrupt = false;
      const input = await VoiceInput.create({
        context,
        stream,
        signal: abort.signal,
        denoise: name === "denoised",
        mode: () => (enabled ? "interrupt" : "blocked"),
        onReset: () => capture.reset(),
        onError: (error) => report.errors.push(error.message),
        onFrame: (frame, decision) => {
          const stats = report[name];
          stats.peak = Math.max(stats.peak, decision.probability);
          for (const value of frame) stats.energy += value * value;
          stats.samples += frame.length;
          if (decision.speech) stats.speechMs += 32;
          if (decision.interrupt && !wasInterrupt) stats.interrupts++;
          wasInterrupt = decision.interrupt;
          if (capture.push(frame, decision.speech)) stats.turns++;
        },
      });
      inputs.push(input);
      report[name].filter = input.filter;
    }
    await context.audioWorklet.addModule("/onboarding-audio-worklet.js");
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const node = new AudioWorkletNode(context, "onboarding-capture");
    analyser.connect(node);
    node.connect(context.destination);
    const gate = new SpeechGate(),
      spectrum = new Float32Array(analyser.frequencyBinCount),
      capture = new ConversationAudio(context.sampleRate);
    node.port.onmessage = ({ data: frame }: { data: Float32Array }) => {
      if (!enabled) return;
      let sum = 0;
      for (const n of frame) sum += n * n;
      analyser.getFloatFrequencyData(spectrum);
      const band = speechBand(spectrum, context.sampleRate, analyser.fftSize);
      const speech = gate.sample(
        Math.sqrt(sum / frame.length),
        band.ratio,
        band.activeBins,
        performance.now(),
      );
      if (speech)
        report.legacy.speechMs += (frame.length / context.sampleRate) * 1000;
      if (capture.push(frame, speech)) report.legacy.turns++;
    };
    enabled = true;
    await new Promise((resolve) => setTimeout(resolve, 10000));
    enabled = false;
    node.port.onmessage = null;
    node.disconnect();
    source.disconnect();
    analyser.disconnect();
    report.framesObservedMs = 10000;
    report.sampleRate = context.sampleRate;
    for (const name of ["silero", "denoised"]) {
      report[name].rms = Math.sqrt(report[name].energy / report[name].samples);
      delete report[name].energy;
    }
    return report;
  } finally {
    abort.abort();
    inputs.forEach((input) => input.dispose());
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }
};
