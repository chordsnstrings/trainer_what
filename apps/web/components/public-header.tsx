import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MarketingHeader, claimCta } from "./marketing/frame";
import { CoachIdentity } from "./trainer-design";

/** The coach whose sign-in, recovery or joining page this is. */
export type PublicCoach = {
  /** Empty while an invitation is still being read. */
  slug: string;
  /** On the trainer's own domain or subdomain (not /coach/ on the platform). */
  host: boolean;
  /** The published trainer, once loaded (GET /public/trainers/:slug). */
  trainer?: { name: string; slug: string; theme: unknown } | null;
  /** The coach has a public website to link home to (default: yes). */
  website?: boolean;
};

/**
 * The header of the public sign-in, recovery and joining pages. On the
 * platform address it is the marketing header (the trainsyou lockup and
 * "Teach your AI"). For a coach, including every page on a trainer's own
 * domain or subdomain, a coach's join page and an invitation, it is a compact
 * bar with the trainer's identity, never the platform's logo or its sign-up
 * link, which coach addresses refuse. Joining pages drop "Join coaching"
 * (the page is the join flow) and the sign-in page drops "Sign in".
 */
export function PublicHeader({
  path,
  platform,
  coach,
}: {
  path: string;
  platform: { name: string; initials: string; registrationOpen: boolean };
  coach: PublicCoach | null;
}) {
  if (!coach)
    return (
      <MarketingHeader
        appName={platform.name}
        initials={platform.initials}
        cta={claimCta(platform.registrationOpen)}
        path={path}
      />
    );
  const trainer = coach.trainer;
  const joining = path.startsWith("/join-coach/") || path.startsWith("/join/");
  const home = coach.host
    ? "/"
    : coach.slug && coach.website !== false
      ? `/coach/${coach.slug}`
      : null;
  const identity = trainer && (
    <CoachIdentity name={trainer.name} theme={trainer.theme} compact />
  );
  return (
    <header className="subscriber-header">
      {home ? (
        <Link
          href={home}
          className="wordmark"
          aria-label={trainer ? undefined : "Coaching website"}
        >
          {identity}
        </Link>
      ) : (
        <span className="wordmark">{identity}</span>
      )}
      <nav aria-label="Account">
        {path !== "/login" && (
          <Link className="subscriber-header-link" href="/login">
            Sign in
          </Link>
        )}
        {!joining && coach.slug && (
          <Link
            className="button"
            href={`/join-coach/${trainer?.slug ?? coach.slug}`}
          >
            Join coaching <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </header>
  );
}
