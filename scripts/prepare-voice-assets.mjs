// Build-time, pinned package assets. Browsers never fetch a model/runtime from a CDN.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "apps/web/public/voice-input-v1");
await mkdir(target, { recursive: true });
const vad = dirname(require.resolve("@ricky0123/vad-web"));
const ort = dirname(require.resolve("onnxruntime-web/wasm"));
const noise = dirname(require.resolve("@sapphi-red/web-noise-suppressor"));
const files = [
  [resolve(vad, "silero_vad_v6.onnx"), "silero.onnx"],
  ...["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"].map(
    (name) => [resolve(ort, name), name],
  ),
  [resolve(noise, "rnnoise/workletProcessor.js"), "rnnoise-worklet.js"],
  ...["rnnoise.wasm", "rnnoise_simd.wasm"].map((name) => [
    resolve(noise, name),
    name,
  ]),
];
for (const [source, name] of files)
  await copyFile(source, resolve(target, name));
// Copy notices alongside the hosted models, as well as retaining them in Git.
await writeFile(
  resolve(target, "NOTICES.txt"),
  await readFile(resolve(root, "docs/VOICE_AUDIO_LICENSES.txt")),
);
console.log(`Prepared ${files.length} local voice assets.`);
