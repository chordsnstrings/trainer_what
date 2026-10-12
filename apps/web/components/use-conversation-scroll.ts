"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion";

/** Preserve reading position; history never becomes a new-message arrival. */
export function useConversationScroll(
  latest: string,
  loaded: boolean,
  scope: string,
) {
  const thread = useRef<HTMLElement>(null),
    nearBottom = useRef(true),
    seen = useRef("");
  const [newMessages, setNewMessages] = useState(false);
  useLayoutEffect(() => {
    seen.current = "";
    nearBottom.current = true;
    setNewMessages(false);
  }, [scope]);
  useLayoutEffect(() => {
    const root = thread.current;
    if (!loaded || !root || !latest || seen.current === latest) return;
    const first = !seen.current;
    seen.current = latest;
    if (first || nearBottom.current) {
      root.scrollTop = root.scrollHeight;
      setNewMessages(false);
    } else setNewMessages(true);
  }, [latest, loaded, scope]);
  const onScroll = () => {
    const root = thread.current;
    if (!root) return;
    nearBottom.current =
      root.scrollHeight - root.clientHeight - root.scrollTop < 96;
    if (nearBottom.current) setNewMessages(false);
  };
  const toLatest = () => {
    nearBottom.current = true;
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    setNewMessages(false);
  };
  const prependHistory = () => {
    const root = thread.current,
      height = root?.scrollHeight ?? 0,
      top = root?.scrollTop ?? 0;
    return () =>
      requestAnimationFrame(() => {
        if (root) root.scrollTop = top + root.scrollHeight - height;
      });
  };
  return {
    thread,
    onScroll,
    toLatest,
    newMessages,
    prependHistory,
    followNext: () => {
      nearBottom.current = true;
    },
  };
}
