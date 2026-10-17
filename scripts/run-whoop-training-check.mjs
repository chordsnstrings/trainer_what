import { randomBytes } from "node:crypto";
process.env.DEMO_PASSWORD = randomBytes(24).toString("base64url");
Object.assign(process.env, {
  RTL_CHECK_MODULE: "./whoop-training-check.mjs",
  RTL_WEB_PORT: "3203",
  RTL_API_PORT: "4203",
  RTL_DATA_DIR: ".data/whoop-training-check",
  WHOOP_TRAINING_FIXTURE: "true",
  WHOOP_CONTRACT_VERIFIED: "true",
  WHOOP_TRAINING_APPROVED: "true",
  WHOOP_CLIENT_ID: "synthetic-whoop",
  WHOOP_CLIENT_SECRET: "synthetic-unused",
  WHOOP_REDIRECT_URI: "https://whoop-fixture.invalid/callback",
  WHOOP_SCOPES: "offline read:recovery read:sleep",
});
await import("./run-rtl-check.mjs");
