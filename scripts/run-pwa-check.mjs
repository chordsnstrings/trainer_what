// Seeds a fresh synthetic development database, starts the API and the
// production build of the web app locally (run `npm run build` first) and
// runs scripts/pwa-check.mjs with local Chromium (never a cloud browser).
// It reuses the right-to-left check's runner on its own ports and database.
// Set RTL_WEB_MODE=dev to check `next dev` instead.
process.env.RTL_CHECK_MODULE ??= "./pwa-check.mjs";
process.env.RTL_DATA_DIR ??= ".data/pwa-check";
process.env.RTL_WEB_PORT ??= "3127";
process.env.RTL_API_PORT ??= "4127";
process.env.RTL_WEB_MODE ??= "start";
await import("./run-rtl-check.mjs");
