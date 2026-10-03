import type { FastifyInstance } from "fastify";
import { getPublishedDocument } from "./admin-operations.ts";
import {
  runtimeConfig,
  strictSecurity,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import type { Database } from "@trainer/db";
/** The documents a new account accepts when it registers or joins a coach. */
export const REGISTRATION_DOCUMENTS = ["terms", "privacy", "ai-disclosure"] as const;
export type RegistrationDocument = (typeof REGISTRATION_DOCUMENTS)[number];
/** Withdrawal is a refusal, not acceptance of a currently published policy. */
export const CONSENT_WITHDRAWAL_VERSION = "consent:v1:withdrawal";
/** Resolve outside an existing tenant transaction; the published registry is global. */
export async function legalAcceptanceVersion(db:Database, scope:string):Promise<string> {
 const keys=scope==="registration"?[...REGISTRATION_DOCUMENTS]:scope==="coaching"||scope.startsWith("nutrition")?["privacy","ai-disclosure"]:["privacy"];
 const parts:string[]=[];
 for(const key of keys){const document=await getPublishedDocument(db,"legal",key);if(!document){if(strictSecurity())throw Object.assign(new Error("The current privacy and coaching documents must be published before accepting permission."),{statusCode:409,code:"LEGAL_PUBLICATION_REQUIRED"});parts.push(`${key}:development-draft`);}else parts.push(`${key}:${document.version}`);}
 return parts.join("|");
}
/**
 * What a sign-up or joining form may ask a person to accept, decided the same
 * way the acceptance is recorded (legalAcceptanceVersion and the
 * LEGAL_APPROVED gate on /auth/register, /auth/enroll and the invitation
 * routes):
 * - `documents` lists each registration document and whether it is published;
 *   forms name only the published ones and never ask anyone to accept a
 *   document that does not exist yet.
 * - `joiningOpen` is false where accepting would be refused: with strict
 *   security (production) until LEGAL_APPROVED is "true" and every document
 *   is published. In local development an unpublished document is recorded
 *   as `<key>:development-draft`, so joining stays open there.
 */
export async function legalStatus(
  db: Database,
  config: RuntimeConfig = runtimeConfig(),
) {
  const documents = await Promise.all(
    REGISTRATION_DOCUMENTS.map(async (key) => {
      const document = await getPublishedDocument(db, "legal", key);
      return {
        key,
        published: !!document,
        version: document ? Number(document.version) : null,
      };
    }),
  );
  const joiningOpen =
    !strictSecurity(config) ||
    (config.LEGAL_APPROVED === "true" && documents.every((d) => d.published));
  return { joiningOpen, documents };
}
export function registerLegalStatus(app: FastifyInstance, db: Database) {
  app.get("/api/v1/public/legal-status", async () => legalStatus(db));
}
