process.env.VOICE_WAIT_CUE_FIXTURE = "true";
process.env.RTL_CHECK_MODULE = "./voice-wait-cues-check.mjs";
process.env.RTL_WEB_PORT ??= "3213";
process.env.RTL_API_PORT ??= "4213";
process.env.RTL_DATA_DIR ??= ".data/voice-wait-cues";
await import("./run-onboarding-chat-check.mjs");
