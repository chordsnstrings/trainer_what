export type VoiceInputMode = "blocked" | "listen" | "interrupt";
export type VoiceDecision = {
  speech: boolean;
  tentative: boolean;
  interrupt: boolean;
  probability: number;
};

/** Confidence comes from the speech model, never from loudness alone. */
export class VoiceDecisionGate {
  private voiced = 0;
  private gap = 0;
  private strong = 0;
  private strongGap = 0;
  reset() {
    this.voiced = this.gap = this.strong = this.strongGap = 0;
  }
  resetInterruption() {
    this.strong = this.strongGap = 0;
  }
  sample(
    probability: number,
    rms: number,
    milliseconds: number,
    mode: VoiceInputMode,
  ): VoiceDecision {
    if (
      mode === "blocked" ||
      !Number.isFinite(probability) ||
      !Number.isFinite(rms) ||
      milliseconds <= 0 ||
      milliseconds > 64
    ) {
      this.reset();
      return {
        speech: false,
        tentative: false,
        interrupt: false,
        probability: 0,
      };
    }
    const voiced = probability >= 0.6 && rms >= 0.0015;
    if (voiced) {
      this.voiced += milliseconds;
      this.gap = 0;
    } else {
      this.gap += milliseconds;
      if (this.gap > 96) this.voiced = 0;
    }
    const strong = probability >= 0.85 && rms >= 0.003;
    if (strong) {
      this.strong += milliseconds;
      this.strongGap = 0;
    } else {
      this.strongGap += milliseconds;
      if (this.strongGap > 128) this.strong = 0;
    }
    return {
      probability,
      speech: this.voiced >= 64 && probability >= 0.35 && rms >= 0.001,
      tentative:
        mode === "interrupt" && this.strong >= 96 && this.strongGap <= 128,
      interrupt: mode === "interrupt" && this.strong >= 384 && strong,
    };
  }
}
