import {
  appInitials,
  platformName,
  type AvailabilityKey,
} from "@trainer/contracts";
import {
  DEFAULT_FOLLOWER_MODEL,
  type FollowerModelAssumptions,
} from "../../../../packages/domain/src/marketing-calculators";
import { platformRootDomain } from "../../../../packages/domain/src/web-address";
import { signedApiGet } from "../discovery-server";

/** The platform facts the public pages need (GET /api/v1/public/platform). */
export type PublicPlatform = {
  name: string;
  initials: string;
  supportEmail: string | null;
  companyDetails: string | null;
  registrationOpen: boolean;
  coachAddressTemplate: string;
  availability: Record<AvailabilityKey, boolean>;
  followerModel: FollowerModelAssumptions;
  /** The home page voice assistant is on, connected and under today's cap. */
  assistant?: boolean;
};

function fallback(): PublicPlatform {
  const name = platformName(process.env.APP_NAME);
  const root = platformRootDomain(process.env.PLATFORM_ROOT_DOMAIN);
  return {
    name,
    initials: appInitials(name),
    supportEmail: null,
    companyDetails: null,
    registrationOpen: false,
    coachAddressTemplate: root
      ? `https://{slug}.${root}`
      : new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000").origin + "/coach/{slug}",
    availability: {
      model: false,
      nutrition: false,
      voice: false,
      customDomains: false,
      payments: false,
      payouts: false,
      whoop: false,
      zepp: false,
      instagram: false,
      frontier: false,
    },
    followerModel: DEFAULT_FOLLOWER_MODEL,
    assistant: false,
  };
}

// Settings change rarely; one read a minute per web process is enough and
// keeps marketing pages fast. The value does not depend on the request host.
let cached: { at: number; value: PublicPlatform } | null = null;
const TTL_MS = 60_000;

/** Platform name, availability and calculator assumptions (server only). */
export async function publicPlatform(): Promise<PublicPlatform> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const response = await signedApiGet("/api/v1/public/platform");
    if (response.ok) {
      const value = (await response.json()) as PublicPlatform;
      cached = { at: Date.now(), value };
      return value;
    }
  } catch {
    // An unavailable API keeps the last known facts, then the defaults.
  }
  return cached?.value ?? fallback();
}
