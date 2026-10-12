import { randomBytes } from "node:crypto";
process.env.DEMO_PASSWORD = randomBytes(24).toString("base64url");
process.env.RTL_CHECK_MODULE = "./photo-studio-ui-check.mjs";
process.env.RTL_WEB_PORT ??= "3165";
process.env.RTL_API_PORT ??= "4165";
process.env.RTL_DATA_DIR ??= ".data/photo-studio-ui";
await import("./run-rtl-check.mjs");
