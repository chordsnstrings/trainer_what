import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, event } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import {
  erasureSchema,
  eraseMember,
  type PrivacyHooks,
} from "./privacy-lifecycle.ts";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export function privacyOperations(
  app: FastifyInstance,
  db: Database,
  identity: (
    r: FastifyRequest,
  ) => Actor & { platformRole: string; mfaAt?: string | null },
  hooks: PrivacyHooks = {},
) {
  function operator(req: FastifyRequest) {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(
        403,
        "PRIVACY_AUTHORITY",
        "A platform administrator must process privacy requests",
      );
    requireRecentMfa(a, true);
    return {
      ...a,
      tenantId: z
        .string()
        .uuid()
        .parse((req.params as any).tenantId),
      role: "owner",
    };
  }
  const prefix = "/api/v1/admin/tenants/:tenantId/privacy";
  app.get(prefix, async (req) => {
    const a = operator(req);
    return db.tenant(a, async (tx) => {
      await event(tx, a, "privacy.queue_inspected", a.tenantId);
      return tx.query(
        "SELECT r.id,r.status,r.version,r.data,r.created_at,u.name FROM records r LEFT JOIN users u ON u.id=r.owner_user_id WHERE r.kind='privacy_request' ORDER BY r.created_at",
      );
    });
  });
  app.post(prefix + "/:id/erase", async (req) =>
    eraseMember(
      db,
      operator(req),
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      erasureSchema.parse(req.body),
      hooks,
    ),
  );
}
