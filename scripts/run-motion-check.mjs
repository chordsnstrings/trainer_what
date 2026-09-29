// Seeds a throwaway synthetic development database (fresh data directory),
// starts the API and the production build of the web app on their own ports
// and runs scripts/motion-check.mjs with local Chromium (never a cloud
// browser). Build first: npm run build. It reuses the right-to-left check's
// runner (scripts/run-rtl-check.mjs). docs/features/motion.md.
process.env.RTL_CHECK_MODULE ??= "./motion-check.mjs";
process.env.RTL_DATA_DIR ??= ".data/motion-check";
process.env.RTL_WEB_PORT ??= "3747";
process.env.RTL_API_PORT ??= "4747";
process.env.RTL_WEB_MODE ??= "start";
await import("./run-rtl-check.mjs");
