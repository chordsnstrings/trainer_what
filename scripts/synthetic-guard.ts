// Synthetic fixtures (known passwords, a demo Superadmin) may only reach a local
// development database. Checked before any database connection is opened.
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function localUrl(value: string, fallback: string) {
  try {
    return localHosts.has(new URL(value || fallback).hostname);
  } catch {
    return false;
  }
}
export function assertLocalSyntheticTarget(
  purpose: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.NODE_ENV === "production")
    throw new Error(`${purpose} is forbidden in production`);
  if (!["", "development", "test"].includes(env.NODE_ENV ?? ""))
    throw new Error(`${purpose} requires a development NODE_ENV`);
  if (!localUrl(env.PUBLIC_APP_URL ?? "", "http://localhost:3000"))
    throw new Error(`${purpose} requires a local PUBLIC_APP_URL`);
  if (env.DATABASE_URL && !localUrl(env.DATABASE_URL, ""))
    throw new Error(`${purpose} requires a local database`);
}
