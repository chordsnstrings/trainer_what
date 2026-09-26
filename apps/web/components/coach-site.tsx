"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrainerTheme, CoachIdentity, CoachCover } from "./trainer-design";

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
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);
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
    [busy, setBusy] = useState(false);
  async function load(offset = 0) {
    const d = await api(`/tenant/galleries?offset=${offset}`);
    setGalleries((v) => (offset ? [...v, ...d.galleries] : d.galleries));
    setNext(d.nextOffset);
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
          <p className="eyebrow">YOUR COACHING IN PICTURES</p>
          <h1>{client ? "Coach galleries." : "Photos & galleries."}</h1>
          <p className="muted">
            {client
              ? "A closer look at your coach’s practice."
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
      <div className="gallery-list">
        {galleries.map((g) => (
          <section className="card" key={g.id}>
            <h2>{g.title}</h2>
            <p>{g.description}</p>
            {!client && (
              <p className="muted">
                Visibility: {g.audience} · {g.photos.length} photos
              </p>
            )}
            <div className="photo-grid">
              {g.photos.map((p: any) => (
                <figure key={p.media_id}>
                  <img src={p.url} alt={p.alt} loading="lazy" />
                  {p.caption && <figcaption>{p.caption}</figcaption>}
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
          More galleries
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
                  <a href={`mailto:${r.data.email}`}>{r.data.email}</a>
                  <p className="site-prose">{r.data.message}</p>
                  <small>{r.status}</small>
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

export function CoachWebsite({
  initialData,
  path = "",
  preview = false,
}: {
  initialData?: any;
  path?: string;
  preview?: boolean;
}) {
  const [data, setData] = useState<any>(initialData ?? null),
    [message, setMessage] = useState(""),
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
          if (current) setMessage(e.message);
        });
    return () => {
      current = false;
    };
  }, [initialData, preview]);
  if (!data)
    return (
      <main className="coach-website">
        <Notice message={message || "Loading your website…"} />
      </main>
    );
  const { tenant, site } = data,
    base = preview ? "/trainer/website/preview" : `/coach/${tenant.slug}`,
    section = path.split("/").filter(Boolean)[0] ?? "",
    join = `/join-coach/${tenant.slug}`;
  const custom = (site.pages ?? []).find(
      (p: any) => p.slug === section && p.visible,
    ),
    paragraph = (v: string) => <div className="site-prose">{v}</div>;
  return (
    <TrainerTheme theme={tenant.theme} className="coach-website">
      <header className="site-header">
        <Link href={base}>
          <CoachIdentity name={tenant.name} theme={tenant.theme} />
        </Link>
        <nav aria-label="Coach website">
          <Link href={base}>Home</Link>
          <Link href={`${base}/about`}>About</Link>
          <Link href={`${base}/memberships`}>Memberships</Link>
          <Link href={`${base}/galleries`}>Galleries</Link>
          {(site.pages ?? [])
            .filter((p: any) => p.visible)
            .map((p: any) => (
              <Link key={p.slug} href={`${base}/${p.slug}`}>
                {p.title}
              </Link>
            ))}
          <Link href={`${base}/contact`}>Contact</Link>
        </nav>
      </header>
      {preview && (
        <p className="notice">
          Private preview of your saved draft.{" "}
          <Link href="/trainer/website">Return to website editor</Link>
        </p>
      )}
      <main>
        {!section && (
          <>
            <CoachCover theme={tenant.theme} />
            <section className="site-hero">
              <p className="eyebrow">
                {tenant.theme?.category || "PERSONAL COACHING"}
              </p>
              <h1>
                {site.headline ||
                  tenant.theme?.headline ||
                  `Train with ${tenant.name}.`}
              </h1>
              {paragraph(site.introduction || tenant.theme?.bio || "")}
              <Link className="button" href={`${base}/memberships`}>
                {site.cta}
              </Link>
            </section>
            <section className="site-split">
              <div>
                <h2>Built around your next chapter.</h2>
                {paragraph(
                  (site.about || tenant.theme?.design?.coachBio || "").slice(
                    0,
                    1200,
                  ),
                )}
                <Link href={`${base}/about`}>Meet your coach →</Link>
              </div>
              {tenant.theme?.design?.photoUrl && (
                <img src={tenant.theme.design.photoUrl} alt={tenant.name} />
              )}
            </section>
          </>
        )}
        {section === "about" && (
          <section>
            <h1>Meet {tenant.name}.</h1>
            {paragraph(site.about || tenant.theme?.bio || "")}
          </section>
        )}
        {section === "memberships" && (
          <section>
            <h1>Find your coaching plan.</h1>
            <div className="site-grid">
              {(data.products ?? []).map((p: any) => (
                <article className="card" key={p.id}>
                  <p className="eyebrow">
                    {p.data.tier === "workout_nutrition"
                      ? "WORKOUT + NUTRITION"
                      : "WORKOUT"}
                  </p>
                  <h2>{p.data.name}</h2>
                  <p>{p.data.description}</p>
                  <p className="site-price">
                    AED {(p.data.priceMinor / 100).toFixed(2)}{" "}
                    <small>/ month</small>
                  </p>
                  {p.data.trialDays > 0 && (
                    <p>
                      {p.data.trialDays}-day trial for eligible new members.
                    </p>
                  )}
                  {preview ? (
                    <p className="muted">
                      Membership signup is available on the published website.
                    </p>
                  ) : (
                    <Link className="button" href={join}>
                      {site.cta}
                    </Link>
                  )}
                </article>
              ))}
            </div>
            {!data.products?.length && (
              <p>
                Membership details are being prepared.{" "}
                <Link href={`${base}/contact`}>Contact your coach</Link>.
              </p>
            )}
          </section>
        )}
        {section === "galleries" && (
          <section>
            <h1>Life around the training.</h1>
            {data.galleries.map((g: any) => (
              <article key={g.id}>
                <h2>{g.title}</h2>
                <p>{g.description}</p>
                <div className="photo-grid">
                  {g.photos.map((p: any) => (
                    <figure key={p.media_id}>
                      <img src={p.url} alt={p.alt} loading="lazy" />
                      {p.caption && <figcaption>{p.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              </article>
            ))}
            {!data.galleries.length && <p>Photos are on their way.</p>}
            {next !== null && (
              <button
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
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                More galleries
              </button>
            )}
          </section>
        )}
        {section === "contact" && (
          <section className="site-contact">
            <div>
              <h1>Let’s talk about your goals.</h1>
              {site.contactEmail && (
                <p>
                  <a href={`mailto:${site.contactEmail}`}>
                    {site.contactEmail}
                  </a>
                </p>
              )}
              {site.whatsapp && (
                <p>
                  <a
                    href={`https://wa.me/${site.whatsapp.slice(1)}`}
                    rel="noopener noreferrer"
                  >
                    Chat on WhatsApp
                  </a>
                </p>
              )}
              {site.instagram && (
                <p>
                  <a href={site.instagram} rel="noopener noreferrer">
                    Instagram
                  </a>
                </p>
              )}
              {site.youtube && (
                <p>
                  <a href={site.youtube} rel="noopener noreferrer">
                    YouTube
                  </a>
                </p>
              )}
            </div>
            <form
              className="card"
              onSubmit={async (e) => {
                e.preventDefault();
                if (preview) {
                  setMessage("Publish your website to receive real inquiries.");
                  return;
                }
                const f = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await api(`/public/sites/${tenant.slug}/contact`, "POST", {
                    name: f.get("name"),
                    email: f.get("email"),
                    message: f.get("message"),
                    consent: f.get("consent") === "on",
                    website: f.get("website"),
                  });
                  setMessage("Your message is with your coach.");
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Your name">
                <input name="name" required maxLength={100} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required />
              </Field>
              <Field label="How can we help?">
                <textarea
                  name="message"
                  minLength={10}
                  maxLength={4000}
                  required
                  rows={5}
                />
              </Field>
              <input
                name="website"
                aria-hidden="true"
                tabIndex={-1}
                autoComplete="off"
                className="site-honeypot"
              />
              <label className="check">
                <input name="consent" type="checkbox" required />I agree to be
                contacted about my inquiry.
              </label>
              <button disabled={busy}>
                {busy
                  ? "Sending…"
                  : preview
                    ? "Preview inquiry"
                    : "Send message"}
              </button>
            </form>
          </section>
        )}
        {custom && (
          <section>
            <h1>{custom.title}</h1>
            {paragraph(custom.body)}
          </section>
        )}
        {section &&
          !custom &&
          !["about", "memberships", "galleries", "contact"].includes(
            section,
          ) && (
            <section>
              <h1>Page not found.</h1>
              <Link href={base}>Return home</Link>
            </section>
          )}
        <Notice message={message} />
      </main>
      <footer className="site-footer">
        <span>
          © {new Date().getFullYear()} {tenant.name}
        </span>
        <nav>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/ai-disclosure">Digital coaching</Link>
          {!preview && <Link href="/login">Member login</Link>}
        </nav>
      </footer>
    </TrainerTheme>
  );
}

export function ClientCoachManifest({
  tenant,
}: {
  tenant: { slug: string; name: string };
}) {
  const path = usePathname();
  useEffect(() => {
    const changes: Array<() => void> = [];
    for (const [rel, url] of [
      ["manifest", `/api/v1/public/sites/${tenant.slug}/manifest.webmanifest`],
      ["icon", `/api/v1/public/sites/${tenant.slug}/icon/192`],
      ["apple-touch-icon", `/api/v1/public/sites/${tenant.slug}/icon/192`],
    ]) {
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
  }, [tenant.slug, tenant.name, path]);
  return null;
}
