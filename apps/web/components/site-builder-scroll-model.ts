import type { SiteBuilderScroll } from "@trainer/contracts";

export const clampScroll = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const scrollPace = { quick: 0.7, balanced: 1.1, slow: 1.6 } as const;
const smooth = (value: number) => {
  const t = clampScroll(value);
  return t * t * (3 - 2 * t);
};

/** A full final scene dwell; no blank frame at either end or at a boundary. */
export function scrollSceneFrame(
  progress: number,
  count: number,
  index: number,
) {
  const position = clampScroll(progress) * Math.max(1, count);
  const incoming = index === 0 ? 1 : smooth((position - index + 0.2) / 0.2);
  const outgoing =
    index === count - 1 ? 1 : 1 - smooth((position - index - 0.8) / 0.2);
  return {
    opacity: incoming * outgoing,
    progress: clampScroll(position - index),
    active: Math.min(count - 1, Math.floor(position + 0.1)) === index,
  };
}

export function scrollImageTransform(
  progress: number,
  variant: string,
  intensity: SiteBuilderScroll["intensity"],
) {
  const p = clampScroll(progress);
  const amount = { subtle: 0.5, standard: 1, strong: 1.5 }[intensity];
  let scale = 1.04 + p * 0.08 * amount;
  let x = 0;
  let y = (0.5 - p) * 2 * amount;
  let rotate = 0;
  if (variant === "zoom-out") scale = 1.04 + (1 - p) * 0.08 * amount;
  if (variant === "drift-up") {
    scale = 1.12;
    y = (0.5 - p) * 6 * amount;
  }
  if (variant === "drift-left" || variant === "drift-right") {
    scale = 1.12;
    x = (0.5 - p) * 6 * amount * (variant === "drift-left" ? 1 : -1);
    y = 0;
  }
  if (variant === "portrait") rotate = (p - 0.5) * 5 * amount;
  if (variant === "still" || variant === "minimal") {
    scale = 1;
    x = y = 0;
  }
  return `perspective(1200px) translate3d(${x}%, ${y}%, 0) scale(${scale}) rotateY(${rotate}deg)`;
}
