// The shared runner deletes DATABASE_URL and seeds only a loopback fixture.
// Generate a fresh password per run; never publish or log a reusable credential.
import { randomBytes } from "node:crypto";
process.env.DEMO_PASSWORD = randomBytes(24).toString("base64url");
process.env.RTL_CHECK_MODULE = "./subscriber-ui-check.mjs";
process.env.RTL_WEB_PORT ??= "3143";
process.env.RTL_API_PORT ??= "4143";
process.env.RTL_DATA_DIR ??= ".data/subscriber-ui-check";
await import("./run-rtl-check.mjs");
