import { randomBytes } from "node:crypto";
process.env.DEMO_PASSWORD = randomBytes(24).toString("base64url");
process.env.RTL_CHECK_MODULE = "./conversation-layout-check.mjs";
process.env.RTL_WEB_PORT ??= "3166";
process.env.RTL_API_PORT ??= "4166";
process.env.RTL_DATA_DIR ??= ".data/conversation-layout";
await import("./run-rtl-check.mjs");
