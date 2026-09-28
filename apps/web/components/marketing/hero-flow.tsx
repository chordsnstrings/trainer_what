// The home hero's relay: you teach, {APP_NAME} learns your coaching, your
// subscribers train, and anything it is unsure about comes back to you. All
// text is real HTML (read by search engines, language models and screen
// readers); the wires, the travelling dot and the return loop are
// decorative. The motion plays once, under five seconds, and only when the
// visitor has not asked for reduced motion (app/marketing.css); every base
// style is the final picture. It shows no metrics, counts or revenue.
import {
  ArrowUp,
  Check,
  CheckCircle,
  CornerUpLeft,
  PenLine,
  Play,
  Users,
} from "lucide-react";
import { marketingPage, usesBrandIdentity } from "@trainer/contracts";
import { availabilityChip, Chip } from "./chip";
import type { PublicPlatform } from "./platform";

/** A wire between two steps: a line, an arrowhead and a decorative dot. */
function Wire() {
  return (
    <svg
      className="mk-relay-wire"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 48 12"
      width="48"
      height="12"
    >
      <line className="mk-relay-line" x1="2" y1="6" x2="40" y2="6" />
      <path className="mk-relay-head" d="M39 1.5 46 6l-7 4.5Z" />
      <circle className="mk-relay-dot" cx="4" cy="6" r="3.5" />
    </svg>
  );
}

/** The platform's mark on the Pace tile: the relay mark, or the initials. */
function CoreMark({ platform }: { platform: PublicPlatform }) {
  if (!usesBrandIdentity(platform.name))
    return (
      <span className="mk-relay-mark mk-relay-initials" aria-hidden="true">
        {platform.initials}
      </span>
    );
  // The two paths of public/brand/trainsyou-symbol-ink.svg (supplied
  // artwork, unmodified); Latin artwork, so it never mirrors.
  return (
    <span className="mk-relay-mark" aria-hidden="true">
      <svg viewBox="0 0 104 104" width="44" height="44" focusable="false">
        <g fill="currentColor" transform="translate(20 18)">
          <path d="M4 8H18L35 31V62H21V36Z" />
          <path d="M46 8H61L48 26H33Z" />
        </g>
      </svg>
    </span>
  );
}

export function HeroFlow({
  platform,
  t,
}: {
  platform: PublicPlatform;
  t: (s: string) => string;
}) {
  // The same registry entry and chip as the voice item on /features.
  const voice = availabilityChip(
    marketingPage("/features/voice-coach"),
    platform.availability,
  );
  return (
    <figure className="mk-relay" aria-labelledby="mk-relay-cap">
      <figcaption id="mk-relay-cap" className="sr-only">
        {t("How {APP_NAME} works")}
      </figcaption>
      <p className="mk-relay-tag">Illustration with sample data</p>
      <ol className="mk-relay-steps">
        <li className="mk-relay-node mk-relay-teach">
          <span className="mk-relay-num" aria-hidden="true">
            01
          </span>
          <span className="mk-relay-icon" aria-hidden="true">
            <PenLine size={18} />
          </span>
          <p className="mk-relay-title">You teach</p>
          <ul className="mk-relay-chips">
            <li>Methods</li>
            <li>Rules</li>
            <li>Programmes</li>
          </ul>
          <p className="mk-relay-quote">“Add 2.5 kg after two easy sessions.”</p>
          <Wire />
        </li>
        <li className="mk-relay-node mk-relay-core">
          <span className="mk-relay-num" aria-hidden="true">
            02
          </span>
          <CoreMark platform={platform} />
          <p className="mk-relay-title">{t("{APP_NAME} learns your coaching")}</p>
          <p className="mk-relay-note">Your Trainer Brain plans each day your way.</p>
          <p className="mk-relay-status">
            <CheckCircle size={14} aria-hidden="true" />
            <span>Confident: applies your rule</span>
          </p>
          <Wire />
        </li>
        <li className="mk-relay-node mk-relay-train">
          <span className="mk-relay-num" aria-hidden="true">
            03
          </span>
          <span className="mk-relay-icon" aria-hidden="true">
            <Users size={18} />
          </span>
          <p className="mk-relay-title">Your subscribers train</p>
          <p className="mk-relay-note">In your app, under your name.</p>
          <ul className="mk-relay-rows">
            <li>
              <Check size={14} aria-hidden="true" />
              <span>Today · Lower body, 45 min</span>
            </li>
            <li>
              <Check size={14} aria-hidden="true" />
              <span>Next week · Squat +2.5 kg</span>
            </li>
            <li>
              <Play size={14} aria-hidden="true" />
              <span>
                Voice-led session <Chip chip={voice} />
              </span>
            </li>
          </ul>
        </li>
      </ol>
      <div className="mk-relay-return" aria-hidden="true" />
      <p className="mk-relay-loop">
        <CornerUpLeft className="mk-relay-loop-wide bidi-mirror" size={16} aria-hidden="true" />
        <ArrowUp className="mk-relay-loop-narrow" size={16} aria-hidden="true" />
        <span>
          <strong>Not sure? It asks you first.</strong>{" "}
          <span>Pain and red flags always come to you.</span>
        </span>
      </p>
    </figure>
  );
}
