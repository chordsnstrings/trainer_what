"use client";
/**
 * Phone-first building blocks for every subscriber surface (member app,
 * joining, coach website forms). See docs/features/phone-first.md for the
 * contract each piece keeps; the styles are in app/phone-first.css.
 *
 * - StickyActionBar: the screen's primary action in thumb reach, above the
 *   bottom tab bar, the on-screen keyboard and the home indicator.
 * - BottomSheet: a modal sheet from the bottom edge on phones (a centred
 *   dialog on larger screens) with a focus trap, Escape and a close button.
 * - FileInput: a styled file chooser in place of the browser's
 *   "Choose File / No file chosen" control.
 * - NumberStepper: a numeric field with large minus and plus buttons for
 *   reps, weight and other small numbers.
 * - ResponsiveTable: stacked cards on phones, a contained scroll with a
 *   visible cue from 768 px, in either reading direction.
 * - ScrollTabs: tabs that scroll sideways on phones instead of wrapping.
 * - Toast, Skeleton, DrawnCheck, ProgressRing, CountUp, Meter: small pieces
 *   whose movement follows docs/features/motion.md.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Minus, Paperclip, Plus, X } from "lucide-react";
import { useT } from "../lib/i18n/react";
import {
  EASE,
  MOTION,
  countUp,
  playArrival,
  playMotion,
  prefersReducedMotion,
  ringKeyframes,
  rollOutKeyframes,
  tickKeyframes,
  useMeterMotion,
  useMotionOnChange,
  whenFirstInView,
} from "./motion";

/* ------------------------------------------------------------------ */
/* Bottom insets                                                        */
/* ------------------------------------------------------------------ */

/**
 * Fixed member UI publishes its size on <html> so any other fixed piece can
 * sit above it (app/phone-first.css defines the defaults):
 *   --member-tabbar-height     bottom tab bar, 0 from 1024 px or while typing
 *   --member-action-bar-height a mounted StickyActionBar, else 0
 *   --member-keyboard-inset    how far the on-screen keyboard overlaps
 *   --member-bottom-inset      their sum: use it for `bottom:` and padding.
 * `data-keyboard="open"` on <html> marks an open on-screen keyboard.
 */
export const BOTTOM_INSET_VARIABLE = "--member-bottom-inset";

let keyboardWatchers = 0;
let stopKeyboardWatch: (() => void) | null = null;

/** The on-screen keyboard's overlap of the layout viewport, in CSS pixels. */
export function keyboardOverlap(view: {
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
  scale: number;
}) {
  // Pinch zoom shrinks the visual viewport too; that is not a keyboard.
  if (view.scale > 1.01) return 0;
  const overlap = Math.round(
    view.innerHeight - view.visualHeight - view.offsetTop,
  );
  // Browser toolbars collapsing and expanding move less than this.
  return overlap > 120 ? overlap : 0;
}

function startKeyboardWatch() {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const overlap = keyboardOverlap({
        innerHeight: window.innerHeight,
        visualHeight: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
      });
      if (overlap) {
        root.style.setProperty("--member-keyboard-inset", overlap + "px");
        root.dataset.keyboard = "open";
      } else {
        root.style.removeProperty("--member-keyboard-inset");
        delete root.dataset.keyboard;
      }
    });
  };
  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  return () => {
    cancelAnimationFrame(frame);
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    root.style.removeProperty("--member-keyboard-inset");
    delete root.dataset.keyboard;
  };
}

/**
 * Keeps --member-keyboard-inset and data-keyboard current while mounted.
 * Shared: the member shell and every StickyActionBar may call it.
 */
export function useKeyboardInset() {
  useEffect(() => {
    if (keyboardWatchers++ === 0) stopKeyboardWatch = startKeyboardWatch();
    return () => {
      if (--keyboardWatchers === 0) {
        stopKeyboardWatch?.();
        stopKeyboardWatch = null;
      }
    };
  }, []);
}

/* ------------------------------------------------------------------ */
/* StickyActionBar                                                      */
/* ------------------------------------------------------------------ */

/**
 * The screen's main action, fixed in thumb reach above the tab bar (and the
 * keyboard while typing). Its height is published as
 * --member-action-bar-height, so page content and other fixed UI stay clear.
 * Put the primary button last; safety controls may sit beside it.
 */
export function StickyActionBar({
  children,
  label,
  note,
}: {
  children: ReactNode;
  /** Names the region for assistive technology, e.g. "Workout actions". */
  label: string;
  /** One short line above the buttons, e.g. why an action is unavailable. */
  note?: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useKeyboardInset();
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty(
        "--member-action-bar-height",
        Math.ceil(el.getBoundingClientRect().height) + "px",
      );
    publish();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    root.dataset.actionBar = "on";
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--member-action-bar-height");
      delete root.dataset.actionBar;
    };
  }, []);
  return (
    <div
      ref={bar}
      className="sticky-action-bar"
      role="region"
      aria-label={label}
    >
      {note && <p className="sticky-action-note">{note}</p>}
      <div className="sticky-action-buttons">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BottomSheet                                                          */
/* ------------------------------------------------------------------ */

/**
 * A modal sheet. Phones: slides up from the bottom edge, full width, above
 * the home indicator. From 768 px: a centred dialog. The native modal
 * <dialog> makes the page behind it inert (focus stays inside), Escape and
 * the close button call onClose, and focus returns to the control that
 * opened it. Mark the field that should take focus with data-autofocus.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Actions pinned to the bottom of the sheet (primary last). */
  footer?: ReactNode;
  closeLabel?: string;
}) {
  const common = useT("common");
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null),
    close = useRef(onClose),
    closing = useRef<number | null>(null);
  close.current = onClose;
  const titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open) {
      // Opened again while it was sliding away: open it properly again
      // (it was left as a plain, non-modal dialog for the slide).
      if (closing.current != null) {
        window.clearTimeout(closing.current);
        closing.current = null;
        delete el.dataset.closing;
        if (typeof el.close === "function") el.close();
      }
      if (el.open) return;
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      const first = el.querySelector<HTMLElement>("[data-autofocus]");
      first?.focus();
    } else if (el.open && closing.current == null) {
      const shut = () => {
        if (typeof el.close === "function") el.close();
        else el.removeAttribute("open");
      };
      if (prefersReducedMotion() || typeof el.show !== "function") {
        shut();
        opener.current?.focus?.();
        return;
      }
      // The page works again at once: the modal closes now, and the sheet
      // slides away as a plain (non-modal, untappable) dialog on top, so
      // no tap is swallowed while it goes (motion.css "e").
      shut();
      el.dataset.closing = "";
      el.show();
      opener.current?.focus?.();
      closing.current = window.setTimeout(() => {
        closing.current = null;
        delete el.dataset.closing;
        shut();
      }, MOTION.base + 40);
    }
  }, [open]);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Escape: keep the dialog under React's control.
    const cancel = (event: Event) => {
      event.preventDefault();
      close.current();
    };
    el.addEventListener("cancel", cancel);
    return () => el.removeEventListener("cancel", cancel);
  }, []);
  // Close on unmount so a navigation never leaves the page inert.
  useEffect(
    () => () => {
      if (closing.current != null) window.clearTimeout(closing.current);
      const el = dialog.current;
      if (el?.open && typeof el.close === "function") el.close();
    },
    [],
  );
  return (
    <dialog
      ref={dialog}
      className="bottom-sheet"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        // A tap on the dimmed backdrop (the dialog box itself) closes it.
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div className="bottom-sheet-panel">
        <span className="bottom-sheet-handle" aria-hidden="true" />
        <div className="bottom-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button bottom-sheet-close"
            aria-label={closeLabel ?? common("close")}
            onClick={() => close.current()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {description && (
          <div className="bottom-sheet-description" id={descriptionId}>
            {description}
          </div>
        )}
        <div className="bottom-sheet-body">{children}</div>
        {footer && <div className="bottom-sheet-footer">{footer}</div>}
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/* FileInput                                                            */
/* ------------------------------------------------------------------ */

/**
 * A styled file chooser. The native input stays in the page (visually
 * hidden, focusable, operable with Enter or Space), so forms and assistive
 * technology keep working; the visible button is its label.
 */
export function FileInput({
  label,
  hint,
  buttonLabel,
  accept,
  multiple = false,
  capture,
  disabled = false,
  disabledReason,
  name,
  onFiles,
  emptyText,
  clearAfterChoose = true,
}: {
  label: string;
  hint?: ReactNode;
  buttonLabel?: string;
  accept?: string;
  multiple?: boolean;
  capture?: "user" | "environment";
  disabled?: boolean;
  /** Shown beside the control while it is disabled. */
  disabledReason?: ReactNode;
  name?: string;
  onFiles: (files: File[]) => void;
  emptyText?: string;
  /** Clears the native selection so choosing the same file again works. */
  clearAfterChoose?: boolean;
}) {
  const common = useT("common");
  const inputId = useId(),
    labelId = useId(),
    hintId = useId(),
    statusId = useId();
  const [chosen, setChosen] = useState<string[]>([]);
  // The chosen file names fade in under the button.
  const status = useRef<HTMLParagraphElement>(null);
  useMotionOnChange(
    status,
    chosen.join("\n"),
    [
      { opacity: 0, transform: "translateY(-4px)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: MOTION.base, easing: EASE.out },
  );
  return (
    <div className={"file-input" + (disabled ? " is-disabled" : "")}>
      <span className="file-input-label" id={labelId}>
        {label}
      </span>
      {hint && (
        <p className="file-input-hint" id={hintId}>
          {hint}
        </p>
      )}
      <span className="file-input-control">
        {/* Transparent and laid over the button, so a tap lands on the
            real input and its target is the button's full size. */}
        <input
          id={inputId}
          className="file-input-native"
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          capture={capture}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={[hint ? hintId : "", statusId].join(" ").trim()}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setChosen(files.map((file) => file.name));
            if (clearAfterChoose) event.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
        <span className="button secondary file-input-button" aria-hidden="true">
          <Paperclip size={18} aria-hidden="true" />
          <span>{buttonLabel ?? common("chooseFile")}</span>
        </span>
      </span>
      <p
        className="file-input-status"
        id={statusId}
        aria-live="polite"
        ref={status}
      >
        {chosen.length ? chosen.join(", ") : (emptyText ?? common("noFileYet"))}
      </p>
      {disabled && disabledReason && (
        <p className="control-reason">{disabledReason}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NumberStepper                                                        */
/* ------------------------------------------------------------------ */

function decimals(step: number) {
  const text = String(step);
  return text.includes(".") ? text.split(".")[1].length : 0;
}
/** Parses what someone typed ("12,5" or "12.5") as a number, or null. */
export function parseStepperValue(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!cleaned || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
/** One press of minus (-1) or plus (+1), kept inside [min, max]. */
export function stepValue(
  current: number | null,
  direction: 1 | -1,
  {
    min = 0,
    max = Infinity,
    step = 1,
  }: { min?: number; max?: number; step?: number },
) {
  const base = current ?? min;
  const next = Math.round((base + direction * step) / step) * step;
  const clamped = Math.min(max, Math.max(min, next));
  return Number(clamped.toFixed(decimals(step)));
}

/**
 * A number field with minus and plus buttons of at least 44 px. The input
 * is text with a numeric keyboard (inputmode), wide enough for "102.5", and
 * carries `name` so a surrounding form reads it with FormData.
 */
export function NumberStepper({
  label,
  name,
  defaultValue,
  min = 0,
  max,
  step = 1,
  unit,
  decimal = false,
  disabled = false,
  inputLabel,
  enterKeyHint = "next",
  onValueChange,
}: {
  /** The visible label, e.g. "Reps". */
  label: string;
  name?: string;
  defaultValue?: number | null;
  min?: number;
  max?: number;
  step?: number;
  /** A short unit shown inside the field, e.g. "kg". */
  unit?: string;
  /** Allow a decimal value (weight); otherwise whole numbers (reps). */
  decimal?: boolean;
  disabled?: boolean;
  /** A fuller accessible name, e.g. "Goblet squat set 1 reps". */
  inputLabel?: string;
  enterKeyHint?: "next" | "done" | "go" | "send";
  onValueChange?: (value: number | null) => void;
}) {
  const common = useT("common");
  const [text, setText] = useState(
    defaultValue == null ? "" : String(defaultValue),
  );
  const labelId = useId(),
    inputId = useId(),
    input = useRef<HTMLInputElement>(null),
    ghost = useRef<HTMLSpanElement>(null);
  const value = parseStepperValue(text);
  const limits = { min, max: max ?? Infinity, step };
  const set = (next: number | null) => {
    setText(next == null ? "" : String(next));
    onValueChange?.(next);
  };
  // A press rolls the number the way it changed: the old value leaves (up
  // for more, down for less) as the new one comes in from the other side.
  const press = (direction: 1 | -1) => {
    const next = stepValue(value, direction, limits);
    if (next === value) return;
    const old = text;
    set(next);
    if (prefersReducedMotion()) return;
    const leaving = ghost.current;
    if (leaving && old) {
      leaving.textContent = old;
      playMotion(leaving, rollOutKeyframes(direction), {
        duration: MOTION.fast,
        easing: EASE.in,
        fill: "forwards",
      });
    }
    playMotion(input.current, tickKeyframes(direction), {
      duration: MOTION.fast,
      easing: EASE.out,
    });
  };
  return (
    <div className="stepper" role="group" aria-labelledby={labelId}>
      <label className="stepper-label" id={labelId} htmlFor={inputId}>
        {label}
      </label>
      <div className="stepper-control">
        <button
          type="button"
          className="stepper-button"
          aria-label={common("less", { label: inputLabel ?? label })}
          disabled={disabled || (value != null && value <= min)}
          onClick={() => press(-1)}
        >
          <Minus size={20} aria-hidden="true" />
        </button>
        <span className="stepper-field">
          <span className="stepper-value">
            {/* The old value rolling away after a press (motion only). */}
            <span className="stepper-ghost" aria-hidden="true" ref={ghost} />
            <input
              ref={input}
              id={inputId}
              className="stepper-input"
              name={name}
              type="text"
              inputMode={decimal ? "decimal" : "numeric"}
              autoComplete="off"
              enterKeyHint={enterKeyHint}
              aria-label={inputLabel}
              value={text}
              disabled={disabled}
              onChange={(event) => {
                setText(event.target.value);
                onValueChange?.(parseStepperValue(event.target.value));
              }}
              onBlur={() => {
                // Normalise "12,5" to "12.5" so the form reads a number.
                if (value != null && String(value) !== text)
                  setText(String(value));
              }}
            />
          </span>
          {unit && (
            <span className="stepper-unit" aria-hidden="true">
              {unit}
            </span>
          )}
        </span>
        <button
          type="button"
          className="stepper-button"
          aria-label={common("more", { label: inputLabel ?? label })}
          disabled={disabled || (max != null && value != null && value >= max)}
          onClick={() => press(1)}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slow loading                                                         */
/* ------------------------------------------------------------------ */

/** True once `waiting` has lasted `ms` (a request that has not answered). */
export function useTakingLong(waiting: boolean, ms = 15000) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setLong(false);
      return;
    }
    const timer = window.setTimeout(() => setLong(true), ms);
    return () => window.clearTimeout(timer);
  }, [waiting, ms]);
  return waiting && long;
}
/**
 * A placeholder while something loads that turns into a plain "taking longer
 * than usual" line with Try again, so a request that never answers never
 * leaves an endless skeleton.
 */
export function LoadingOrRetry({
  label,
  lines = 3,
  onRetry,
}: {
  label: string;
  lines?: number;
  onRetry: () => void;
}) {
  const common = useT("common");
  const slow = useTakingLong(true);
  if (!slow) return <Skeleton label={label} lines={lines} />;
  return (
    <div className="notice" role="status">
      <p>{common("slowLoad")}</p>
      <button type="button" className="button secondary" onClick={onRetry}>
        {common("tryAgain")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ResponsiveTable                                                      */
/* ------------------------------------------------------------------ */

export type ResponsiveColumn = {
  key: string;
  label: string;
  /** Numbers align to the end and keep their own left-to-right order. */
  numeric?: boolean;
};
export type ResponsiveRow = { key: string; cells: Record<string, ReactNode> };

/** Which edges of a horizontal scroller still hide content (either direction). */
export function scrollEdges(el: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}) {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return { start: false, end: false };
  // Right to left, scrollLeft runs from 0 at the start to -max at the end.
  const position = Math.abs(el.scrollLeft);
  return { start: position > 1, end: position < max - 1 };
}

/**
 * Phones: each row is a card of "label: value" lines (the first column is
 * the card's title). From 768 px: a normal table that scrolls inside its own
 * region, with a fade and a "Scroll for more" cue at the hidden edge.
 */
export function ResponsiveTable({
  label,
  columns,
  rows,
  empty,
}: {
  /** Names the table region, e.g. "Exercise progress". */
  label: string;
  columns: ResponsiveColumn[];
  rows: ResponsiveRow[];
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}) {
  const common = useT("common");
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const next = scrollEdges(el);
    setEdges((old) =>
      old.start === next.start && old.end === next.end ? old : next,
    );
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    const observer =
      el && typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : null;
    if (el) observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, rows.length]);
  if (!rows.length && empty) return <>{empty}</>;
  const scrollable = edges.start || edges.end;
  return (
    <div
      className="responsive-table"
      data-overflow-start={edges.start ? "" : undefined}
      data-overflow-end={edges.end ? "" : undefined}
    >
      <div
        ref={scroller}
        className="responsive-table-scroll"
        role="region"
        aria-label={label}
        tabIndex={scrollable ? 0 : undefined}
        onScroll={measure}
      >
        <table role="table">
          <thead role="rowgroup">
            <tr role="row">
              {columns.map((column) => (
                <th
                  key={column.key}
                  role="columnheader"
                  scope="col"
                  className={column.numeric ? "is-numeric" : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => (
              <tr key={row.key} role="row">
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th
                      key={column.key}
                      role="rowheader"
                      scope="row"
                      data-label={column.label}
                    >
                      {row.cells[column.key]}
                    </th>
                  ) : (
                    <td
                      key={column.key}
                      role="cell"
                      data-label={column.label}
                      className={column.numeric ? "is-numeric" : undefined}
                    >
                      <span className="responsive-table-value">
                        {row.cells[column.key]}
                      </span>
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edges.end && (
        <p className="responsive-table-cue" aria-hidden="true">
          {common("scrollForMore")}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ScrollTabs                                                           */
/* ------------------------------------------------------------------ */

/** The id of a ScrollTabs panel, for role="tabpanel" (see tabPanelProps). */
export const tabPanelId = (prefix: string) => `${prefix}-panel`;
/** Props for the element that shows the selected tab's content. */
export function tabPanelProps(prefix: string, selected: string) {
  return {
    role: "tabpanel" as const,
    id: tabPanelId(prefix),
    "aria-labelledby": `${prefix}-tab-${selected}`,
  };
}

/**
 * A row that scrolls sideways on phones (tabs, day chips, a website's
 * navigation): fades the edge that still hides items (data-overflow-start /
 * data-overflow-end with the `edge-fade` class, phone-first.css) and brings
 * the current item fully into view when the row first appears, so a cut-off
 * label is never the only cue.
 */
export function useEdgeFade<T extends HTMLElement>(
  ref: { current: T | null },
  current = '[aria-current="page"], [aria-selected="true"], .selected',
  /** Re-run when this changes (the row appears later, or on a new page). */
  watch?: unknown,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(current);
    if (active) {
      // Scroll only this row (never the page) so the item is fully visible.
      const row = el.getBoundingClientRect(),
        item = active.getBoundingClientRect();
      if (item.left < row.left || item.right > row.right)
        el.scrollLeft += item.left < row.left
          ? item.left - row.left - 16
          : item.right - row.right + 16;
    }
    const measure = () => {
      const edges = scrollEdges(el);
      if (edges.start) el.dataset.overflowStart = "";
      else delete el.dataset.overflowStart;
      if (edges.end) el.dataset.overflowEnd = "";
      else delete el.dataset.overflowEnd;
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref, current, watch]);
}

/**
 * Tabs in one row that scroll sideways on phones (never wrapping), each at
 * least 44 px tall. Arrow keys move between tabs in the reading direction;
 * Home and End jump to the first and last.
 */
export function ScrollTabs({
  label,
  tabs,
  selected,
  onSelect,
  idPrefix,
}: {
  label: string;
  tabs: Array<{ id: string; label: ReactNode }>;
  selected: string;
  onSelect: (id: string) => void;
  /** Stable prefix for tab and panel ids (tabPanelProps uses it too). */
  idPrefix: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEdgeFade(list);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    list.current
      ?.querySelector<HTMLElement>(`[aria-selected="true"]`)
      ?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    // The newly selected panel settles in, block by block.
    playArrival(document.getElementById(tabPanelId(idPrefix)), 6);
  }, [selected, idPrefix]);
  const choose = (id: string, focus = false) => {
    moved.current = true;
    onSelect(id);
    if (focus)
      requestAnimationFrame(() =>
        document.getElementById(`${idPrefix}-tab-${id}`)?.focus(),
      );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === selected);
    if (index < 0) return;
    const rtl =
      getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    let next = -1;
    if (event.key === "ArrowRight") next = index + rtl;
    else if (event.key === "ArrowLeft") next = index - rtl;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    if (target) choose(target.id, true);
  };
  return (
    <div
      ref={list}
      className="scroll-tabs edge-fade"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tabPanelId(idPrefix)}
            tabIndex={active ? 0 : -1}
            className={active ? "scroll-tab selected" : "scroll-tab"}
            onClick={() => choose(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

/**
 * A short confirmation ("Saved") above the tab bar, the action bar and the
 * analytics bar. It slides up and fades in, stays for `duration`, then
 * slides away and calls onDone (docs/features/motion.md "e"). It never
 * takes taps, so it cannot cover a control.
 */
export function Toast({
  children,
  onDone,
  duration = 4000,
}: {
  children: ReactNode;
  onDone: () => void;
  duration?: number;
}) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let gone = 0;
    const leave = window.setTimeout(() => {
      if (prefersReducedMotion()) return done.current();
      setLeaving(true);
      gone = window.setTimeout(() => done.current(), MOTION.fast + 40);
    }, duration);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, [duration]);
  return (
    <div
      className={"member-toast" + (leaving ? " is-leaving" : "")}
      role="status"
      data-fixed-ui
    >
      <Check size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

/**
 * A loading placeholder in the shape of what is coming (a title and a few
 * lines, optionally a block), with a soft shimmer that is still with
 * reduced motion. `label` is read to screen readers ("Loading your day").
 */
export function Skeleton({
  label,
  lines = 3,
  block = false,
  className,
}: {
  label: string;
  lines?: number;
  block?: boolean;
  className?: string;
}) {
  return (
    <div
      className={"skeleton" + (className ? " " + className : "")}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <span className="skeleton-line is-title" aria-hidden="true" />
      {Array.from({ length: Math.max(0, lines - 1) }, (_, index) => (
        <span
          key={index}
          className={
            "skeleton-line" + (index === lines - 2 ? " is-short" : "")
          }
          aria-hidden="true"
        />
      ))}
      {block && <span className="skeleton-line is-block" aria-hidden="true" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DrawnCheck and ProgressRing                                          */
/* ------------------------------------------------------------------ */

/**
 * A check mark drawn as an SVG stroke. `draw` draws it once when it mounts
 * (a logged set, a finished workout, joining a coach); `emphasis` takes the
 * longer celebration timing. Decorative: say what happened in text.
 */
export function DrawnCheck({
  draw = false,
  emphasis = false,
  className,
}: {
  draw?: boolean;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={
        "drawn-check" +
        (draw ? " is-drawing" : "") +
        (emphasis ? " is-emphasis" : "") +
        (className ? " " + className : "")
      }
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path className="drawn-check-path" d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
    </svg>
  );
}

/**
 * A ring that shows a share (0-1): the rest timer counting down, a workout
 * filling up. It starts at the top and runs in the reading direction.
 * `from` animates the ring from that share when it first shows (the
 * completion moment); `ticking` smooths each small change (a countdown).
 * Decorative: the value is in the text beside it.
 */
export function ProgressRing({
  value,
  from,
  size = 28,
  ticking = false,
  immediate = false,
  className,
}: {
  value: number;
  from?: number;
  size?: number;
  ticking?: boolean;
  /**
   * Fill at once on mount (the completion moment, already on screen), not
   * when it scrolls into view, and in the short `MOTION.slow`.
   */
  immediate?: boolean;
  className?: string;
}) {
  const arc = useRef<SVGCircleElement>(null);
  const share = Math.max(0, Math.min(1, value));
  useLayoutEffect(() => {
    const el = arc.current;
    if (!el || from === undefined || from === share) return;
    const play = () =>
      playMotion(el, ringKeyframes(from, share), {
        duration: immediate ? MOTION.slow : MOTION.progress,
        easing: EASE.out,
      });
    if (immediate) {
      play();
      return;
    }
    return whenFirstInView(el, play);
    // Plays once, when the ring first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <svg
      className={"progress-ring" + (className ? " " + className : "")}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
    >
      <g className="progress-ring-arc">
        <circle className="progress-ring-track" cx="18" cy="18" r="15" />
        <circle
          ref={arc}
          className={"progress-ring-value" + (ticking ? " is-ticking" : "")}
          cx="18"
          cy="18"
          r="15"
          pathLength={1}
          style={{ strokeDashoffset: 1 - share } as CSSProperties}
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* CountUp and Meter                                                    */
/* ------------------------------------------------------------------ */

/** What each keyed number showed last in this tab. */
const countMemory = new Map<string, number>();

/**
 * A number that counts up once, from `from` (0 by default) to `value`, the
 * first time it is seen. With `memoryKey` it counts only the first time in
 * this tab, and later only when the value changed (from the old value);
 * with reduced motion it simply shows `value`. The final text is always in
 * the page for screen readers and tests (it is written before and after
 * the count).
 */
export function CountUp({
  value,
  from = 0,
  format = String,
  duration = MOTION.progress,
  memoryKey,
}: {
  value: number;
  from?: number;
  format?: (value: number) => string;
  duration?: number;
  memoryKey?: string;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    const node = el.current;
    let start = from;
    if (memoryKey) {
      const last = countMemory.get(memoryKey);
      countMemory.set(memoryKey, value);
      if (last !== undefined) start = last;
    }
    if (!node || prefersReducedMotion() || start === value) return;
    let cancel = () => {};
    const stop = whenFirstInView(node, () => {
      cancel = countUp(node, start, value, (v) => fmt.current(v), duration);
    });
    return () => {
      stop();
      cancel();
    };
    // Counts once, when first seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span ref={el}>{format(value)}</span>;
}

/**
 * A progress bar whose fill grows from zero the first time it is seen and
 * moves from the last value shown when it changes (`memoryKey`), by scaleX
 * over a fill already drawn at its value (no layout change).
 */
export function Meter({
  value,
  max,
  label,
  className = "programme-meter",
  memoryKey,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
  memoryKey?: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  useMeterMotion(fill, ratio, memoryKey);
  return (
    <div
      className={className}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <span
        ref={fill}
        className="motion-meter-fill"
        style={{ inlineSize: `${ratio * 100}%` }}
      />
    </div>
  );
}
