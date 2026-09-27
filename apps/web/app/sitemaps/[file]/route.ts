import { sitemapUrlSetXml } from "@trainer/contracts";
import {
  sitemapFile,
  sitemapMissing,
  sitemapUnavailable,
  xmlResponse,
} from "../../../components/discovery-server";

export const dynamic = "force-dynamic";

/**
 * One file of the platform sitemap index (/sitemaps/<n>.xml). It exists only
 * while /sitemap.xml is an index, so no address lists the same pages twice.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const match = /^(0|[1-9][0-9]{0,4})\.xml$/.exec((await params).file);
  if (!match) return sitemapMissing();
  let data;
  try {
    data = await sitemapFile(Number(match[1]));
  } catch {
    return sitemapUnavailable();
  }
  if (!data || data.pages <= 1) return sitemapMissing();
  return xmlResponse(sitemapUrlSetXml(data.entries));
}
