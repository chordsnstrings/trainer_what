"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, REDUCE_MOTION_ATTRIBUTE } from "./motion";

type ConversationMotion = "system" | "on" | "off";
const storageKey = "trainer:conversation-motion";

/** A device-local choice for conversations only. System remains the default;
 * an explicit On can override reduced motion without changing other screens. */
export function useConversationMotion() {
  const [choice, setChoice] = useState<ConversationMotion>("system");
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "system" || saved === "on" || saved === "off") setChoice(saved);
    } catch { /* A blocked preference store must not block the conversation. */ }
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(prefersReducedMotion());
    update();
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [REDUCE_MOTION_ATTRIBUTE] });
    return () => { media.removeEventListener("change", update); observer.disconnect(); };
  }, []);
  function choose(value: ConversationMotion) {
    setChoice(value);
    try { localStorage.setItem(storageKey, value); } catch { /* Keep this session's choice. */ }
  }
  return { choice, choose, reduced, enabled: choice === "on" || choice === "system" && !reduced };
}
