"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  ImageIcon,
  LayoutDashboard,
  MessageCircle,
  Monitor,
  Palette,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Utensils,
  TrendingUp,
  UserRound,
} from "lucide-react";
import {
  brandSchema,
  brandCssVariables,
  brandPresets,
  brandImageSchema,
  resolveBrandDesign,
  type BrandDesign,
  type BrandSection,
} from "@trainer/contracts";

import { PhotoUploader, MediaLibrary } from "./coach-site";

type Tenant = {
  id?: string;
  name: string;
  slug: string;
  published?: boolean;
  theme?: Record<string, any>;
};
type Draft = {
  name: string;
  bio: string;
  category: string;
  accent: string;
  headline: string;
  timezone: "Asia/Dubai";
  design: BrandDesign;
};

const sections: Record<
  BrandSection,
  { title: string; note: string; href: string; icon: typeof Dumbbell }
> = {
  program: {
    title: "My program",
    note: "Your next session, at your pace.",
    href: "/app/program",
    icon: Dumbbell,
  },
  nutrition: {
    title: "My nutrition",
    note: "Meals, recipes and your weekly groceries.",
    href: "/app/nutrition",
    icon: Utensils,
  },
  progress: {
    title: "My progress",
    note: "See the work adding up over time.",
    href: "/app/progress",
    icon: TrendingUp,
  },
  coach: {
    title: "Coach chat",
    note: "A conversation shaped by your coach’s method.",
    href: "/app/chat",
    icon: MessageCircle,
  },
};

function makeDraft(tenant: Tenant): Draft {
  const theme = tenant.theme ?? {};
  const design = resolveBrandDesign(theme);
  return {
    name: tenant.name,
    bio: theme.bio ?? "",
    category: theme.category ?? "",
    accent: design.primary,
    headline: theme.headline ?? "",
    timezone: "Asia/Dubai",
    design,
  };
}

export function TrainerTheme({
  theme,
  children,
  className = "",
}: {
  theme: unknown;
  children: ReactNode;
  className?: string;
}) {
  const design = resolveBrandDesign(theme);
  return (
    <div
      className={`trainer-theme ${className}`}
      style={brandCssVariables(theme) as CSSProperties}
      data-brand-buttons={design.buttonStyle}
      data-brand-density={design.density}
    >
      {children}
    </div>
  );
}

function BrandImage({
  src,
  alt,
  className = "",
  fallback,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState("");
  return src && failed !== src ? (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  ) : (
    <>{fallback}</>
  );
}

export function CoachIdentity({
  name,
  theme,
  compact = false,
}: {
  name: string;
  theme: unknown;
  compact?: boolean;
}) {
  const design = resolveBrandDesign(theme);
  return (
    <div className={`coach-identity ${compact ? "is-compact" : ""}`}>
      <BrandImage
        src={design.logoUrl || design.photoUrl}
        alt={`${name} logo`}
        className="coach-identity-image"
        fallback={
          <span className="coach-identity-monogram" aria-hidden="true">
            {name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
        }
      />
      <span>
        <strong>{name}</strong>
        <small>{design.tagline || "Your personal coaching space"}</small>
      </span>
    </div>
  );
}

export function CoachWelcome({
  name,
  theme,
}: {
  name: string;
  theme: unknown;
}) {
  const design = resolveBrandDesign(theme);
  return (
    <section className={`coach-welcome ${design.coverUrl ? "has-cover" : ""}`}>
      {design.coverUrl && (
        <BrandImage
          src={design.coverUrl}
          alt="Your coach’s cover"
          className="coach-cover"
          fallback={null}
        />
      )}
      <div className="coach-welcome-body">
        <p className="eyebrow">A NOTE FROM {name}</p>
        <h2>{design.tagline || "Progress, with your kind of coaching."}</h2>
        <p>
          {design.welcome ||
            "Welcome to your coaching space. Make room for one positive step today. Your program and your coach are right here."}
        </p>
        {design.photoUrl && (
          <BrandImage
            src={design.photoUrl}
            alt={name}
            className="coach-welcome-photo"
            fallback={null}
          />
        )}
      </div>
    </section>
  );
}

export function CoachCover({ theme }: { theme: unknown }) {
  const design = resolveBrandDesign(theme);
  if (!design.coverUrl) return null;
  return (
    <BrandImage
      src={design.coverUrl}
      alt="Your coach’s cover"
      className="coach-cover coach-store-cover"
      fallback={null}
    />
  );
}

export function ClientHomeSections({ theme }: { theme: unknown }) {
  const design = resolveBrandDesign(theme);
  return (
    <div className="coach-home-sections" aria-label="Your coaching home">
      {design.sectionOrder.map((key, index) => {
        const item = sections[key],
          Icon = item.icon;
        return (
          <Link
            key={key}
            href={item.href}
            className={`coach-home-section ${index === 0 ? "is-featured" : ""}`}
          >
            <Icon size={22} />
            <div>
              <small>{index === 0 ? "YOUR FOCUS" : "YOUR COACHING"}</small>
              <h3>{key === "program" ? design.programLabel : item.title}</h3>
              <p>{item.note}</p>
            </div>
            <ArrowRight size={18} />
          </Link>
        );
      })}
    </div>
  );
}

export function CoachStory({ name, theme }: { name: string; theme: unknown }) {
  const design = resolveBrandDesign(theme);
  if (!design.coachBio) return null;
  return (
    <section className="card coach-story">
      <CoachIdentity name={name} theme={theme} />
      <h2>A little more about your coach.</h2>
      <p>{design.coachBio}</p>
    </section>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <label className="field design-field">
      <span>{label}</span>
      {children}
      {note && <small>{note}</small>}
    </label>
  );
}

function DesignPreview({
  draft,
  device,
  mode,
}: {
  draft: Draft;
  device: "mobile" | "desktop";
  mode: "app" | "store";
}) {
  const theme = { ...draft, design: draft.design };
  return (
    <div className={`design-device ${device}`} data-testid="design-preview">
      <TrainerTheme theme={theme}>
        <div className="design-preview-top">
          <CoachIdentity
            name={draft.name || "Your coaching"}
            theme={theme}
            compact
          />
          <span className="design-preview-dot" />
        </div>
        {mode === "app" ? (
          <>
            <div className="design-preview-greeting">
              <small>YOUR DAILY SPACE</small>
              <h2>Good morning, Alex.</h2>
            </div>
            <CoachWelcome name={draft.name || "your coach"} theme={theme} />
            <div className="design-preview-sections">
              {draft.design.sectionOrder.map((key, index) => {
                const item = sections[key],
                  Icon = item.icon;
                return (
                  <div
                    className={`design-preview-section ${index === 0 ? "is-featured" : ""}`}
                    key={key}
                  >
                    <Icon size={21} />
                    <div>
                      <small>{index === 0 ? "YOUR FOCUS" : "EXPLORE"}</small>
                      <strong>
                        {key === "program"
                          ? draft.design.programLabel
                          : item.title}
                      </strong>
                      <p>{item.note}</p>
                    </div>
                    <ChevronRight size={16} />
                  </div>
                );
              })}
            </div>
            <div className="design-preview-safe">
              <ShieldCheck size={14} />
              <span>Coaching context, privacy and support stay close.</span>
            </div>
            <div className="design-preview-nav">
              <span>
                <LayoutDashboard size={17} />
                Today
              </span>
              <span>
                <Dumbbell size={17} />
                Train
              </span>
              <span>
                <MessageCircle size={17} />
                Coach
              </span>
              <span>
                <UserRound size={17} />
                Profile
              </span>
            </div>
          </>
        ) : (
          <div className="design-preview-store">
            {draft.design.coverUrl && (
              <BrandImage
                src={draft.design.coverUrl}
                alt="Storefront cover preview"
                className="coach-cover"
                fallback={null}
              />
            )}
            <p className="eyebrow">{draft.category || "PERSONAL COACHING"}</p>
            <h1>{draft.headline || "Your coaching. Their next chapter."}</h1>
            <p>
              {draft.bio ||
                "Tell people who you help and what makes your method your own."}
            </p>
            <div className="design-sample-offer">
              <small>MEMBERSHIP PREVIEW</small>
              <h3>Train with {draft.name || "your coach"}</h3>
              <p>
                Your real memberships and prices appear here after you create
                your offers.
              </p>
              <span className="button">
                Explore memberships <ArrowRight size={14} />
              </span>
            </div>
            <CoachStory name={draft.name || "Your coach"} theme={theme} />
            <small className="design-preview-disclosure">
              Digital coaching, guided by your coach’s method.
            </small>
          </div>
        )}
      </TrainerTheme>
    </div>
  );
}

export function TrainerDesign({
  tenant,
  role = "owner",
  onSaved,
}: {
  tenant: Tenant;
  role?: string;
  onSaved?: () => void | Promise<void>;
}) {
  const [saved, setSaved] = useState(() => makeDraft(tenant));
  const [draft, setDraft] = useState(() => makeDraft(tenant));
  const [version, setVersion] = useState<number>(
    tenant.theme?.brandVersion ?? 0,
  );
  const [tab, setTab] = useState("Identity");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [mode, setMode] = useState<"app" | "store">("app");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const editable = role === "owner";
  const [privateVersion, setPrivateVersion] = useState(0),
    [privateDraft, setPrivateDraft] = useState<any>(null);
  const [uploadTarget, setUploadTarget] = useState<
    "logoUrl" | "photoUrl" | "coverUrl"
  >("photoUrl");
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => {
    if (editable)
      void call("/tenant/design-draft", "GET")
        .then((d) => {
          setPrivateVersion(d.version);
          setPrivateDraft(d.data);
        })
        .catch((e) => setError(e.message));
  }, [editable]);
  async function savePrivate() {
    setBusy(true);
    setError("");
    try {
      const data = brandSchema.parse({
        ...draft,
        accent: draft.design.primary,
        expectedVersion: version,
      });
      const saved = await call("/tenant/design-draft", "PUT", {
        version: privateVersion,
        data,
      });
      setPrivateVersion(saved.version);
      setPrivateDraft(saved.data);
      setNotice("Private design draft saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const previewDraft = {
    ...draft,
    design: {
      ...draft.design,
      programLabel:
        draft.design.programLabel.trim().length >= 2
          ? draft.design.programLabel
          : "My program",
      ...Object.fromEntries(
        (["logoUrl", "photoUrl", "coverUrl"] as const).map((key) => [
          key,
          brandImageSchema.safeParse(draft.design[key]).success
            ? draft.design[key]
            : "",
        ]),
      ),
    },
  };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setNotice("");
  };
  const style = <K extends keyof BrandDesign>(key: K, value: BrandDesign[K]) =>
    setDraft((old) => ({ ...old, design: { ...old.design, [key]: value } }));

  async function call(path: string, method: string, body?: unknown) {
    const response = await fetch("/api/v1" + path, {
      method,
      credentials: "same-origin",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(
          payload.message || "Your changes could not be saved. Try again.",
        ),
        { status: response.status },
      );
    return payload;
  }
  async function save() {
    setError("");
    setNotice("");
    setConflict(false);
    const parsed = brandSchema.safeParse({
      ...draft,
      accent: draft.design.primary,
      expectedVersion: version,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(" · ")}: ${issue.message}`)
          .join(" "),
      );
      return;
    }
    setBusy(true);
    try {
      const result = await call("/tenant/brand", "PUT", parsed.data);
      const next = makeDraft({
        ...tenant,
        name: parsed.data.name,
        theme: result.theme ?? parsed.data,
      });
      setDraft(next);
      setSaved(next);
      setVersion(result.brandVersion ?? version + 1);
      setNotice(
        "Design saved. Your client app and published storefront now use this design.",
      );
      await onSaved?.();
    } catch (cause) {
      setError((cause as Error).message);
      setConflict((cause as any).status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError("");
    try {
      const data = await call("/bootstrap", "GET");
      const next = makeDraft(data.tenant);
      setDraft(next);
      setSaved(next);
      setVersion(data.tenant.theme?.brandVersion ?? 0);
      setConflict(false);
      setNotice("Loaded your latest saved design.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await call("/tenant/publish", "POST", {});
      setNotice("Storefront published.");
      await onSaved?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, offset: number) {
    const next = [...draft.design.sectionOrder],
      target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft((old) => ({
      ...old,
      design: { ...old.design, sectionOrder: next, dashboardFocus: next[0] },
    }));
  }

  return (
    <div className="design-studio">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR COACHING. YOUR EXPRESSION.</p>
          <h1>Make this space yours.</h1>
          <p className="muted">
            Bring your personality to the app your clients open every day.
          </p>
        </div>
        <div className="design-save-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy || !editable}
            onClick={() => void savePrivate()}
          >
            Save private draft
          </button>
          {privateDraft && (
            <button
              type="button"
              className="button secondary"
              disabled={busy || !editable}
              onClick={() => {
                setDraft(
                  makeDraft({
                    ...tenant,
                    name: privateDraft.name,
                    theme: privateDraft,
                  }),
                );
                setNotice(
                  "Private draft loaded for preview. Publish design when ready.",
                );
              }}
            >
              Load private draft
            </button>
          )}

          <span className={`design-save-state ${dirty ? "has-changes" : ""}`}>
            {dirty ? "Unsaved changes" : "Saved design"}
          </span>
          <button
            className="button"
            type="button"
            disabled={busy || !editable || !dirty}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Publish design"}
            <Check size={16} />
          </button>
        </div>
      </div>
      <div className="design-top-note">
        <Sparkles size={18} />
        <p>
          Start with a look you love, then make it your own. Your teaching and
          coaching stay at the heart of the experience.
        </p>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          {conflict && (
            <button
              className="button secondary"
              onClick={() => void reload()}
              disabled={busy}
            >
              Reload saved design
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {!editable && (
        <div className="notice">
          Only the workspace owner can change the client app design.
        </div>
      )}
      <div
        className="design-tabs"
        role="tablist"
        aria-label="Design studio sections"
      >
        {[
          ["Identity", UserRound],
          ["Style", Palette],
          ["Home layout", LayoutDashboard],
          ["Preview", Monitor],
        ].map(([label, Icon]) => (
          <button
            key={String(label)}
            id={`design-tab-${String(label).replace(" ", "-")}`}
            role="tab"
            aria-selected={tab === label}
            aria-controls="design-panel"
            tabIndex={tab === label ? 0 : -1}
            onClick={() => setTab(String(label))}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const tabs = ["Identity", "Style", "Home layout", "Preview"],
                index = tabs.indexOf(tab);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 3
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + 4) % 4;
              setTab(tabs[next]);
              document
                .getElementById(`design-tab-${tabs[next].replace(" ", "-")}`)
                ?.focus();
            }}
          >
            <Icon size={16} />
            {String(label)}
          </button>
        ))}
      </div>
      <div
        className={`design-workbench ${tab === "Preview" ? "preview-only" : ""}`}
      >
        <section
          id="design-panel"
          role="tabpanel"
          aria-labelledby={`design-tab-${tab.replace(" ", "-")}`}
          className="design-controls"
        >
          <fieldset disabled={busy || !editable} className="design-fieldset">
            {tab === "Identity" && (
              <>
                <section className="card">
                  <div className="design-section-heading">
                    <span>01</span>
                    <div>
                      <h2>In your own words.</h2>
                      <p>Your name, your voice and what you stand for.</p>
                    </div>
                  </div>
                  <Field label="Coach / business name">
                    <input
                      value={draft.name}
                      minLength={2}
                      maxLength={100}
                      onChange={(event) => update("name", event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Your tagline"
                    note="A short line clients will remember."
                  >
                    <input
                      value={draft.design.tagline}
                      maxLength={100}
                      placeholder="Strength for the life you want."
                      onChange={(event) => style("tagline", event.target.value)}
                    />
                  </Field>
                  <Field label="Storefront headline">
                    <input
                      value={draft.headline}
                      maxLength={160}
                      placeholder="Build strength. Keep your life."
                      onChange={(event) =>
                        update("headline", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Coaching specialty">
                    <input
                      value={draft.category}
                      maxLength={100}
                      placeholder="Strength & sustainable progress"
                      onChange={(event) =>
                        update("category", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="About your coaching">
                    <textarea
                      value={draft.bio}
                      maxLength={2000}
                      rows={4}
                      placeholder="Who do you help, and how do you work?"
                      onChange={(event) => update("bio", event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Welcome message"
                    note="Shown on your client’s Today screen."
                  >
                    <textarea
                      value={draft.design.welcome}
                      maxLength={320}
                      rows={3}
                      placeholder="A personal note to welcome clients into your coaching space."
                      onChange={(event) => style("welcome", event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Your personal story"
                    note="An optional introduction on your public coaching page."
                  >
                    <textarea
                      value={draft.design.coachBio}
                      maxLength={1000}
                      rows={4}
                      placeholder="What brought you to coaching? What do you want people to know about you?"
                      onChange={(event) =>
                        style("coachBio", event.target.value)
                      }
                    />
                  </Field>
                </section>
                <section className="card">
                  <div className="design-section-heading">
                    <span>02</span>
                    <div>
                      <h2>A familiar face.</h2>
                      <p>
                        Upload your own photos or use public HTTPS image links.
                        If an image cannot load, your initials keep the space
                        complete.
                      </p>
                    </div>
                  </div>
                  <Field label="Use uploaded photo as">
                    <select
                      value={uploadTarget}
                      onChange={(e) =>
                        setUploadTarget(e.target.value as typeof uploadTarget)
                      }
                    >
                      <option value="photoUrl">Coach portrait</option>
                      <option value="logoUrl">App logo</option>
                      <option value="coverUrl">Cover photo</option>
                    </select>
                  </Field>
                  <PhotoUploader
                    single
                    onUploaded={(photos) => {
                      if (photos[0]) style(uploadTarget, photos[0].url);
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setLibraryOpen(!libraryOpen)}
                  >
                    {libraryOpen
                      ? "Hide photo library"
                      : "Choose an uploaded photo"}
                  </button>
                  {libraryOpen && (
                    <MediaLibrary
                      onSelect={(photo) => {
                        style(uploadTarget, photo.url);
                        setLibraryOpen(false);
                      }}
                    />
                  )}
                  {(
                    [
                      ["logoUrl", "Logo image URL"],
                      ["photoUrl", "Coach photo URL"],
                      ["coverUrl", "Cover image URL"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        type="text"
                        maxLength={1024}
                        value={draft.design[key]}
                        placeholder="https://your-website.com/image.jpg"
                        onChange={(event) => style(key, event.target.value)}
                      />
                    </Field>
                  ))}
                  <p className="design-help">
                    <ImageIcon size={15} />
                    Use images you have permission to share. These links are
                    public; signed or private links are not accepted.
                  </p>
                </section>
              </>
            )}
            {tab === "Style" && (
              <>
                <section className="card">
                  <div className="design-section-heading">
                    <span>01</span>
                    <div>
                      <h2>Find your starting point.</h2>
                      <p>
                        Four considered looks. Every one can become your own.
                      </p>
                    </div>
                  </div>
                  <div className="design-presets">
                    {brandPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={draft.design.preset === preset.id}
                        onClick={() =>
                          setDraft((old) => ({
                            ...old,
                            design: {
                              ...old.design,
                              preset: preset.id,
                              primary: preset.primary,
                              accent: preset.accent,
                              surface: preset.surface,
                              typography: preset.typography,
                              corners: preset.corners,
                            },
                          }))
                        }
                      >
                        <span
                          className="design-preset-art"
                          style={{
                            background: preset.surface,
                            color: preset.primary,
                          }}
                        >
                          <span
                            className="design-preset-initial"
                            style={{
                              fontFamily:
                                preset.typography === "editorial"
                                  ? "Georgia, serif"
                                  : "Arial, sans-serif",
                            }}
                          >
                            Aa.
                          </span>
                          <span className="design-preset-bars">
                            <i style={{ background: preset.primary }} />
                            <i style={{ background: preset.accent }} />
                          </span>
                        </span>
                        <span className="design-preset-name">
                          {preset.name}
                          {draft.design.preset === preset.id && (
                            <Check size={15} />
                          )}
                        </span>
                        <small>{preset.detail}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <div className="design-section-heading">
                    <span>02</span>
                    <div>
                      <h2>Your palette.</h2>
                      <p>
                        Text contrast adjusts automatically so your clients can
                        read comfortably.
                      </p>
                    </div>
                  </div>
                  {(
                    [
                      [
                        "primary",
                        "Primary color",
                        "Buttons and your signature color",
                      ],
                      [
                        "accent",
                        "Accent color",
                        "Highlights and small moments",
                      ],
                      [
                        "surface",
                        "Surface color",
                        "The canvas of your client app",
                      ],
                    ] as const
                  ).map(([key, label, note]) => (
                    <div className="design-color-row" key={key}>
                      <div>
                        <strong>{label}</strong>
                        <small>{note}</small>
                      </div>
                      <label className="design-color-input">
                        <input
                          aria-label={label}
                          type="color"
                          value={
                            /^#[0-9a-f]{6}$/i.test(draft.design[key])
                              ? draft.design[key]
                              : "#244c46"
                          }
                          onChange={(event) =>
                            setDraft((old) => ({
                              ...old,
                              design: {
                                ...old.design,
                                [key]: event.target.value,
                                preset: "custom",
                              },
                            }))
                          }
                        />
                        <span>{draft.design[key].toUpperCase()}</span>
                      </label>
                    </div>
                  ))}
                  <div className="design-contrast-note">
                    <ShieldCheck size={16} />
                    Readable text and important controls stay protected.
                  </div>
                </section>
                <section className="card">
                  <div className="design-section-heading">
                    <span>03</span>
                    <div>
                      <h2>The little details.</h2>
                      <p>Find the right feel for your coaching.</p>
                    </div>
                  </div>
                  <Field label="Typography">
                    <select
                      value={draft.design.typography}
                      onChange={(event) =>
                        style(
                          "typography",
                          event.target.value as BrandDesign["typography"],
                        )
                      }
                    >
                      <option value="modern">
                        Modern — clean and familiar
                      </option>
                      <option value="editorial">
                        Editorial — thoughtful and expressive
                      </option>
                      <option value="geometric">
                        Geometric — energetic and clear
                      </option>
                      <option value="humanist">
                        Humanist — open and approachable
                      </option>
                    </select>
                  </Field>
                  <div className="design-two-fields">
                    <Field label="Button style">
                      <select
                        value={draft.design.buttonStyle}
                        onChange={(event) =>
                          style(
                            "buttonStyle",
                            event.target.value as BrandDesign["buttonStyle"],
                          )
                        }
                      >
                        <option value="filled">Filled</option>
                        <option value="outline">Outline</option>
                      </select>
                    </Field>
                    <Field label="Corners">
                      <select
                        value={draft.design.corners}
                        onChange={(event) =>
                          style(
                            "corners",
                            event.target.value as BrandDesign["corners"],
                          )
                        }
                      >
                        <option value="square">Straight</option>
                        <option value="soft">Soft</option>
                        <option value="round">Rounded</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Spacing">
                    <select
                      value={draft.design.density}
                      onChange={(event) =>
                        style(
                          "density",
                          event.target.value as BrandDesign["density"],
                        )
                      }
                    >
                      <option value="airy">Airy — more room to breathe</option>
                      <option value="balanced">
                        Balanced — a little of both
                      </option>
                      <option value="compact">
                        Compact — more at a glance
                      </option>
                    </select>
                  </Field>
                </section>
              </>
            )}
            {tab === "Home layout" && (
              <>
                <section className="card">
                  <div className="design-section-heading">
                    <span>01</span>
                    <div>
                      <h2>Make the first step obvious.</h2>
                      <p>
                        Choose what leads your client’s Today screen. Move
                        sections to match your coaching approach.
                      </p>
                    </div>
                  </div>
                  <Field label="Program navigation label">
                    <input
                      value={draft.design.programLabel}
                      minLength={2}
                      maxLength={40}
                      placeholder="My program"
                      onChange={(event) =>
                        style("programLabel", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Dashboard focus">
                    <select
                      value={draft.design.dashboardFocus}
                      onChange={(event) => {
                        const value = event.target.value as BrandSection;
                        setDraft((old) => ({
                          ...old,
                          design: {
                            ...old.design,
                            dashboardFocus: value,
                            sectionOrder: [
                              value,
                              ...old.design.sectionOrder.filter(
                                (key) => key !== value,
                              ),
                            ],
                          },
                        }));
                      }}
                    >
                      {Object.entries(sections).map(([key, item]) => (
                        <option key={key} value={key}>
                          {key === "program"
                            ? draft.design.programLabel
                            : item.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <ol className="design-order">
                    {draft.design.sectionOrder.map((key, index) => {
                      const item = sections[key],
                        Icon = item.icon;
                      return (
                        <li key={key}>
                          <span className="design-order-number">
                            0{index + 1}
                          </span>
                          <Icon size={19} />
                          <div>
                            <strong>
                              {key === "program"
                                ? draft.design.programLabel
                                : item.title}
                            </strong>
                            <small>
                              {index === 0
                                ? "Featured first"
                                : "Always within reach"}
                            </small>
                          </div>
                          <div className="design-order-actions">
                            <button
                              type="button"
                              aria-label={`Move ${item.title} up`}
                              disabled={index === 0 || busy || !editable}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${item.title} down`}
                              disabled={index === 3 || busy || !editable}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDown size={16} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
                <section className="card design-protected">
                  <ShieldCheck size={23} />
                  <h3>Personal, with the essentials in place.</h3>
                  <p>
                    Clients always keep access to their coaching context,
                    membership, support, privacy and safety information.
                    Nutrition access still follows their membership.
                  </p>
                </section>
              </>
            )}
            {tab === "Preview" && (
              <section className="card design-final-review">
                <span className="design-review-icon">
                  <CheckCircle2 size={28} />
                </span>
                <h2>Your coaching, brought to life.</h2>
                <p>
                  Explore the client app and storefront before saving. This
                  preview uses example content; your clients will see their own
                  programs, progress and memberships.
                </p>
                <div className="design-review-summary">
                  <strong>{draft.name}</strong>
                  <span>
                    {draft.design.preset === "custom"
                      ? "Custom palette"
                      : brandPresets.find(
                          (preset) => preset.id === draft.design.preset,
                        )?.name}{" "}
                    · {draft.design.typography} typography
                  </span>
                  <span>
                    First on Today:{" "}
                    {sections[draft.design.dashboardFocus].title}
                  </span>
                </div>
                <p className="design-help">
                  Saving updates the design immediately. A new storefront still
                  needs to pass your launch checklist before it is public.
                </p>
              </section>
            )}
          </fieldset>
          <div className="design-bottom-actions">
            <button
              type="button"
              className="text-button"
              disabled={!dirty || busy}
              onClick={() => {
                setDraft(saved);
                setError("");
                setNotice("");
              }}
            >
              <RefreshCw size={14} />
              Reset changes
            </button>
            <Link href={`/coach/${tenant.slug}`} className="text-link">
              View storefront <ArrowRight size={14} />
            </Link>
          </div>
          <button
            type="button"
            className="button secondary design-publish"
            disabled={busy || dirty || !editable}
            onClick={() => void publish()}
          >
            Publish storefront <ArrowRight size={16} />
          </button>
        </section>
        <aside className="design-live-preview" aria-label="Live design preview">
          <div className="design-preview-toolbar">
            <div>
              <span className="eyebrow">LIVE PREVIEW</span>
              <span className="design-preview-label">
                Your client’s point of view.
              </span>
            </div>
            <div className="design-device-toggle">
              <button
                type="button"
                aria-label="Mobile"
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                <Smartphone size={17} />
              </button>
              <button
                type="button"
                aria-label="Desktop"
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                <Monitor size={17} />
              </button>
            </div>
          </div>
          <div className="design-preview-mode">
            <button
              type="button"
              aria-pressed={mode === "app"}
              onClick={() => setMode("app")}
            >
              Client app
            </button>
            <button
              type="button"
              aria-pressed={mode === "store"}
              onClick={() => setMode("store")}
            >
              Storefront
            </button>
          </div>
          <DesignPreview draft={previewDraft} device={device} mode={mode} />
          <p className="design-preview-caption">
            Draft preview · example content · changes apply when saved
          </p>
        </aside>
      </div>
    </div>
  );
}
