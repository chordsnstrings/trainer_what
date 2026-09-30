// Seeds a throwaway synthetic development database, starts the API and the
// web app locally (next dev by default; RTL_WEB_MODE=start uses an existing
// production build) and runs scripts/phone-check.mjs with local Chromium.
// It reuses the right-to-left check's runner on its own ports and database.
process.env.RTL_CHECK_MODULE ??= "./phone-check.mjs";
process.env.RTL_DATA_DIR ??= ".data/phone-check";
process.env.RTL_WEB_PORT ??= "3125";
process.env.RTL_API_PORT ??= "4125";
await import("./run-rtl-check.mjs");
