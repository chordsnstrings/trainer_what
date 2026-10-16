"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_BUILDER_SCROLL,
  type SiteBuilderAction,
  type SiteBuilderSection,
} from "@trainer/contracts";
import {
  safeBuilderImage,
  type BuilderContext,
} from "./site-builder-render-utils";
import {
  clampScroll,
  scrollImageTransform,
  scrollPace,
  scrollSceneFrame,
} from "./site-builder-scroll-model";

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  return null;
}

const motionReasons = {
  disabled: [
    "Scroll effect is turned off for this section.",
    "تأثير التمرير متوقف لهذا القسم.",
  ],
  reduced: [
    "Motion is paused to respect your device’s reduced-motion setting.",
    "الحركة متوقفة احترامًا لإعداد تقليل الحركة في جهازك.",
  ],
  short: [
    "This preview is too short for motion. Reduce the canvas zoom or use a taller window.",
    "هذه المعاينة قصيرة جدًا للحركة. قلّل تكبير اللوحة أو استخدم نافذة أطول.",
  ],
  stacked: [
    "This section uses stacked photos on phones. Change Phone presentation in the section settings to animate it.",
    "يعرض هذا القسم الصور متتابعة على الهواتف. غيّر طريقة العرض على الهاتف في إعدادات القسم لتفعيل الحركة.",
  ],
  content: [
    "Motion is paused so all your text stays readable. Shorten the scene text or reduce the canvas zoom to see the effect.",
    "الحركة متوقفة ليبقى النص كاملًا قابلًا للقراءة. اختصر نص المشهد أو قلّل تكبير اللوحة لرؤية التأثير.",
  ],
} as const;
type MotionReason = keyof typeof motionReasons;

/** Server-readable cards enhanced inside their own section, including the zoomed editor preview. */
export function BuilderScrollSection({
  section,
  context,
  editing,
  intro,
  actions,
  renderAction,
}: {
  section: SiteBuilderSection;
  context: BuilderContext;
  editing: boolean;
  intro: ReactNode;
  actions: ReactNode;
  renderAction: (action: SiteBuilderAction) => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const navigateRef = useRef<(index: number) => void>(() => {});
  const [animated, setAnimated] = useState(false);
  const [motionReason, setMotionReason] = useState<MotionReason | null>(null);
  const [active, setActive] = useState(0);
  const [readAll, setReadAll] = useState(false);
  const config = section.scroll ?? DEFAULT_BUILDER_SCROLL;
  const journey = section.moduleId === "scroll-journey";
  const scenes = journey
    ? section.content.items
    : [
        {
          id: section.id,
          title: "",
          body: "",
          image: section.content.image,
          imageAlt: section.content.imageAlt,
          focusX: config.focusX,
          focusY: config.focusY,
        },
      ];
  const ar = context.language === "ar";

  useEffect(() => {
    const host = hostRef.current;
    if (!host || editing || readAll || !config.enabled || !scenes.length) {
      setAnimated(false);
      setMotionReason(
        !editing && !readAll && !config.enabled ? "disabled" : null,
      );
      return;
    }
    const track = host.querySelector<HTMLElement>(".sb-scroll-track")!;
    const cards = [...host.querySelectorAll<HTMLElement>(".sb-scroll-scene")];
    const media = cards.map((card) =>
      card.querySelector<HTMLElement>(".sb-scroll-photo"),
    );
    const root = scrollParent(host);
    const target = root ?? window;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false,
      frame = 0,
      needsMeasure = true,
      enabled = false;
    let scale = 1,
      height = 0,
      travel = 0,
      top = 0,
      current = -1;

    const measure = () => {
      scale = host.offsetWidth
        ? host.getBoundingClientRect().width / host.offsetWidth
        : 1;
      const header = host
        .closest(".sb-site")
        ?.querySelector<HTMLElement>('.sb-header[data-sticky="true"]');
      top = header ? header.getBoundingClientRect().height : 0;
      const viewport = root ? root.clientHeight : window.innerHeight;
      height = (viewport - top) / scale;
      // Match the CSS container query, not a section narrowed by its gutters.
      const narrow =
        (host.closest<HTMLElement>(".sb-site")?.clientWidth ??
          host.clientWidth) <= 640;
      let reason: MotionReason | null = reduced.matches
        ? "reduced"
        : height < 460 || !host.offsetWidth
          ? "short"
          : narrow && config.mobile === "stacked"
            ? "stacked"
            : null;
      enabled = reason === null;
      travel = height * scrollPace[config.pace] * cards.length;
      host.style.setProperty("--sb-scroll-height", `${height}px`);
      host.style.setProperty("--sb-scroll-top", `${top / scale}px`);
      host.style.setProperty("--sb-scroll-travel", `${travel}px`);
      host.dataset.motion = String(enabled);
      // Measure the actual animated widths after fonts, resizing and content edits.
      // Long copy always wins over motion; never clip text or create an inner text scroller.
      if (
        enabled &&
        cards.some((card) => {
          const copy = card.querySelector<HTMLElement>(".sb-scroll-copy")!;
          // scrollHeight already includes the padding reserved for controls.
          // Subtracting it again disables normal copy in a laptop's preview.
          return copy.scrollHeight > height * (narrow ? 0.65 : 1);
        })
      ) {
        enabled = false;
        reason = "content";
      }
      host.dataset.motion = String(enabled);
      setAnimated(enabled);
      setMotionReason(reason);
    };
    const update = () => {
      frame = 0;
      if (disposed || document.hidden) return;
      if (
        host.offsetWidth &&
        Math.abs(
          host.getBoundingClientRect().width / host.offsetWidth - scale,
        ) > 0.001
      )
        needsMeasure = true;
      if (needsMeasure) {
        measure();
        needsMeasure = false;
      }
      if (!enabled) return;
      const rootTop = root
        ? root.getBoundingClientRect().top + root.clientTop
        : 0;
      const rect = track.getBoundingClientRect();
      if (rect.bottom < rootTop || rect.top > rootTop + top + height * scale)
        return;
      const progress = clampScroll(
        (rootTop + top - rect.top) / (travel * scale),
      );
      let next = 0;
      for (let i = 0; i < cards.length; i++) {
        const state = scrollSceneFrame(progress, cards.length, i);
        cards[i].style.setProperty("--scene-opacity", String(state.opacity));
        cards[i].style.setProperty(
          "--scene-shift",
          `${(0.5 - state.progress) * 12}px`,
        );
        if (media[i])
          media[i]!.style.transform = scrollImageTransform(
            state.progress,
            section.variant,
            config.intensity,
          );
        if (state.active) next = i;
      }
      if (next !== current) {
        // If a visitor is using a scene link, keep it and their keyboard focus readable.
        if (current >= 0 && cards[current].contains(document.activeElement)) {
          setReadAll(true);
          return;
        }
        current = next;
        setActive(next);
      }
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(update);
    };
    const resize = () => {
      needsMeasure = true;
      schedule();
    };
    navigateRef.current = (index) => {
      if (!enabled) return;
      const rootTop = root
        ? root.getBoundingClientRect().top + root.clientTop
        : 0;
      const delta =
        track.getBoundingClientRect().top -
        rootTop -
        top +
        ((index + 0.35) / cards.length) * travel * scale;
      target.scrollBy({ top: delta, behavior: "instant" });
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    if (root) observer.observe(root);
    const header = host
      .closest(".sb-site")
      ?.querySelector<HTMLElement>(".sb-header");
    if (header) observer.observe(header);
    // CSS zoom changes visual coordinates without changing layout width.
    const zoomFrame = host.closest(".sbe-canvas-frame");
    const zoomObserver = new MutationObserver(resize);
    if (zoomFrame)
      zoomObserver.observe(zoomFrame, {
        attributes: true,
        attributeFilter: ["style"],
      });
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    reduced.addEventListener("change", resize);
    document.addEventListener("visibilitychange", resize);
    document.fonts.ready.then(() => {
      if (!disposed) resize();
    });
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      zoomObserver.disconnect();
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      reduced.removeEventListener("change", resize);
      document.removeEventListener("visibilitychange", resize);
      navigateRef.current = () => {};
      host.dataset.motion = "false";
      for (const card of cards) {
        card.style.removeProperty("--scene-opacity");
        card.style.removeProperty("--scene-shift");
      }
      for (const photo of media)
        if (photo) photo.style.removeProperty("transform");
    };
  }, [
    editing,
    readAll,
    config.enabled,
    config.pace,
    config.intensity,
    config.mobile,
    section.variant,
    section.content,
  ]);

  return (
    <div
      ref={hostRef}
      tabIndex={-1}
      className="sb-scroll"
      data-motion={animated}
      data-scroll-kind={journey ? "journey" : "image"}
      data-scroll-variant={section.variant}
    >
      {journey && intro}
      {context.preview && !editing && motionReason && (
        <p className="sb-scroll-preview-status" role="status">
          {motionReasons[motionReason][ar ? 1 : 0]}
        </p>
      )}
      <div className="sb-scroll-track">
        <div className="sb-scroll-stage">
          {scenes.map((scene, index) => {
            const src = safeBuilderImage(scene.image);
            const hidden = animated && active !== index;
            return (
              <article
                key={scene.id}
                className="sb-scroll-scene"
                data-scene={index}
                aria-hidden={hidden || undefined}
                inert={hidden || undefined}
              >
                {section.variant === "portrait" && src && (
                  <img
                    className="sb-scroll-ambient"
                    src={src}
                    alt=""
                    aria-hidden="true"
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                )}
                <div className="sb-scroll-visual">
                  {src ? (
                    <img
                      className="sb-scroll-photo"
                      src={src}
                      alt={scene.imageAlt ?? ""}
                      loading={index === 0 ? "eager" : "lazy"}
                      decoding="async"
                      style={{
                        objectPosition: `${scene.focusX ?? 50}% ${scene.focusY ?? 50}%`,
                      }}
                    />
                  ) : (
                    <div
                      className="sb-scroll-photo sb-scroll-placeholder"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="sb-scroll-copy">
                  {journey ? (
                    <>
                      <span className="sb-scroll-number" aria-hidden="true">
                        <bdi dir="ltr">
                          {String(index + 1).padStart(2, "0")} /{" "}
                          {String(scenes.length).padStart(2, "0")}
                        </bdi>
                      </span>
                      {scene.eyebrow && (
                        <p className="sb-eyebrow">{scene.eyebrow}</p>
                      )}
                      {scene.title && <h3>{scene.title}</h3>}
                      {scene.body && <p className="sb-copy">{scene.body}</p>}
                      {scene.action && (
                        <div className="sb-actions">
                          {renderAction(scene.action)}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {intro}
                      {actions}
                    </>
                  )}
                  {!src && editing && (
                    <p className="sb-scroll-hint">
                      {ar
                        ? "اختر صورة من مكتبة الوسائط."
                        : "Choose a photo from your media library."}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
          {animated && (
            <div className="sb-scroll-controls">
              {journey && config.navigation && (
                <nav aria-label={ar ? "مشاهد القصة" : "Story scenes"}>
                  {scenes.map((scene, index) => (
                    <button
                      key={scene.id}
                      type="button"
                      aria-label={`${ar ? "المشهد" : "Scene"} ${index + 1}: ${scene.title}`}
                      aria-current={active === index ? "step" : undefined}
                      onClick={() => navigateRef.current(index)}
                    >
                      <span />
                    </button>
                  ))}
                </nav>
              )}
              <button
                type="button"
                className="sb-scroll-read"
                onClick={() => {
                  setReadAll(true);
                  requestAnimationFrame(() => {
                    hostRef.current?.focus({ preventScroll: true });
                    hostRef.current?.scrollIntoView({
                      block: "start",
                      behavior: "instant",
                    });
                  });
                }}
              >
                {ar ? "عرض دون حركة" : "Read without motion"}
              </button>
            </div>
          )}
        </div>
      </div>
      {journey && actions}
    </div>
  );
}
