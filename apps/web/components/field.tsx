"use client";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
} from "react";

/** Keep the visible label independent of select options and saved textarea text. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {Children.map(children, (child) => {
        if (
          !isValidElement<Record<string, unknown>>(child) ||
          typeof child.type !== "string" ||
          !["input", "select", "textarea"].includes(child.type) ||
          child.props["aria-label"] ||
          child.props["aria-labelledby"]
        )
          return child;
        return cloneElement(child, { "aria-labelledby": labelId });
      })}
    </label>
  );
}
