// Who is inside a trainer's AI (/trainer-brain "inside";
// docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP5): every specialist of
// the Brain traces, by crew, with what it does and whether it runs today.
// The names, lines and statuses are the data the showcases play, through the
// same prepare(), so a status follows the platform's flags exactly as it does
// in the playground. Server only: it imports the engine's pure data module
// and the client traces, never a runtime module or a stylesheet
// (tests/marketing-showcase.test.ts walks the imports). Each crew's heading
// and line come from the registry; "See it work" plays the specialist's
// moment in the playground on the same page (a[data-run], brain/mount.tsx).
// Styles: app/marketing-brain-pages.css (.mk-tb-).
import { ArrowRight } from "lucide-react";
import raw from "./data/traces.client.json";
import { prepare } from "./engine/data.js";
import type {
  BrainData,
  RawBrainData,
  ShowcaseOptions,
  Specialist,
} from "./engine/types";

const TRACES = raw as unknown as RawBrainData;

/** A crew's heading and line, from the registry's cards (Coach, Teach, Guard). */
export type Crew = {
  id: Specialist["crew"];
  title: string;
  label?: string;
  body: string;
};

/**
 * The moment that shows each specialist at work: the playground chip
 * "See it work" presses (concept A's roster). Specialists that are not on
 * yet have no moment to show.
 */
export const SHOWS: Readonly<Record<string, string>> = {
  reply_picker: "t1",
  draft_writer: "t7",
  plan_writer: "t10",
  week_reviewer: "t8",
  meal_photo: "t4",
  voice_lines: "t5",
  learner: "t7",
  examiner: "t7",
  safety: "t2",
  topics: "t9",
  memory: "t1",
  rule_finder: "t1",
  checker: "t1",
  confidence: "t8",
  lane_gate: "t6",
  set_logger: "t5",
  today: "t7",
};
/** The line under a status: the specialist's own tip, or why it waits. */
function tip(d: BrainData, s: Specialist) {
  if (s.status === "not_on_yet")
    return "Built and tested. Not switched on yet.";
  return (
    s.statusTip ??
    (s.status === "live"
      ? ""
      : (d.labels.statusTip as { default: string }).default)
  );
}
/** Its status as the house chips show one: live, try it on yourself, not on yet. */
const CHIP: Record<Specialist["status"], string> = {
  live: "mk-pf-chip mk-pf-live",
  try_yourself: "mk-pf-chip mk-pf-estimate",
  not_on_yet: "mk-pf-chip mk-pf-soon",
};

/**
 * Every specialist by crew, as cards. `play` is the id of the band that
 * holds the playground on the same page: "See it work" leads there, under
 * its heading, and the playground plays the moment; `howWeCount` is the
 * registry's note, shown as a disclosure.
 */
export function Roster({
  crews,
  options,
  play,
  howWeCount,
}: {
  crews: Crew[];
  options: Pick<ShowcaseOptions, "appName" | "flags">;
  play: string;
  howWeCount: string;
}) {
  const d = prepare(TRACES, options);
  const kind = d.labels.kind as Record<Specialist["kind"], string>;
  const status = d.labels.status as Record<Specialist["status"], string>;
  return (
    <>
      <div className="mk-tb-row">
        <p className="mk-tb-mono">{String(d.labels.picks)}</p>
        <details>
          <summary>How we count</summary>
          <p>{howWeCount}</p>
        </details>
      </div>
      {crews.map((crew) => {
        const members = d.specialists.filter((s) => s.crew === crew.id);
        if (!members.length)
          throw new Error(`Roster: no specialist in the "${crew.id}" crew`);
        // A crew is a group under the band's region, not a region of its
        // own: its H3 names it for heading navigation.
        return (
          <div key={crew.id} className="mk-tb-stack mk-tb-crew">
            <h3 id={"crew-" + crew.id}>
              {crew.title}
              {crew.label && ` · ${crew.label}`}
            </h3>
            <p>{crew.body}</p>
            <ul className="mk-cards">
              {members.map((s) => {
                // "See it work" plays a moment that runs under the page's
                // flags (its status as the playground reads it): with the AI
                // model off, Memory's moment (Omar's reply) is not on yet,
                // so Memory shows no link.
                const show = SHOWS[s.id];
                const run =
                  s.status !== "not_on_yet" && show && d.trace(show).status !== "not_on_yet" ? show : undefined;
                const line = tip(d, s);
                // Shape tells the kind apart, as on the showcases' nodes:
                // round for an AI specialist, square for code.
                return (
                  <li
                    key={s.id}
                    className="mk-tb-box"
                    data-kind={s.kind}
                    data-off={s.status === "not_on_yet" ? "" : undefined}
                  >
                    <p>
                      <b>{s.name}</b>
                      {s.usesAi && <small> · uses your AI</small>}
                    </p>
                    <p className="mk-tb-mono">{kind[s.kind]}</p>
                    <p>{s.line}</p>
                    <p>
                      <span className={CHIP[s.status]}>{status[s.status]}</span>
                    </p>
                    {line && <small>{line}</small>}
                    {run && (
                      <a
                        className="text-link mk-link"
                        href={"#" + play}
                        data-run={run}
                      >
                        See it work <ArrowRight size={14} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {d.labels.subscribers && (
        <p className="mk-tb-mono">{d.labels.subscribers}</p>
      )}
    </>
  );
}
