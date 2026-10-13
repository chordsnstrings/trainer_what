/** Code-owned read-only destinations. Model output never becomes a URL. */
export const ASSISTANT_DESTINATIONS = {
  home: { href: "/", label: "Home" },
  how: { href: "/how-it-works", label: "How it works" },
  brain: { href: "/trainer-brain", label: "Your coaching method" },
  features: { href: "/features", label: "Features" },
  voice: { href: "/features/voice-coach", label: "Voice coaching" },
  pricing: { href: "/pricing", label: "Pricing" },
  earnings: { href: "/earnings-calculator", label: "Earnings calculator" },
  followers: { href: "/follower-calculator", label: "Follower calculator" },
  faq: { href: "/faq", label: "Frequently asked questions" },
  about: { href: "/about", label: "Why I built this" },
  privacy: { href: "/security-and-privacy", label: "Security and privacy" },
  start: { href: "/get-started", label: "Getting started" },
} as const;
export type AssistantDestination = keyof typeof ASSISTANT_DESTINATIONS;
export function assistantDestination(value: unknown) {
  return typeof value === "string" &&
    Object.hasOwn(ASSISTANT_DESTINATIONS, value)
    ? ASSISTANT_DESTINATIONS[value as AssistantDestination]
    : null;
}
export function assistantPage(path: unknown): AssistantDestination | null {
  return (
    (Object.keys(ASSISTANT_DESTINATIONS) as AssistantDestination[]).find(
      (key) => ASSISTANT_DESTINATIONS[key].href === path,
    ) ?? null
  );
}
