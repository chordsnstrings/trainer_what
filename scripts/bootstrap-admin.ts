import { createDatabase } from "@trainer/db";
import { readFile, stat } from "node:fs/promises";
import { bootstrapAdmin } from "../apps/api/src/bootstrap-admin.ts";

if (!process.env.DATABASE_URL)
  throw new Error(
    "Set the deployed runtime DATABASE_URL before creating the first Superadmin.",
  );
const file = process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE;
if (!file)
  throw new Error(
    "Provide BOOTSTRAP_ADMIN_PASSWORD_FILE pointing to a private file containing a new password of at least 16 characters.",
  );
const mode = await stat(file);
if (!mode.isFile() || mode.mode & 0o077)
  throw new Error(
    "The password file must be a regular file readable only by its owner (chmod 600).",
  );
const password = (await readFile(file, "utf8")).replace(/\r?\n$/, "");
const db = await createDatabase();
try {
  await bootstrapAdmin(db, {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? "Platform administrator",
    password,
  });
  console.log(
    "First Superadmin created. Sign in, enroll an authenticator in Account security, then open Superadmin settings. Remove the one-time password file.",
  );
} finally {
  await db.close();
}
