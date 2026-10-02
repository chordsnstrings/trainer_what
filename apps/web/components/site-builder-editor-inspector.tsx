"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  SITE_BUILDER_MODULES,
  isPublicBrandImage,
  getBuilderVideoEmbedUrl,
  isSafeBuilderLink,
  renameBuilderPage,
  type SiteBuilderDocument,
  type SiteBuilderSection,
  type SiteBuilderPage,
  type SiteBuilderAction,
  type SiteBuilderStyle,
  type SiteBuilderResponsive,
  type SiteBuilderItem,
  type SiteBuilderElement,
} from "@trainer/contracts";
import {
  newEditorId,
  addEditorElement,
  editorElementLocation,
  findEditorElement,
  removeEditorElement,
  moveEditorElement,
} from "./site-builder-editor-model";

export type EditorViewport = "desktop" | "tablet" | "mobile";
export type BuilderChange = (
  change: (builder: SiteBuilderDocument) => void,
  group?: string,
) => void;
export type PickImage = (apply: (url: string, alt?: string) => void) => void;

export function EditorField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const labelId = useId(),
    hintId = useId();
  function labelControls(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (child) => {
      if (
        !isValidElement<Record<string, unknown>>(child) ||
        typeof child.type !== "string"
      )
        return child;
      if (["input", "textarea", "select"].includes(child.type))
        return cloneElement(child, {
          ...(!child.props["aria-label"] && !child.props["aria-labelledby"]
            ? { "aria-labelledby": labelId }
            : {}),
          ...(hint ? { "aria-describedby": hintId } : {}),
        });
      return child.props.children
        ? cloneElement(child, {
            children: labelControls(child.props.children as ReactNode),
          })
        : child;
    });
  }
  return (
    <label className="sbe-field">
      <span id={labelId}>{label}</span>
      {labelControls(children)}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}

export function EditorImageField({
  label = "Image",
  value,
  onChange,
  onPick,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onPick: PickImage;
}) {
  const [text, setText] = useState(value),
    [error, setError] = useState("");
  useEffect(() => {
    setText(value);
    setError("");
  }, [value]);
  return (
    <div className="sbe-image-field">
      {value && <img src={value} alt="Selected image" loading="lazy" />}
      <EditorField
        label={`${label} address`}
        hint="Choose a library photo or use a public HTTPS image address."
      >
        <input
          value={text}
          aria-invalid={!!error}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (isPublicBrandImage(text)) {
              onChange(text);
              setError("");
            } else
              setError(
                "Use a public HTTPS image address without a query string.",
              );
          }}
        />
      </EditorField>
      {error && (
        <small className="sbe-error" role="alert">
          {error}
        </small>
      )}
      <div className="sbe-inline">
        <button type="button" onClick={() => onPick((url) => onChange(url))}>
          <ImagePlus size={14} />
          Choose photo
        </button>
        {value && (
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange("")}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function VideoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value),
    [error, setError] = useState("");
  useEffect(() => {
    setText(value);
    setError("");
  }, [value]);
  return (
    <EditorField
      label="Video link"
      hint={
        error ||
        "Paste a YouTube or Vimeo link. Visitors choose when to play it."
      }
    >
      <input
        type="url"
        value={text}
        aria-invalid={!!error}
        placeholder="https://youtu.be/…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text || getBuilderVideoEmbedUrl(text)) {
            setError("");
            onChange(text);
          } else setError("Use a valid YouTube or Vimeo HTTPS link.");
        }}
      />
    </EditorField>
  );
}

function SafeLinkField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value),
    [invalid, setInvalid] = useState(false);
  useEffect(() => setText(value), [value]);
  return (
    <EditorField
      label="Link address"
      hint={
        invalid
          ? "Use a public HTTPS address, page path or section anchor."
          : undefined
      }
    >
      <input
        value={text}
        aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const valid = isSafeBuilderLink(text);
          setInvalid(!valid);
          if (valid) onChange(text);
        }}
      />
    </EditorField>
  );
}

export function EditorActionField({
  action,
  onChange,
  builder,
  products = [],
}: {
  action: SiteBuilderAction;
  onChange: (action: SiteBuilderAction) => void;
  builder: SiteBuilderDocument;
  products?: any[];
}) {
  return (
    <div className="sbe-action-fields">
      <EditorField label="Button text">
        <input
          value={action.label}
          maxLength={80}
          onChange={(e) => onChange({ ...action, label: e.target.value })}
        />
      </EditorField>
      <EditorField label="Button destination">
        <select
          value={action.kind}
          onChange={(e) => {
            const kind = e.target.value as SiteBuilderAction["kind"];
            onChange({
              label: action.label,
              kind,
              newTab: false,
              ...(kind === "page" ? { pageId: builder.pages[0].id } : {}),
              ...(["url", "anchor"].includes(kind)
                ? { href: kind === "anchor" ? "#contact" : "/" }
                : {}),
            });
          }}
        >
          <option value="signup">Join coaching</option>
          <option value="programmes">Coaching programmes</option>
          <option value="booking">Book a consultation</option>
          <option value="contact">Contact the coach</option>
          <option value="page">A website page</option>
          <option value="url">A link</option>
          <option value="anchor">A section on this page</option>
        </select>
      </EditorField>
      {action.kind === "page" && (
        <EditorField label="Destination page">
          <select
            value={action.pageId ?? ""}
            onChange={(e) => onChange({ ...action, pageId: e.target.value })}
          >
            {builder.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {!p.visible ? " (draft only)" : ""}
              </option>
            ))}
          </select>
        </EditorField>
      )}
      {["url", "anchor"].includes(action.kind) && (
        <SafeLinkField
          value={action.href ?? ""}
          onChange={(href) => onChange({ ...action, href })}
        />
      )}
      {(["signup", "programmes"].includes(action.kind) || action.productId) && (
        <EditorField label="Specific programme">
          <select
            value={action.productId ?? ""}
            onChange={(e) => {
              const next = { ...action };
              if (e.target.value) next.productId = e.target.value;
              else delete next.productId;
              onChange(next);
            }}
          >
            <option value="">All available programmes</option>
            {action.productId &&
              !products.some((p) => p.id === action.productId) && (
                <option value={action.productId}>
                  Unavailable programme · choose another
                </option>
              )}
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.data?.name ??
                  product.data?.title ??
                  "Coaching programme"}
              </option>
            ))}
          </select>
        </EditorField>
      )}
      {action.kind === "url" && (
        <label className="sbe-check">
          <input
            type="checkbox"
            checked={action.newTab}
            onChange={(e) => onChange({ ...action, newTab: e.target.checked })}
          />
          Open in a new tab
        </label>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  fallback,
  min = 0,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value?: number;
  fallback: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <EditorField label={label}>
      <div className="sbe-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value ?? fallback}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          aria-label={`${label} value`}
          min={min}
          max={max}
          step={step}
          value={value ?? fallback}
          onChange={(e) => {
            if (e.target.value !== "")
              onChange(
                Math.max(
                  min,
                  Math.min(max, Math.round(Number(e.target.value) || 0)),
                ),
              );
          }}
        />
      </div>
    </EditorField>
  );
}

export function EditorStyleFields({
  style,
  responsive,
  viewport,
  onChange,
  onResponsiveChange,
  onViewport,
}: {
  style: SiteBuilderStyle;
  responsive: SiteBuilderResponsive;
  viewport: EditorViewport;
  onChange: (patch: Partial<SiteBuilderStyle>) => void;
  onResponsiveChange: (next: SiteBuilderResponsive) => void;
  onViewport: (viewport: EditorViewport) => void;
}) {
  const current = viewport === "desktop" ? style : (responsive[viewport] ?? {});
  function change(patch: Partial<SiteBuilderStyle>) {
    if (viewport === "desktop") onChange(patch);
    else
      onResponsiveChange({
        ...responsive,
        [viewport]: { ...responsive[viewport], ...patch },
      });
  }
  return (
    <>
      <EditorField label="Design for">
        <select
          value={viewport}
          onChange={(e) => onViewport(e.target.value as EditorViewport)}
        >
          <option value="desktop">Desktop · base styles</option>
          <option value="tablet">Tablet overrides</option>
          <option value="mobile">Phone overrides</option>
        </select>
      </EditorField>
      <p className="sbe-help">
        {viewport === "desktop"
          ? "Base styles flow down to smaller screens. Change tablet or phone settings only where needed."
          : `Only the ${viewport === "mobile" ? "phone" : "tablet"} layout changes. Unset values inherit the base styles.`}
      </p>
      <details open>
        <summary>Layout & spacing</summary>
        <EditorField label="Content width">
          <select
            value={current.width ?? style.width ?? "content"}
            onChange={(e) =>
              change({ width: e.target.value as SiteBuilderStyle["width"] })
            }
          >
            <option value="content">Content</option>
            <option value="wide">Wide</option>
            <option value="full">Full width</option>
          </select>
        </EditorField>
        <EditorField label="Text alignment">
          <select
            value={current.align ?? style.align ?? "left"}
            onChange={(e) =>
              change({ align: e.target.value as SiteBuilderStyle["align"] })
            }
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </EditorField>
        <NumberField
          label="Space above"
          value={current.paddingTop}
          fallback={style.paddingTop ?? 72}
          max={240}
          onChange={(paddingTop) => change({ paddingTop })}
        />
        <NumberField
          label="Space below"
          value={current.paddingBottom}
          fallback={style.paddingBottom ?? 72}
          max={240}
          onChange={(paddingBottom) => change({ paddingBottom })}
        />
        <NumberField
          label="Columns"
          value={current.columns}
          fallback={viewport === "mobile" ? 1 : (style.columns ?? 3)}
          min={1}
          max={4}
          onChange={(columns) => change({ columns })}
        />
        <NumberField
          label="Gap"
          value={current.gap}
          fallback={style.gap ?? 24}
          max={100}
          onChange={(gap) => change({ gap })}
        />
        <NumberField
          label="Minimum height"
          value={current.minHeight}
          fallback={style.minHeight ?? 0}
          max={1000}
          step={10}
          onChange={(minHeight) => change({ minHeight })}
        />
        <label className="sbe-check">
          <input
            type="checkbox"
            checked={responsive[viewport]?.reverse ?? false}
            onChange={(e) =>
              onResponsiveChange({
                ...responsive,
                [viewport]: {
                  ...responsive[viewport],
                  reverse: e.target.checked,
                },
              })
            }
          />
          Reverse column order
        </label>
      </details>
      <details>
        <summary>Colours & shape</summary>
        {(["background", "color", "accent"] as const).map((key) => (
          <EditorField
            key={key}
            label={
              key === "color"
                ? "Text colour"
                : key === "accent"
                  ? "Accent colour"
                  : "Background"
            }
          >
            <div className="sbe-colour">
              <input
                type="color"
                value={
                  current[key] ??
                  style[key] ??
                  (key === "background" ? "#ffffff" : "#171917")
                }
                onChange={(e) => change({ [key]: e.target.value })}
              />
              <span>{current[key] ?? style[key] ?? "Website default"}</span>
            </div>
          </EditorField>
        ))}
        <NumberField
          label="Corner radius"
          value={current.radius}
          fallback={style.radius ?? 12}
          max={64}
          onChange={(radius) => change({ radius })}
        />
        <NumberField
          label="Heading size"
          value={current.fontSize}
          fallback={style.fontSize ?? 48}
          min={12}
          max={120}
          onChange={(fontSize) => change({ fontSize })}
        />
      </details>
      <details>
        <summary>Image & visibility</summary>
        <EditorField label="Image crop">
          <select
            value={current.imageFit ?? style.imageFit ?? "cover"}
            onChange={(e) =>
              change({
                imageFit: e.target.value as SiteBuilderStyle["imageFit"],
              })
            }
          >
            <option value="cover">Fill the space</option>
            <option value="contain">Show the full image</option>
          </select>
        </EditorField>
        <EditorField label="Image focus">
          <select
            value={current.imagePosition ?? style.imagePosition ?? "center"}
            onChange={(e) =>
              change({
                imagePosition: e.target
                  .value as SiteBuilderStyle["imagePosition"],
              })
            }
          >
            {["center", "top", "bottom", "left", "right"].map((v) => (
              <option value={v} key={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </EditorField>
        <label className="sbe-check">
          <input
            type="checkbox"
            checked={responsive[viewport]?.hidden ?? false}
            onChange={(e) =>
              onResponsiveChange({
                ...responsive,
                [viewport]: {
                  ...responsive[viewport],
                  hidden: e.target.checked,
                },
              })
            }
          />
          Hide on {viewport === "mobile" ? "phones" : viewport}
        </label>
        <button
          type="button"
          onClick={() => {
            const next = { ...responsive };
            delete next[viewport];
            onResponsiveChange(next);
          }}
        >
          Reset {viewport} overrides
        </button>
      </details>
    </>
  );
}

const itemFields: Partial<
  Record<SiteBuilderSection["moduleId"], Array<keyof SiteBuilderItem>>
> = {
  faq: ["question", "answer"],
  testimonials: ["quote", "author", "role", "image"],
  transformation: ["title", "body", "beforeImage", "afterImage", "caption"],
  stats: ["value", "title", "body"],
  team: ["title", "role", "body", "image", "imageAlt"],
  logos: ["title", "image", "imageAlt"],
  gallery: ["title", "image", "imageAlt", "caption"],
  schedule: ["title", "body", "value"],
  credentials: ["title", "body", "image", "imageAlt"],
  quote: ["quote", "author", "role"],
  comparison: ["title", "body", "value"],
  resources: ["title", "body", "image", "href"],
  social: ["title", "href", "body"],
  navigation: ["title", "href"],
  footer: ["title", "href"],
  image: ["image", "imageAlt", "caption"],
};
const labels: Record<string, string> = {
  body: "Description",
  imageAlt: "Image description",
  beforeImage: "Before photo",
  afterImage: "After photo",
  value: "Value or time",
  author: "Name",
  role: "Role or detail",
  quote: "Quote",
  question: "Question",
  answer: "Answer",
  href: "Link",
  image: "Image",
  title: "Title",
  caption: "Caption",
  eyebrow: "Small label",
};

function SectionItems({
  section,
  onChange,
  onPick,
}: {
  section: SiteBuilderSection;
  onChange: (items: SiteBuilderItem[], group?: string) => void;
  onPick: PickImage;
}) {
  const fields = itemFields[section.moduleId] ?? [
    "title",
    "body",
    "image",
    "imageAlt",
  ];
  return (
    <details open>
      <summary>
        Items <span>{section.content.items.length}</span>
      </summary>
      {section.content.items.map((item, i) => (
        <details className="sbe-item" key={item.id}>
          <summary>
            {item.question || item.title || item.author || `Item ${i + 1}`}
          </summary>
          {fields.map((key) => {
            const value = String(item[key] ?? "");
            const update = (next: string) =>
              onChange(
                section.content.items.map((v) =>
                  v.id === item.id ? { ...v, [key]: next } : v,
                ),
                `item:${item.id}:${key}`,
              );
            if (["image", "beforeImage", "afterImage"].includes(key))
              return (
                <EditorImageField
                  key={key}
                  label={labels[key]}
                  value={value}
                  onChange={update}
                  onPick={onPick}
                />
              );
            if (key === "href")
              return (
                <SafeLinkField
                  key={key}
                  value={value || "/"}
                  onChange={update}
                />
              );
            return (
              <EditorField key={key} label={labels[key] ?? key}>
                {["body", "answer", "quote"].includes(key) ? (
                  <textarea
                    rows={4}
                    value={value}
                    maxLength={key === "answer" ? 4000 : 2000}
                    onChange={(e) => update(e.target.value)}
                  />
                ) : (
                  <input
                    value={value}
                    maxLength={
                      key === "question" ? 300 : key === "caption" ? 500 : 200
                    }
                    onChange={(e) => update(e.target.value)}
                  />
                )}
              </EditorField>
            );
          })}
          <div className="sbe-inline">
            <button
              type="button"
              aria-label={`Move item ${i + 1} up`}
              disabled={i === 0}
              onClick={() => {
                const next = [...section.content.items];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              aria-label={`Move item ${i + 1} down`}
              disabled={i === section.content.items.length - 1}
              onClick={() => {
                const next = [...section.content.items];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className="sbe-danger"
              onClick={() =>
                onChange(section.content.items.filter((v) => v.id !== item.id))
              }
            >
              <Trash2 size={14} />
              Remove item
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        disabled={section.content.items.length >= 24}
        onClick={() =>
          onChange([
            ...section.content.items,
            {
              id: newEditorId("item"),
              title: "New item",
              body: "",
              ...(section.moduleId === "faq"
                ? {
                    title: "",
                    question: "A question visitors often ask",
                    answer: "Your answer goes here.",
                  }
                : {}),
            },
          ])
        }
      >
        <Plus size={14} />
        Add item
      </button>
    </details>
  );
}

export function EditorElementTree({
  elements,
  selected,
  onSelect,
  onMove,
  parentId = null,
  depth = 0,
}: {
  elements: SiteBuilderElement[];
  selected?: string;
  onSelect: (id: string) => void;
  onMove: (id: string, parentId: string | null, index: number) => void;
  parentId?: string | null;
  depth?: number;
}) {
  function drop(e: React.DragEvent, index: number) {
    const id = e.dataTransfer.getData("application/x-builder-element");
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      onMove(id, parentId, index);
    }
  }
  return (
    <div
      className="sbe-element-tree"
      style={{ paddingInlineStart: depth ? 10 : 0 }}
    >
      {elements.map((element, index) => (
        <div key={element.id}>
          <button
            type="button"
            className={selected === element.id ? "is-active" : ""}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData(
                "application/x-builder-element",
                element.id,
              );
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => drop(e, index)}
            onClick={() => onSelect(element.id)}
          >
            <span className="sbe-element-kind">
              {element.type === "columns" ? "▥" : "·"}
            </span>
            <span>
              {element.text?.slice(0, 32) ||
                element.action?.label ||
                element.type}
            </span>
          </button>
          {element.type === "columns" && (
            <EditorElementTree
              elements={element.children}
              selected={selected}
              onSelect={onSelect}
              onMove={onMove}
              parentId={element.id}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
      <div
        className="sbe-element-drop"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => drop(e, elements.length)}
      >
        {elements.length ? "Move an element here" : "Drop elements here"}
      </div>
    </div>
  );
}

export function SiteBuilderInspector({
  builder,
  page,
  selection,
  elementId,
  viewport,
  site,
  products,
  galleries,
  hasMoreGalleries,
  loadingGalleries,
  onMoreGalleries,
  change,
  changeSite,
  selectElement,
  onPick,
  onViewport,
}: {
  builder: SiteBuilderDocument;
  page: SiteBuilderPage;
  selection: string;
  elementId?: string;
  viewport: EditorViewport;
  site: any;
  products: any[];
  galleries: any[];
  hasMoreGalleries?: boolean;
  loadingGalleries?: boolean;
  onMoreGalleries?: () => void;
  change: BuilderChange;
  changeSite: (key: string, value: string) => void;
  selectElement: (id?: string) => void;
  onPick: PickImage;
  onViewport: (value: EditorViewport) => void;
}) {
  const section = page.sections.find((s) => s.id === selection),
    [tab, setTab] = useState<"content" | "style">("content"),
    [slug, setSlug] = useState(page.slug),
    [slugError, setSlugError] = useState(""),
    [elementError, setElementError] = useState("");
  useEffect(() => {
    setSlug(page.slug);
    setSlugError("");
  }, [page.id, page.slug]);
  const element =
    section && elementId
      ? findEditorElement(section.content.elements, elementId)
      : undefined;
  useEffect(() => setElementError(""), [selection, elementId]);
  const elementLocation =
    section && element
      ? editorElementLocation(section.content.elements, element.id)
      : null;
  const elementSiblings =
    section && elementLocation
      ? elementLocation.parentId
        ? findEditorElement(section.content.elements, elementLocation.parentId)!
            .children
        : section.content.elements
      : [];
  const columns: SiteBuilderElement[] = [];
  function collectColumns(values: SiteBuilderElement[]) {
    for (const value of values) {
      if (value.type === "columns") columns.push(value);
      collectColumns(value.children);
    }
  }
  if (section) collectColumns(section.content.elements);
  function updateSection(
    update: (section: SiteBuilderSection) => void,
    group?: string,
  ) {
    change((next) => {
      const target = next.pages
        .find((p) => p.id === page.id)
        ?.sections.find((s) => s.id === selection);
      if (target) update(target);
    }, group);
  }
  function updateElement(
    update: (element: SiteBuilderElement) => void,
    group?: string,
  ) {
    updateSection((next) => {
      const target =
        elementId && findEditorElement(next.content.elements, elementId);
      if (target) update(target);
    }, group);
  }
  function addElement(
    type: SiteBuilderElement["type"],
    parentId: string | null = null,
  ) {
    if (!section) return;
    const next = addEditorElement(section.content.elements, type, parentId);
    if (!next) {
      setElementError(
        "This layout is full. Keep up to 12 elements in a group and four levels of columns, or add another section.",
      );
      return;
    }
    setElementError("");
    updateSection((target) => {
      target.content.elements = next;
    });
  }
  function moveElement(id: string, parentId: string | null, index: number) {
    if (!section) return;
    const next = moveEditorElement(
      section.content.elements,
      id,
      parentId,
      index,
    );
    if (!next) {
      setElementError(
        "That move would nest the layout too deeply or place a column inside itself. Choose another position.",
      );
      return;
    }
    setElementError("");
    updateSection((target) => {
      target.content.elements = next;
    });
  }
  if (selection === "$theme")
    return (
      <>
        <div className="sbe-panel-heading">
          <small>WEBSITE DESIGN</small>
          <h2>Make it yours</h2>
          <p>
            Your public website has its own design. Your coaching app keeps its
            current appearance.
          </p>
        </div>
        <EditorField label="Font family">
          <select
            value={builder.theme.font}
            onChange={(e) =>
              change((next) => {
                next.theme.font = e.target
                  .value as SiteBuilderDocument["theme"]["font"];
              })
            }
          >
            <option value="sans">Clean & modern</option>
            <option value="serif">Editorial & refined</option>
            <option value="display">Bold & athletic</option>
            <option value="rounded">Warm & friendly</option>
            <option value="mono">Technical & precise</option>
          </select>
        </EditorField>
        {(
          [
            "background",
            "text",
            "accent",
            "surface",
            "muted",
            "border",
          ] as const
        ).map((key) => (
          <EditorField
            key={key}
            label={`${key[0].toUpperCase()}${key.slice(1)} colour`}
          >
            <div className="sbe-colour">
              <input
                type="color"
                value={builder.theme[key]}
                onChange={(e) =>
                  change((next) => {
                    next.theme[key] = e.target.value;
                  }, `theme:${key}`)
                }
              />
              <span>{builder.theme[key]}</span>
            </div>
          </EditorField>
        ))}
        <NumberField
          label="Website width"
          value={builder.theme.width}
          fallback={1200}
          min={900}
          max={1600}
          step={10}
          onChange={(width) =>
            change((next) => {
              next.theme.width = width;
            }, "theme:width")
          }
        />
        <NumberField
          label="Corner radius"
          value={builder.theme.radius}
          fallback={12}
          max={40}
          onChange={(radius) =>
            change((next) => {
              next.theme.radius = radius;
            }, "theme:radius")
          }
        />
      </>
    );
  if (selection === "$page")
    return (
      <>
        <div className="sbe-panel-heading">
          <small>PAGE SETTINGS</small>
          <h2>{page.title}</h2>
        </div>
        <EditorField label="Page title">
          <input
            value={page.title}
            maxLength={100}
            onChange={(e) =>
              change((next) => {
                next.pages.find((p) => p.id === page.id)!.title =
                  e.target.value;
              }, `page:${page.id}:title`)
            }
          />
        </EditorField>
        {page.slug !== "" && (
          <EditorField
            label="Page address"
            hint={
              slugError ||
              "Changing an address keeps a redirect from the old address."
            }
          >
            <div className="sbe-slug">
              <span>/</span>
              <input
                value={slug}
                maxLength={60}
                aria-invalid={!!slugError}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                onBlur={() => {
                  try {
                    const changed = renameBuilderPage(builder, page.id, slug);
                    change((next) => Object.assign(next, changed));
                    setSlugError("");
                  } catch (error) {
                    setSlugError((error as Error).message);
                  }
                }}
              />
            </div>
          </EditorField>
        )}
        {page.slug === "" ? (
          <p className="sbe-help">
            This is your home page. Its address stays at the root of your
            website.
          </p>
        ) : (
          <label className="sbe-check">
            <input
              type="checkbox"
              checked={page.visible}
              onChange={(e) =>
                change((next) => {
                  next.pages.find((p) => p.id === page.id)!.visible =
                    e.target.checked;
                })
              }
            />
            Include in the published website
          </label>
        )}
        <label className="sbe-check">
          <input
            type="checkbox"
            checked={page.inNavigation}
            onChange={(e) =>
              change((next) => {
                next.pages.find((p) => p.id === page.id)!.inNavigation =
                  e.target.checked;
              })
            }
          />
          Show in the navigation menu
        </label>
        {page.slug !== "" && (
          <EditorField label="Navigation group">
            <select
              value={page.parentId ?? ""}
              onChange={(e) =>
                change((next) => {
                  const target = next.pages.find((p) => p.id === page.id)!;
                  if (e.target.value) target.parentId = e.target.value;
                  else delete target.parentId;
                })
              }
            >
              <option value="">Top-level page</option>
              {builder.pages
                .filter(
                  (p) =>
                    p.id !== page.id &&
                    !p.parentId &&
                    !builder.pages.some((child) => child.parentId === page.id),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Under {p.title}
                  </option>
                ))}
            </select>
          </EditorField>
        )}
        <details open>
          <summary>Search & sharing</summary>
          <EditorField
            label="Search title"
            hint={`${page.seoTitle.length}/100 characters`}
          >
            <input
              value={page.seoTitle}
              maxLength={100}
              placeholder={page.title}
              onChange={(e) =>
                change((next) => {
                  next.pages.find((p) => p.id === page.id)!.seoTitle =
                    e.target.value;
                }, `page:${page.id}:seoTitle`)
              }
            />
          </EditorField>
          <EditorField
            label="Search description"
            hint={`${page.seoDescription.length}/200 characters`}
          >
            <textarea
              rows={4}
              value={page.seoDescription}
              maxLength={200}
              onChange={(e) =>
                change((next) => {
                  next.pages.find((p) => p.id === page.id)!.seoDescription =
                    e.target.value;
                }, `page:${page.id}:seoDescription`)
              }
            />
          </EditorField>
          <EditorImageField
            label="Social sharing image"
            value={page.socialImage}
            onChange={(url) =>
              change((next) => {
                next.pages.find((p) => p.id === page.id)!.socialImage = url;
              })
            }
            onPick={onPick}
          />
          <label className="sbe-check">
            <input
              type="checkbox"
              checked={page.noindex}
              onChange={(e) =>
                change((next) => {
                  next.pages.find((p) => p.id === page.id)!.noindex =
                    e.target.checked;
                })
              }
            />
            Ask search engines not to list this page
          </label>
        </details>
      </>
    );
  if (selection === "$header" || selection === "$footer") {
    const key = selection === "$header" ? "header" : "footer",
      target = builder[key];
    return (
      <>
        <div className="sbe-panel-heading">
          <small>ON EVERY PAGE</small>
          <h2>{key === "header" ? "Website header" : "Website footer"}</h2>
          <p>One shared design keeps every page consistent.</p>
        </div>
        <EditorField label="Layout">
          <select
            value={target.variant}
            onChange={(e) =>
              change((next) => {
                (next[key] as { variant: string }).variant = e.target.value;
              })
            }
          >
            {(key === "header"
              ? ["simple", "centered", "split"]
              : ["simple", "columns", "centered"]
            ).map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </EditorField>
        {key === "header" ? (
          <>
            {(["sticky", "showLogo", "showTitle"] as const).map((k) => (
              <label className="sbe-check" key={k}>
                <input
                  type="checkbox"
                  checked={builder.header[k]}
                  onChange={(e) =>
                    change((next) => {
                      next.header[k] = e.target.checked;
                    })
                  }
                />
                {k === "sticky"
                  ? "Keep the menu visible while scrolling"
                  : k === "showLogo"
                    ? "Show brand logo"
                    : "Show coach name"}
              </label>
            ))}
            <p className="sbe-help">
              Set your logo in the coaching brand settings. The menu follows the
              order of your pages.
            </p>
          </>
        ) : (
          <>
            <EditorField label="Footer text">
              <textarea
                rows={4}
                value={builder.footer.text}
                maxLength={1000}
                onChange={(e) =>
                  change((next) => {
                    next.footer.text = e.target.value;
                  }, "footer:text")
                }
              />
            </EditorField>
            <label className="sbe-check">
              <input
                type="checkbox"
                checked={builder.footer.showSocial}
                onChange={(e) =>
                  change((next) => {
                    next.footer.showSocial = e.target.checked;
                  })
                }
              />
              Show contact & social links
            </label>
          </>
        )}
        <details open>
          <summary>Action button</summary>
          {target.action ? (
            <>
              <EditorActionField
                action={target.action}
                builder={builder}
                products={products}
                onChange={(action) =>
                  change((next) => {
                    next[key].action = action;
                  }, `${key}:action`)
                }
              />
              <button
                type="button"
                onClick={() =>
                  change((next) => {
                    delete next[key].action;
                  })
                }
              >
                Remove button
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                change((next) => {
                  next[key].action = {
                    label: "Start coaching",
                    kind: "signup",
                    newTab: false,
                  };
                })
              }
            >
              <Plus size={14} />
              Add a button
            </button>
          )}
        </details>
      </>
    );
  }
  if (selection === "$site")
    return (
      <>
        <div className="sbe-panel-heading">
          <small>WEBSITE SETTINGS</small>
          <h2>Contact & language</h2>
        </div>
        <EditorField label="Website language">
          <select
            value={site.language ?? "en"}
            onChange={(e) => changeSite("language", e.target.value)}
          >
            <option value="en">English</option>
            <option value="ar">العربية · Arabic</option>
          </select>
        </EditorField>
        <p className="sbe-help">
          Arabic uses a right-to-left layout. Write or translate your page
          content in the chosen language.
        </p>
        {[
          ["contactEmail", "Public contact email"],
          ["whatsapp", "WhatsApp number"],
          ["instagram", "Instagram HTTPS link"],
          ["youtube", "YouTube HTTPS link"],
        ].map(([key, label]) => (
          <EditorField
            key={key}
            label={label}
            hint={
              key === "whatsapp"
                ? "Include the country code, for example +971…"
                : undefined
            }
          >
            <input
              type={key === "contactEmail" ? "email" : "text"}
              value={site[key] ?? ""}
              onChange={(e) => changeSite(key, e.target.value)}
            />
          </EditorField>
        ))}
        <p className="sbe-help">
          Forms on your website send inquiries to your coaching inbox.
        </p>
      </>
    );
  if (!section)
    return (
      <div className="sbe-inspector-empty">
        <h2>Your details, your design.</h2>
        <p>Choose a section on the canvas to edit its content and layout.</p>
        <p>Double-click a heading or paragraph to edit it directly.</p>
      </div>
    );
  const definition = SITE_BUILDER_MODULES.find(
    (m) => m.id === section.moduleId,
  )!;
  const showImage = ![
    "faq",
    "stats",
    "divider",
    "text",
    "navigation",
    "footer",
    "pricing",
    "programmes",
    "schedule",
    "columns",
  ].includes(section.moduleId);
  const showItems =
    section.content.items.length > 0 ||
    [
      "team",
      "benefits",
      "services",
      "process",
      "gallery",
      "transformation",
      "testimonials",
      "logos",
      "faq",
      "stats",
      "schedule",
      "credentials",
      "social",
      "resources",
      "comparison",
      "nutrition",
      "community",
      "navigation",
      "footer",
    ].includes(section.moduleId);
  return (
    <>
      <div className="sbe-panel-heading">
        <small>{element ? "CUSTOM ELEMENT" : "SECTION"}</small>
        <h2>
          {element
            ? element.type[0].toUpperCase() + element.type.slice(1)
            : definition.label}
        </h2>
        {element && (
          <button type="button" onClick={() => selectElement(undefined)}>
            Back to section
          </button>
        )}
      </div>
      <div
        className="sbe-inspector-tabs"
        role="tablist"
        aria-label="Section controls"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "content"}
          onClick={() => setTab("content")}
        >
          Content
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "style"}
          onClick={() => setTab("style")}
        >
          Design
        </button>
      </div>
      {tab === "style" ? (
        <EditorStyleFields
          style={element?.style ?? section.style}
          responsive={element?.responsive ?? section.responsive}
          viewport={viewport}
          onViewport={onViewport}
          onChange={(patch) =>
            element
              ? updateElement((next) => {
                  Object.assign(next.style, patch);
                }, `element:${element.id}:style`)
              : updateSection((next) => {
                  Object.assign(next.style, patch);
                }, `section:${section.id}:style`)
          }
          onResponsiveChange={(responsive) =>
            element
              ? updateElement((next) => {
                  next.responsive = responsive;
                })
              : updateSection((next) => {
                  next.responsive = responsive;
                })
          }
        />
      ) : element ? (
        <>
          {["text", "heading"].includes(element.type) && (
            <EditorField label="Text">
              <textarea
                rows={element.type === "heading" ? 3 : 7}
                value={element.text ?? ""}
                maxLength={12000}
                onChange={(e) =>
                  updateElement((next) => {
                    next.text = e.target.value;
                  }, `element:${element.id}:text`)
                }
              />
            </EditorField>
          )}
          {element.type === "image" && (
            <>
              <EditorImageField
                value={element.image ?? ""}
                onChange={(image) =>
                  updateElement((next) => {
                    next.image = image;
                  })
                }
                onPick={onPick}
              />
              <EditorField label="Image description">
                <input
                  value={element.imageAlt ?? ""}
                  maxLength={240}
                  onChange={(e) =>
                    updateElement((next) => {
                      next.imageAlt = e.target.value;
                    }, `element:${element.id}:alt`)
                  }
                />
              </EditorField>
            </>
          )}
          {element.type === "video" && (
            <VideoField
              value={element.videoUrl ?? ""}
              onChange={(videoUrl) =>
                updateElement((next) => {
                  next.videoUrl = videoUrl;
                })
              }
            />
          )}
          {element.type === "button" && (
            <EditorActionField
              action={
                element.action ?? {
                  label: "Start coaching",
                  kind: "signup",
                  newTab: false,
                }
              }
              builder={builder}
              products={products}
              onChange={(action) =>
                updateElement((next) => {
                  next.action = action;
                }, `element:${element.id}:action`)
              }
            />
          )}
          {element.type === "columns" && (
            <>
              <p className="sbe-help">
                Add elements inside these columns, then drag them in the layer
                list to rearrange or nest them.
              </p>
              <ElementAddButtons
                onAdd={(type) => addElement(type, element.id)}
              />
            </>
          )}
          {elementLocation && (
            <details open>
              <summary>Position in this section</summary>
              <EditorField label="Move element into">
                <select
                  value={elementLocation.parentId ?? ""}
                  onChange={(e) =>
                    moveElement(
                      element.id,
                      e.target.value || null,
                      e.target.value
                        ? findEditorElement(
                            section.content.elements,
                            e.target.value,
                          )!.children.length
                        : section.content.elements.length,
                    )
                  }
                >
                  <option value="">Section root</option>
                  {columns
                    .filter(
                      (column) =>
                        column.id !== element.id &&
                        !findEditorElement(element.children, column.id),
                    )
                    .map((column, index) => (
                      <option key={column.id} value={column.id}>
                        Columns {index + 1}
                        {column.id === elementLocation.parentId
                          ? " · current"
                          : ""}
                      </option>
                    ))}
                </select>
              </EditorField>
              <div className="sbe-inline">
                <button
                  type="button"
                  disabled={elementLocation.index === 0}
                  onClick={() =>
                    moveElement(
                      element.id,
                      elementLocation.parentId,
                      elementLocation.index - 1,
                    )
                  }
                >
                  <ArrowUp size={14} />
                  Move element up
                </button>
                <button
                  type="button"
                  disabled={
                    elementLocation.index === elementSiblings.length - 1
                  }
                  onClick={() =>
                    moveElement(
                      element.id,
                      elementLocation.parentId,
                      elementLocation.index + 2,
                    )
                  }
                >
                  <ArrowDown size={14} />
                  Move element down
                </button>
              </div>
            </details>
          )}
          {elementError && (
            <p className="sbe-error" role="alert">
              {elementError}
            </p>
          )}
          <button
            className="sbe-danger"
            type="button"
            onClick={() => {
              updateSection((next) => {
                next.content.elements = removeEditorElement(
                  next.content.elements,
                  element.id,
                );
              });
              selectElement(undefined);
            }}
          >
            <Trash2 size={14} />
            Remove element
          </button>
        </>
      ) : (
        <>
          <EditorField label="Section layout">
            <select
              value={section.variant}
              onChange={(e) =>
                updateSection((next) => {
                  next.variant = e.target.value;
                })
              }
            >
              {definition.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </EditorField>
          {section.moduleId !== "divider" && (
            <>
              <EditorField label="Small label">
                <input
                  value={section.content.eyebrow}
                  maxLength={100}
                  onChange={(e) =>
                    updateSection((next) => {
                      next.content.eyebrow = e.target.value;
                    }, `${section.id}:eyebrow`)
                  }
                />
              </EditorField>
              <EditorField label="Title">
                <textarea
                  rows={3}
                  value={section.content.title}
                  maxLength={300}
                  onChange={(e) =>
                    updateSection((next) => {
                      next.content.title = e.target.value;
                    }, `${section.id}:title`)
                  }
                />
              </EditorField>
              <EditorField label="Body">
                <textarea
                  rows={6}
                  value={section.content.body}
                  maxLength={20000}
                  onChange={(e) =>
                    updateSection((next) => {
                      next.content.body = e.target.value;
                    }, `${section.id}:body`)
                  }
                />
              </EditorField>
            </>
          )}
          {showImage && (
            <details open={!!section.content.image}>
              <summary>Image</summary>
              <EditorImageField
                value={section.content.image}
                onChange={(image) =>
                  updateSection((next) => {
                    next.content.image = image;
                  })
                }
                onPick={onPick}
              />
              <EditorField
                label="Image description"
                hint="Describe the image for visitors who use a screen reader."
              >
                <input
                  value={section.content.imageAlt}
                  maxLength={240}
                  onChange={(e) =>
                    updateSection((next) => {
                      next.content.imageAlt = e.target.value;
                    }, `${section.id}:imageAlt`)
                  }
                />
              </EditorField>
            </details>
          )}
          {["video", "hero", "about", "split", "app-preview"].includes(
            section.moduleId,
          ) && (
            <details open={section.moduleId === "video"}>
              <summary>Video</summary>
              <VideoField
                value={section.content.videoUrl}
                onChange={(videoUrl) =>
                  updateSection((next) => {
                    next.content.videoUrl = videoUrl;
                  })
                }
              />
              <EditorImageField
                label="Video cover"
                value={section.content.poster}
                onChange={(poster) =>
                  updateSection((next) => {
                    next.content.poster = poster;
                  })
                }
                onPick={onPick}
              />
              <EditorField label="Video caption">
                <textarea
                  rows={2}
                  value={section.content.caption}
                  maxLength={1000}
                  onChange={(e) =>
                    updateSection((next) => {
                      next.content.caption = e.target.value;
                    }, `${section.id}:caption`)
                  }
                />
              </EditorField>
              <p className="sbe-help">
                Use the video provider for hosting and captions. Uploaded video
                files are not supported here.
              </p>
            </details>
          )}
          {(["programmes", "programme-detail", "pricing"].includes(
            section.moduleId,
          ) ||
            section.content.productIds.length > 0) && (
            <details open>
              <summary>Connected programmes</summary>
              <p className="sbe-help">
                Prices and programme details stay linked to your actual offers.
                Select none to show all available programmes.
              </p>
              {section.content.productIds
                .filter((id) => !products.some((p) => p.id === id))
                .map((id) => (
                  <label className="sbe-check" key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        updateSection((next) => {
                          next.content.productIds =
                            next.content.productIds.filter(
                              (value) => value !== id,
                            );
                        })
                      }
                    />
                    Unavailable programme · uncheck to remove
                  </label>
                ))}
              {products.length ? (
                products.map((p) => (
                  <label className="sbe-check" key={p.id}>
                    <input
                      type="checkbox"
                      checked={section.content.productIds.includes(p.id)}
                      onChange={(e) =>
                        updateSection((next) => {
                          next.content.productIds = e.target.checked
                            ? [...next.content.productIds, p.id]
                            : next.content.productIds.filter(
                                (id) => id !== p.id,
                              );
                        })
                      }
                    />
                    {p.data?.name ?? p.data?.title ?? "Coaching programme"}
                  </label>
                ))
              ) : (
                <p className="sbe-help">
                  Your published programmes will appear here once you create
                  them.
                </p>
              )}
            </details>
          )}
          {(section.moduleId === "gallery" || section.content.galleryId) && (
            <EditorField label="Connected gallery">
              <select
                value={section.content.galleryId ?? ""}
                onChange={(e) =>
                  updateSection((next) => {
                    if (e.target.value) next.content.galleryId = e.target.value;
                    else delete next.content.galleryId;
                  })
                }
              >
                <option value="">Use images in this section</option>
                {section.content.galleryId &&
                  !galleries.some(
                    (g) => g.id === section.content.galleryId,
                  ) && (
                    <option value={section.content.galleryId}>
                      Unavailable gallery · choose another
                    </option>
                  )}
                {galleries.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title ?? g.name ?? "Gallery"}
                  </option>
                ))}
              </select>
            </EditorField>
          )}
          {section.moduleId === "gallery" && hasMoreGalleries && (
            <button
              type="button"
              disabled={loadingGalleries}
              onClick={onMoreGalleries}
            >
              {loadingGalleries ? "Loading galleries…" : "Load more galleries"}
            </button>
          )}
          {showItems && (
            <SectionItems
              section={section}
              onChange={(items, group) =>
                updateSection((next) => {
                  next.content.items = items;
                }, group)
              }
              onPick={onPick}
            />
          )}
          {section.moduleId !== "divider" && (
            <details open={section.content.actions.length > 0}>
              <summary>
                Buttons <span>{section.content.actions.length}</span>
              </summary>
              {section.content.actions.map((action, index) => (
                <div className="sbe-action-card" key={index}>
                  <EditorActionField
                    action={action}
                    builder={builder}
                    products={products}
                    onChange={(value) =>
                      updateSection((next) => {
                        next.content.actions[index] = value;
                      }, `${section.id}:action:${index}`)
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateSection((next) => {
                        next.content.actions.splice(index, 1);
                      })
                    }
                  >
                    Remove button
                  </button>
                </div>
              ))}
              {section.content.actions.length < 3 && (
                <button
                  type="button"
                  onClick={() =>
                    updateSection((next) => {
                      next.content.actions.push({
                        label: "Start coaching",
                        kind: "signup",
                        newTab: false,
                      });
                    })
                  }
                >
                  <Plus size={14} />
                  Add a button
                </button>
              )}
            </details>
          )}
          {section.moduleId === "columns" && (
            <details open>
              <summary>Custom elements</summary>
              <p className="sbe-help">
                Drag elements within the layer list. Drop into a column to nest
                them.
              </p>
              <EditorElementTree
                elements={section.content.elements}
                selected={elementId}
                onSelect={selectElement}
                onMove={moveElement}
              />
              <ElementAddButtons onAdd={(type) => addElement(type)} />
              {elementError && (
                <p className="sbe-error" role="alert">
                  {elementError}
                </p>
              )}
            </details>
          )}
          <p className="sbe-help sbe-anchor">Section link: #{section.id}</p>
        </>
      )}
    </>
  );
}

function ElementAddButtons({
  onAdd,
}: {
  onAdd: (type: SiteBuilderElement["type"]) => void;
}) {
  return (
    <div className="sbe-element-buttons">
      {(
        [
          "heading",
          "text",
          "image",
          "button",
          "video",
          "spacer",
          "columns",
        ] as const
      ).map((type) => (
        <button type="button" key={type} onClick={() => onAdd(type)}>
          <Plus size={12} />
          {type[0].toUpperCase() + type.slice(1)}
        </button>
      ))}
    </div>
  );
}
