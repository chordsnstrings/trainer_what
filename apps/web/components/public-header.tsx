import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MarketingHeader, claimCta } from "./marketing/frame";
import { CoachIdentity } from "./trainer-design";

/** The coach whose sign-in, recovery or joining page this is. */
export type PublicCoach = {
  slug: string;
  /** On the trainer's own domain or subdomain (not /coach/ on the platform). */
  host: boolean;
  /** The published trainer, once loaded (GET /public/trainers/:slug). */
  trainer?: { name: string; slug: string; theme: unknown } | null;
};

/**
 * The header of the public sign-in, recovery and joining pages. On the
 * platform address it is the marketing header (the trainsyou lockup and
 * "Teach your AI"). For a coach, including every page on a trainer's own
 * domain or subdomain, it carries the trainer's identity and "Join coaching",
 * never the platform's logo or its sign-up link, which coach addresses refuse.
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
  return (
    <header className="public-header">
      <Link
        href={coach.host ? "/" : `/coach/${coach.slug}`}
        className="wordmark"
        aria-label={trainer ? undefined : "Coaching website"}
      >
        {trainer && (
          <CoachIdentity name={trainer.name} theme={trainer.theme} compact />
        )}
      </Link>
      <nav>
        <Link href="/login">Sign in</Link>
      </nav>
      <Link className="button" href={`/join-coach/${trainer?.slug ?? coach.slug}`}>
        Join coaching <ArrowUpRight size={16} />
      </Link>
    </header>
  );
}
