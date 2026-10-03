// Seeds a throwaway synthetic development database, starts the API and the
// web app locally (next dev by default; RTL_WEB_MODE=start uses an existing
// production build) and runs scripts/dark-check.mjs with local Chromium.
// It reuses the right-to-left check's runner on its own ports and database.
import { randomBytes } from "node:crypto";
process.env.DEMO_PASSWORD ??= randomBytes(24).toString("base64url");
process.env.RTL_CHECK_MODULE ??= "./dark-check.mjs";
process.env.RTL_DATA_DIR ??= ".data/dark-check";
process.env.RTL_WEB_PORT ??= "3126";
process.env.RTL_API_PORT ??= "4126";
await import("./run-rtl-check.mjs");
