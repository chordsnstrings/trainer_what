import {
  sitemapFilePath,
  sitemapIndexXml,
  sitemapUrlSetXml,
} from "@trainer/contracts";
import {
  requestOrigin,
  sitemapFile,
  sitemapMissing,
  sitemapUnavailable,
  xmlResponse,
} from "../../components/discovery-server";

// Per request: the platform and each connected coach domain get their own
// sitemap, decided by the API from the signed host.
export const dynamic = "force-dynamic";

/**
 * The sitemap named in robots.txt. A coach domain, and the platform while its
 * coach websites fit in one file, get a plain URL set; a larger platform gets
 * a sitemap index naming /sitemaps/<n>.xml files.
 */
export async function GET() {
  const { origin } = await requestOrigin();
  let first;
  try {
    first = await sitemapFile(0);
  } catch {
    return sitemapUnavailable();
  }
  if (!first) return sitemapMissing();
  if (first.pages <= 1) return xmlResponse(sitemapUrlSetXml(first.entries));
  return xmlResponse(
    sitemapIndexXml(
      Array.from(
        { length: first.pages },
        (_, page) => origin + sitemapFilePath(page),
      ),
    ),
  );
}
