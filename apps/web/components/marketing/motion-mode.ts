// The marketing site's motion switch (docs/features/marketing-motion.md,
// "Motion for every visitor"). One constant, read by server code (site.tsx)
// and client code alike, so this module has no "use client".
//
// - "always" (the owner's decision, 22 October 2026): every short marketing
//   motion plays for every visitor, whatever the device's
//   prefers-reduced-motion setting or the member's own "Reduce motion" choice
//   (<html data-reduce-motion="on">, app/layout.tsx) says. The owner: "we can
//   always switch it back to motion matching the device."
// - "device": motion matches the device, as before that decision: either
//   setting stops the marketing motion.
//
// The value is rendered as data-mk-motion on the marketing root (.mk,
// site.tsx) and on Kamran's assistant host (.mk-assistant-host,
// assistant-button.tsx). Every reduced-motion rule that reaches them is
// kept and skips only elements under [data-mk-motion="always"]
// (MOTION_ALWAYS_EXCLUDED below, in app/globals.css, app/motion.css,
// app/marketing.css, app/marketing-assistant.css and
// app/marketing-journey.css); the scripts (motion.tsx, journey-player.tsx)
// test MARKETING_MOTION before they read either setting. With "device" no
// element carries "always", so every one of those rules matches exactly
// what it matched before (the exclusion is wrapped in :where(), which adds
// no specificity). tests/marketing-motion-sitewide.test.ts keeps both
// modes wired.
//
// Never switched: the pinned, scroll-scrubbed scenes on the home page
// (scenes-head.ts, scene-mount.tsx) follow both settings in either mode, and
// the member app, the trainer workspace, coach websites and the sign-in,
// sign-up and coach directory pages never carry the attribute.

export type MarketingMotionMode = "always" | "device";

/** The switch. "device" restores motion that matches the device. */
export const MARKETING_MOTION = "always" as MarketingMotionMode;

/** The attribute that carries the switch to the stylesheets. */
export const MARKETING_MOTION_ATTRIBUTE = "data-mk-motion";

/**
 * The selector every marketing reduced-motion rule appends to the element
 * it stops, so the rule skips the marketing root and everything inside it
 * while the switch is "always" (a static test finds it in each stylesheet).
 */
export const MOTION_ALWAYS_EXCLUDED =
  ':not(:where([data-mk-motion="always"], [data-mk-motion="always"] *))';
