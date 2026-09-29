import Link from "next/link";

/**
 * The footer of every page a subscriber sees outside the member app: the
 * coach directory, sign-in, recovery and joining pages, the public legal
 * documents and a coach's own website. It is neutral (the platform's name)
 * or carries the coach's name, and never the trainer-marketing footer
 * (earnings calculator, trainer features, "For trainers").
 *
 * "Analytics preferences" is a button with data-analytics-preferences: the
 * analytics consent (components/acquisition.tsx) opens its panel from it.
 */
export function SubscriberFooter({
  name,
  coach = false,
  directory = true,
  signIn = true,
  analytics = true,
}: {
  /** The platform's name, or the coach's on a coach page. */
  name: string;
  /** A coach's page (their website, or sign-in on their own address). */
  coach?: boolean;
  /** Link the coach directory (the platform address only). */
  directory?: boolean;
  /** Link the sign-in page (not on the sign-in page itself). */
  signIn?: boolean;
  /** The analytics preferences entry (not in a trainer's private preview). */
  analytics?: boolean;
}) {
  return (
    <footer className="subscriber-footer">
      <nav aria-label={coach ? `${name} links` : "Help and legal"}>
        {directory && <Link href="/coaches">Find a coach</Link>}
        {signIn && <Link href="/login">Member sign in</Link>}
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/ai-disclosure">Digital coaching</Link>
        {analytics && (
          <button
            type="button"
            className="subscriber-footer-link"
            data-analytics-preferences=""
          >
            Analytics preferences
          </button>
        )}
      </nav>
      <p>
        © {new Date().getFullYear()} {name}
        {coach ? "" : ". Coaching is not medical advice."}
      </p>
    </footer>
  );
}
