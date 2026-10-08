// An isolated loopback model fixture. No real provider calls or customer data.
import { createServer } from "node:https";
import { createMockTls } from "../tests/e2e/mocks/tls.ts";
if (process.env.NODE_ENV === "production") throw Error("Synthetic development checks only");
const replies = {
  coach: { publicName: "Alex", city: "Dubai", audience: "busy beginners", approach: "simple strength sessions" },
  member: { age: 28, goal: "Build sustainable strength", experience: "beginner", daysPerWeek: 3, availableWeekdays: [1, 3, 5], maxSessionMinutes: 45, equipment: "Dumbbells", limitations: "No injuries or limitations" },
};
const tls = createMockTls();
const server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const payload = JSON.parse(raw), context = JSON.parse(payload.messages[1].content);
  const text = context.conversation.at(-1).text, patch = replies[context.audience];
  const evidence = Object.fromEntries(Object.keys(patch).map(key => [key, key === "limitations" ? "No injuries or limitations" : text]));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ usage: { prompt_tokens: 20, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify({ reply: "That sounds doable. We'll keep it practical.", patch, evidence }) } }] }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
Object.assign(process.env, {
  TRAINER_PROVIDER_SANDBOX: "mock", NODE_EXTRA_CA_CERTS: tls.caFile,
  MODEL_BASE_URL: "https://127.0.0.1:" + port + "/v1", MODEL_API_KEY: "synthetic-local-fixture", MODEL_NAME: "fixture-onboarding",
  RTL_CHECK_MODULE: "./onboarding-chat-check.mjs",
});
try { await import("./run-rtl-check.mjs"); } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); tls.cleanup(); }
