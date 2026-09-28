// The public site header and footer. No hooks, so the server-rendered
// marketing pages, the directory and the client sign-in pages share them.
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  marketingFooter,
  marketingNav,
  type NavLink,
} from "@trainer/contracts";

export type BrandProps = { appName: string; initials: string };
export type Cta = { label: string; href: string };

/** The primary call to action: claim an address, or early access. */
export function claimCta(registrationOpen: boolean): Cta {
  return registrationOpen
    ? { label: "Claim your coaching address", href: "/signup" }
    : { label: "Join early access", href: "/get-started#early-access" };
}

export function Wordmark({ appName, initials }: BrandProps) {
  return (
    <Link href="/" className="wordmark mk-wordmark" aria-label={appName + " home"}>
      <span className="brand-mark mk-brand-mark" aria-hidden="true">
        {initials}
      </span>
      <span>{appName}</span>
    </Link>
  );
}

function current(href: string, path?: string) {
  return path === href ? ("page" as const) : undefined;
}

export function MarketingHeader({
  appName,
  initials,
  cta,
  path,
}: BrandProps & { cta: Cta; path?: string }) {
  const nav = marketingNav();
  return (
    <header className="mk-header">
      <a className="mk-skip" href="#main">
        Skip to content
      </a>
      <Wordmark appName={appName} initials={initials} />
      <nav className="mk-nav" aria-label="Main">
        <ul>
          {nav.map((group) =>
            group.href ? (
              <li key={group.label}>
                <Link
                  className="mk-nav-top"
                  href={group.href}
                  aria-current={current(group.href, path)}
                >
                  {group.label}
                </Link>
              </li>
            ) : (
              <li key={group.label} className="mk-nav-group">
                <span className="mk-nav-top">
                  {group.label} <ChevronDown size={14} aria-hidden="true" />
                </span>
                <ul className="mk-dropdown" aria-label={group.label}>
                  {group.links.map((item: NavLink) => (
                    <li key={item.href}>
                      <Link href={item.href} aria-current={current(item.href, path)}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      </nav>
      <div className="mk-header-actions">
        <Link className="mk-signin" href="/login">
          Sign in
        </Link>
        <Link className="button" href={cta.href}>
          {cta.label}
        </Link>
      </div>
      <details className="mk-mobile-menu">
        <summary>Menu</summary>
        <div className="mk-mobile-panel">
          {nav.map((group) => (
            <div key={group.label}>
              {group.href ? (
                <Link href={group.href}>{group.label}</Link>
              ) : (
                <>
                  <p className="eyebrow">{group.label}</p>
                  <ul>
                    {group.links.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href}>{item.label}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
          <Link href="/login">Sign in</Link>
          <Link className="button" href={cta.href}>
            {cta.label}
          </Link>
        </div>
      </details>
    </header>
  );
}

export function MarketingFooter({ appName, initials }: BrandProps) {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-brand">
        <Wordmark appName={appName} initials={initials} />
        <p className="muted">
          Personal training in each trainer’s own method, made affordable for
          their followers. Built for the UAE, priced in AED.
        </p>
      </div>
      <nav className="mk-footer-map" aria-label="Site map">
        {marketingFooter().map((column) => (
          <div key={column.label}>
            <p className="eyebrow">{column.label}</p>
            <ul>
              {column.links.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p className="mk-footer-note muted">
        © {new Date().getFullYear()} {appName}. Estimates on this site are
        illustrative ranges, never promises. Coaching is not medical advice.
      </p>
    </footer>
  );
}
