import { llmsFullTxt } from "@trainer/contracts";
import { requestOrigin } from "../../components/discovery-server";
import { publicPlatform } from "../../components/marketing/platform";

// Per request: the full site text for language models, platform address only.
export const dynamic = "force-dynamic";

export async function GET() {
  const { origin, coachHost } = await requestOrigin();
  if (coachHost) return new Response("Not found", { status: 404 });
  const platform = await publicPlatform();
  return new Response(
    llmsFullTxt({
      origin,
      appName: platform.name,
      supportEmail: platform.supportEmail,
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
