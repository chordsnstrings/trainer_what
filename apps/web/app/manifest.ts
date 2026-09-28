import type { MetadataRoute } from "next";
import { platformManifest } from "@trainer/contracts";
import { publicPlatform } from "../components/marketing/platform";

// The platform install manifest follows the configured name (APP_NAME,
// trainsyou by default): the trainsyou icons from public/brand, or the
// initials of another configured name rendered by the API. Coach websites
// and member apps use their own manifests.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name } = await publicPlatform();
  return platformManifest(name) as MetadataRoute.Manifest;
}
