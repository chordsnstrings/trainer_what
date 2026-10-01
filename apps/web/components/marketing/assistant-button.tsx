"use client";

/**
 * The home page voice assistant's button (docs/features/kamran-assistant.md):
 * a small round button at the bottom corner (bottom-left in right-to-left
 * layouts). Everything else, the panel, recording and playback, loads on the
 * first tap, so the home page's own code and speed budget are unchanged.
 */
import { useEffect, useState, type ComponentType } from "react";
import { Mic, X } from "lucide-react";

export type AssistantPanelProps = {
  appName: string;
  onClose: () => void;
  /** At the daily cap: hidden until the given time (midnight UAE). */
  onHide: (until: string | null) => void;
};
const HIDDEN_UNTIL = "mk-assistant-hidden-until";

export function AssistantButton({ appName }: { appName: string }) {
  const [Panel, setPanel] = useState<ComponentType<AssistantPanelProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    try {
      const until = localStorage.getItem(HIDDEN_UNTIL);
      if (until && Date.parse(until) > Date.now()) setHidden(true);
    } catch {
      // Storage may be blocked; the server refuses at the cap anyway.
    }
  }, []);
  if (hidden) return null;
  async function toggle() {
    if (!Panel) {
      setLoading(true);
      try {
        const module = await import("./assistant-panel");
        setPanel(() => module.AssistantPanel);
      } finally {
        setLoading(false);
      }
    }
    setOpen((value) => !value);
  }
  function hide(until: string | null) {
    try {
      if (until) localStorage.setItem(HIDDEN_UNTIL, until);
    } catch {
      // Hidden for this page view only.
    }
    setOpen(false);
    setHidden(true);
  }
  return (
    <>
      {open && Panel && (
        <Panel appName={appName} onClose={() => setOpen(false)} onHide={hide} />
      )}
      <button
        type="button"
        className="mk-assistant-fab"
        aria-label={open ? "Close Kamran's AI voice" : "Talk to Kamran (AI voice)"}
        aria-expanded={open}
        aria-busy={loading}
        onClick={toggle}
      >
        {open ? <X size={22} aria-hidden="true" /> : <Mic size={22} aria-hidden="true" />}
      </button>
    </>
  );
}
