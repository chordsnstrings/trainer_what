// The coach-to-subscriber journey: the whole workflow as one player. Each of
// the eight /how-it-works steps is a chapter: what the coach does in the
// workspace (a laptop), how it crosses the wire, and what it means for a
// subscriber (a phone). The captions are the registry's steps, unchanged,
// in the same `ol` (and the HowTo JSON-LD); each adds one subscriber line
// looked up verbatim from the registry. The stage is decorative
// (aria-hidden), sample data only, with no metrics, counts, revenue or
// amounts. Base styles are each chapter's complete picture; the one-off
// beats (app/marketing-journey.css) play only while the root carries
// data-run, never under reduced motion. The only client code is the control
// bar and clock (journey-player.tsx).
//
// The launch gate: the second half of the workflow (publish, join, pay,
// daily coaching, payouts) exists only once a coach can launch, so the
// player renders only while registration is open and the model, payments
// and payouts providers are available. Otherwise /how-it-works shows its
// steps exactly as before and the home page has no journey band.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  BatteryFull,
  Check,
  Laptop,
  Signal,
  Smartphone,
  Wifi,
} from "lucide-react";
import { marketingPage, type MarketingSection } from "@trainer/contracts";
import { availabilityChip } from "./chip";
import { CoreMark } from "./hero-flow";
import { JourneyPlayer, type JourneyTiming } from "./journey-player";
import type { PublicPlatform } from "./platform";

/** Whether a coach can reach the subscriber half of the workflow today. */
export function journeyAvailable(platform: PublicPlatform): boolean {
  const a = platform.availability;
  return platform.registrationOpen && a.model && a.payments && a.payouts;
}

/**
 * Where each chapter's subscriber line lives in the registry: a bullet or a
 * step of a page section, or one sentence of a FAQ answer. Never copied, so
 * no new sentence can enter the site this way (tests/marketing-journey).
 */
export type RegistryLine =
  | { path: string; section: string; bullet: number }
  | { path: string; section: string; step: number }
  | { path: string; faq: string; sentence: number };
export const SUBSCRIBER_LINES: RegistryLine[] = [
  { path: "/features/subscriber-app", section: "subscriber", bullet: 0 },
  { path: "/features/chat-and-digital-coach", section: "flow", step: 1 },
  { path: "/features/subscriber-app", section: "subscriber", bullet: 1 },
  { path: "/features/payments-and-payouts", section: "subscriber", bullet: 0 },
  {
    path: "/",
    faq: "How do my Instagram followers become subscribers?",
    sentence: 1,
  },
  { path: "/features/ai-training-plans", section: "subscriber", bullet: 0 },
  { path: "/features/ai-training-plans", section: "subscriber", bullet: 2 },
  { path: "/pricing", section: "how", bullet: 0 },
];
/** The registry text a reference points to; throws when it does not resolve. */
export function registryLine(ref: RegistryLine): string {
  const page = marketingPage(ref.path);
  let text: string | undefined;
  if ("faq" in ref)
    text = page?.faqs.find((f) => f.q === ref.faq)?.a.split(/(?<=[.?!])\s+/)[
      ref.sentence
    ];
  else {
    const section = page?.sections.find((s) => s.id === ref.section);
    text =
      "step" in ref
        ? section?.steps?.[ref.step]?.body
        : section?.bullets?.[ref.bullet];
  }
  if (!text)
    throw new Error("Unresolved registry line: " + JSON.stringify(ref));
  return text;
}

/**
 * Each chapter's clock (milliseconds from its start). A crossing takes 570:
 * the trail draws (280), the dot travels from +150 (420) and arrives. Every
 * chapter holds its complete picture for at least 2.5 s before the next.
 */
export const JOURNEY_TIMING: JourneyTiming[] = [
  { ms: 6500, go: 2300, back: null, start: "coach", swaps: [2870] },
  { ms: 7000, go: 2300, back: null, start: "coach", swaps: [2870] },
  { ms: 6500, go: 2300, back: null, start: "coach", swaps: [2870] },
  { ms: 6500, go: 2300, back: null, start: "coach", swaps: [2870] },
  { ms: 7500, go: 2300, back: null, start: "coach", swaps: [2870] },
  { ms: 7400, go: 1400, back: 3850, start: "coach", swaps: [1970, 4420] },
  { ms: 7100, go: 3100, back: 1100, start: "phone", swaps: [1670, 3670] },
  { ms: 5000, go: null, back: 900, start: "phone", swaps: [1470] },
];

type Beat =
  | "rise"
  | "card"
  | "pop"
  | "stamp"
  | "fade"
  | "xin"
  | "xout"
  | "slide"
  | "glow"
  | "tap"
  | "draw"
  | "dots"
  | "temp"
  | "uncover";
/** A beat: its kind and start time (ms); `temp` also leaves at `leave`. */
function b(kind: Beat, at: number, leave?: number) {
  const style: Record<string, string> = { "--d": at + "ms" };
  if (leave !== undefined) style["--e"] = leave + "ms";
  return { "data-b": kind, style: style as CSSProperties };
}

type Ctx = {
  /** Words (full) or skeleton bars (the compact home variant). */
  l: boolean;
  address: string;
  nutrition: string | null;
  voice: string | null;
};
/** A word or phrase, or a bar of about its length in the compact variant. */
function T({ c, children }: { c: Ctx; children: string }) {
  return c.l ? (
    <>{children}</>
  ) : (
    <i
      className="w-sk"
      style={{ inlineSize: Math.min(children.length, 24) * 0.42 + "em" }}
    />
  );
}
function Tick({ at }: { at: number }) {
  return (
    <span className="w-tick" {...b("pop", at)}>
      <Check size={12} strokeWidth={3} />
    </span>
  );
}
/** A small status label; `tone` g (success), a (review), r (safety) or n. */
function Badge({
  c,
  tone,
  beat,
  children,
}: {
  c: Ctx;
  tone: "g" | "a" | "r" | "n";
  beat?: ReturnType<typeof b>;
  children: string;
}) {
  return (
    <span className={"w-badge w-" + tone} {...beat}>
      <T c={c}>{children}</T>
    </span>
  );
}
/** The demo coach's header inside the subscriber's phone. */
function AppHead({
  c,
  beat,
  nameBeat,
}: {
  c: Ctx;
  beat?: ReturnType<typeof b>;
  nameBeat?: ReturnType<typeof b>;
}) {
  return (
    <div className="w-head" {...beat}>
      <span className="w-av">{c.l ? "LS" : ""}</span>
      <span {...nameBeat}>
        <T c={c}>Layla Strength</T>
      </span>
    </div>
  );
}
/** A placeholder bar where a value would be: never a number. */
const Ph = ({ w = 4 }: { w?: number }) => (
  <i className="w-ph" style={{ inlineSize: w + "em" }} />
);
/** Words that appear one after another, as if typed. */
function Typed({ c, words, at }: { c: Ctx; words: string[]; at: number }) {
  return (
    <>
      {words.map((word, i) => (
        <span key={i} {...b("fade", at + i * 80)}>
          <T c={c}>{word}</T>{" "}
        </span>
      ))}
    </>
  );
}

type Scene = {
  tab: string[];
  coach: (c: Ctx) => ReactNode;
  phone: (c: Ctx) => ReactNode;
};
const SCENES: Scene[] = [
  // 1. Claim your address: the reserved address and the Design Studio;
  // the subscriber side previews the brand (the coach's colours, name and a
  // placeholder page). No address bar and no Join yet: nothing is published
  // at this step (the address first opens in chapter 5).
  {
    tab: ["Design Studio"],
    coach: (c) => (
      <div className="w-pane">
        <div className="w-f" {...b("rise", 300)}>
          <span className="w-row">
            <span className="w-lab">
              <T c={c}>Your coaching address</T>
            </span>
            <Badge c={c} tone="g" beat={b("pop", 580)}>
              Reserved
            </Badge>
          </span>
          <span className="w-val w-addr" dir="ltr">
            <T c={c}>{c.address}</T>
            <i className="w-cover" {...b("uncover", 340)} />
          </span>
        </div>
        <div className="w-row w-line" {...b("rise", 1000)}>
          <span className="w-lab">
            <T c={c}>Public name</T>
          </span>
          <strong>
            <T c={c}>Layla Strength</T>
          </strong>
        </div>
        <div className="w-swatches">
          {[0, 1, 2, 3, 4].map((i) => (
            <i
              key={i}
              className={"w-sw w-sw" + i}
              {...b("rise", 1000 + i * 40)}
            >
              {i === 0 && <i className="w-sel" {...b("stamp", 1300)} />}
            </i>
          ))}
        </div>
        <div className="w-row w-line">
          <span className="w-logo" {...b("stamp", 1700)}>
            {c.l ? "LS" : ""}
          </span>
          <span className="w-lab">
            <T c={c}>Logo</T>
          </span>
          <span className="w-prev">
            <i className="w-prev-old" {...b("xout", 1850)} />
            <i className="w-prev-new" {...b("xin", 1850)} />
          </span>
        </div>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} beat={b("rise", 3000)} nameBeat={b("rise", 3080)} />
        <div className="w-card w-skel" {...b("card", 3350)}>
          <Ph w={9} />
          <Ph w={12} />
          <Ph w={7} />
        </div>
      </div>
    ),
  },
  // 2. Teach your Brain: a rule confirmed in Knowledge review; the
  // labelled digital coach replies from it.
  {
    tab: ["Knowledge review"],
    coach: (c) => (
      <div className="w-pane">
        <div className="w-card" {...b("card", 300)}>
          <p className="w-quote">
            <Typed c={c} words={["“Add", "2.5", "kg", "after"]} at={380} />
            <span className="w-hl" {...b("glow", 1500)}>
              <Typed c={c} words={["two", "easy", "sessions.”"]} at={700} />
            </span>
          </p>
          <span className="w-acts">
            <span className="w-btn w-pri" {...b("tap", 1200)}>
              <T c={c}>Confirm</T>
            </span>
            <span className="w-btn">
              <T c={c}>Edit</T>
            </span>
            <span className="w-btn">
              <T c={c}>Reject</T>
            </span>
          </span>
          <span className="w-row">
            <Badge c={c} tone="g" beat={b("pop", 1400)}>
              Confirmed
            </Badge>
            <Badge c={c} tone="n" beat={b("rise", 1800)}>
              Coaching interview
            </Badge>
          </span>
        </div>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} />
        <p className="w-bub w-me" {...b("rise", 3000)}>
          <T c={c}>“Week three done. Squats felt easy.”</T>
        </p>
        <div className="w-stack">
          <span className="w-typing" {...b("dots", 3300)}>
            <i />
            <i />
            <i />
          </span>
          <div className="w-bub w-bot" {...b("rise", 3860)}>
            <span className="w-who">
              <T c={c}>Digital coach</T>
            </span>
            <span>
              <T c={c}>“Squat increased:</T>{" "}
              <span className="w-hl" {...b("glow", 4200)}>
                <T c={c}>two easy sessions</T>
              </span>{" "}
              <T c={c}>in a row.”</T>
            </span>
          </div>
        </div>
      </div>
    ),
  },
  // 3. Test it: held-out scenarios, evaluated; the expected handoff counts
  // as a pass. The subscriber's Today card comes from the evaluated release.
  {
    tab: ["Scenario lab"],
    coach: (c) => (
      <div className="w-pane">
        <ul className="w-list">
          {[
            ["A confident progression", 1100],
            ["A missed session", 1300],
          ].map(([name, at], i) => (
            <li key={i} {...b("rise", 300 + i * 80)}>
              <T c={c}>{name as string}</T>
              <Tick at={at as number} />
            </li>
          ))}
          <li {...b("rise", 460)}>
            <T c={c}>Outside what it was taught</T>
            <Badge c={c} tone="n" beat={b("stamp", 1500)}>
              Handed to you
            </Badge>
          </li>
        </ul>
        <span className="w-row" {...b("rise", 540)}>
          <span className="w-btn w-pri" {...b("tap", 900)}>
            <T c={c}>Evaluate</T>
          </span>
          <Badge c={c} tone="g" beat={b("pop", 1850)}>
            Passed
          </Badge>
        </span>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} />
        <div className="w-card">
          <div className="w-stack">
            <span className="w-skel" {...b("xout", 3000)}>
              <Ph w={11} />
            </span>
            <span className="w-row" {...b("xin", 3000)}>
              <strong>
                <T c={c}>Today · Lower body, 45 min</T>
              </strong>
              <Tick at={3600} />
            </span>
          </div>
          <span className="w-row w-line" {...b("rise", 3300)}>
            <T c={c}>Next week · Squat +2.5 kg</T>
            <Tick at={3720} />
          </span>
        </div>
      </div>
    ),
  },
  // 4. Create your offer: price (never a number), length, billing, trial
  // and the optional extras that are available now.
  {
    tab: ["Your offer"],
    coach: (c) => (
      <div className="w-pane w-form">
        <span className="w-row" {...b("rise", 300)}>
          <span className="w-lab">
            <T c={c}>Price</T>
          </span>
          <span className="w-val">
            <T c={c}>AED</T> <Ph />
          </span>
        </span>
        <span className="w-row" {...b("rise", 380)}>
          <span className="w-lab">
            <T c={c}>Programme length</T>
          </span>
          <span className="w-val">
            <Ph />
          </span>
        </span>
        <span className="w-row">
          <span className="w-lab">
            <T c={c}>Billing</T>
          </span>
          <span className="w-seg2">
            <i className="w-pill" {...b("slide", 800)} />
            <span>
              <T c={c}>Upfront</T>
            </span>
            <span>
              <T c={c}>Monthly</T>
            </span>
          </span>
        </span>
        <span className="w-row">
          <span className="w-lab">
            <T c={c}>Free trial</T>
          </span>
          <span className="w-toggle">
            <i className="w-on" {...b("xin", 1300)} />
            <i className="w-knob" {...b("slide", 1300)} />
          </span>
        </span>
        {c.nutrition && (
          <span className="w-row" {...b("rise", 1700)}>
            <span className="w-lab">
              <T c={c}>Nutrition tier</T>
            </span>
            <Badge c={c} tone="g">
              {c.nutrition}
            </Badge>
          </span>
        )}
        {c.voice && (
          <span className="w-row" {...b("rise", 1780)}>
            <span className="w-lab">
              <T c={c}>Voice add-on</T>
            </span>
            <Badge c={c} tone="g">
              {c.voice}
            </Badge>
          </span>
        )}
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} />
        <div className="w-card" {...b("card", 3000)}>
          <strong>
            <T c={c}>Membership</T>
          </strong>
          <span className="w-row" {...b("rise", 3300)}>
            <span>
              <T c={c}>AED</T> <Ph w={3} />
            </span>
            <span className="w-m">
              <T c={c}>Monthly</T>
            </span>
          </span>
          <Badge c={c} tone="n" beat={b("stamp", 3300)}>
            Free trial
          </Badge>
          <span className="w-cta" {...b("rise", 3600)}>
            <T c={c}>Join</T>
          </span>
        </div>
      </div>
    ),
  },
  // 5. Publish and share: the preview, the launch checks, Live, then the
  // link in the bio and Stories. A follower opens it (the address bar shows
  // it), joins, pays and answers the intake.
  {
    tab: ["Subscriber preview", "Publish"],
    coach: (c) => (
      <div className="w-pane">
        <div className="w-split">
          <span className="w-mini" {...b("rise", 300)}>
            <i className="w-mini-head" />
            <Ph w={2.4} />
            <Ph w={3} />
          </span>
          <div className="w-pane">
            <ul className="w-checks">
              {["Product", "Coaching", "Legal", "Payout"].map((name, i) => (
                <li key={name}>
                  <Tick at={400 + i * 120} />
                  <T c={c}>{name}</T>
                </li>
              ))}
            </ul>
            <span className="w-row">
              <span className="w-btn w-pri" {...b("tap", 1100)}>
                <T c={c}>Publish</T>
              </span>
              <span className="w-live" {...b("pop", 1250)}>
                <T c={c}>Live</T>
              </span>
            </span>
          </div>
        </div>
        <div className="w-f" {...b("rise", 1600)}>
          <span className="w-lab">
            <T c={c}>Share your link</T>
          </span>
          <span className="w-row w-wrap">
            <span className="w-addr" dir="ltr">
              <T c={c}>{c.address}</T>
            </span>
            <Badge c={c} tone="n" beat={b("rise", 1680)}>
              Bio
            </Badge>
            <Badge c={c} tone="n" beat={b("rise", 1760)}>
              Stories
            </Badge>
          </span>
        </div>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane w-layers">
        <div className="w-layer w-profile" {...b("temp", 3000, 3400)}>
          <i className="w-av w-blank" />
          <Ph w={8} />
          <Ph w={11} />
          <span className="w-link" dir="ltr">
            <span {...b("tap", 3200)}>
              <T c={c}>{c.address}</T>
            </span>
          </span>
        </div>
        <div className="w-layer" {...b("rise", 3400)}>
          <span className="w-url" dir="ltr">
            <T c={c}>{c.address}</T>
          </span>
          <AppHead c={c} />
          <div className="w-card">
            <strong>
              <T c={c}>Membership</T>
            </strong>
            <span className="w-cta" {...b("tap", 3600)}>
              <T c={c}>Join</T>
            </span>
          </div>
        </div>
        <div className="w-card w-sheet" {...b("temp", 3700, 4250)}>
          <strong>
            <T c={c}>Card</T>
          </strong>
          <span>
            <T c={c}>AED</T> <Ph w={3} />
          </span>
          <span className="w-cta" {...b("tap", 4050)}>
            <T c={c}>Pay</T>
          </span>
        </div>
        <ul className="w-card w-sheet w-chips" {...b("rise", 4250)}>
          {["Goal", "Schedule", "Experience", "Equipment"].map((name, i) => (
            <li key={name} {...b("stamp", 4300 + i * 100)}>
              <T c={c}>{name}</T>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  // 6. It coaches daily: confident changes apply automatically; the
  // subscriber trains; pain pauses the workout and comes to the coach.
  {
    tab: ["Exceptions"],
    coach: (c) => (
      <div className="w-pane">
        <ul className="w-list w-items">
          <li {...b("rise", 300)}>
            <Badge c={c} tone="g" beat={b("pop", 360)}>
              Applied automatically
            </Badge>
            <T c={c}>Squat 60 → 62.5 kg</T>
          </li>
          <li {...b("rise", 900)}>
            <Badge c={c} tone="g" beat={b("pop", 960)}>
              Rescheduled automatically
            </Badge>
            <T c={c}>Missed Tuesday · moved to Thursday</T>
          </li>
          <li {...b("rise", 4550)}>
            <Badge c={c} tone="r" beat={b("stamp", 4610)}>
              Safety hold
            </Badge>
            <T c={c}>“My knee hurts when I squat”</T>
          </li>
        </ul>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} />
        <div {...b("rise", 2250)}>
          <strong>
            <T c={c}>Today</T>
          </strong>
          <span className="w-m w-block">
            <T c={c}>Week 3 · Day 2 · Lower body A</T>
          </span>
        </div>
        <div className="w-card" {...b("card", 2320)}>
          <strong>
            <T c={c}>Back squat · set 3 of 4</T>
          </strong>
          <span className="w-sets">
            <span className="w-pane">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-row w-set"
                  {...b("rise", 2400 + i * 80)}
                >
                  {i < 2 ? (
                    <>
                      <Ph w={4} />
                      <Tick at={2650 + i * 120} />
                    </>
                  ) : (
                    // The set in progress.
                    <span className="w-hl w-grow" {...b("glow", 2650)}>
                      <Ph w={5} />
                    </span>
                  )}
                </span>
              ))}
            </span>
            <svg className="w-ring" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" pathLength={1} />
              <circle
                className="w-ring-on"
                cx="12"
                cy="12"
                r="10"
                pathLength={1}
                {...b("draw", 2650)}
              />
            </svg>
          </span>
        </div>
        <span className="w-row" {...b("rise", 2760)}>
          <span className="w-btn" {...b("tap", 3500)}>
            <T c={c}>Report pain</T>
          </span>
          <Badge c={c} tone="a" beat={b("stamp", 3700)}>
            Workout paused
          </Badge>
        </span>
      </div>
    ),
  },
  // 7. You correct, it learns: below the coach's threshold, it asks; the
  // approval becomes teaching and reaches the subscriber.
  {
    tab: ["Exceptions"],
    coach: (c) => (
      <div className="w-pane">
        <div className="w-card" {...b("card", 1800)}>
          <Badge c={c} tone="a">
            Below your threshold
          </Badge>
          <strong>
            <T c={c}>Hotel gym for two weeks</T>
          </strong>
          <span className="w-m">
            <T c={c}>Draft plan with dumbbells to 20 kg. Approve or correct.</T>
          </span>
          <span className="w-acts">
            <span className="w-btn w-pri" {...b("tap", 2300)}>
              <T c={c}>Approve</T>
            </span>
            <span className="w-btn">
              <T c={c}>Correct</T>
            </span>
          </span>
          <span className="w-row">
            <Badge c={c} tone="g" beat={b("pop", 2440)}>
              Approved
            </Badge>
            <span className="w-new" {...b("rise", 2800)}>
              <T c={c}>New teaching</T>
            </span>
          </span>
        </div>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} />
        <p className="w-bub w-me" {...b("rise", 300)}>
          <T c={c}>“I’m travelling for two weeks with only a hotel gym.”</T>
        </p>
        <div className="w-stack">
          <Badge c={c} tone="n" beat={b("temp", 800, 3950)}>
            Handed to the trainer
          </Badge>
          <Badge c={c} tone="g" beat={b("xin", 3950)}>
            Approved
          </Badge>
        </div>
        <span className="w-row w-line" {...b("rise", 3950)}>
          <T c={c}>Hotel gym for two weeks</T>
          <Tick at={4150} />
        </span>
      </div>
    ),
  },
  // 8. Get paid monthly: the subscriber's membership is paid; the coach's
  // statement rows (placeholders, no amounts, no total) and the payout.
  {
    tab: ["Monthly statement"],
    coach: (c) => (
      <div className="w-pane">
        <ul className="w-list w-stmt">
          {[
            "Gross subscriptions",
            "Commission by band",
            "Payment processing",
          ].map((name, i) => (
            <li key={name} {...b("rise", 1600 + i * 80)}>
              <T c={c}>{name}</T>
              <Ph w={3.5} />
            </li>
          ))}
        </ul>
        <span className="w-row w-line" {...b("rise", 2200)}>
          <T c={c}>Paid monthly to your UAE IBAN</T>
          <Tick at={2380} />
        </span>
      </div>
    ),
    phone: (c) => (
      <div className="w-pane">
        <AppHead c={c} />
        <div className="w-card" {...b("card", 300)}>
          <strong>
            <T c={c}>Membership</T>
          </strong>
          <span className="w-row">
            <span>
              <T c={c}>AED</T> <Ph w={3} />
            </span>
            <span className="w-m">
              <T c={c}>Monthly</T>
            </span>
          </span>
          <Badge c={c} tone="g" beat={b("pop", 580)}>
            Paid
          </Badge>
        </div>
      </div>
    ),
  },
];

/** The shared stage: laptop, wire and phone, with the eight scenes stacked. */
function Stage({ c, platform }: { c: Ctx; platform: PublicPlatform }) {
  const scenes = (side: "coach" | "phone") =>
    SCENES.map((scene, i) => (
      <div key={i} className="w-s" data-s={i + 1}>
        {scene[side](c)}
      </div>
    ));
  return (
    <div className="mk-walk-stage" aria-hidden="true">
      {c.l && <p className="w-tag">Illustration with sample data</p>}
      {/* Phones show one side at a time; the strip names both (the "Who
          does what" column headers) and marks the one on screen. */}
      <span className="w-chip w-cc">
        <i className="w-fill w-c" />
        <Laptop size={16} />
        {c.l && <span className="w-who-l">You</span>}
      </span>
      <div className="w-frame w-coach w-c">
        <div className="w-dev">
          <div className="w-bar">
            <span className="mk-browser-dots">
              <span />
              <span />
              <span />
            </span>
            {c.l ? <CoreMark platform={platform} /> : <i className="w-mk" />}
            <span className="w-tab">
              {SCENES.map((scene, i) => (
                <span key={i} className="w-s" data-s={i + 1}>
                  {scene.tab.length > 1 ? (
                    <span className="w-stack">
                      <span {...b("xout", 1000)}>
                        <T c={c}>{scene.tab[0]}</T>
                      </span>
                      <span {...b("xin", 1000)}>
                        <T c={c}>{scene.tab[1]}</T>
                      </span>
                    </span>
                  ) : (
                    <T c={c}>{scene.tab[0]}</T>
                  )}
                </span>
              ))}
            </span>
          </div>
          <div className="w-scr">{scenes("coach")}</div>
        </div>
      </div>
      <div className="w-wire">
        <span className="w-go">
          <i className="w-trail" />
          <i className="w-dot" />
        </span>
        <span className="w-ret">
          <i className="w-trail" />
          <i className="w-dot" />
        </span>
      </div>
      <span className="w-chip w-pc">
        <i className="w-fill w-p" />
        <Smartphone size={16} />
        {c.l && <span className="w-who-l">Your subscriber</span>}
      </span>
      <div className="w-frame w-phone w-p">
        <div className="w-dev">
          <div className="w-stat">
            <i className="w-notch" />
            <Signal size={10} />
            <Wifi size={10} />
            <BatteryFull size={12} />
          </div>
          <div className="w-scr">{scenes("phone")}</div>
        </div>
      </div>
    </div>
  );
}

function context(platform: PublicPlatform, labels: boolean): Ctx {
  const offering = (path: string) => {
    const chip = availabilityChip(marketingPage(path), platform.availability);
    return chip && !chip.soon ? chip.label : null;
  };
  return {
    l: labels,
    address: platform.coachAddressTemplate
      .replace(/^https?:\/\//, "")
      .replace("{slug}", "layla-strength"),
    nutrition: offering("/features/nutrition"),
    voice: offering("/features/voice-coach"),
  };
}

/**
 * "Your subscriber" (the "Who does what" column header) before a chapter's
 * subscriber line: visible, so every step states what it means for the
 * subscriber.
 */
function SubscriberLabel() {
  return (
    <span className="mk-walk-sub-label">
      <Smartphone size={14} aria-hidden="true" />
      Your subscriber<span className="sr-only">:</span>
    </span>
  );
}

/**
 * /how-it-works: the full player in place of the plain steps section. The
 * same h2 and `ol.mk-steps` (with the registry text unchanged), plus one
 * subscriber line per step.
 */
export function Journey({
  section,
  platform,
  t,
}: {
  section: MarketingSection;
  platform: PublicPlatform;
  t: (s: string) => string;
}) {
  const steps = section.steps ?? [];
  const id = section.id;
  return (
    <section
      className="mk-section mk-walk-section"
      id={id}
      aria-labelledby={id + "-h"}
    >
      <h2 id={id + "-h"}>{t(section.heading)}</h2>
      <JourneyPlayer
        variant="full"
        groupLabel={id + "-h"}
        titles={steps.map((s) => t(s.title))}
        stepIds={id}
        timing={JOURNEY_TIMING}
        stage={<Stage c={context(platform, true)} platform={platform} />}
        captions={
          <div className="mk-walk-steps">
            <ol className="mk-steps">
              {steps.map((s, i) => (
                <li key={s.title} data-step={i + 1}>
                  <span
                    className="mk-step-number"
                    id={`${id}-n${i + 1}`}
                    aria-hidden="true"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 id={`${id}-t${i + 1}`}>{t(s.title)}</h3>
                    <p>{t(s.body)}</p>
                    {SUBSCRIBER_LINES[i] && (
                      <p className="mk-walk-sub">
                        <SubscriberLabel />{" "}
                        <span>{t(registryLine(SUBSCRIBER_LINES[i]))}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        }
      />
    </section>
  );
}

/**
 * The home band: the same stage without words, the active step's title and
 * what it means for the subscriber (the same registry line /how-it-works
 * shows), the controls and the link to the full walkthrough. No heading
 * (the home page keeps its six H2s); the existing section heading is its
 * label.
 */
export function JourneyBand({
  platform,
  t,
}: {
  platform: PublicPlatform;
  t: (s: string) => string;
}) {
  const section = marketingPage("/how-it-works")!.sections.find(
    (s) => s.id === "steps",
  )!;
  return (
    <section
      className="mk-home-band mk-home-paper mk-walk-band"
      aria-labelledby="mk-walk-label"
    >
      <div className="mk-container">
        <JourneyPlayer
          variant="compact"
          groupLabel="mk-walk-label"
          titles={(section.steps ?? []).map((s) => t(s.title))}
          timing={JOURNEY_TIMING}
          head={
            <p className="small-label mk-walk-label" id="mk-walk-label">
              {t(section.heading)}
            </p>
          }
          stage={<Stage c={context(platform, false)} platform={platform} />}
          subs={SUBSCRIBER_LINES.map((ref) => t(registryLine(ref)))}
          subLabel={<SubscriberLabel />}
          foot={
            <p className="mk-home-more mk-walk-more">
              <Link className="text-link mk-link" href="/how-it-works#steps">
                See how it works <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </p>
          }
        />
      </div>
    </section>
  );
}
