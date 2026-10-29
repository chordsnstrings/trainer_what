// A Brain showcase (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.2): the
// server-rendered first frame in a host that React owns but never looks
// inside (the engine owns its content), and the island that loads the engine.
// Host and island sit in one fragment keyed by the hash of the HTML: a
// changed payload (a flag flipped inside the platform cache, then a link to
// the same page) replaces both. Static mode renders the frame alone.
import { Fragment } from "react";
import { ShowcaseMount } from "./mount";
import { fnv1a, renderShowcase } from "./render";
import type {
  ShowcaseKind,
  ShowcaseMode,
  ShowcaseOptions,
} from "./engine/types";

export function BrainShowcase({
  kind,
  id,
  label,
  options,
  mode,
}: {
  kind: ShowcaseKind;
  /** The host's id; every inner id starts with it. */
  id: string;
  /** The root's accessible name when no H2 labels it (options.labelledBy). */
  label: string;
  options: ShowcaseOptions;
  mode: ShowcaseMode;
}) {
  const html = renderShowcase(kind, { ...options, kind, id, label }, mode);
  const key = fnv1a(html);
  return (
    <Fragment key={key}>
      <div
        id={id}
        className="sc-host"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {mode === "live" && (
        <ShowcaseMount id={id} kind={kind} options={options} />
      )}
    </Fragment>
  );
}
