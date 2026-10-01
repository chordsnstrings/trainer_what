import { llmsTxt } from "@trainer/contracts";
import { requestOrigin } from "../../components/discovery-server";
import { publicPlatform } from "../../components/marketing/platform";

// Per request: only the platform address has an llms.txt (llmstxt.org).
export const dynamic = "force-dynamic";

export async function GET() {
  const { origin, coachHost } = await requestOrigin();
  if (coachHost) return new Response("Not found", { status: 404 });
  const platform = await publicPlatform();
  return new Response(
    llmsTxt({
      origin,
      appName: platform.name,
      supportEmail: platform.supportEmail,
      followerModel: platform.followerModel,
      availability: platform.availability,
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
