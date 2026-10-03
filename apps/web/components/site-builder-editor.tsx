"use client";
import "../app/site-builder-editor.css";
import { confirmWorkspace } from "./workspace-feedback";
import { useSearchParams } from "next/navigation";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  History,
  LayoutTemplate,
  LoaderCircle,
  Monitor,
  Palette,
  Plus,
  Redo2,
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  SITE_BUILDER_MODULES,
  SITE_BUILDER_GROUPS,
  SITE_BUILDER_TEMPLATES,
  SITE_BUILDER_PRESET_COUNT,
  createModule,
  createTemplate,
  duplicateSection,
  duplicatePage,
  legacyToBuilder,
  siteBuilderSchema,
  siteBuilderPageSchema,
  getBuilderPublishIssues,
  resolveBrandDesign,
  type SiteBuilderDocument,
  type SiteBuilderModuleId,
  type SiteBuilderPage,
  type SiteBuilderSection,
} from "@trainer/contracts";
import {
  BuilderTheme,
  BuilderHeader,
  BuilderFooter,
  BuilderSection,
  BuilderWebsite,
} from "./site-builder-renderer";
import {
  SiteBuilderInspector,
  EditorField,
  EditorElementTree,
  type EditorViewport,
  type PickImage,
} from "./site-builder-editor-inspector";
import {
  copyEditorValue,
  createEditorSaveQueue,
  applyEditorStarter,
  remapEditorPageActions,
  editHistory,
  undoHistory,
  redoHistory,
  newEditorId,
  moveEditorItem,
  moveEditorElement,
  editorSlug,
  type EditorHistory,
} from "./site-builder-editor-model";

type EditorSite = Record<string, any> & { builder: SiteBuilderDocument };
type EditorTenant = { slug: string; published: boolean; name?: string };
type Pane = "sections" | "pages" | "layers" | "saved";
type Dialog =
  | "templates"
  | "starter"
  | "history"
  | "publish"
  | "page"
  | "save-section"
  | "media"
  | null;
type StarterProposal = {
  builder: SiteBuilderDocument;
  source: "ai" | "template";
  cached?: boolean;
  message?: string;
};

async function builderApi(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.message || "We could not complete that action. Please try again.",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

function EditorDialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== "Tab" || !panel.current) return;
      const elements = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length > 0);
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="sbe-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`sbe-dialog ${wide ? "sbe-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <header>
          <div>
            <span className="sbe-eyebrow">YOUR COACHING WEBSITE</span>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ModuleThumbnail({
  moduleId,
  variant = "",
  colour,
}: {
  moduleId: string;
  variant?: string;
  colour?: string;
}) {
  const grid = [
    "benefits",
    "services",
    "programmes",
    "pricing",
    "team",
    "gallery",
    "testimonials",
    "resources",
    "comparison",
    "nutrition",
  ].includes(moduleId);
  const form = ["contact", "lead", "booking", "faq", "schedule"].includes(
    moduleId,
  );
  return (
    <div
      aria-hidden="true"
      className={`sbe-module-thumbnail ${grid ? "is-grid" : form ? "is-form" : "is-split"} thumb-${moduleId} ${variant}`}
      style={
        colour ? ({ "--thumb-accent": colour } as CSSProperties) : undefined
      }
    >
      <div className="thumb-heading" />
      <div className="thumb-lines">
        <i />
        <i />
        <i />
      </div>
      <div className="thumb-visual">
        <b />
        <b />
        <b />
      </div>
      {moduleId === "transformation" && (
        <div className="thumb-progress-pair">
          <span>Before</span>
          <span>After</span>
        </div>
      )}
      <div className="thumb-button" />
    </div>
  );
}

export function SiteBuilderEditor({ tenant }: { tenant: EditorTenant }) {
  const returnTo = useSearchParams().get("from") === "setup" ? "/setup/page" : "/trainer";
  const [mountedDesktop, setMountedDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 1100px) and (hover: hover) and (pointer: fine)",
    );
    const update = () => {
      if (query.matches) setMountedDesktop(true);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <>
      <div
        className="sbe-desktop-required"
        data-testid="site-builder-desktop-required"
        tabIndex={-1}
      >
        <div className="sbe-desktop-illustration">
          <Monitor size={52} strokeWidth={1.2} />
        </div>
        <span className="sbe-eyebrow">WEBSITE STUDIO</span>
        <h1>A bigger canvas for your ideas.</h1>
        <p>
          Open the website editor on a desktop or laptop with a mouse or
          trackpad, and a window at least 1,100 pixels wide. Your published
          website still works beautifully on phones and tablets.
        </p>
        <a className="button" href={returnTo}>
          {returnTo === "/setup/page" ? "Back to setup" : "Back to workspace"}
        </a>
        {tenant.published && (
          <a href={`/coach/${tenant.slug}`}>
            View your website <ExternalLink size={14} />
          </a>
        )}
      </div>
      {mountedDesktop ? (
        <DesktopSiteBuilder tenant={tenant} returnTo={returnTo} />
      ) : (
        <div className="sbe-desktop-loading">Opening Website Studio…</div>
      )}
    </>
  );
}

function DesktopSiteBuilder({ tenant, returnTo }: { tenant: EditorTenant; returnTo: string }) {
  const editorRoot = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<EditorHistory<EditorSite> | null>(
      null,
    ),
    historyRef = useRef(history);
  const [server, setServer] = useState<any>(null),
    serverRef = useRef<any>(null),
    savedJson = useRef("");
  const [contextData, setContextData] = useState<any>(null),
    [loadingError, setLoadingError] = useState("");
  const [pane, setPane] = useState<Pane>("sections"),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState("All sections");
  const [pageId, setPageId] = useState(""),
    [selection, setSelection] = useState(""),
    [elementId, setElementId] = useState<string>();
  const [viewport, setViewport] = useState<EditorViewport>("desktop"),
    [preview, setPreview] = useState(false),
    [zoom, setZoom] = useState("fit"),
    [stageWidth, setStageWidth] = useState(900);
  const stageRef = useRef<HTMLDivElement>(null),
    [dragging, setDragging] = useState(false),
    [dropIndex, setDropIndex] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<
      "saved" | "pending" | "saving" | "error" | "conflict"
    >("saved"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const saveQueue = useRef(createEditorSaveQueue()),
    failedJson = useRef(""),
    conflictRef = useRef(false),
    [saveTick, setSaveTick] = useState(0),
    mounted = useRef(true);
  const [dialog, setDialog] = useState<Dialog>(null),
    [dialogError, setDialogError] = useState(""),
    [newPageTitle, setNewPageTitle] = useState(""),
    [sectionName, setSectionName] = useState("");
  const [revisions, setRevisions] = useState<any[]>([]),
    [revisionToRestore, setRevisionToRestore] = useState<any>(null);
  const [proposal, setProposal] = useState<StarterProposal | null>(null),
    [proposalPage, setProposalPage] = useState("");
  const [starterBrief, setStarterBrief] = useState(""),
    [starterTemplate, setStarterTemplate] = useState(""),
    [starterOptions, setStarterOptions] = useState<any>(null),
    [generating, setGenerating] = useState(false),
    starterRequest = useRef<{ key: string; id: string } | null>(null);
  const pickImageApply = useRef<((url: string, alt?: string) => void) | null>(
      null,
    ),
    [media, setMedia] = useState<any[]>([]),
    [mediaMore, setMediaMore] = useState(false),
    [mediaSearch, setMediaSearch] = useState(""),
    [uploadRights, setUploadRights] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [extraGalleries, setExtraGalleries] = useState<any[]>([]),
    [galleryOffset, setGalleryOffset] = useState<number | null>(0),
    [galleryBusy, setGalleryBusy] = useState(false);
  const draft = history?.present,
    builder = draft?.builder,
    page = builder?.pages.find((p) => p.id === pageId) ?? builder?.pages[0];
  const currentSection = page?.sections.find(
    (section) => section.id === selection,
  );
  const liveDraft = useRef(draft);
  liveDraft.current = draft;
  const dirty = !!draft && JSON.stringify(draft) !== savedJson.current;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;

  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 1100px) and (hover: hover) and (pointer: fine)",
    );
    let release: (() => void) | undefined;
    function isolate() {
      release?.();
      release = undefined;
      const root = editorRoot.current;
      if (!root || !media.matches) return;
      const previous: Array<[HTMLElement, boolean]> = [];
      let child: HTMLElement = root;
      // Keep the editor's ancestors active, but remove every sibling branch
      // from the tab order. This also covers the workspace navigation.
      while (child.parentElement && child !== document.body) {
        for (const sibling of Array.from(child.parentElement.children)) {
          // Native dialogs are hidden until opened and showModal owns their
          // focus isolation. Explicit inert would block their own controls.
          if (
            sibling !== child &&
            sibling instanceof HTMLElement &&
            !(sibling instanceof HTMLDialogElement)
          ) {
            previous.push([sibling, sibling.inert]);
            sibling.inert = true;
          }
        }
        child = child.parentElement;
      }
      const bodyOverflow = document.body.style.overflow,
        htmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      if (!root.contains(document.activeElement))
        root.focus({ preventScroll: true });
      release = () => {
        previous.forEach(([element, wasInert]) => {
          element.inert = wasInert;
        });
        document.body.style.overflow = bodyOverflow;
        document.documentElement.style.overflow = htmlOverflow;
        if (!media.matches && root.contains(document.activeElement))
          document
            .querySelector<HTMLElement>(".sbe-desktop-required")
            ?.focus({ preventScroll: true });
      };
    }
    isolate();
    media.addEventListener("change", isolate);
    return () => {
      media.removeEventListener("change", isolate);
      release?.();
    };
  }, [!!builder]);

  function setEditorHistory(next: EditorHistory<EditorSite>) {
    historyRef.current = next;
    liveDraft.current = next.present;
    setHistory(next);
  }
  const load = useCallback(async () => {
    setLoadingError("");
    try {
      const [row, data] = await Promise.all([
        builderApi("/tenant/site"),
        builderApi("/tenant/site/preview"),
      ]);
      if (!mounted.current) return;
      const next: EditorSite = {
        ...row.draft,
        builder: row.draft.builder ?? legacyToBuilder(row.draft, data.tenant),
      };
      serverRef.current = row;
      setServer(row);
      setContextData(data);
      savedJson.current = JSON.stringify(next);
      failedJson.current = "";
      conflictRef.current = false;
      setEditorHistory({ past: [], present: next, future: [] });
      setPageId(next.builder.pages[0].id);
      setSelection(next.builder.pages[0].sections[0]?.id ?? "$page");
      setElementId(undefined);
      setSaveStatus("saved");
      setMessage("");
    } catch (error) {
      if (mounted.current) setLoadingError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  function change(
    changeBuilder: (builder: SiteBuilderDocument) => void,
    groupKey?: string,
  ) {
    const state = historyRef.current;
    if (!state || busy) return;
    const next = copyEditorValue(state.present);
    changeBuilder(next.builder);
    setEditorHistory(editHistory(state, next, groupKey));
    if (!conflictRef.current) setSaveStatus("pending");
  }
  function changeSite(key: string, value: string) {
    const state = historyRef.current;
    if (!state || busy) return;
    const next = { ...state.present, [key]: value };
    setEditorHistory(editHistory(state, next, `site:${key}`));
    if (!conflictRef.current) setSaveStatus("pending");
  }
  function undo() {
    const state = historyRef.current;
    if (state && !busy) {
      setEditorHistory(undoHistory(state));
      if (!conflictRef.current) setSaveStatus("pending");
    }
  }
  function redo() {
    const state = historyRef.current;
    if (state && !busy) {
      setEditorHistory(redoHistory(state));
      if (!conflictRef.current) setSaveStatus("pending");
    }
  }
  const saveNow = useCallback(
    (force = false): Promise<any> =>
      saveQueue.current(async () => {
        const current = historyRef.current?.present;
        if (!current || conflictRef.current) return null;
        const json = JSON.stringify(current);
        if (!force && json === savedJson.current) return serverRef.current;
        const valid = siteBuilderSchema.safeParse(current.builder);
        if (!valid.success) {
          failedJson.current = json;
          setSaveStatus("error");
          setMessage(
            `Draft not saved: ${valid.error.issues[0]?.message ?? "check the page content"}.`,
          );
          return null;
        }
        setSaveStatus("saving");
        failedJson.current = "";
        const promise = builderApi("/tenant/site", "PUT", {
          version: serverRef.current.version,
          site: current,
        })
          .then((row) => {
            serverRef.current = row;
            savedJson.current = json;
            if (mounted.current) {
              setServer(row);
              setSaveStatus(
                JSON.stringify(historyRef.current?.present) === json
                  ? "saved"
                  : "pending",
              );
              setSaveTick((n) => n + 1);
            }
            return row;
          })
          .catch((error: Error & { status?: number }) => {
            failedJson.current = json;
            conflictRef.current = error.status === 409;
            if (mounted.current) {
              setSaveStatus(conflictRef.current ? "conflict" : "error");
              setMessage(
                conflictRef.current
                  ? "This website was updated in another window. Your edits are still here. Download a copy before loading the saved draft."
                  : error.message,
              );
            }
            return null;
          });
        return promise;
      }),
    [],
  );

  useEffect(() => {
    if (!draft || !dirty || conflictRef.current || busy) return;
    const json = JSON.stringify(draft);
    if (failedJson.current === json) return;
    const timer = window.setTimeout(() => void saveNow(), 1100);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, busy, saveNow, saveTick]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        historyRef.current &&
        JSON.stringify(historyRef.current.present) !== savedJson.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (dialogRef.current) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveNow(true);
      }
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if (key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if (key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [saveNow, busy]);
  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setStageWidth(entry.contentRect.width),
    );
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [!!builder, preview]);
  useEffect(() => {
    if (!page) return;
    if (
      selection &&
      !selection.startsWith("$") &&
      !page.sections.some((s) => s.id === selection)
    ) {
      setSelection("$page");
      setElementId(undefined);
    }
  }, [page, selection]);

  const products = contextData?.products ?? [],
    galleries = Array.from(
      new Map<string, any>(
        [
          ...(contextData?.galleries ?? []),
          ...(contextData?.boundGalleries ?? []),
          ...extraGalleries,
        ].map((gallery: any) => [gallery.id, gallery]),
      ).values(),
    );
  const brandDesign = resolveBrandDesign(contextData?.tenant?.theme);
  const context = {
    name: contextData?.tenant?.name ?? tenant.name ?? tenant.slug,
    tenantSlug: tenant.slug,
    basePath: `/coach/${tenant.slug}`,
    joinPath: `/join-coach/${tenant.slug}`,
    products,
    galleries,
    preview: true,
    contactEmail: draft?.contactEmail,
    whatsapp: draft?.whatsapp,
    instagram: draft?.instagram,
    youtube: draft?.youtube,
    language: (draft?.language ?? "en") as "en" | "ar",
    logoUrl: brandDesign.logoUrl,
    photoUrl: brandDesign.photoUrl,
  };
  const previewWidth =
    viewport === "mobile" ? 390 : viewport === "tablet" ? 768 : 1200;
  const scale =
    zoom === "fit"
      ? Math.min(1, Math.max(0.25, (stageWidth - 56) / previewWidth))
      : Number(zoom);
  const searchTerms = search
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const modules = SITE_BUILDER_MODULES.filter(
    (m) =>
      (group === "All sections" || group === m.group) &&
      searchTerms.every((term) =>
        `${m.id} ${m.label} ${m.description} ${m.group} ${m.variants.map((variant) => `${variant.id} ${variant.label} ${variant.description}`).join(" ")}`
          .toLowerCase()
          .includes(term),
      ),
  );
  function selectSection(id: string) {
    setSelection(id);
    setElementId(undefined);
  }
  function goPage(id: string) {
    setPageId(id);
    setSelection("$page");
    setElementId(undefined);
  }
  function openDialog(next: Dialog) {
    setDialogError("");
    setDialog(next);
    if (next !== "templates" && next !== "starter") setProposal(null);
  }
  function closeDialog() {
    if (!busy && !generating) {
      setDialog(null);
      setDialogError("");
      setRevisionToRestore(null);
    }
  }
  function addModule(
    moduleId: SiteBuilderModuleId,
    index = dropIndex ?? page?.sections.length ?? 0,
  ) {
    if (!page || page.sections.length >= 60) {
      setMessage(
        "A page can contain up to 60 sections. Add another page for more content.",
      );
      return;
    }
    const section = createModule(
      moduleId,
      undefined,
      {},
      draft?.language ?? "en",
    );
    change((next) => {
      next.pages
        .find((p) => p.id === page.id)!
        .sections.splice(index, 0, section);
    });
    selectSection(section.id);
    setDropIndex(null);
    setDragging(false);
  }
  function dropSection(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!page) return;
    const moduleId = event.dataTransfer.getData(
        "application/x-builder-module",
      ) as SiteBuilderModuleId,
      sectionId = event.dataTransfer.getData("application/x-builder-section"),
      savedId = event.dataTransfer.getData("application/x-builder-saved");
    if (SITE_BUILDER_MODULES.some((m) => m.id === moduleId))
      addModule(moduleId, index);
    else if (sectionId)
      change((next) => {
        const target = next.pages.find((p) => p.id === page.id)!;
        target.sections = moveEditorItem(target.sections, sectionId, index);
      });
    else if (savedId && builder) {
      const saved = builder.savedSections.find((s) => s.id === savedId);
      if (saved) addSavedSection(saved.section, index);
    }
    setDragging(false);
    setDropIndex(null);
  }
  function addSavedSection(
    section: SiteBuilderSection,
    index = page?.sections.length ?? 0,
  ) {
    if (!page || page.sections.length >= 60) return;
    const duplicate = duplicateSection(section);
    change((next) => {
      next.pages
        .find((p) => p.id === page.id)!
        .sections.splice(index, 0, duplicate);
    });
    selectSection(duplicate.id);
  }
  function duplicateCurrentSection(section: SiteBuilderSection) {
    if (!page || page.sections.length >= 60) return;
    const duplicate = duplicateSection(section);
    change((next) => {
      const target = next.pages.find((p) => p.id === page.id)!;
      target.sections.splice(
        target.sections.findIndex((s) => s.id === section.id) + 1,
        0,
        duplicate,
      );
    });
    selectSection(duplicate.id);
  }
  function removeSection(id: string) {
    if (!page) return;
    change((next) => {
      const target = next.pages.find((p) => p.id === page.id)!;
      target.sections = target.sections.filter((s) => s.id !== id);
    });
    setSelection("$page");
  }
  function moveSection(id: string, direction: -1 | 1) {
    if (!page) return;
    const index = page.sections.findIndex((s) => s.id === id);
    change((next) => {
      const target = next.pages.find((p) => p.id === page.id)!;
      target.sections = moveEditorItem(
        target.sections,
        id,
        direction < 0 ? index - 1 : index + 2,
      );
    });
  }
  function duplicateCurrentPage(source: SiteBuilderPage) {
    if (!builder || builder.pages.length >= 100) return;
    const created = duplicatePage(source, {
      title: `${source.title} copy`.slice(0, 100),
      slug: editorSlug(
        `${source.slug || "home"}-copy`,
        builder.pages.map((p) => p.slug),
      ),
      inNavigation: false,
    });
    change((next) => {
      next.pages.push(created);
    });
    goPage(created.id);
  }
  async function deletePage(source: SiteBuilderPage) {
    if (!builder || source.slug === "") return;
    if (
      !(await confirmWorkspace({ title: "Confirm action", detail: `Remove “${source.title}” from this draft? Buttons linking to it will lead to your home page. You can undo this change.`, confirm: "Continue" }))
    )
      return;
    change((next) => {
      next.pages = next.pages.filter((p) => p.id !== source.id);
      next.redirects = next.redirects.filter((r) => r.toPageId !== source.id);
      for (const p of next.pages)
        if (p.parentId === source.id) delete p.parentId;
      remapEditorPageActions(
        next,
        new Map([[source.id, next.pages.find((p) => p.slug === "")!.id]]),
      );
    });
    goPage(builder.pages.find((p) => p.slug === "")!.id);
  }
  function downloadDraft() {
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tenant.slug}-website-draft.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function loadHistory() {
    openDialog("history");
    setRevisionToRestore(null);
    setBusy(true);
    try {
      setRevisions((await builderApi("/tenant/site/history")).items);
    } catch (error) {
      setDialogError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restoreRevision() {
    if (!revisionToRestore) return;
    setBusy(true);
    setDialogError("");
    try {
      const saved = await saveNow();
      if (!saved)
        throw new Error("Save your current draft before restoring a version.");
      const row = await builderApi("/tenant/site/restore", "POST", {
        version: saved.version,
        revisionId: revisionToRestore.id,
      });
      const restored: EditorSite = {
        ...row.draft,
        builder:
          row.draft.builder ?? legacyToBuilder(row.draft, contextData?.tenant),
      };
      const state = historyRef.current!;
      setEditorHistory(editHistory(state, restored));
      serverRef.current = row;
      setServer(row);
      savedJson.current = JSON.stringify(restored);
      setSaveStatus("saved");
      setPageId(restored.builder.pages[0].id);
      setSelection("$page");
      setDialog(null);
      setMessage(
        "Version restored to your private draft. Review it, then publish when ready.",
      );
    } catch (error) {
      setDialogError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publishSite() {
    setBusy(true);
    setDialogError("");
    try {
      const row = await saveNow(true);
      if (!row)
        throw new Error(
          "Save your draft before publishing. Your edits remain in the editor.",
        );
      const published = await builderApi("/tenant/site/publish", "POST", {
        version: row.version,
      });
      serverRef.current = published;
      setServer(published);
      setDialog(null);
      setMessage("Your website is published. All visible pages are live.");
      setSaveStatus("saved");
    } catch (error) {
      setDialogError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openStarter() {
    setProposal(null);
    openDialog("starter");
    setStarterOptions(null);
    try {
      setStarterOptions(await builderApi("/tenant/site/starter/options"));
    } catch (error) {
      setStarterOptions({ available: false, reason: (error as Error).message });
    }
  }
  async function generateStarter() {
    if (!starterBrief.trim() || !draft) return;
    setGenerating(true);
    setDialogError("");
    const key = JSON.stringify({
      brief: starterBrief,
      templateId: starterTemplate,
      language: draft.language ?? "en",
    });
    if (starterRequest.current?.key !== key)
      starterRequest.current = { key, id: crypto.randomUUID() };
    try {
      const saved = await saveNow();
      if (!saved)
        throw new Error("Save your current draft before creating a starter.");
      const result = await builderApi("/tenant/site/starter", "POST", {
        requestId: starterRequest.current.id,
        brief: starterBrief.trim(),
        ...(starterTemplate ? { templateId: starterTemplate } : {}),
        language: draft.language ?? "en",
        version: saved.version,
      });
      siteBuilderSchema.parse(result.builder);
      setProposal(result);
      setProposalPage(result.builder.pages[0].id);
    } catch (error) {
      setDialogError((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }
  function applyProposal() {
    if (!proposal) return;
    change((next) =>
      Object.assign(next, applyEditorStarter(next, proposal.builder)),
    );
    setPageId(proposal.builder.pages[0].id);
    setSelection("$page");
    setElementId(undefined);
    setDialog(null);
    setMessage(
      "Starter applied. Your saved section library is kept; its page links match the new pages or lead to Home. Review the content before publishing. Undo restores your previous draft.",
    );
    setProposal(null);
  }
  async function loadMoreGalleries() {
    if (galleryOffset === null) return;
    setGalleryBusy(true);
    try {
      const data = await builderApi(
        `/tenant/galleries?offset=${galleryOffset}`,
      );
      setExtraGalleries((previous) => [
        ...previous,
        ...data.galleries.filter(
          (gallery: any) =>
            gallery.audience === "site" || gallery.audience === "both",
        ),
      ]);
      setGalleryOffset(data.nextOffset);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setGalleryBusy(false);
    }
  }
  async function loadMedia(offset = 0) {
    const result = await builderApi(`/tenant/media?offset=${offset}`);
    setMedia((items) => (offset ? [...items, ...result.items] : result.items));
    setMediaMore(result.items.length === 48);
  }
  const pickImage: PickImage = (apply) => {
    pickImageApply.current = apply;
    openDialog("media");
    setMediaSearch("");
    setUploadRights(false);
    setBusy(true);
    void loadMedia()
      .catch((error) => setDialogError(error.message))
      .finally(() => setBusy(false));
  };
  async function uploadPhoto(file: File) {
    if (!uploadRights) return;
    setBusy(true);
    setDialogError("");
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Choose a photo smaller than 8 MB.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("This photo could not be read."));
        reader.readAsDataURL(file);
      });
      const photo = await builderApi("/tenant/media", "POST", {
        filename: file.name,
        data,
        rightsConfirmed: true,
      });
      await loadMedia();
      setMessage("Photo uploaded. Choose it to add it to your page.");
      if (!photo.url)
        throw new Error(
          "Your photo was uploaded but its preview is not ready. Reload the photo library.",
        );
    } catch (error) {
      setDialogError((error as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function navigateAway(href: string) {
    const row = await saveNow();
    if (row) window.location.assign(href);
  }

  if (!builder || !page || !draft)
    return (
      <div
        className="sbe sbe-loading"
        data-testid="site-builder-editor"
        ref={editorRoot}
        tabIndex={-1}
      >
        <Monitor size={36} />
        <h1>Website Studio</h1>
        {loadingError ? (
          <>
            <p role="alert">{loadingError}</p>
            <button onClick={() => void load()}>Try again</button>
            <a href={returnTo}>{returnTo === "/setup/page" ? "Back to setup" : "Back to workspace"}</a>
          </>
        ) : (
          <p>Opening your private draft…</p>
        )}
      </div>
    );
  const publishIssues = getBuilderPublishIssues(builder);

  return (
    <div
      className={`sbe ${preview ? "is-preview" : ""} ${dragging ? "is-dragging" : ""}`}
      data-testid="site-builder-editor"
      ref={editorRoot}
      tabIndex={-1}
      onDragEnd={() => {
        setDragging(false);
        setDropIndex(null);
      }}
    >
      <header className="sbe-topbar">
        <div className="sbe-topbar-brand">
          <a
            href={returnTo}
            aria-label={returnTo === "/setup/page" ? "Back to setup" : "Back to workspace"}
            title={returnTo === "/setup/page" ? "Back to setup" : "Back to workspace"}
            onClick={(e) => {
              if (dirty) {
                e.preventDefault();
                void navigateAway(returnTo);
              }
            }}
          >
            <ArrowLeft size={18} />
          </a>
          <div>
            <strong>
              Website Studio
              <span className="sbe-beta-dot" />
            </strong>
            <small>{tenant.slug}.trainsyou.com</small>
          </div>
        </div>
        <div
          className="sbe-save-state"
          role="status"
          data-testid="builder-save-status"
        >
          {saveStatus === "saving" ? (
            <LoaderCircle size={14} className="sbe-spin" />
          ) : saveStatus === "error" || saveStatus === "conflict" ? (
            <CircleAlert size={14} />
          ) : saveStatus === "pending" || dirty ? (
            <span className="sbe-pending-dot" />
          ) : (
            <Check size={14} />
          )}
          <span>
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "error"
                ? "Not saved"
                : saveStatus === "conflict"
                  ? "Changes need review"
                  : dirty
                    ? "Unsaved changes"
                    : "Draft saved"}
          </span>
          <span className="sbe-private-label">Private until published</span>
        </div>
        <div className="sbe-topbar-actions">
          <button
            type="button"
            className="sbe-icon"
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            disabled={!history.past.length || busy}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            className="sbe-icon"
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            disabled={!history.future.length || busy}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
          <span className="sbe-toolbar-divider" />
          <button
            type="button"
            disabled={
              busy || saveStatus === "saving" || saveStatus === "conflict"
            }
            onClick={() => void saveNow(true)}
          >
            Save draft
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
          >
            <Eye size={16} />
            {preview ? "Back to editing" : "Preview"}
          </button>
          <button
            type="button"
            className="sbe-primary"
            disabled={busy || saveStatus === "conflict"}
            onClick={() => openDialog("publish")}
          >
            Publish
            <ArrowUp size={15} />
          </button>
        </div>
      </header>
      <div className="sbe-toolbar">
        <div className="sbe-page-switcher">
          <FileText size={15} />
          <select
            aria-label="Current page"
            value={page.id}
            onChange={(e) => goPage(e.target.value)}
          >
            {builder.pages.map((p) => (
              <option value={p.id} key={p.id}>
                {p.title}
                {!p.visible ? " · draft only" : ""}
              </option>
            ))}
          </select>
          <button
            className="sbe-icon"
            type="button"
            aria-label="Page settings"
            title="Page settings"
            onClick={() => selectSection("$page")}
          >
            <Settings2 size={15} />
          </button>
        </div>
        <div className="sbe-device-controls" aria-label="Canvas preview size">
          {(
            [
              ["desktop", Monitor, "Desktop preview"],
              ["tablet", Tablet, "Tablet preview"],
              ["mobile", Smartphone, "Phone preview"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              type="button"
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={viewport === value}
              onClick={() => setViewport(value)}
            >
              <Icon size={17} />
            </button>
          ))}
          <span>{previewWidth}px</span>
          <select
            aria-label="Canvas zoom"
            value={zoom}
            onChange={(e) => setZoom(e.target.value)}
          >
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
          </select>
        </div>
        <div className="sbe-toolbar-tools">
          <button
            type="button"
            onClick={() => {
              setProposal(null);
              openDialog("templates");
            }}
          >
            <LayoutTemplate size={15} />
            Templates
          </button>
          <button type="button" onClick={() => void openStarter()}>
            <Sparkles size={15} />
            AI starter
          </button>
          <button
            type="button"
            aria-label="Published versions"
            title="Published versions"
            onClick={() => void loadHistory()}
          >
            <History size={17} />
          </button>
          <a
            href="/trainer/website/settings"
            aria-label="Website settings"
            title="Website settings & inquiries"
            onClick={(e) => {
              if (dirty) {
                e.preventDefault();
                void navigateAway("/trainer/website/settings");
              }
            }}
          >
            <Settings2 size={17} />
          </a>
        </div>
      </div>
      {message && (
        <div
          className={`sbe-message ${saveStatus === "error" || saveStatus === "conflict" ? "sbe-message-error" : ""}`}
          role="status"
        >
          <span>{message}</span>
          {saveStatus === "conflict" ? (
            <>
              <button onClick={downloadDraft}>Download my draft</button>
              <button
                onClick={async () => {
                  if (
                    (await confirmWorkspace({ title: "Confirm action", detail: "Load the saved draft and discard the edits in this window? Download your draft first if you want to keep a copy.", confirm: "Continue" }))
                  )
                    void load();
                }}
              >
                Load saved draft
              </button>
            </>
          ) : saveStatus === "error" ? (
            <button onClick={() => void saveNow(true)}>Try saving again</button>
          ) : null}
          <button
            className="sbe-icon"
            aria-label="Dismiss notice"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="sbe-workarea">
        {!preview && (
          <aside
            className="sbe-left-panel"
            aria-label="Website structure and sections"
          >
            <div
              className="sbe-left-tabs"
              role="tablist"
              aria-label="Builder panels"
            >
              {(
                [
                  ["sections", "Sections"],
                  ["pages", "Pages"],
                  ["layers", "Layers"],
                  ["saved", "Saved"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  role="tab"
                  key={key}
                  aria-selected={pane === key}
                  onClick={() => setPane(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="sbe-left-scroll">
              {pane === "sections" && (
                <>
                  <div className="sbe-panel-heading">
                    <h2>Build your page.</h2>
                    <p>
                      {SITE_BUILDER_MODULES.length} section types ·{" "}
                      {SITE_BUILDER_PRESET_COUNT} layouts
                    </p>
                  </div>
                  <label className="sbe-search">
                    <Search size={15} />
                    <input
                      aria-label="Search sections"
                      placeholder="Find a section…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    className="sbe-group-select"
                    aria-label="Section category"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option>All sections</option>
                    {SITE_BUILDER_GROUPS.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <p className="sbe-drag-hint">
                    Drag onto your page, or click to add.
                  </p>
                  <div className="sbe-module-catalog">
                    {modules.map((module) => (
                      <button
                        type="button"
                        className="sbe-module-card"
                        key={module.id}
                        data-module-id={module.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-builder-module",
                            module.id,
                          );
                          e.dataTransfer.effectAllowed = "copy";
                          setDragging(true);
                        }}
                        onClick={() => addModule(module.id)}
                        title={module.description}
                      >
                        <ModuleThumbnail moduleId={module.id} />
                        <span>
                          <strong>{module.label}</strong>
                          <small>{module.variants.length} layouts</small>
                          <Plus size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                  {!modules.length && (
                    <p className="sbe-empty">
                      No sections match that search. Try a shorter word or
                      another category.
                    </p>
                  )}
                </>
              )}
              {pane === "pages" && (
                <>
                  <div className="sbe-panel-heading">
                    <h2>Your pages</h2>
                    <p>Drag to arrange the navigation.</p>
                  </div>
                  <div className="sbe-page-list">
                    {builder.pages.map((p, index) => (
                      <div
                        key={p.id}
                        className={`sbe-page-row ${p.id === page.id ? "is-active" : ""} ${p.parentId ? "is-child" : ""}`}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-builder-page",
                            p.id,
                          )
                        }
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData(
                            "application/x-builder-page",
                          );
                          if (id)
                            change((next) => {
                              next.pages = moveEditorItem(
                                next.pages,
                                id,
                                index,
                              );
                            });
                        }}
                      >
                        <button
                          type="button"
                          className="sbe-page-select"
                          onClick={() => goPage(p.id)}
                        >
                          <GripVertical size={13} />
                          <FileText size={14} />
                          <span>{p.title || "Untitled page"}</span>
                          {!p.visible ? (
                            <EyeOff size={13} />
                          ) : p.slug === "" ? (
                            <small>HOME</small>
                          ) : !p.inNavigation ? (
                            <small>HIDDEN MENU</small>
                          ) : null}
                        </button>
                        {p.id === page.id && (
                          <div className="sbe-page-actions">
                            <button
                              type="button"
                              title="Move page up"
                              aria-label="Move page up"
                              disabled={index === 0}
                              onClick={() =>
                                change((next) => {
                                  next.pages = moveEditorItem(
                                    next.pages,
                                    p.id,
                                    index - 1,
                                  );
                                })
                              }
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              type="button"
                              title="Move page down"
                              aria-label="Move page down"
                              disabled={index === builder.pages.length - 1}
                              onClick={() =>
                                change((next) => {
                                  next.pages = moveEditorItem(
                                    next.pages,
                                    p.id,
                                    index + 2,
                                  );
                                })
                              }
                            >
                              <ArrowDown size={13} />
                            </button>
                            <button
                              type="button"
                              title="Duplicate page"
                              aria-label="Duplicate page"
                              onClick={() => duplicateCurrentPage(p)}
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              type="button"
                              title="Delete page"
                              aria-label="Delete page"
                              disabled={p.slug === ""}
                              onClick={() => deletePage(p)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="sbe-wide-button"
                    disabled={builder.pages.length >= 100}
                    onClick={() => {
                      setNewPageTitle("");
                      openDialog("page");
                    }}
                  >
                    <Plus size={15} />
                    New page
                  </button>
                  <div className="sbe-shared-controls">
                    <small>SHARED ACROSS YOUR WEBSITE</small>
                    <button
                      type="button"
                      onClick={() => selectSection("$header")}
                    >
                      <LayoutTemplate size={15} />
                      Header & navigation
                    </button>
                    <button
                      type="button"
                      onClick={() => selectSection("$footer")}
                    >
                      <LayoutTemplate size={15} />
                      Footer
                    </button>
                    <button
                      type="button"
                      onClick={() => selectSection("$site")}
                    >
                      <Settings2 size={15} />
                      Contact & language
                    </button>
                  </div>
                </>
              )}
              {pane === "layers" && (
                <>
                  <div className="sbe-panel-heading">
                    <h2>{page.title}</h2>
                    <p>
                      Drag sections into order. Use the arrows for precise
                      moves.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="sbe-layer-global"
                    onClick={() => selectSection("$header")}
                  >
                    Shared header
                  </button>
                  {page.sections.map((section, index) => (
                    <div
                      className={`sbe-layer ${selection === section.id ? "is-active" : ""}`}
                      key={section.id}
                    >
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-builder-section",
                            section.id,
                          );
                          setDragging(true);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => dropSection(e, index)}
                        onClick={() => selectSection(section.id)}
                      >
                        <GripVertical size={14} />
                        <span>
                          {section.content.title ||
                            SITE_BUILDER_MODULES.find(
                              (m) => m.id === section.moduleId,
                            )?.label}
                        </span>
                        {section.responsive[viewport]?.hidden && (
                          <EyeOff size={12} />
                        )}
                      </button>
                      {selection === section.id && (
                        <>
                          <div className="sbe-layer-actions">
                            <button
                              aria-label="Move section up"
                              disabled={index === 0}
                              onClick={() => moveSection(section.id, -1)}
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              aria-label="Move section down"
                              disabled={index === page.sections.length - 1}
                              onClick={() => moveSection(section.id, 1)}
                            >
                              <ArrowDown size={13} />
                            </button>
                            <button
                              aria-label="Duplicate section"
                              onClick={() => duplicateCurrentSection(section)}
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              aria-label="Delete section"
                              onClick={() => removeSection(section.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          {section.moduleId === "columns" && (
                            <EditorElementTree
                              elements={section.content.elements}
                              selected={elementId}
                              onSelect={setElementId}
                              onMove={(id, parentId, boundary) => {
                                const moved = moveEditorElement(
                                  section.content.elements,
                                  id,
                                  parentId,
                                  boundary,
                                );
                                if (moved)
                                  change((next) => {
                                    next.pages
                                      .find((p) => p.id === page.id)!
                                      .sections.find(
                                        (s) => s.id === section.id,
                                      )!.content.elements = moved;
                                  });
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <div
                    className="sbe-layer-end"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => dropSection(e, page.sections.length)}
                  >
                    Drop at end of page
                  </div>
                  <button
                    type="button"
                    className="sbe-layer-global"
                    onClick={() => selectSection("$footer")}
                  >
                    Shared footer
                  </button>
                </>
              )}
              {pane === "saved" && (
                <>
                  <div className="sbe-panel-heading">
                    <h2>Your saved sections</h2>
                    <p>
                      Reuse a design on any page. Each new copy is independent.
                    </p>
                  </div>
                  {builder.savedSections.map((saved) => (
                    <div className="sbe-saved-card" key={saved.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-builder-saved",
                            saved.id,
                          );
                          setDragging(true);
                        }}
                        onClick={() => addSavedSection(saved.section)}
                      >
                        <ModuleThumbnail moduleId={saved.section.moduleId} />
                        <strong>{saved.name}</strong>
                        <small>Click or drag to add</small>
                      </button>
                      <button
                        type="button"
                        className="sbe-icon sbe-saved-delete"
                        aria-label={`Remove saved section ${saved.name}`}
                        onClick={() =>
                          change((next) => {
                            next.savedSections = next.savedSections.filter(
                              (s) => s.id !== saved.id,
                            );
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {!builder.savedSections.length && (
                    <div className="sbe-empty">
                      <Bookmark size={28} />
                      <p>
                        Save a section from its canvas toolbar. It will be ready
                        to use again here.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              className={`sbe-global-design ${selection === "$theme" ? "is-active" : ""}`}
              onClick={() => selectSection("$theme")}
            >
              <Palette size={16} />
              <span>
                Website design<small>Fonts, colours & corners</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </aside>
        )}
        <main
          className="sbe-canvas-stage"
          ref={stageRef}
          aria-label="Website canvas"
        >
          <div className="sbe-canvas-title">
            <span>{preview ? "PRIVATE PREVIEW" : "YOUR PRIVATE DRAFT"}</span>
            <span>
              {page.title} / {page.sections.length} sections
            </span>
          </div>
          <div className="sbe-canvas-centre">
            <div
              className="sbe-canvas-frame"
              style={{ width: previewWidth, zoom: scale } as CSSProperties}
              data-viewport={viewport}
            >
              {preview ? (
                <BuilderWebsite
                  builder={builder}
                  context={context}
                  path={page.slug}
                  preview
                  onNavigate={(slug: string) => {
                    const destination = builder.pages.find(
                      (p) =>
                        p.slug === slug ||
                        `/${p.slug}` === slug ||
                        `${context.basePath}/${p.slug}` === slug,
                    );
                    if (destination) goPage(destination.id);
                  }}
                />
              ) : (
                <BuilderTheme
                  theme={builder.theme}
                  language={draft.language ?? "en"}
                  className="sbe-editable-site"
                >
                  <div
                    className={`sbe-global-canvas ${selection === "$header" ? "is-selected" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      selectSection("$header");
                    }}
                  >
                    <span className="sbe-global-hint">Edit shared header</span>
                    <BuilderHeader
                      builder={builder}
                      context={context}
                      path={page.slug}
                      onNavigate={() => {}}
                    />
                  </div>
                  {page.sections.map((section, index) => (
                    <div key={section.id}>
                      <div
                        className={`sbe-dropzone ${dropIndex === index ? "is-over" : ""}`}
                        data-drop-index={index}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDropIndex(index);
                        }}
                        onDrop={(e) => dropSection(e, index)}
                      >
                        <button
                          type="button"
                          aria-label={`Add section before ${index + 1}`}
                          onClick={() => {
                            setPane("sections");
                            setDropIndex(index);
                          }}
                        >
                          <Plus size={15} />
                          Add section
                        </button>
                      </div>
                      <section
                        className={`sbe-canvas-section ${selection === section.id ? "is-selected" : ""} ${section.responsive[viewport]?.hidden ? "is-hidden-section" : ""}`}
                        data-section-id={section.id}
                        onClick={(e) => {
                          if (
                            (e.target as HTMLElement).closest(
                              ".sbe-section-tools",
                            )
                          )
                            return;
                          if (
                            (e.target as HTMLElement).closest("a,button,form")
                          )
                            e.preventDefault();
                          selectSection(section.id);
                          const element = (
                            e.target as HTMLElement
                          ).closest<HTMLElement>("[data-element-id]");
                          if (element?.dataset.elementId)
                            setElementId(element.dataset.elementId);
                        }}
                        onDragOver={(e) => {
                          if (
                            !e.dataTransfer.types.includes(
                              "application/x-builder-element",
                            )
                          ) {
                            e.preventDefault();
                            const bounds =
                              e.currentTarget.getBoundingClientRect();
                            setDropIndex(
                              e.clientY > bounds.top + bounds.height / 2
                                ? index + 1
                                : index,
                            );
                          }
                        }}
                        onDrop={(e) => {
                          if (
                            !e.dataTransfer.types.includes(
                              "application/x-builder-element",
                            )
                          )
                            dropSection(e, dropIndex ?? index);
                        }}
                      >
                        <div className="sbe-section-tools">
                          <button
                            type="button"
                            className="sbe-section-grip"
                            aria-label={`Drag ${SITE_BUILDER_MODULES.find((m) => m.id === section.moduleId)?.label} section`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                "application/x-builder-section",
                                section.id,
                              );
                              e.dataTransfer.effectAllowed = "move";
                              setDragging(true);
                            }}
                          >
                            <GripVertical size={15} />
                            <span>
                              {
                                SITE_BUILDER_MODULES.find(
                                  (m) => m.id === section.moduleId,
                                )?.label
                              }
                            </span>
                          </button>
                          <span className="sbe-tools-space" />
                          <button
                            type="button"
                            aria-label="Move section up"
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => moveSection(section.id, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Move section down"
                            title="Move down"
                            disabled={index === page.sections.length - 1}
                            onClick={() => moveSection(section.id, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Duplicate section"
                            title="Duplicate section"
                            onClick={() => duplicateCurrentSection(section)}
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Save section"
                            title="Save section for reuse"
                            onClick={() => {
                              selectSection(section.id);
                              setSectionName(
                                section.content.title.slice(0, 100) ||
                                  SITE_BUILDER_MODULES.find(
                                    (m) => m.id === section.moduleId,
                                  )!.label,
                              );
                              openDialog("save-section");
                            }}
                          >
                            <Bookmark size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete section"
                            title="Delete section"
                            onClick={() => removeSection(section.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        {section.responsive[viewport]?.hidden ? (
                          <div className="sbe-hidden-placeholder">
                            <EyeOff size={22} />
                            <strong>
                              {section.content.title || "Section"}
                            </strong>
                            <p>
                              Hidden on{" "}
                              {viewport === "mobile" ? "phones" : viewport}.
                              Change visibility in Design.
                            </p>
                          </div>
                        ) : (
                          <BuilderSection
                            section={section}
                            context={context}
                            builder={builder}
                            firstHeading={index === 0}
                            selected={selection === section.id}
                            onSelect={selectSection}
                            onTextChange={(
                              id: string,
                              field: string,
                              value: string,
                            ) =>
                              change((next) => {
                                const target = next.pages
                                  .find((p) => p.id === page.id)!
                                  .sections.find((s) => s.id === id);
                                if (
                                  target &&
                                  [
                                    "title",
                                    "body",
                                    "eyebrow",
                                    "caption",
                                  ].includes(field)
                                )
                                  (target.content as Record<string, unknown>)[
                                    field
                                  ] = value;
                              }, `${id}:${field}`)
                            }
                          />
                        )}
                      </section>
                    </div>
                  ))}
                  <div
                    className={`sbe-dropzone sbe-dropzone-end ${dropIndex === page.sections.length ? "is-over" : ""}`}
                    data-drop-index={page.sections.length}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropIndex(page.sections.length);
                    }}
                    onDrop={(e) => dropSection(e, page.sections.length)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPane("sections");
                        setDropIndex(page.sections.length);
                      }}
                    >
                      <Plus size={17} />
                      {page.sections.length
                        ? "Add a section"
                        : "Add your first section"}
                    </button>
                    {!page.sections.length && (
                      <p>
                        Choose a section from the library or drag one into this
                        space.
                      </p>
                    )}
                  </div>
                  <div
                    className={`sbe-global-canvas ${selection === "$footer" ? "is-selected" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      selectSection("$footer");
                    }}
                  >
                    <span className="sbe-global-hint">Edit shared footer</span>
                    <BuilderFooter builder={builder} context={context} />
                  </div>
                </BuilderTheme>
              )}
            </div>
          </div>
          <p className="sbe-canvas-note">
            {preview
              ? "Preview only · forms and purchases stay inactive here."
              : "Double-click text to edit. Select a section to see its controls."}
          </p>
        </main>
        {!preview && (
          <aside
            className="sbe-right-panel"
            aria-label="Content and design inspector"
          >
            <SiteBuilderInspector
              builder={builder}
              page={page}
              selection={selection}
              elementId={elementId}
              viewport={viewport}
              site={draft}
              products={products}
              galleries={galleries}
              hasMoreGalleries={galleryOffset !== null}
              loadingGalleries={galleryBusy}
              onMoreGalleries={() => void loadMoreGalleries()}
              change={change}
              changeSite={changeSite}
              selectElement={setElementId}
              onPick={pickImage}
              onViewport={setViewport}
            />
          </aside>
        )}
      </div>
      <footer className="sbe-statusbar">
        <span>
          <span className="sbe-live-dot" />
          {server?.published_at
            ? `Last published ${new Date(server.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
            : "Your website has not been published yet"}
        </span>
        <span>
          {builder.pages.length} {builder.pages.length === 1 ? "page" : "pages"}{" "}
          · {builder.pages.reduce((n, p) => n + p.sections.length, 0)} sections
        </span>
        {tenant.published && (
          <a href={`/coach/${tenant.slug}`} target="_blank" rel="noreferrer">
            View live website <ExternalLink size={12} />
          </a>
        )}
      </footer>

      {dialog === "page" && (
        <EditorDialog title="Add a page" onClose={closeDialog}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = newPageTitle.trim();
              if (!title) return;
              const created = siteBuilderPageSchema.parse({
                id: newEditorId("page"),
                title,
                slug: editorSlug(
                  title,
                  builder.pages.map((p) => p.slug),
                ),
                sections: [],
              });
              change((next) => {
                next.pages.push(created);
              });
              goPage(created.id);
              setPane("pages");
              setDialog(null);
            }}
          >
            <EditorField label="New page title">
              <input
                autoFocus
                required
                value={newPageTitle}
                maxLength={100}
                placeholder="About my coaching"
                onChange={(e) => setNewPageTitle(e.target.value)}
              />
            </EditorField>
            <p className="sbe-help">
              The page starts with your shared header and footer. Add as many
              sections as you need.
            </p>
            <div className="sbe-dialog-actions">
              <button type="button" onClick={closeDialog}>
                Cancel
              </button>
              <button className="sbe-primary" type="submit">
                Create page
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
      {dialog === "save-section" && currentSection && (
        <EditorDialog title="Save this section" onClose={closeDialog}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!sectionName.trim()) return;
              change((next) => {
                next.savedSections.push({
                  id: newEditorId("saved"),
                  name: sectionName.trim(),
                  section: duplicateSection(currentSection),
                });
              });
              setDialog(null);
              setPane("saved");
            }}
          >
            <EditorField label="Section name">
              <input
                value={sectionName}
                maxLength={100}
                required
                onChange={(e) => setSectionName(e.target.value)}
              />
            </EditorField>
            <p className="sbe-help">
              Keep this design in your section library. Adding it to another
              page creates an independent copy.
            </p>
            <div className="sbe-dialog-actions">
              <button type="button" onClick={closeDialog}>
                Cancel
              </button>
              <button
                className="sbe-primary"
                type="submit"
                disabled={builder.savedSections.length >= 50}
              >
                Save section
              </button>
            </div>
          </form>
        </EditorDialog>
      )}
      {dialog === "publish" && (
        <EditorDialog title="Ready to go live?" onClose={closeDialog}>
          <p>
            Your saved draft will replace the current website on your existing
            address. Pages marked draft only stay private.
          </p>
          <div className="sbe-publish-summary">
            <strong>
              {builder.pages.filter((p) => p.visible).length} pages ready to
              publish
            </strong>
            <span>{tenant.slug}.trainsyou.com</span>
          </div>
          {!tenant.published && (
            <p className="sbe-warning">
              Finish your coach launch review before publishing your website.
              Your draft can still be saved.
            </p>
          )}
          {publishIssues.length > 0 && (
            <div className="sbe-warning">
              <strong>Check these before publishing</strong>
              <ul>
                {publishIssues.map((issue, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => {
                        if (issue.pageId) goPage(issue.pageId);
                        if (issue.sectionId) setSelection(issue.sectionId);
                        setDialog(null);
                      }}
                    >
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="sbe-help">
            Review your photos, client permissions, programme links and contact
            details. Published versions remain available to restore.
          </p>
          {dialogError && (
            <p className="sbe-error" role="alert">
              {dialogError}
            </p>
          )}
          <div className="sbe-dialog-actions">
            <button type="button" disabled={busy} onClick={closeDialog}>
              Keep editing
            </button>
            <button
              type="button"
              className="sbe-primary"
              disabled={busy || !tenant.published || publishIssues.length > 0}
              onClick={() => void publishSite()}
            >
              {busy ? "Publishing…" : "Publish website"}
            </button>
          </div>
        </EditorDialog>
      )}
      {dialog === "history" && (
        <EditorDialog title="Published versions" onClose={closeDialog}>
          <p>
            Restore an earlier publication to your private draft. Your live
            website changes only when you publish it.
          </p>
          {busy && <p className="sbe-help">Loading…</p>}
          {!busy && !revisions.length && (
            <p className="sbe-empty">
              Your first published version will appear here.
            </p>
          )}
          <div className="sbe-history-list">
            {revisions.map((revision) => (
              <button
                type="button"
                key={revision.id}
                className={
                  revisionToRestore?.id === revision.id ? "is-active" : ""
                }
                onClick={() => setRevisionToRestore(revision)}
              >
                <History size={18} />
                <span>
                  <strong>
                    {new Date(revision.createdAt).toLocaleString()}
                  </strong>
                  <small>
                    {revision.pageCount} pages ·{" "}
                    {revision.headline || `Version ${revision.version}`}
                  </small>
                </span>
                {revisionToRestore?.id === revision.id && <Check size={16} />}
              </button>
            ))}
          </div>
          {revisionToRestore && (
            <p className="sbe-warning">
              Your current draft will be saved, then replaced with this version.
              You can undo the restore before publishing.
            </p>
          )}
          {dialogError && (
            <p className="sbe-error" role="alert">
              {dialogError}
            </p>
          )}
          <div className="sbe-dialog-actions">
            <button type="button" disabled={busy} onClick={closeDialog}>
              Close
            </button>
            <button
              type="button"
              className="sbe-primary"
              disabled={busy || !revisionToRestore || conflictRef.current}
              onClick={() => void restoreRevision()}
            >
              Restore to draft
            </button>
          </div>
        </EditorDialog>
      )}
      {(dialog === "templates" || dialog === "starter") && (
        <EditorDialog
          title={
            dialog === "starter"
              ? "A head start, shaped around you."
              : "Start with a complete design."
          }
          wide
          onClose={closeDialog}
        >
          {proposal ? (
            <>
              <div className="sbe-proposal-bar">
                <div>
                  <strong>
                    {proposal.source === "ai"
                      ? "Your suggested website"
                      : "Your starter template"}
                  </strong>
                  <p>
                    {proposal.message ||
                      "A complete starting point made from the section library. Make every word and image your own."}
                  </p>
                </div>
                <select
                  aria-label="Starter preview page"
                  value={proposalPage}
                  onChange={(e) => setProposalPage(e.target.value)}
                >
                  {proposal.builder.pages.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sbe-proposal-preview">
                <BuilderWebsite
                  builder={proposal.builder}
                  context={context}
                  path={
                    proposal.builder.pages.find((p) => p.id === proposalPage)
                      ?.slug ?? ""
                  }
                  preview
                />
              </div>
              <p className="sbe-warning">
                Using this starter replaces your current draft pages and design.
                Your live website stays as it is. You can undo this change.
              </p>
              <div className="sbe-dialog-actions">
                <button type="button" onClick={() => setProposal(null)}>
                  Back to {dialog === "starter" ? "your brief" : "templates"}
                </button>
                <button
                  type="button"
                  className="sbe-primary"
                  onClick={applyProposal}
                >
                  Use this starter
                </button>
              </div>
            </>
          ) : dialog === "starter" ? (
            <div className="sbe-starter-layout">
              <div>
                <p>
                  Tell us who you coach, how you work, and the feeling you want
                  your website to have. The assistant selects existing sections
                  and drafts your copy in one request.
                </p>
                <EditorField
                  label="Describe your coaching website"
                  hint={`${starterBrief.length}/1200 characters`}
                >
                  <textarea
                    value={starterBrief}
                    maxLength={1200}
                    rows={7}
                    placeholder="I coach busy professionals who want to get stronger. My style is calm, direct and practical. I'd like an introduction, my approach, coaching plans, FAQs and a contact page…"
                    onChange={(e) => setStarterBrief(e.target.value)}
                  />
                </EditorField>
                <EditorField label="Starting design">
                  <select
                    value={starterTemplate}
                    onChange={(e) => setStarterTemplate(e.target.value)}
                  >
                    <option value="">Let the assistant choose</option>
                    {SITE_BUILDER_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </EditorField>
                {starterOptions && !starterOptions.available && (
                  <p className="sbe-warning">
                    {starterOptions.reason ||
                      "The website assistant is currently unavailable."}{" "}
                    You can still create a starter from the ready-made
                    templates.
                  </p>
                )}
                {dialogError && (
                  <p role="alert" className="sbe-error">
                    {dialogError}
                  </p>
                )}
                <button
                  type="button"
                  className="sbe-primary"
                  disabled={
                    generating || !starterBrief.trim() || !starterOptions
                  }
                  onClick={() => void generateStarter()}
                >
                  {generating ? (
                    <>
                      <LoaderCircle size={16} className="sbe-spin" />
                      Preparing your starter…
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      {starterOptions?.available === false
                        ? "Create template starter"
                        : "Generate starter"}
                    </>
                  )}
                </button>
              </div>
              <aside>
                <ModuleThumbnail moduleId="hero" />
                <h3>A foundation you can change.</h3>
                <p>
                  Prebuilt sections keep the process quick and focused. You can
                  edit every section afterwards.
                </p>
                <ul>
                  <li>Multiple pages with useful structure</li>
                  <li>Your existing coaching offers</li>
                  <li>Desktop, tablet and phone layouts</li>
                  <li>No automatic publishing</li>
                </ul>
              </aside>
            </div>
          ) : (
            <>
              <p>
                Choose a complete website, then make it your own. Preview the
                pages before replacing your draft.
              </p>
              <div className="sbe-template-grid">
                {SITE_BUILDER_TEMPLATES.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className="sbe-template-card"
                    onClick={() => {
                      const proposed = createTemplate(template.id, {
                        name: context.name,
                        headline: draft.headline,
                        bio: draft.introduction,
                        language: draft.language ?? "en",
                      });
                      setProposal({ builder: proposed, source: "template" });
                      setProposalPage(proposed.pages[0].id);
                    }}
                  >
                    <ModuleThumbnail moduleId="hero" variant={template.id} />
                    <div>
                      <strong>{template.label}</strong>
                      <p>{template.description}</p>
                      <span>
                        Preview template <ArrowUp size={14} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </EditorDialog>
      )}
      {dialog === "media" && (
        <EditorDialog title="Your photo library" wide onClose={closeDialog}>
          <div className="sbe-media-toolbar">
            <label className="sbe-search">
              <Search size={15} />
              <input
                aria-label="Search photos"
                value={mediaSearch}
                onChange={(e) => setMediaSearch(e.target.value)}
                placeholder="Search by filename"
              />
            </label>
            <button
              type="button"
              disabled={!uploadRights || busy}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={15} />
              Upload photo
            </button>
            <input
              hidden
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPhoto(file);
              }}
            />
          </div>
          <label className="sbe-check">
            <input
              type="checkbox"
              checked={uploadRights}
              onChange={(e) => setUploadRights(e.target.checked)}
            />
            I have permission to upload and publish these photos.
          </label>
          <p className="sbe-help">
            Still photos up to 8 MB. Client photos should only be used with
            permission.
          </p>
          {dialogError && (
            <p className="sbe-error" role="alert">
              {dialogError}
            </p>
          )}
          {busy && <p role="status">Loading your photos…</p>}
          <div className="sbe-media-grid">
            {media
              .filter((photo) =>
                (photo.filename ?? "")
                  .toLowerCase()
                  .includes(mediaSearch.toLowerCase()),
              )
              .map((photo) => (
                <button
                  type="button"
                  disabled={busy}
                  key={photo.id}
                  onClick={() => {
                    pickImageApply.current?.(photo.url, photo.filename);
                    setDialog(null);
                  }}
                >
                  <img
                    src={photo.url}
                    alt={photo.filename || "Library photo"}
                    loading="lazy"
                  />
                  <span>{photo.filename}</span>
                </button>
              ))}
          </div>
          {!busy && !media.length && (
            <p className="sbe-empty">
              Your photos will appear here. Upload a photo to get started.
            </p>
          )}
          {mediaMore && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void loadMedia(media.length)
                  .catch((error) => setDialogError(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              Load more photos
            </button>
          )}
        </EditorDialog>
      )}
    </div>
  );
}
