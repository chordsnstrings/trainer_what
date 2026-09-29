import type { ReactNode } from "react";

/**
 * The phone-first frame of the sign-in, recovery, email-link and joining
 * pages (app/subscriber-public.css): one short heading block and one card in
 * a single 16 px-gutter column, no marketing story beside it. Larger screens
 * only centre and widen the column.
 */
export function AuthPage({
  title,
  intro,
  eyebrow,
  children,
  wide = false,
}: {
  title: ReactNode;
  intro?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  /** A joining form with a little more room from 768 px. */
  wide?: boolean;
}) {
  return (
    <main className={`auth-page${wide ? " is-wide" : ""}`} id="main">
      <header className="auth-page-heading">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {intro && <div className="auth-page-intro">{intro}</div>}
      </header>
      <section className="auth-card">{children}</section>
    </main>
  );
}

/** "Return to sign in", apart from the form's own button. */
export function ReturnToSignIn({ label = "Return to sign in" }: { label?: string }) {
  return (
    <p className="auth-return">
      <a className="text-link" href="/login">
        {label}
      </a>
    </p>
  );
}
