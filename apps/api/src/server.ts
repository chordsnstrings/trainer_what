import { buildApp } from "./app.ts";
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
