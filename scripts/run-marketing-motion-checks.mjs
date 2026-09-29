// `npm run test:marketing-motion`: both marketing motion browser checks, one
// after the other, on this checkout's production build (`npm run build`
// first), in local Chromium only (never a cloud browser):
// 1. the coach-to-subscriber journey player
//    (scripts/run-marketing-motion-check.mjs, `npm run
//    test:marketing-motion-journey`): a stub platform API, the launch gate
//    closed and then open; ports MOTION_WEB_PORT / MOTION_API_PORT (default
//    3967/4967);
// 2. the sitewide microanimations
//    (scripts/marketing-motion-sitewide-check.mjs, `npm run
//    test:marketing-motion-sitewide`): the same platform stub with the
//    launch gate open (MOTION_PLATFORM=closed for the fallback platform),
//    so / and /how-it-works carry the player; with MOTION_BASE_DIR (a built
//    checkout of the release before the motion work) or MOTION_BASELINE it
//    also compares LCP, CLS and long tasks with that base; ports
//    MOTION_WEB_PORT / MOTION_BASE_PORT / MOTION_API_PORT (default
//    3931/3932/4931).
// The second runs even when the first fails; the exit code is 1 when either
// failed. The environment passes through to both.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [
  {
    name: "journey player",
    args: ["--import", "tsx", "scripts/run-marketing-motion-check.mjs"],
  },
  {
    name: "sitewide microanimations",
    args: ["--import", "tsx", "scripts/marketing-motion-sitewide-check.mjs"],
  },
];
const results = [];
for (const check of checks) {
  console.log(`\n== marketing motion: ${check.name} ==`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, check.args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", () => resolve(1));
    child.on("exit", (exitCode, signal) => resolve(signal ? 1 : exitCode));
  });
  results.push({ name: check.name, code });
}
console.log("\n== marketing motion: summary ==");
for (const r of results)
  console.log(
    `${r.code === 0 ? "passed" : "FAILED"}  ${r.name} (exit ${r.code})`,
  );
process.exitCode = results.every((r) => r.code === 0) ? 0 : 1;
