// The platform identity (docs/features/brand.md). No hooks, so server
// components (marketing pages) and client components (the workspace) share
// it. Trainer-branded surfaces (coach websites, member apps) never use it.
import {
  appInitials,
  BRAND_ASSETS,
  BRAND_LOCKUP_SIZE,
  usesBrandIdentity,
} from "@trainer/contracts";

/**
 * The trainsyou lockup when the platform name is the brand: the ink version
 * on light surfaces and the white version on dark ones (CSS picks one from
 * prefers-color-scheme inside `.platform-ui`). Any other configured name
 * shows as text with its initials, so the logo never contradicts APP_NAME.
 * Only the visible image is exposed to assistive technology.
 */
export function PlatformLogo({ name }: { name: string }) {
  if (!usesBrandIdentity(name))
    return (
      <>
        <span className="brand-mark" aria-hidden="true">
          {appInitials(name)}
        </span>
        <span>{name}</span>
      </>
    );
  const size = BRAND_LOCKUP_SIZE;
  return (
    <span className="brand-logo">
      <img
        className="brand-logo-light"
        src={BRAND_ASSETS.lockupInk}
        alt={name}
        width={size.width}
        height={size.height}
      />
      <img
        className="brand-logo-dark"
        src={BRAND_ASSETS.lockupWhite}
        alt={name}
        width={size.width}
        height={size.height}
      />
    </span>
  );
}
