import Workspace from "../../components/workspace";
import { CoachWebsite } from "../../components/coach-site";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import type { Metadata, Viewport } from "next";
import {
  documentLanguage,
  publicWebsite as website,
} from "../../components/public-website";
import {
  BRAND_COLORS,
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
import {
  movedCoachSlug,
  requestOrigin,
  signedApiGet,
} from "../../components/discovery-server";
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
// Sign-in, sign-up, recovery and joining pages the workspace renders as
// `public platform-ui` on the platform address (components/workspace.tsx).
const PUBLIC_AUTH_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/magic-link",
  "/recover-authenticator",
  "/sign-in/verify",
];
const PUBLIC_AUTH_PREFIXES = [
  "/magic-link/",
  "/verify-email-change/",
  "/account-recovery/",
  "/reset-password/",
  "/verify-email/",
  "/join-coach/",
  "/join/",
];
/** Public platform pages, which are always light (docs/features/brand.md). */
function isPublicPlatformRoute(route: string) {
  return (
    !!marketingPage(route) ||
    route === DIRECTORY_PATH ||
    route.startsWith(DIRECTORY_PATH + "/") ||
    PUBLIC_AUTH_PATHS.includes(route) ||
    PUBLIC_AUTH_PREFIXES.some((prefix) => route.startsWith(prefix))
  );
}
/**
 * A coach website, and any page on a trainer's own address, takes the coach's
 * own browser colour (Design Studio primary, as in its public manifest). The
 * public platform pages (marketing, directory, sign-in) are always light, so
 * their browser colour is white in every device scheme. The workspace keeps
 * the root layout's paper and ink pair.
 */
export async function generateViewport({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<Viewport> {
  const { path = [] } = await params;
  // The member app draws under the notch and home indicator and pads its top
  // bar, tab bar and sticky action bars with env(safe-area-inset-*)
  // (app/phone-first.css), which matters most once it is installed.
  const member: Viewport = path[0] === "app" ? { viewportFit: "cover" } : {};
  const slug =
    path[0] === "coach" ? path[1] : (await requestOrigin()).coachSlug;
  if (!slug)
    return isPublicPlatformRoute("/" + path.join("/"))
      ? { themeColor: BRAND_COLORS.white, colorScheme: "light" }
      : member;
  const data = await website(slug);
  return data
    ? { themeColor: resolveBrandDesign(data.tenant.theme).primary, ...member }
    : member;
}
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { path = [] } = await params;
  const { origin, coachHost, coachSlug } = await requestOrigin();
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
  if (path[0] !== "coach" && coachHost && coachSlug) {
    // Sign-in, recovery, joining and legal pages on a trainer's own address
    // carry the trainer's name and icon, never the platform's B2B title,
    // description or favicon. The member app replaces them once signed in.
    const data = await website(coachSlug);
    return {
      robots: { index: false, follow: false },
      ...(data
        ? {
            title: { absolute: data.tenant.name },
            applicationName: data.tenant.name,
            description: `Personal coaching with ${data.tenant.name}.`,
            icons: {
              icon: `/api/v1/public/sites/${data.tenant.slug}/icon/192`,
              apple: `/api/v1/public/sites/${data.tenant.slug}/icon/180`,
            },
          }
        : { description: null }),
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
      apple: `/api/v1/public/sites/${data.tenant.slug}/icon/180`,
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
    if (!data) {
      // A renamed workspace's previous address redirects for a while.
      const moved = await movedCoachSlug(path[1]);
      if (moved)
        redirect(
          "/coach/" + [moved, ...path.slice(2)].map(encodeURIComponent).join("/"),
        );
      notFound();
    }
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
  if (path[0] === "join-coach" && path[1] && path.length === 2) {
    const moved = await movedCoachSlug(path[1]);
    if (moved) redirect("/join-coach/" + moved);
  }
  const platform = await publicPlatform();
  const { coachSlug } = await requestOrigin();
  return (
    <Workspace
      platform={{
        name: platform.name,
        initials: platform.initials,
        registrationOpen: platform.registrationOpen,
      }}
      coachSlug={coachSlug}
    />
  );
}
