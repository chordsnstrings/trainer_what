import type { MetadataRoute } from "next";
import { signedApiGet } from "../components/discovery-server";

// The API decides from the signed host: the platform lists marketing pages,
// the directory and published coach sites; a coach domain lists its own pages.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const response = await signedApiGet("/api/v1/public/discovery/sitemap");
  // A failed lookup must not publish an empty sitemap; crawlers retry a 500.
  if (!response.ok) throw new Error("The sitemap is temporarily unavailable.");
  const { entries } = (await response.json()) as {
    entries: Array<{ url: string; lastModified?: string }>;
  };
  return entries.map((entry) => ({
    url: entry.url,
    ...(entry.lastModified ? { lastModified: entry.lastModified } : {}),
  }));
}
