import Workspace from "../../components/workspace";
import { CoachWebsite } from "../../components/coach-site";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { verifiedProxyHeaders } from "../../host-proxy";
import { DIRECTORY_PATH, isIndexablePlatformPath } from "@trainer/contracts";
import {
  CoachDirectory,
  type DirectoryData,
} from "../../components/coach-directory";
import { requestOrigin, signedApiGet } from "../../components/discovery-server";
type SearchParams = Record<string, string | string[] | undefined>;
// Only known single-valued filters reach the API; anything else is dropped.
function directoryQuery(search: SearchParams) {
  const params = new URLSearchParams();
  for (const key of ["q", "specialty", "language", "offset"]) {
    const value = search[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  return params.toString();
}
const directory = cache(
  async (
    query: string,
  ): Promise<(DirectoryData & { platformName: string }) | null> => {
    const response = await signedApiGet(
      "/api/v1/public/directory" + (query ? "?" + query : ""),
    );
    if (response.status === 404 || response.status === 421) return null;
    if (response.status === 400) {
      // An edited address with an unknown filter shows the unfiltered form.
      const fallback = await directory("");
      return (
        fallback && {
          ...fallback,
          coaches: [],
          nextOffset: null,
          error:
            "That search could not be read. Clear the filters and try again.",
        }
      );
    }
    if (!response.ok)
      throw new Error("The coach directory is temporarily unavailable.");
    return response.json();
  },
);
const website = cache(async (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return null;
  const incoming = await headers(),
    origin =
      incoming.get("x-trainer-site-origin") ??
      process.env.PUBLIC_APP_URL ??
      "http://localhost:3000";
  const target = `/api/v1/public/sites/${slug}`;
  const response = await fetch(
    new URL(target, process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"),
    {
      headers: verifiedProxyHeaders(
        new Headers(),
        new URL(origin).host,
        "GET",
        target,
        process.env.INTERNAL_PROXY_SECRET,
        Date.now(),
        // Set by proxy.ts from the edge address after removing client copies.
        incoming.get("x-trainer-client-ip"),
      ),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 404 || response.status === 421) return null;
  if (!response.ok)
    throw new Error("This coaching website is temporarily unavailable.");
  return response.json();
});
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { path = [] } = await params;
  const { origin, coachHost } = await requestOrigin();
  if (!coachHost && path.length === 1 && "/" + path[0] === DIRECTORY_PATH) {
    const query = directoryQuery(await searchParams);
    const data = await directory(query);
    if (!data)
      return {
        title: "Coach directory unavailable",
        robots: { index: false, follow: false },
      };
    return {
      title: `Find a coach — ${data.platformName}`,
      description:
        "Browse independent coaches who chose to be listed, by specialty and language, and visit their websites.",
      alternates: { canonical: origin + DIRECTORY_PATH },
      // Filtered and paged results are reachable but not separate entries.
      ...(query ? { robots: { index: false, follow: true } } : {}),
    };
  }
  if (path[0] !== "coach" || !path[1])
    // Only marketing pages and the directory on the platform address are
    // indexed; app, sign-in and unknown addresses are not.
    return coachHost || !isIndexablePlatformPath("/" + path.join("/"))
      ? { robots: { index: false, follow: false } }
      : {};
  const data = await website(path[1]);
  if (!data)
    return {
      title: "Coaching website unavailable",
      robots: { index: false, follow: false },
    };
  const page = data.site.pages.find(
    (p: any) => p.visible && p.slug === path[2],
  );
  return {
    title: page
      ? `${page.title} — ${data.tenant.name}`
      : data.site.seoTitle || data.tenant.name,
    description: data.site.seoDescription || data.site.introduction,
    manifest: `/api/v1/public/sites/${data.tenant.slug}/manifest.webmanifest`,
    icons: {
      icon: `/api/v1/public/sites/${data.tenant.slug}/icon/192`,
      apple: `/api/v1/public/sites/${data.tenant.slug}/icon/192`,
    },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<SearchParams>;
}) {
  const { path = [] } = await params;
  if (path.length === 1 && "/" + path[0] === DIRECTORY_PATH) {
    // The directory belongs to the platform address; coach domains never
    // reach this branch because the proxy maps their paths under /coach/.
    const data = await directory(directoryQuery(await searchParams));
    if (!data) notFound();
    return <CoachDirectory data={data} platformName={data.platformName} />;
  }
  if (path[0] === "coach" && path[1]) {
    const data = await website(path[1]);
    if (!data) notFound();
    const section = path[2];
    if (
      path.length > 3 ||
      (section &&
        !["about", "memberships", "galleries", "contact"].includes(section) &&
        !data.site.pages.some((p: any) => p.visible && p.slug === section))
    )
      notFound();
    return <CoachWebsite initialData={data} path={path.slice(2).join("/")} />;
  }
  return <Workspace />;
}
