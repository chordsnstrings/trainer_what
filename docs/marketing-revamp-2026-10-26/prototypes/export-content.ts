// Exports the marketing site's real content (brand name applied) for the concept prototypes.
import * as M from "/home/user/trainer_what/packages/contracts/src/marketing.ts";
import * as B from "/home/user/trainer_what/packages/contracts/src/brand.ts";
import * as P from "/home/user/trainer_what/packages/contracts/src/membership-pricing.ts";
const t = (s: string) => M.brandText(s, "trainsyou");
const deep = (v: unknown): unknown =>
  typeof v === "string" ? t(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v;
const out = {
  exportedAt: new Date().toISOString(),
  pages: deep(M.MARKETING_PAGES),
  sources: deep((M as any).MARKETING_SOURCES ?? []),
  setupChecklist: deep((M as any).SETUP_CHECKLIST ?? []),
  availabilityLines: deep((M as any).AVAILABILITY_LINES ?? []),
  citedAssumptions: M.CITED_ASSUMPTIONS,
  entitySentence: t(M.ENTITY_SENTENCE),
  notStatements: deep(M.NOT_STATEMENTS),
  nav: deep(M.marketingNav()),
  footer: deep(M.marketingFooter()),
  brand: { name: B.BRAND_NAME, domain: B.BRAND_DOMAIN, copy: B.BRAND_COPY, colors: B.BRAND_COLORS },
  membershipPricing: deep(P),
};
console.log(JSON.stringify(out, null, 1));
