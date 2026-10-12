import { randomBytes } from "node:crypto";
process.env.DEMO_PASSWORD = randomBytes(24).toString("base64url");
process.env.RTL_CHECK_MODULE = "./ux-spacing-check.mjs";
process.env.RTL_WEB_PORT ??= "3164";
process.env.RTL_API_PORT ??= "4164";
process.env.RTL_DATA_DIR ??= ".data/ux-spacing";
// Display the domain form locally; no domain requests or provider writes are sent.
process.env.DOMAIN_OPERATIONS_ENABLED = "true";
process.env.DOMAIN_CNAME_TARGET = "ingress.example.test";
await import("./run-rtl-check.mjs");
