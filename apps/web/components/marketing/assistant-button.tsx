"use client";

/**
 * The home page voice assistant's button (docs/features/kamran-assistant.md):
 * a small round button at the bottom corner (bottom-left in right-to-left
 * layouts). Everything else, the panel, recording and playback, loads on the
 * first tap, so the home page's own code and speed budget are unchanged.
 */
import { useEffect, useState, type ComponentType } from "react";
import { Mic, Phone, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { MARKETING_MOTION } from "./motion-mode";

export type AssistantPanelProps = {
  appName: string;
  minimized: boolean;
  onMinimize: () => void;
  onNavigate: () => void;
  onClose: () => void;
  /** At the daily cap: hidden until the given time (midnight UAE). */
  onHide: (until: string | null) => void;
};
const HIDDEN_UNTIL = "mk-assistant-hidden-until";

export function AssistantButton({
  appName,
  enabled,
  marketingPaths,
}: {
  appName: string;
  enabled: boolean;
  marketingPaths: string[];
}) {
  const path = usePathname() ?? "";
  const allowed = marketingPaths.includes(path);
  const [Panel, setPanel] = useState<ComponentType<AssistantPanelProps> | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    try {
      const until = localStorage.getItem(HIDDEN_UNTIL);
      if (until && Date.parse(until) > Date.now()) setHidden(true);
    } catch {
      // Storage may be blocked; the server refuses at the cap anyway.
    }
  }, []);
  useEffect(() => {
    if (!allowed) {
      setOpen(false);
      setMinimized(false);
    }
  }, [allowed]);
  if (hidden || !enabled || !allowed || (path !== "/" && !open)) return null;
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
    if (open) setMinimized((value) => !value);
    else {
      setMinimized(false);
      setOpen(true);
    }
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
    // data-mk-motion: the marketing motion switch (motion-mode.ts), as on the
    // marketing root; the host sits outside it.
    <div
      className="mk-assistant-host public platform-ui"
      data-mk-motion={MARKETING_MOTION}
    >
      {open && Panel && (
        <Panel
          appName={appName}
          minimized={minimized}
          onMinimize={() => setMinimized((value) => !value)}
          onNavigate={() => setMinimized(true)}
          onClose={() => setOpen(false)}
          onHide={hide}
        />
      )}
      <button
        type="button"
        className="mk-assistant-fab"
        aria-label={
          open
            ? minimized
              ? "Expand Kamran call"
              : "Minimize Kamran call"
            : "Talk to Kamran (AI voice)"
        }
        aria-expanded={open && !minimized}
        aria-busy={loading}
        disabled={loading}
        onClick={toggle}
      >
        {open ? (
          minimized ? (
            <Phone size={22} aria-hidden="true" />
          ) : (
            <ChevronDown size={22} aria-hidden="true" />
          )
        ) : (
          <Mic size={22} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
