// Availability chips for provider-dependent features: "Available soon" while
// a provider the feature needs is off at runtime, otherwise its offering
// ("Included", "Optional tier", "Add-on"). Shared by the page renderer and
// the home hero diagram so both follow the same registry entry.
import type { AvailabilityKey, MarketingPage } from "@trainer/contracts";

export type ChipValue = { label: string; soon: boolean } | null;

/** "Available soon" when a required provider is off at runtime. */
export function availabilityChip(
  page: MarketingPage | undefined,
  availability: Record<AvailabilityKey, boolean>,
): ChipValue {
  if (!page?.offering) return null;
  const soon = (page.availability ?? []).some((key) => !availability[key]);
  return soon
    ? { label: "Available soon", soon: true }
    : { label: page.offering, soon: false };
}

export function Chip({ chip }: { chip: ChipValue }) {
  return chip ? (
    <span className={"badge " + (chip.soon ? "amber" : "green")}>{chip.label}</span>
  ) : null;
}
