"use client";
import { useEffect, useState } from "react";
import { Field } from "./field";
import { offerTermsText } from "./programme-offers";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrainerTheme, CoachIdentity } from "./trainer-design";
import { resolveBrandDesign } from "@trainer/contracts";
import { AtSign, Mail, MessageCircle, PlayCircle } from "lucide-react";
import { Skeleton, StickyActionBar } from "./phone-ui";
import { useInvalidShake } from "./motion";
import { SubscriberFooter } from "./subscriber-footer";
import { coachAppLinks } from "./app-routes";
import { InquirySource } from "./lead-analytics";
import { PageLanguage } from "./document-direction";
import { parseLanguage, type Language } from "../document-language";
import type { ColorSchemeChoice } from "../color-scheme";
import { useColorScheme } from "./appearance";
import { translator, type Locale } from "../lib/i18n/core";
import siteMessages from "../lib/i18n/messages/site";
import commonMessages from "../lib/i18n/messages/common";
import { errorText } from "../lib/i18n/errors";
import { useLocale } from "../lib/i18n/react";

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? "Please try again.");
  return data;
}
const Notice = ({ message }: { message: string }) =>
  message ? (
    <p className="notice" role="status">
      {message}
    </p>
  ) : null;
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("This photo could not be read"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}

export function PhotoUploader({
  onUploaded,
  single = false,
}: {
  onUploaded: (photos: any[]) => void | Promise<void>;
  single?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [rights, setRights] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [crop, setCrop] = useState(false);
  return (
    <form
      className="photo-uploader"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!files.length) return;
        const formElement = e.currentTarget;
        const form = new FormData(formElement);
        setBusy(true);
        setMessage("");
        try {
          const photos = [];
          for (const [fileIndex, file] of files.entries()) {
            if (file.size > 8 * 1024 * 1024)
              throw new Error(`${file.name} is larger than 8 MB`);
            setMessage(`Uploading ${fileIndex + 1} of ${files.length}…`);
            const photo = await api("/tenant/media", "POST", {
              filename: file.name,
              rightsConfirmed: rights,
              data: await fileData(file),
              ...(crop && files.length === 1
                ? {
                    crop: {
                      left: Number(form.get("left")),
                      top: Number(form.get("top")),
                      width: Number(form.get("width")),
                      height: Number(form.get("height")),
                    },
                  }
                : {}),
            });
            photos.push(photo);
            await onUploaded([photo]);
          }
          setFiles([]);
          setRights(false);
          setCrop(false);
          formElement.reset();
          setMessage(
            `${photos.length} photo${photos.length === 1 ? "" : "s"} uploaded.`,
          );
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={single ? "Choose a photo" : "Choose photos"}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple={!single}
          disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </Field>
      <small>
        Still photos up to 8 MB each. Location and camera metadata are removed.
      </small>
      {files.length === 1 && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={crop}
              onChange={(e) => setCrop(e.target.checked)}
            />
            Crop before upload
          </label>
          {crop && (
            <div className="site-grid">
              {["left", "top", "width", "height"].map((k) => (
                <Field
                  key={k}
                  label={`${k[0].toUpperCase() + k.slice(1)} (pixels)`}
                >
                  <input
                    name={k}
                    type="number"
                    min={k === "left" || k === "top" ? 0 : 1}
                    defaultValue={k === "left" || k === "top" ? 0 : 1000}
                    required
                  />
                </Field>
              ))}
            </div>
          )}
        </>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={rights}
          onChange={(e) => setRights(e.target.checked)}
          required
        />
        I have permission to use and publish these photos.
      </label>
      <button disabled={busy || !files.length || !rights}>
        {busy ? "Uploading…" : "Upload photos"}
      </button>
      <Notice message={message} />
    </form>
  );
}

export function MediaLibrary({
  onSelect,
}: {
  onSelect?: (photo: any) => void;
}) {
  const [items, setItems] = useState<any[]>([]),
    [more, setMore] = useState(true),
    [message, setMessage] = useState("");
  async function load(offset = 0) {
    const d = await api(`/tenant/media?offset=${offset}`);
    setItems((v) => (offset ? [...v, ...d.items] : d.items));
    setMore(d.items.length === 48);
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Photo library</h2>
      <PhotoUploader onUploaded={() => load()} />
      <Notice message={message} />
      <div className="photo-grid">
        {items.map((m) => (
          <figure key={m.id}>
            <img src={m.url} alt={m.filename} loading="lazy" />
            <figcaption>{m.filename}</figcaption>
            <div className="actions">
              {onSelect && (
                <button type="button" onClick={() => onSelect(m)}>
                  Use photo
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    await api(`/tenant/media/${m.id}`, "DELETE");
                    await load();
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                Delete
              </button>
            </div>
          </figure>
        ))}
      </div>
      {more && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void load(items.length).catch((e) => setMessage(e.message))
          }
        >
          Load more photos
        </button>
      )}
    </section>
  );
}

export function GalleryStudio({ client = false }: { client?: boolean }) {
  const [galleries, setGalleries] = useState<any[]>([]),
    [next, setNext] = useState<number | null>(null),
    [selected, setSelected] = useState<any>(null),
    [photos, setPhotos] = useState<any[]>([]),
    [library, setLibrary] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  // The member's view follows their language; the coach's studio is unchanged.
  const pageLocale = useLocale();
  const t = translator(siteMessages, client ? pageLocale : "en");
  async function load(offset = 0) {
    const d = await api(`/tenant/galleries?offset=${offset}`);
    setGalleries((v) => (offset ? [...v, ...d.galleries] : d.galleries));
    setNext(d.nextOffset);
    setLoaded(true);
    return d.galleries;
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  function choose(g: any) {
    setSelected(g);
    setPhotos(g.photos ?? []);
    setMessage("");
  }
  async function action(fn: () => Promise<any>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add(list: any[]) {
    setPhotos((old) => [
      ...old,
      ...list
        .filter((m) => !old.some((p) => p.media_id === m.id))
        .map((m) => ({
          media_id: m.id,
          url: m.url,
          alt: m.filename.replace(/\.[^.]+$/, ""),
          caption: "",
        })),
    ]);
  }
  return (
    <div className="site-workspace">
      <div className="page-heading">
        <div>
          {!client && <p className="eyebrow">{t("galleriesEyebrow")}</p>}
          <h1>{client ? t("clientGalleries") : "Photos & galleries."}</h1>
          <p className="muted">
            {client
              ? t("clientGalleriesIntro")
              : "Create as many galleries as you need. Choose what appears on your website and in the client app."}
          </p>
        </div>
      </div>
      <Notice message={message} />
      {!client && (
        <form
          className="card inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(async () => {
              const g = await api("/tenant/galleries", "POST", {
                title: f.get("title"),
                description: f.get("description"),
              });
              choose({ ...g, photos: [] });
            });
          }}
        >
          <Field label="New gallery title">
            <input name="title" required maxLength={100} />
          </Field>
          <Field label="Description">
            <input name="description" maxLength={2000} />
          </Field>
          <button disabled={busy}>Create gallery</button>
        </form>
      )}
      {client && !loaded && !message && (
        <Skeleton label={t("clientLoadingGalleries")} lines={3} />
      )}
      {client && loaded && !galleries.length && (
        <section className="card">
          <h2>{t("clientNoPhotos")}</h2>
          <p className="muted">{t("clientNoGalleries")}</p>
        </section>
      )}
      <div className="gallery-list">
        {galleries.map((g) => (
          <section className="card" key={g.id}>
            <h2 dir="auto">{g.title}</h2>
            <p dir="auto">{g.description}</p>
            {!client && (
              <p className="muted">
                Visibility: {g.audience} · {g.photos.length} photos
              </p>
            )}
            <div className="photo-grid">
              {g.photos.map((p: any) => (
                <figure key={p.media_id}>
                  <img src={p.url} alt={p.alt} loading="lazy" />
                  {p.caption && (
                    <figcaption dir="auto">{p.caption}</figcaption>
                  )}
                </figure>
              ))}
            </div>
            {!client && (
              <button className="secondary" onClick={() => choose(g)}>
                Edit gallery
              </button>
            )}
          </section>
        ))}
      </div>
      {next !== null && (
        <button
          className="secondary"
          onClick={() => void load(next).catch((e) => setMessage(e.message))}
        >
          {client ? t("moreGalleries") : "More galleries"}
        </button>
      )}
      {!client && selected && (
        <section className="card gallery-editor">
          <h2>Edit {selected.title}</h2>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                choose(await api(`/tenant/galleries/${selected.id}`));
              })
            }
          >
            Discard local changes and reload saved gallery
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                const saved = await api(
                  `/tenant/galleries/${selected.id}`,
                  "PATCH",
                  {
                    version: selected.version,
                    title: f.get("title"),
                    description: f.get("description"),
                    audience: f.get("audience"),
                  },
                );
                setSelected({ ...saved, photos });
              });
            }}
            key={selected.id + ":" + selected.version}
          >
            <Field label="Gallery title">
              <input
                name="title"
                defaultValue={selected.title}
                required
                maxLength={100}
              />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                defaultValue={selected.description}
                maxLength={2000}
              />
            </Field>
            <Field label="Show this gallery">
              <select name="audience" defaultValue={selected.audience}>
                <option value="draft">Private draft</option>
                <option value="site">Website</option>
                <option value="app">Client app</option>
                <option value="both">Website and client app</option>
              </select>
            </Field>
            <button disabled={busy}>Save gallery details</button>
          </form>
          <h3>Add photos</h3>
          <PhotoUploader onUploaded={add} />
          <button className="secondary" onClick={() => setLibrary(!library)}>
            {library ? "Hide" : "Choose from"} photo library
          </button>
          {library && <MediaLibrary onSelect={(p) => add([p])} />}
          <ol className="photo-edit-list">
            {photos.map((p, i) => (
              <li key={p.media_id}>
                <img src={p.url} alt={p.alt} />
                <div>
                  <Field label="Description for accessibility">
                    <input
                      value={p.alt}
                      required
                      maxLength={300}
                      onChange={(e) =>
                        setPhotos((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, alt: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Caption">
                    <textarea
                      value={p.caption}
                      maxLength={2000}
                      onChange={(e) =>
                        setPhotos((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, caption: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={!i}
                      onClick={() =>
                        setPhotos((v) => {
                          const n = [...v];
                          [n[i - 1], n[i]] = [n[i], n[i - 1]];
                          return n;
                        })
                      }
                    >
                      Move up
                    </button>
                    <button
                      className="secondary"
                      disabled={i === photos.length - 1}
                      onClick={() =>
                        setPhotos((v) => {
                          const n = [...v];
                          [n[i + 1], n[i]] = [n[i], n[i + 1]];
                          return n;
                        })
                      }
                    >
                      Move down
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        setPhotos((v) => v.filter((_, j) => i !== j))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const g = await api(
                    `/tenant/galleries/${selected.id}/photos`,
                    "PUT",
                    {
                      version: selected.version,
                      photos: photos.map((p) => ({
                        mediaId: p.media_id,
                        alt: p.alt,
                        caption: p.caption,
                      })),
                    },
                  );
                  setSelected({ ...g, photos });
                  setMessage("Photos saved.");
                })
              }
            >
              Save photos and order
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api(`/tenant/galleries/${selected.id}`, "DELETE", {
                    version: selected.version,
                  });
                  setSelected(null);
                })
              }
            >
              Delete gallery
            </button>
          </div>
        </section>
      )}
      {!client && !selected && <MediaLibrary />}
    </div>
  );
}

export function WebsiteStudio({
  tenant,
}: {
  tenant: { slug: string; published: boolean };
}) {
  const [data, setData] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [inquiries, setInquiries] = useState<any[]>([]);
  async function load() {
    const d = await api("/tenant/site");
    setData(d);
    setDraft(d.draft);
    setInquiries((await api("/tenant/site/inquiries")).items);
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  function field(k: string, label: string, long = false) {
    return (
      <Field key={k} label={label}>
        {long ? (
          <textarea
            value={draft[k] ?? ""}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            rows={k === "about" ? 8 : 3}
          />
        ) : (
          <input
            value={draft[k] ?? ""}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            // Email, phone and links read left to right in either layout.
            dir={
              ["contactEmail", "whatsapp", "instagram", "youtube"].includes(k)
                ? "ltr"
                : undefined
            }
          />
        )}
      </Field>
    );
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const d = await api("/tenant/site", "PUT", {
        version: data.version,
        site: draft,
      });
      setData(d);
      setDraft(d.draft);
      setMessage("Private website draft saved.");
      return d;
    } catch (e) {
      setMessage((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="site-workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A WEBSITE THAT FEELS LIKE YOU</p>
          <h1>Your coaching website.</h1>
          <p className="muted">
            Your story, memberships, galleries and contact page, with room for
            your own pages.
          </p>
        </div>
        <Link className="button secondary" href="/trainer/website/preview">
          Preview saved draft
        </Link>
      </div>
      <Notice message={message} />
      {!draft && !message && <p>Loading your website draft…</p>}
      {!draft && message && (
        <button
          className="secondary"
          onClick={() => void load().catch((e) => setMessage(e.message))}
        >
          Retry loading website
        </button>
      )}
      {tenant.published && (
        <p>
          <Link href={`/coach/${tenant.slug}`}>View published website</Link>
          {data?.published_at && (
            <>
              {" "}
              · Last published {new Date(data.published_at).toLocaleString()}
            </>
          )}
        </p>
      )}
      {draft && (
        <>
          <section className="card">
            <h2>Home & your story</h2>
            {field("headline", "Headline")}
            {field("introduction", "Introduction", true)}
            {field("about", "About your coaching", true)}
            {field("cta", "Join button text")}
            <Field label="Website language">
              <select
                value={draft.language ?? "en"}
                onChange={(e) =>
                  setDraft({ ...draft, language: e.target.value })
                }
              >
                <option value="en">English (left to right)</option>
                <option value="ar" lang="ar">
                  العربية — Arabic (right to left)
                </option>
              </select>
            </Field>
          </section>
          <section className="card">
            <h2>Contact & social links</h2>
            <div className="site-grid">
              {field("contactEmail", "Public contact email")}
              {field("whatsapp", "WhatsApp number, including + country code")}
              {field("instagram", "Instagram HTTPS link")}
              {field("youtube", "YouTube HTTPS link")}
            </div>
          </section>
          <section className="card">
            <h2>Search appearance</h2>
            {field("seoTitle", "Page title")}
            {field("seoDescription", "Search description")}
          </section>
          <section className="card">
            <h2>Your own pages</h2>
            {(draft.pages ?? []).map((p: any, i: number) => (
              <fieldset key={i}>
                <legend>Page {i + 1}</legend>
                {["slug", "title", "body"].map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "slug"
                        ? "Page address (for example my-method)"
                        : k === "title"
                          ? "Page title"
                          : "Page content"
                    }
                  >
                    {k === "body" ? (
                      <textarea
                        rows={7}
                        value={p[k]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            pages: draft.pages.map((x: any, j: number) =>
                              i === j ? { ...x, [k]: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    ) : (
                      <input
                        value={p[k]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            pages: draft.pages.map((x: any, j: number) =>
                              i === j ? { ...x, [k]: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={p.visible}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        pages: draft.pages.map((x: any, j: number) =>
                          i === j ? { ...x, visible: e.target.checked } : x,
                        ),
                      })
                    }
                  />
                  Include this page
                </label>
                <button
                  className="secondary"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      pages: draft.pages.filter((_: any, j: number) => j !== i),
                    })
                  }
                >
                  Remove page
                </button>
              </fieldset>
            ))}
            <button
              className="secondary"
              onClick={() =>
                setDraft({
                  ...draft,
                  pages: [
                    ...(draft.pages ?? []),
                    { slug: "", title: "", body: "", visible: true },
                  ],
                })
              }
            >
              Add a page
            </button>
          </section>
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void load().catch((e) => setMessage(e.message))}
            >
              Discard local changes and reload saved draft
            </button>
            <button disabled={busy} onClick={() => void save()}>
              Save private draft
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                const saved = await save();
                if (!saved) return;
                setBusy(true);
                try {
                  const d = await api("/tenant/site/publish", "POST", {
                    version: saved.version,
                  });
                  setData(d);
                  setMessage("Your website is published.");
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Publish website
            </button>
          </div>
          <section className="card">
            <h2>Website inquiries</h2>
            {inquiries.length ? (
              inquiries.map((r) => (
                <article key={r.id}>
                  <h3>{r.data.name}</h3>
                  <a href={`mailto:${r.data.email}`} dir="ltr">
                    {r.data.email}
                  </a>
                  <p className="site-prose">{r.data.message}</p>
                  <small>{r.status}</small>
                  <InquirySource attribution={r.attribution} />
                  {r.status === "open" && (
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          await api(`/tenant/site/inquiries/${r.id}`, "POST", {
                            version: r.version,
                          });
                          setInquiries(
                            (await api("/tenant/site/inquiries")).items,
                          );
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      Mark handled
                    </button>
                  )}
                </article>
              ))
            ) : (
              <p className="muted">New website messages will appear here.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Initials for a coach without a photo or logo. */
function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * A coach photo, or an intentional placeholder in the coach's colours (their
 * initials on a tinted panel) when there is no photo or it fails to load.
 * Both keep the same box, so nothing shifts while the image loads.
 */
function SitePortrait({
  src,
  name,
  className = "",
}: {
  src: string;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState("");
  return src && failed !== src ? (
    <img
      className={`site-portrait ${className}`}
      src={src}
      alt={name}
      width={480}
      height={600}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  ) : (
    <div className={`site-portrait is-placeholder ${className}`} aria-hidden="true">
      <span>{initialsOf(name)}</span>
    </div>
  );
}

/** A wide cover image, or nothing (the hero stands on its own). */
function SiteCover({ src }: { src: string }) {
  const [failed, setFailed] = useState("");
  if (!src || failed === src) return null;
  return (
    <img
      className="site-cover"
      src={src}
      alt=""
      width={1200}
      height={675}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  );
}

/**
 * The website's hero rises in once per visit (app/motion.css,
 * docs/features/motion.md "l"); moving between the website's pages and back
 * keeps it still. Browser memory only (the server never sets it).
 */
let heroShown = false;

/**
 * A coach's public website, phone first (docs/features/phone-first.md,
 * "Coach website"): a compact header with the coach's identity and a
 * sideways-scrolling page row, one column of content with 16 px gutters,
 * and the main action (join, or contact while no plans are listed) in a
 * sticky bar at the bottom on phones. From 768 px the action moves into the
 * page and the header. The coach's own text follows its own direction.
 */
export function CoachWebsite({
  initialData,
  path = "",
  preview = false,
  language,
  colorScheme,
}: {
  initialData?: any;
  path?: string;
  preview?: boolean;
  /** The document language the server resolved for this public page. */
  language?: Language;
  /**
   * The visitor's appearance choice on this device (the server's cookie).
   * The public website follows it; the Design Studio preview stays light.
   */
  colorScheme?: ColorSchemeChoice;
}) {
  const scheme = useColorScheme(colorScheme);
  // The Design Studio preview (a trainer screen) stays still.
  const [heroSeen] = useState(() => heroShown || preview);
  useInvalidShake();
  useEffect(() => {
    heroShown = true;
  }, []);
  const [data, setData] = useState<any>(initialData ?? null),
    [message, setMessage] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState<number | null>(
      initialData?.galleries?.length === 24 ? 24 : null,
    );
  useEffect(() => {
    let current = true;
    if (initialData) {
      setData(initialData);
      setNext(initialData.galleries?.length === 24 ? 24 : null);
      setMessage("");
    } else if (preview)
      void api("/tenant/site/preview")
        .then((value) => {
          if (current) {
            setData(value);
            setNext(value.galleries?.length === 24 ? 24 : null);
          }
        })
        .catch((e) => {
          if (current) setMessage(errorText(e, language ?? "en"));
        });
    return () => {
      current = false;
    };
  }, [initialData, preview, language]);
  useEffect(() => setSent(false), [path]);
  if (!data)
    return (
      <main className="coach-website">
        <Notice
          message={
            message ||
            translator(siteMessages, language ?? "en")("loadingWebsite")
          }
        />
      </main>
    );
  const { tenant, site } = data,
    base = preview ? "/trainer/website/preview" : `/coach/${tenant.slug}`,
    section = path.split("/").filter(Boolean)[0] ?? "",
    join = `/join-coach/${tenant.slug}`;
  const design = resolveBrandDesign(tenant.theme);
  const name: string = tenant.name;
  const custom = (site.pages ?? []).find(
      (p: any) => p.slug === section && p.visible,
    ),
    // The coach's own text follows its own direction inside either layout.
    paragraph = (v: string, className = "") => (
      <div className={`site-prose ${className}`} dir="auto">
        {v}
      </div>
    );
  const intro = String(site.introduction || tenant.theme?.bio || "").trim();
  // The About text, unless it only repeats the home introduction.
  const aboutText = String(site.about || design.coachBio || "").trim();
  const about = aboutText && aboutText !== intro ? aboutText : "";
  const products: any[] = data.products ?? [];
  const hasPlans = products.length > 0;
  const contact = `${base}/contact`;
  const known = ["", "about", "memberships", "galleries", "contact"];
  const missing = !!section && !custom && !known.includes(section);
  // Public pages use the server-resolved language (the visitor's choice, else
  // the website's); the private preview shows the draft's own language.
  const pageLanguage: Locale =
    (preview ? null : language) ?? parseLanguage(site.language) ?? "en";
  // The website's chrome in that language; the coach's words stay theirs.
  const t = translator(siteMessages, pageLanguage);
  const b = (text: string) => {
    const match = /^<b>(.*?)<\/b>\s*(.*)$/.exec(text);
    return match ? (
      <>
        <strong>{match[1]}</strong> {match[2]}
      </>
    ) : (
      text
    );
  };
  // One main action per page: joining once plans are listed (from the
  // memberships page straight to the join form), otherwise a message.
  const primary = !hasPlans
    ? { label: t("contactName", { name }), href: contact }
    : section === "memberships"
      ? { label: t("joinName", { name }), href: join }
      : { label: site.cta || t("startCoaching"), href: `${base}/memberships` };
  const secondary =
    hasPlans && section !== "contact"
      ? { label: t("contact"), href: contact }
      : null;
  const links: Array<[string, string, string]> = [
    ["", base, t("home")],
    ["about", `${base}/about`, t("about")],
    ["memberships", `${base}/memberships`, t("memberships")],
    ["galleries", `${base}/galleries`, t("galleries")],
    ...(site.pages ?? [])
      .filter((p: any) => p.visible)
      .map((p: any): [string, string, string] => [
        p.slug,
        `${base}/${p.slug}`,
        p.title,
      ]),
    ["contact", contact, t("contact")],
  ];
  const inlineActions = (
    <div className={`site-actions${preview ? " is-preview" : ""}`}>
      <Link className="button" href={primary.href}>
        {primary.label}
      </Link>
      {secondary && (
        <Link className="button secondary" href={secondary.href}>
          {secondary.label}
        </Link>
      )}
    </div>
  );
  return (
    <TrainerTheme
      theme={tenant.theme}
      className="coach-website"
      language={pageLanguage}
      colorScheme={preview ? undefined : scheme}
    >
      {!preview && <PageLanguage language={pageLanguage} />}
      <header className="site-header">
        <Link href={base} className="site-identity">
          <CoachIdentity name={name} theme={tenant.theme} compact />
        </Link>
        <nav aria-label={t("websiteNav")} className="site-nav">
          {links.map(([key, href, label]) => (
            <Link
              key={key || "home"}
              href={href}
              aria-current={key === section ? "page" : undefined}
              dir="auto"
            >
              {label}
            </Link>
          ))}
        </nav>
        {!preview && section !== "contact" && (
          <Link className="button site-header-action" href={primary.href}>
            {primary.label}
          </Link>
        )}
      </header>
      {preview && (
        <p className="notice site-preview-note">
          {t("previewNote")}{" "}
          <Link href="/trainer/website">{t("returnToEditor")}</Link>
        </p>
      )}
      <main id="main">
        {!section && (
          <>
            <section
              className="site-hero"
              data-seen={heroSeen ? "" : undefined}
            >
              <SiteCover src={design.coverUrl} />
              <p className="eyebrow">
                {tenant.theme?.category || t("personalCoaching")}
              </p>
              <h1 dir="auto">
                {site.headline ||
                  tenant.theme?.headline ||
                  t("trainWith", { name })}
              </h1>
              {intro && paragraph(intro, "site-lead")}
              {inlineActions}
            </section>
            <section className="site-meet" aria-labelledby="site-meet-title">
              <SitePortrait src={design.photoUrl} name={name} />
              <div className="site-meet-text">
                <h2 id="site-meet-title">{t("meetYourCoach")}</h2>
                {about
                  ? paragraph(
                      about.length > 420 ? about.slice(0, 400).trimEnd() + "…" : about,
                      "site-excerpt",
                    )
                  : design.tagline && <p dir="auto">{design.tagline}</p>}
                <Link className="site-more" href={`${base}/about`}>
                  {t("moreAbout", { name })}{" "}
                  <span className="bidi-mirror" aria-hidden="true">
                    →
                  </span>
                </Link>
              </div>
            </section>
            <section className="site-steps" aria-labelledby="site-steps-title">
              <h2 id="site-steps-title">{t("howToStart")}</h2>
              <ol>
                {hasPlans ? (
                  <li>{b(t("stepChoose"))}</li>
                ) : (
                  <li>{b(t("stepMessage", { name }))}</li>
                )}
                <li>{b(t("stepAccount"))}</li>
                <li>{b(t("stepTrain", { name }))}</li>
              </ol>
            </section>
          </>
        )}
        {section === "about" && (
          <section className="site-about">
            <SitePortrait
              src={design.photoUrl}
              name={name}
              className="is-large"
            />
            <div>
              <h1>{t("meet", { name })}</h1>
              {design.tagline && (
                <p className="site-tagline" dir="auto">
                  {design.tagline}
                </p>
              )}
              {about ? (
                paragraph(about)
              ) : (
                <p className="muted">{t("noAbout", { name })}</p>
              )}
              {inlineActions}
            </div>
          </section>
        )}
        {section === "memberships" && (
          <section className="site-memberships">
            <h1>{t("findPlan")}</h1>
            {hasPlans ? (
              <>
                <p className="muted site-subtitle">
                  {t("joinFirst", { name })}
                </p>
                <ul className="site-plans">
                  {products.map((p: any) => {
                    const terms = offerTermsText(p.data, pageLanguage);
                    return (
                      <li key={p.id}>
                        <article className="card site-plan">
                          <p className="eyebrow">
                            {p.data.tier === "workout_nutrition"
                              ? t("tierNutrition")
                              : t("tierWorkout")}
                          </p>
                          <h2 dir="auto">{p.data.name}</h2>
                          {p.data.description && (
                            <p dir="auto">{p.data.description}</p>
                          )}
                          <p className="site-price">
                            <span
                              dir={pageLanguage === "en" ? "ltr" : undefined}
                            >
                              {terms.price}
                            </span>
                          </p>
                          <p className="muted">{terms.length}</p>
                          {terms.voice && <p className="muted">{terms.voice}</p>}
                          {p.data.trialDays > 0 && (
                            <p>{t("trial", { count: p.data.trialDays })}</p>
                          )}
                        </article>
                      </li>
                    );
                  })}
                </ul>
                {preview ? (
                  <p className="muted">{t("signupOnPublished")}</p>
                ) : (
                  inlineActions
                )}
              </>
            ) : (
              <div className="site-empty" role="status">
                <h2>{t("plansNotListed")}</h2>
                <p>{t("plansNotListedText", { name })}</p>
                {inlineActions}
              </div>
            )}
          </section>
        )}
        {section === "galleries" && (
          <section className="site-galleries">
            <h1>{t("galleriesTitle")}</h1>
            {data.galleries.map((g: any) => (
              <article key={g.id} className="site-gallery">
                <h2 dir="auto">{g.title}</h2>
                {g.description && <p dir="auto">{g.description}</p>}
                <div className="photo-grid site-photos">
                  {g.photos.map((p: any) => (
                    <figure key={p.media_id}>
                      <img
                        src={p.url}
                        alt={p.alt}
                        width={800}
                        height={600}
                        loading="lazy"
                        decoding="async"
                      />
                      {p.caption && (
                        <figcaption dir="auto">{p.caption}</figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              </article>
            ))}
            {!data.galleries.length && (
              <div className="site-empty" role="status">
                <div className="site-empty-art" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <h2>{t("noPhotos")}</h2>
                <p>{t("noPhotosText", { name })}</p>
              </div>
            )}
            {next !== null && (
              <button
                type="button"
                className="button secondary site-more-galleries"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const d = await api(
                      preview
                        ? `/tenant/galleries?offset=${next}`
                        : `/public/sites/${tenant.slug}/galleries?offset=${next}`,
                    );
                    setData({
                      ...data,
                      galleries: [...data.galleries, ...d.galleries],
                    });
                    setNext(d.nextOffset);
                  } catch (e) {
                    setMessage(errorText(e, pageLanguage));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? translator(commonMessages, pageLanguage)("loading")
                  : t("moreGalleries")}
              </button>
            )}
          </section>
        )}
        {section === "contact" && (
          <section className="site-contact">
            <h1>{t("contactTitle")}</h1>
            <p className="muted site-subtitle">
              {t("contactSubtitle", { name })}
            </p>
            {(site.contactEmail ||
              site.whatsapp ||
              site.instagram ||
              site.youtube) && (
              <ul
                className="site-contact-links"
                aria-label={t("otherWays", { name })}
              >
                {site.contactEmail && (
                  <li>
                    <a href={`mailto:${site.contactEmail}`}>
                      <Mail size={18} aria-hidden="true" />
                      <span dir="ltr">{site.contactEmail}</span>
                    </a>
                  </li>
                )}
                {site.whatsapp && (
                  <li>
                    <a
                      href={`https://wa.me/${site.whatsapp.slice(1)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle size={18} aria-hidden="true" />
                      {t("whatsApp")}
                    </a>
                  </li>
                )}
                {site.instagram && (
                  <li>
                    <a href={site.instagram} target="_blank" rel="noopener noreferrer">
                      <AtSign size={18} aria-hidden="true" />
                      Instagram
                    </a>
                  </li>
                )}
                {site.youtube && (
                  <li>
                    <a href={site.youtube} target="_blank" rel="noopener noreferrer">
                      <PlayCircle size={18} aria-hidden="true" />
                      YouTube
                    </a>
                  </li>
                )}
              </ul>
            )}
            {sent ? (
              <div className="card site-sent" role="status">
                <h2>{t("messageSent")}</h2>
                <p>{t("messageSentText", { name })}</p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setSent(false)}
                >
                  {t("sendAnother")}
                </button>
              </div>
            ) : (
              <form
                id="coach-contact-form"
                className="card site-contact-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (preview) {
                    setMessage(t("publishFirst"));
                    return;
                  }
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  setBusy(true);
                  setMessage("");
                  try {
                    await api(`/public/sites/${tenant.slug}/contact`, "POST", {
                      name: f.get("name"),
                      email: f.get("email"),
                      message: f.get("message"),
                      consent: f.get("consent") === "on",
                      website: f.get("website"),
                    });
                    form.reset();
                    setSent(true);
                  } catch (e) {
                    setMessage(errorText(e, pageLanguage));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label={t("yourName")}>
                  <input
                    name="name"
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    required
                    maxLength={100}
                  />
                </Field>
                <Field label={t("email")}>
                  <input
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="next"
                    required
                  />
                </Field>
                <Field label={t("howHelp")}>
                  <textarea
                    name="message"
                    minLength={10}
                    maxLength={4000}
                    required
                    rows={5}
                    aria-describedby="contact-message-hint"
                  />
                </Field>
                <small className="field-hint" id="contact-message-hint">
                  {t("messageHint")}
                </small>
                <input
                  name="website"
                  aria-hidden="true"
                  tabIndex={-1}
                  autoComplete="off"
                  className="site-honeypot"
                />
                <label className="check-field site-consent">
                  <input name="consent" type="checkbox" required />
                  <span>{t("consent")}</span>
                </label>
                {message && (
                  <p className="notice error" role="alert">
                    {message}
                  </p>
                )}
                <div className={`site-actions${preview ? " is-preview" : ""}`}>
                  <button className="button" type="submit" disabled={busy}>
                    {busy
                      ? t("sending")
                      : preview
                        ? t("previewInquiry")
                        : t("sendMessage")}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
        {custom && (
          <section className="site-page">
            <h1 dir="auto">{custom.title}</h1>
            {paragraph(custom.body)}
          </section>
        )}
        {missing && (
          <section className="site-page">
            <h1>{t("notFound")}</h1>
            <Link className="button secondary" href={base}>
              {t("returnHome")}
            </Link>
          </section>
        )}
        {section !== "contact" && <Notice message={message} />}
      </main>
      <SubscriberFooter
        name={name}
        coach
        directory={false}
        signIn={!preview}
        analytics={!preview}
        locale={pageLanguage}
      />
      {!preview && !missing && !(section === "contact" && sent) && (
        <StickyActionBar label={t("actions", { name })}>
          {section === "contact" ? (
            <button
              className="button"
              type="submit"
              form="coach-contact-form"
              disabled={busy}
            >
              {busy ? t("sending") : t("sendMessage")}
            </button>
          ) : (
            <>
              {secondary && (
                <Link className="button secondary" href={secondary.href}>
                  {secondary.label}
                </Link>
              )}
              <Link className="button" href={primary.href}>
                {primary.label}
              </Link>
            </>
          )}
        </StickyActionBar>
      )}
    </TrainerTheme>
  );
}

export function ClientCoachManifest({
  tenant,
}: {
  tenant: { slug: string; name: string; published?: boolean | null };
}) {
  const path = usePathname();
  useEffect(() => {
    const changes: Array<() => void> = [];
    // A private workspace has no public site assets; keep the platform icon.
    for (const [rel, url] of coachAppLinks(tenant)) {
      const existing = document.head.querySelector<HTMLLinkElement>(
          `link[rel="${rel}"]`,
        ),
        link = existing ?? document.createElement("link"),
        original = link.getAttribute("href");
      link.rel = rel;
      link.href = url;
      if (!existing) document.head.append(link);
      changes.push(() => {
        if (link.getAttribute("href") !== url) return;
        if (!existing) link.remove();
        else if (original) link.setAttribute("href", original);
        else link.removeAttribute("href");
      });
    }
    const originalTitle = document.title;
    document.title = `${tenant.name} · Coaching`;
    return () => {
      for (const undo of changes) undo();
      if (document.title === `${tenant.name} · Coaching`)
        document.title = originalTitle;
    };
  }, [tenant.slug, tenant.name, tenant.published, path]);
  return null;
}
