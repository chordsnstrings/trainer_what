import {
  scrypt as rawScrypt,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply } from "fastify";
const scrypt = promisify(rawScrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const [, salt, hex] = encoded.split(":");
  if (!salt || !hex) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
// Per-account budget for anonymous sign-in and recovery routes, on top of the
// per-client route budget. Every attempt for the submitted address counts,
// whether or not an account exists, so the response never discloses one.
// In-memory like the route limiter; the map is ordered by window start.
export function accountAttempts(
  max = 10,
  windowMs = 15 * 60 * 1000,
  capacity = 10000,
) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (reply: FastifyReply, email: string) => {
    const now = Date.now(),
      key = createHash("sha256")
        .update(email.trim().toLowerCase())
        .digest("hex");
    let entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.delete(key);
      for (const [oldest, value] of attempts) {
        if (attempts.size < capacity && value.resetAt > now) break;
        attempts.delete(oldest);
      }
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(key, entry);
    }
    if (++entry.count > max) {
      reply.header(
        "retry-after",
        String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))),
      );
      throw Object.assign(
        new Error("Too many attempts. Wait a few minutes, then try again."),
        { statusCode: 429, code: "TOO_MANY_ATTEMPTS" },
      );
    }
  };
}
