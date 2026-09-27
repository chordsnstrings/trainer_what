import type { MetadataRoute } from "next";
import { robotsPolicy } from "@trainer/contracts";
import { requestOrigin } from "../components/discovery-server";

// Reading the request host makes this a per-request route: the platform and
// each connected coach domain get their own sitemap address.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { origin, coachHost } = await requestOrigin();
  const policy = robotsPolicy(origin, coachHost);
  return {
    rules: {
      userAgent: policy.rules.userAgent,
      allow: policy.rules.allow,
      disallow: policy.rules.disallow,
    },
    sitemap: policy.sitemap,
  };
}
