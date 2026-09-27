import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import {
  MESSAGE_KINDS,
  TEMPLATE_LOCALES,
  TEMPLATE_VARIABLES,
  parseTemplateDocumentKey,
  previewTemplate,
} from "./message-templates.ts";
import { registerSafetyPolicy } from "./safety-policy.ts";

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * Operator routes for message templates and the coaching safety policy.
 * Same gate as the admin configuration view: an allowed platform role and a
 * fresh authenticator check. Previews never store or send anything.
 */
export function registerMessaging(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  const operator = (req: FastifyRequest, roles: string[]) => {
    const a = identity(req);
    if (!roles.includes(a.platformRole ?? "none"))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Your operator role does not allow this view.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  app.get("/api/v1/admin/notification-templates", async (req) => {
    operator(req, ["admin"]);
    const published = await db.system((tx) =>
      tx.query(
        "SELECT DISTINCT ON (key) key,version,title,effective_at FROM admin_documents WHERE kind='notification' AND status='published' AND effective_at<=now() ORDER BY key,effective_at DESC,version DESC",
      ),
    );
    const scheduled = await db.system((tx) =>
      tx.query(
        "SELECT key,version,effective_at FROM admin_documents WHERE kind='notification' AND status='published' AND effective_at>now() ORDER BY effective_at",
      ),
    );
    const byKey = new Map(published.map((r) => [r.key, r]));
    return {
      variables: TEMPLATE_VARIABLES,
      locales: TEMPLATE_LOCALES,
      kinds: MESSAGE_KINDS.map((k) => ({
        ...k,
        published: Object.fromEntries(
          TEMPLATE_LOCALES.map((locale) => {
            const row = byKey.get(
              locale === "en" ? k.templateKey : `${k.templateKey}--${locale}`,
            );
            return [
              locale,
              row
                ? {
                    version: row.version,
                    title: row.title,
                    effectiveAt: row.effective_at,
                  }
                : null,
            ];
          }),
        ),
        scheduled: scheduled
          .filter((r) => parseTemplateDocumentKey(r.key).base === k.templateKey)
          .map((r) => ({
            key: r.key,
            version: r.version,
            effectiveAt: r.effective_at,
          })),
      })),
      unregisteredPublished: published
        .filter((r) => !parseTemplateDocumentKey(r.key).kind)
        .map((r) => ({ key: r.key, version: r.version })),
      push: "Device notifications carry no message content; the device shows a fixed notice and opens the inbox.",
    };
  });
  app.post("/api/v1/admin/notification-templates/preview", async (req) => {
    operator(req, ["admin"]);
    const b = z
      .object({
        key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
        title: z.string().trim().min(3).max(150),
        content: z.string().trim().min(5).max(60000),
      })
      .strict()
      .parse(req.body);
    return previewTemplate(
      b,
      process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
    );
  });
  registerSafetyPolicy(app, db, identity, operator);
}
