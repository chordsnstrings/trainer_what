import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { useTapToTalk } from "../apps/web/components/voice-tap-to-talk";

const report = {
  recordings: [] as any[],
  errors: 0,
  streams: [] as MediaStream[],
};
(window as any).tapReport = report;
const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async (...args) => {
  const stream = await get(...args);
  report.streams.push(stream);
  return stream;
};
function TapHarness() {
  const talk = useTapToTalk({
    capture: "server",
    lang: "en",
    graceLeftMs: () => 0,
    sincePlaybackMs: () => 5000,
    onAudio: async (blob, durationMs, sincePlaybackMs, current) => {
      const bytes = new DataView(await blob.arrayBuffer());
      report.recordings.push({
        type: blob.type,
        bytes: blob.size,
        durationMs,
        sincePlaybackMs,
        current: current(),
        rate: bytes.getUint32(24, true),
        channels: bytes.getUint16(22, true),
      });
    },
    onWords: () => {
      throw Error("Server capture must not use device transcription");
    },
    onMicError: () => {
      report.errors++;
    },
  });
  return createElement(
    "button",
    { onClick: talk.tap, "data-phase": talk.state.phase },
    "Talk",
  );
}
const element = document.createElement("div");
document.body.appendChild(element);
createRoot(element).render(createElement(TapHarness));
