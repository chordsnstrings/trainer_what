// Use the same isolated loopback fixture and teardown as the established visual
// checks. The compiled app is shared; the servers and PGlite directory are not.
process.env.RTL_CHECK_MODULE = "./site-builder-check.mjs";
process.env.RTL_WEB_PORT ??= "3129";
process.env.RTL_API_PORT ??= "4129";
process.env.RTL_DATA_DIR ??= ".data/site-builder-check";
process.env.RTL_WEB_MODE ??= "start";
await import("./run-rtl-check.mjs");
