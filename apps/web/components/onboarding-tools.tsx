"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { prefersReducedMotion } from "./motion";

export type ConversationPanel = "menu" | "details" | "brain" | null;

/** Secondary tasks stay out of the transcript. Native modal focus/escape behavior. */
export function ConversationTools({ panel, onPanel, children }: {
  panel: ConversationPanel;
  onPanel: (panel: ConversationPanel) => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const heading = useId();
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setClosing(false);
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    if (!panel && dialog.current?.open) dialog.current.close();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [panel]);
  function close() {
    if (closing) return;
    if (prefersReducedMotion()) { onPanel(null); return; }
    setClosing(true);
    timer.current = setTimeout(() => onPanel(null), 140);
  }
  return <dialog ref={dialog} className={"onboarding-tools" + (closing ? " closing" : "")} aria-labelledby={heading}
    data-panel={panel ?? "menu"}
    onClose={event => { if (!event.currentTarget.open) onPanel(null); }}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    }}>
    <header className="onboarding-tools-header">
      {panel !== "menu" && <button type="button" className="onboarding-icon" aria-label="Back to conversation options" onClick={() => onPanel("menu")}><ArrowLeft size={19} /></button>}
      <h2 id={heading}>{panel === "details" ? "Saved details" : panel === "brain" ? "Your Brain" : "Conversation options"}</h2>
      <button type="button" className="onboarding-icon" aria-label={panel === "details" ? "Close review" : "Close conversation options"} onClick={close}><X size={19} /></button>
    </header>
    <div key={panel} className="onboarding-tools-content">{children}</div>
  </dialog>;
}
