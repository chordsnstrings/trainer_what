import { buildApp } from "./app.ts";
import { assertSecurityModeBinding } from "../../../packages/providers/src/configuration.ts";
import { assertProviderSandboxBinding } from "../../../packages/providers/src/sandbox.ts";
// Relaxed development controls must never answer a shared or public address.
assertSecurityModeBinding();
// The mock-provider sandbox is refused anywhere but a loopback-only process.
if (assertProviderSandboxBinding())
  console.warn(
    "MOCK PROVIDERS: TRAINER_PROVIDER_SANDBOX=mock is active on this loopback process. No real provider is contacted.",
  );
const app = await buildApp();
await app.listen({
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
