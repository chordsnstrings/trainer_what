"use client";
import { useState } from "react";

type Source = { id: string; data: { title?: string; text?: string } };
type Coverage = {
  sourceCount: number;
  includedCharacters: number;
  notice: string;
};

export function SourceCompilation({
  sources,
  busy,
  onCompile,
  previous,
}: {
  sources: Source[];
  busy: boolean;
  onCompile: (
    ids: string[],
  ) => Promise<{ coverage?: Coverage } | null | undefined>;
  previous?: Coverage;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<Coverage | undefined>();
  const included = sources.filter((source) => selected.includes(source.id));
  const characters = included.reduce(
    (sum, source) => sum + (source.data.text?.length ?? 0),
    0,
  );
  const overLimit =
    characters > 120000 ||
    included.some((source) => (source.data.text?.length ?? 0) > 60000);
  const observed = coverage ?? previous;
  return (
    <>
      <p className="muted">
        Choose up to 20 sources and 120,000 characters for this compilation.
        Each source can contain up to 60,000 characters. Every selected
        character is included.
      </p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted">Sources to include</legend>
        {sources.map((source) => (
          <label className="check-field" key={source.id}>
            <input
              type="checkbox"
              checked={selected.includes(source.id)}
              disabled={!selected.includes(source.id) && included.length >= 20}
              onChange={(event) =>
                setSelected((ids) =>
                  event.target.checked
                    ? [...ids, source.id]
                    : ids.filter((id) => id !== source.id),
                )
              }
            />
            <span>
              {source.data.title ?? "Teaching source"}{" "}
              <small className="muted">
                · {(source.data.text?.length ?? 0).toLocaleString()} characters
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <p>
        {included.length} sources · {characters.toLocaleString()} characters
        selected
      </p>
      {overLimit && (
        <p role="status" className="notice">
          Choose a smaller selection or add focused excerpts. No source will be
          shortened automatically.
        </p>
      )}
      <button
        className="button"
        disabled={busy || !included.length || overLimit}
        onClick={async () => {
          const result = await onCompile(included.map((source) => source.id));
          if (result?.coverage) setCoverage(result.coverage);
        }}
      >
        Compile selected draft rules
      </button>
      {observed && (
        <p role="status" className="notice">
          Compilation input: {observed.sourceCount} sources and{" "}
          {observed.includedCharacters.toLocaleString()} characters.{" "}
          {observed.notice}
        </p>
      )}
    </>
  );
}
