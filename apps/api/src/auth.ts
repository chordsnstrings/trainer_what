import {
  scrypt as rawScrypt,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply } from "fastify";
import { normalizeIP } from "@fastify/rate-limit";
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
// The client address that keys anonymous budgets: the edge-observed address
// inside a verified proxy proof, else the socket address. normalizeIP reads an
// IPv4-mapped address as IPv4 and groups IPv6 by /64.
export function clientSource(request: {
  ip: string;
  hostContext?: { verifiedProxy: boolean; clientIp?: string };
}) {
  const signed = request.hostContext?.verifiedProxy
    ? request.hostContext.clientIp
    : undefined;
  return normalizeIP(signed ?? request.ip);
}
// Per-account budgets for anonymous sign-in and recovery routes, on top of the
// per-client route budget. The hard budget is keyed on the account and the
// client source, so one source cannot lock another out of an account. A much
// higher account-wide ceiling bounds guessing spread across sources; attempts
// already refused for their source do not count towards it. Every attempt for
// the submitted address counts, whether or not an account exists, so the
// response never discloses one. In-memory like the route limiter; each map is
// ordered by window start.
export function accountAttempts(
  max = 10,
  windowMs = 15 * 60 * 1000,
  capacity = 10000,
  accountMax = 100,
) {
  const windows = () => {
    const attempts = new Map<string, { count: number; resetAt: number }>();
    return (value: string, now: number) => {
      const key = createHash("sha256").update(value).digest("hex");
      let entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.delete(key);
        for (const [oldest, old] of attempts) {
          if (attempts.size < capacity && old.resetAt > now) break;
          attempts.delete(oldest);
        }
        entry = { count: 0, resetAt: now + windowMs };
        attempts.set(key, entry);
      }
      return entry;
    };
  };
  const bySource = windows(),
    byAccount = windows();
  const refuse = (
    reply: FastifyReply,
    entry: { resetAt: number },
    now: number,
  ) => {
    reply.header(
      "retry-after",
      String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))),
    );
    throw Object.assign(
      new Error("Too many attempts. Wait a few minutes, then try again."),
      { statusCode: 429, code: "TOO_MANY_ATTEMPTS" },
    );
  };
  return (reply: FastifyReply, email: string, source: string) => {
    const now = Date.now(),
      account = email.trim().toLowerCase();
    const perSource = bySource(account + "\n" + source, now);
    if (perSource.count >= max) refuse(reply, perSource, now);
    const perAccount = byAccount(account, now);
    if (perAccount.count >= accountMax) refuse(reply, perAccount, now);
    perSource.count++;
    perAccount.count++;
  };
}
