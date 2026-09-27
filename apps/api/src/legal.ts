import { getPublishedDocument } from "./admin-operations.ts";
import { strictSecurity } from "../../../packages/providers/src/configuration.ts";
import type { Database } from "@trainer/db";
/** Resolve outside an existing tenant transaction; the published registry is global. */
export async function legalAcceptanceVersion(db:Database, scope:string):Promise<string> {
 const keys=scope==="registration"?["terms","privacy","ai-disclosure"]:scope==="coaching"||scope.startsWith("nutrition")?["privacy","ai-disclosure"]:["privacy"];
 const parts:string[]=[];
 for(const key of keys){const document=await getPublishedDocument(db,"legal",key);if(!document){if(strictSecurity())throw Object.assign(new Error("The current privacy and coaching documents must be published before accepting permission."),{statusCode:409,code:"LEGAL_PUBLICATION_REQUIRED"});parts.push(`${key}:development-draft`);}else parts.push(`${key}:${document.version}`);}
 return parts.join("|");
}
