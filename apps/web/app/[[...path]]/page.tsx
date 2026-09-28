import Workspace from "../../components/workspace";
import { CoachWebsite } from "../../components/coach-site";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import type { Metadata, Viewport } from "next";
import {
  documentLanguage,
  publicWebsite as website,
} from "../../components/public-website";
import {
  DIRECTORY_PATH,
  isIndexablePlatformPath,
  isUnknownMarketingChild,
  marketingMetadata,
  marketingPage,
  marketingRedirect,
  resolveBrandDesign,
} from "@trainer/contracts";
import { MarketingSite } from "../../components/marketing/site";
import { publicPlatform } from "../../components/marketing/platform";
import {
  CoachDirectory,
  CoachDirectoryClosed,
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
type DirectoryResult =
  (DirectoryData & { platformName: string }) | "closed" | null;
const directory = cache(async (query: string): Promise<DirectoryResult> => {
  const response = await signedApiGet(
    "/api/v1/public/directory" + (query ? "?" + query : ""),
  );
  // On the platform address a 404 means the Super admin closed the directory.
  if (response.status === 404) return "closed";
  if (response.status === 421) return null;
  if (response.status === 400) {
    // An edited address with an unknown filter shows the unfiltered form.
    const fallback = await directory("");
    return fallback && fallback !== "closed"
      ? {
          ...fallback,
          coaches: [],
          nextOffset: null,
          error:
            "That search could not be read. Clear the filters and try again.",
        }
      : fallback;
  }
  if (!response.ok)
    throw new Error("The coach directory is temporarily unavailable.");
  return response.json();
});
/**
 * A coach website takes the coach's own browser colour (Design Studio
 * primary, as in its public manifest); every other page keeps the platform
 * colour from the root layout.
 */
export async function generateViewport({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<Viewport> {
  const { path = [] } = await params;
  if (path[0] !== "coach" || !path[1]) return {};
  const data = await website(path[1]);
  return data
    ? { themeColor: resolveBrandDesign(data.tenant.theme).primary }
    : {};
}
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { path = [] } = await params;
  const { origin, coachHost } = await requestOrigin();
  const route = "/" + path.join("/");
  const marketing = coachHost ? undefined : marketingPage(route);
  if (marketing) {
    const platform = await publicPlatform();
    const m = marketingMetadata(marketing, {
      origin,
      appName: platform.name,
      followerModel: platform.followerModel,
    });
    return {
      title: { absolute: m.title },
      description: m.description,
      alternates: { canonical: m.canonical },
      robots: m.robots,
      openGraph: m.openGraph,
      twitter: m.twitter,
    };
  }
  if (!coachHost && path.length === 1 && "/" + path[0] === DIRECTORY_PATH) {
    const query = directoryQuery(await searchParams);
    const data = await directory(query);
    if (!data || data === "closed")
      return {
          title: {
          absolute:
            data === "closed"
              ? "The coach directory is closed"
              : "Coach directory unavailable",
        },
        robots: { index: false, follow: false },
      };
    return {
      title: { absolute: `Find a coach | ${data.platformName}` },
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
      title: { absolute: "Coaching website unavailable" },
      robots: { index: false, follow: false },
    };
  const page = data.site.pages.find(
    (p: any) => p.visible && p.slug === path[2],
  );
  return {
    // A coach website carries the coach's brand, never the platform's: its
    // name, its own description, and never the platform's B2B description.
    title: {
      absolute: page
        ? `${page.title} — ${data.tenant.name}`
        : data.site.seoTitle || data.tenant.name,
    },
    applicationName: data.tenant.name,
    description:
      data.site.seoDescription ||
      data.site.introduction ||
      `Personal coaching with ${data.tenant.name}.`,
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
  const route = "/" + path.join("/");
  if (path[0] !== "coach") {
    const marketing = marketingPage(route);
    if (marketing && marketing.renderer !== "workspace") {
      const { origin, coachHost } = await requestOrigin();
      if (!coachHost)
        return (
          <MarketingSite
            page={marketing}
            platform={await publicPlatform()}
            origin={origin}
          />
        );
    }
    // Retired marketing addresses move permanently; unknown feature,
    // specialty, UAE and guide addresses are missing pages, not the app.
    const moved = marketingRedirect(route);
    if (moved) permanentRedirect(moved);
    if (isUnknownMarketingChild(route)) notFound();
  }
  if (path.length === 1 && "/" + path[0] === DIRECTORY_PATH) {
    // The directory belongs to the platform address; coach domains never
    // reach this branch because the proxy maps their paths under /coach/.
    const data = await directory(directoryQuery(await searchParams));
    if (!data) notFound();
    // Links to /coaches (the marketing header, trainers' settings) stay
    // useful while the Super admin has the directory closed.
    if (data === "closed") return <CoachDirectoryClosed />;
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
    // The same language as <html>: the visitor's explicit choice, else the
    // website's own. The website root carries it too, so client-side
    // navigation between pages keeps the right direction.
    const { lang } = await documentLanguage();
    return (
      <CoachWebsite
        initialData={data}
        path={path.slice(2).join("/")}
        language={lang}
      />
    );
  }
  const platform = await publicPlatform();
  return (
    <Workspace
      platform={{
        name: platform.name,
        initials: platform.initials,
        registrationOpen: platform.registrationOpen,
      }}
    />
  );
}
