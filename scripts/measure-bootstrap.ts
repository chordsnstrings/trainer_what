// Measures GET /api/v1/bootstrap payload size and latency per role on the
// large synthetic fixture (tests/bootstrap-fixtures.ts). Local measurement
// only: it uses an in-memory embedded database unless DATABASE_URL names a
// throwaway PostgreSQL database, and it never contacts a provider.
//   node --import tsx scripts/measure-bootstrap.ts
import { createDatabase } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { largeWorkspace } from "../tests/bootstrap-fixtures.ts";

process.env.PUBLIC_APP_URL = "http://localhost:3000";
const db = await createDatabase(
  process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : { memory: true },
);
const app = await buildApp({ db, testing: true });
const seeded = Date.now();
const w = await largeWorkspace(db);
console.log(`seed ${Date.now() - seeded} ms`);
const call = (cookie: string) =>
  app.inject({
    url: "/api/v1/bootstrap",
    headers: {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      cookie,
    },
  });
for (const p of [w.owner, w.staff, w.finance, w.follower]) {
  await call(p.cookie);
  const times: number[] = [];
  let body: Record<string, unknown> = {},
    bytes = 0;
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const r = await call(p.cookie);
    times.push(performance.now() - started);
    if (r.statusCode !== 200) throw new Error(`${p.role}: ${r.statusCode}`);
    bytes = Buffer.byteLength(r.body);
    body = r.json();
  }
  times.sort((a, b) => a - b);
  const rows = Object.fromEntries(
    Object.entries(body)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => [k, (v as unknown[]).length]),
  );
  console.log(
    JSON.stringify({
      role: p.role,
      bytes,
      medianMs: Math.round(times[2]),
      minMs: Math.round(times[0]),
      maxMs: Math.round(times[4]),
      rows,
    }),
  );
}
await app.close();
await db.close();
