import {
  siteBuilderElementSchema,
  type SiteBuilderElement,
  type SiteBuilderDocument,
  type SiteBuilderAction,
  type SiteBuilderSection,
} from "@trainer/contracts";

export type EditorHistory<T> = {
  past: T[];
  present: T;
  future: T[];
  group?: string;
  changedAt?: number;
};

export const newEditorId = (prefix = "item") =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
export const copyEditorValue = <T>(value: T): T => structuredClone(value);

/** Every waiter rechecks the queue after waking; no two saves share a version. */
export function createEditorSaveQueue() {
  let pending: Promise<unknown> | null = null;
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    while (pending) {
      try {
        await pending;
      } catch {
        /* A failed request must not poison the queue. */
      }
    }
    const promise = task();
    pending = promise;
    try {
      return await promise;
    } finally {
      if (pending === promise) pending = null;
    }
  };
}

export function remapEditorPageActions(
  document: SiteBuilderDocument,
  mapping: Map<string, string>,
) {
  const action = (value?: SiteBuilderAction) => {
    if (value?.kind === "page" && value.pageId && mapping.has(value.pageId))
      value.pageId = mapping.get(value.pageId)!;
  };
  const elements = (values: SiteBuilderElement[]) => {
    for (const value of values) {
      action(value.action);
      elements(value.children);
    }
  };
  const section = (value: SiteBuilderSection) => {
    value.content.actions.forEach(action);
    value.content.items.forEach((item) => action(item.action));
    elements(value.content.elements);
  };
  action(document.header.action);
  action(document.footer.action);
  document.pages.forEach((page) => page.sections.forEach(section));
  document.savedSections.forEach((saved) => section(saved.section));
}

/** A new starting design does not erase the trainer's reusable section library. */
export function applyEditorStarter(
  current: SiteBuilderDocument,
  proposal: SiteBuilderDocument,
): SiteBuilderDocument {
  const next = copyEditorValue(proposal),
    home = next.pages.find((page) => page.slug === "")!;
  next.savedSections = copyEditorValue(current.savedSections);
  const pageMapping = new Map(
    current.pages.map((page) => [
      page.id,
      next.pages.find((candidate) => candidate.slug === page.slug)?.id ??
        home.id,
    ]),
  );
  remapEditorPageActions(next, pageMapping);
  return next;
}

/** Consecutive typing in one field is one undo step; structural edits never merge. */
export function editHistory<T>(
  state: EditorHistory<T>,
  next: T,
  group?: string,
  now = Date.now(),
): EditorHistory<T> {
  if (JSON.stringify(state.present) === JSON.stringify(next)) return state;
  const combine =
    !!group && group === state.group && now - (state.changedAt ?? 0) < 900;
  return {
    past: combine ? state.past : [...state.past, state.present].slice(-80),
    present: next,
    future: [],
    group,
    changedAt: now,
  };
}

export function undoHistory<T>(state: EditorHistory<T>): EditorHistory<T> {
  if (!state.past.length) return state;
  return {
    past: state.past.slice(0, -1),
    present: state.past.at(-1)!,
    future: [state.present, ...state.future].slice(0, 80),
  };
}

export function redoHistory<T>(state: EditorHistory<T>): EditorHistory<T> {
  if (!state.future.length) return state;
  return {
    past: [...state.past, state.present].slice(-80),
    present: state.future[0],
    future: state.future.slice(1),
  };
}

/** The drop index is a boundary in the original list, including the last boundary. */
export function moveEditorItem<T extends { id: string }>(
  items: T[],
  id: string,
  boundary: number,
): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from === -1) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(
    Math.max(
      0,
      Math.min(next.length, boundary > from ? boundary - 1 : boundary),
    ),
    0,
    item,
  );
  return next;
}

export function findEditorElement(
  elements: SiteBuilderElement[],
  id: string,
): SiteBuilderElement | undefined {
  for (const element of elements) {
    if (element.id === id) return element;
    const child = findEditorElement(element.children, id);
    if (child) return child;
  }
}

export function editorElementLocation(
  elements: SiteBuilderElement[],
  id: string,
  parentId: string | null = null,
  depth = 1,
): { parentId: string | null; index: number; depth: number } | null {
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (element.id === id) return { parentId, index, depth };
    const child = editorElementLocation(
      element.children,
      id,
      element.id,
      depth + 1,
    );
    if (child) return child;
  }
  return null;
}

export function editorElementCount(elements: SiteBuilderElement[]): number {
  return elements.reduce(
    (count, element) => count + 1 + editorElementCount(element.children),
    0,
  );
}

export function addEditorElement(
  elements: SiteBuilderElement[],
  type: SiteBuilderElement["type"],
  parentId: string | null = null,
): SiteBuilderElement[] | null {
  if (editorElementCount(elements) >= 80) return null;
  const next = copyEditorValue(elements),
    parent = parentId ? findEditorElement(next, parentId) : undefined;
  if (parentId && (!parent || parent.type !== "columns")) return null;
  const target = parent?.children ?? next;
  if (target.length >= 12) return null;
  target.push(createEditorElement(type));
  return next.every(
    (element) => siteBuilderElementSchema.safeParse(element).success,
  )
    ? next
    : null;
}

export function removeEditorElement(
  elements: SiteBuilderElement[],
  id: string,
): SiteBuilderElement[] {
  return elements
    .filter((element) => element.id !== id)
    .map((element) => ({
      ...element,
      children: removeEditorElement(element.children, id),
    }));
}

/** Move a nested element without allowing cycles, invalid nesting or lost content. */
export function moveEditorElement(
  elements: SiteBuilderElement[],
  id: string,
  parentId: string | null,
  boundary: number,
): SiteBuilderElement[] | null {
  const moving = findEditorElement(elements, id);
  if (
    !moving ||
    parentId === id ||
    (parentId && findEditorElement(moving.children, parentId))
  )
    return null;
  const parent = parentId ? findEditorElement(elements, parentId) : undefined;
  if (parentId && (!parent || parent.type !== "columns")) return null;
  const originalTarget = parent?.children ?? elements;
  const from = originalTarget.findIndex((element) => element.id === id);
  const next = removeEditorElement(copyEditorValue(elements), id);
  const target = parentId ? findEditorElement(next, parentId)!.children : next;
  if (target.length >= 12) return null;
  const index = from >= 0 && boundary > from ? boundary - 1 : boundary;
  target.splice(
    Math.max(0, Math.min(target.length, index)),
    0,
    copyEditorValue(moving),
  );
  return next.every(
    (element) => siteBuilderElementSchema.safeParse(element).success,
  )
    ? next
    : null;
}

export function createEditorElement(
  type: SiteBuilderElement["type"],
): SiteBuilderElement {
  return {
    id: newEditorId("element"),
    type,
    style: type === "columns" ? { columns: 2, gap: 24 } : {},
    responsive: {},
    children: [],
    ...(type === "heading" ? { text: "A heading that sounds like you" } : {}),
    ...(type === "text"
      ? { text: "Tell visitors what makes your coaching different." }
      : {}),
    ...(type === "button"
      ? {
          action: {
            label: "Start coaching",
            kind: "signup" as const,
            newTab: false,
          },
        }
      : {}),
    ...(type === "image" ? { image: "", imageAlt: "" } : {}),
    ...(type === "video" ? { videoUrl: "" } : {}),
    ...(type === "spacer" ? { style: { minHeight: 40 } } : {}),
  };
}

export function editorSlug(title: string, used: string[]): string {
  let base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "page";
  if (!/^[a-z]/.test(base)) base = `page-${base}`;
  let slug = base;
  for (let n = 2; used.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}
