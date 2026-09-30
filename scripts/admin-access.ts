import { createDatabase } from "@trainer/db";
import { readFile, stat } from "node:fs/promises";
import { runAdminAccess } from "../apps/api/src/admin-access.ts";
// Host-only Superadmin recovery, run inside the api container as root on the
// server (see infra/digitalocean/admin-access.sh):
//   npm run admin:access -- list
//   ADMIN_ACCESS_EMAIL=... [ADMIN_ACCESS_NAME=...] npm run admin:access -- create
//   ADMIN_ACCESS_EMAIL=... npm run admin:access -- reset-password
// The password comes from ADMIN_ACCESS_PASSWORD_FILE (chmod 600) or stdin,
// never from arguments or the environment.

if (!process.env.DATABASE_URL)
  throw new Error(
    "Set the deployed runtime DATABASE_URL before recovering Superadmin access.",
  );

async function readPassword() {
  const file = process.env.ADMIN_ACCESS_PASSWORD_FILE;
  let text: string;
  if (file) {
    const mode = await stat(file);
    if (!mode.isFile() || mode.mode & 0o077)
      throw new Error(
        "The password file must be a regular file readable only by its owner (chmod 600).",
      );
    text = await readFile(file, "utf8");
  } else {
    if (process.stdin.isTTY)
      throw new Error(
        "Pipe the new password on stdin or set ADMIN_ACCESS_PASSWORD_FILE.",
      );
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    text = Buffer.concat(chunks).toString("utf8");
  }
  return text.replace(/\r?\n$/, "");
}

const db = await createDatabase();
try {
  await runAdminAccess(db, process.argv[2], process.env, readPassword, (line) =>
    console.log(line),
  );
} finally {
  await db.close();
}
