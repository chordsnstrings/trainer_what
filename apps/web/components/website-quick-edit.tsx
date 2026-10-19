"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  legacyToBuilder,
  siteBuilderSchema,
  resolveBrandDesign,
} from "@trainer/contracts";
import { BuilderWebsite } from "./site-builder-renderer";
import { confirmWorkspace } from "./workspace-feedback";

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    signal: method === "GET" ? AbortSignal.timeout(20000) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Could not update your website.");
  return data;
}

/** The same versioned draft and publish boundary as the full editor. */
export function WebsiteQuickEdit({ slug, onOpenDesktop }: { slug: string; onOpenDesktop?: () => void }) {
  const [row, setRow] = useState<any>(null),
    [site, setSite] = useState<any>(null),
    [context, setContext] = useState<any>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const [saved, preview] = await Promise.all([
        request("/tenant/site"),
        request("/tenant/site/preview"),
      ]);
      setRow(saved);
      setContext(preview);
      setSite({
        ...saved.draft,
        builder:
          saved.draft.builder ?? legacyToBuilder(saved.draft, preview.tenant),
      });
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const hero = site?.builder.pages
    .find((p: any) => p.slug === "")
    ?.sections.find((s: any) => s.moduleId === "hero");
  const update = (key: string, value: string, section = false) => {
    setSite((previous: any) => {
      const next = structuredClone(previous);
      if (section && hero)
        next.builder.pages
          .flatMap((p: any) => p.sections)
          .find((s: any) => s.id === hero.id).content[key] = value;
      else next[key] = value;
      return next;
    });
    setDirty(true);
    setMessage("");
  };
  const save = async (publish = false) => {
    if (busy || !site) return;
    if (
      publish &&
      !(await confirmWorkspace({
        title: "Publish this website draft?",
        detail:
          "All saved draft changes, including changes from the full editor, will replace the public website. Review the preview first.",
        confirm: "Publish website",
      }))
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const valid = siteBuilderSchema.safeParse(site.builder);
      if (!valid.success)
        throw new Error(valid.error.issues[0]?.message || "Check your draft.");
      const saved = dirty
        ? await request("/tenant/site", "PUT", { version: row.version, site })
        : row;
      setRow(saved);
      setDirty(false);
      setMessage("Draft saved. Your public website is unchanged.");
      if (publish) {
        const live = await request("/tenant/site/publish", "POST", {
          version: saved.version,
        });
        setRow(live);
        setMessage("Website published.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const brand = resolveBrandDesign(context?.tenant?.theme);
  return (
    <div className="website-quick-edit stack">
      <header>
        <p className="eyebrow">WEBSITE STUDIO</p>
        <h1>Quick edit</h1>
        <p>
          Update your headline and contact details, then review the draft before
          publishing.
        </p>
        {onOpenDesktop && <button type="button" className="button secondary website-quick-open-full" disabled={busy || dirty || !site} onClick={onOpenDesktop}>
          {dirty ? "Save to open full editor" : "Open full editor"}
        </button>}
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
          {!site && (
            <button className="text-button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!site && !error && <p role="status">Loading your draft…</p>}
      {site && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            data-unsaved={dirty ? "" : undefined}
          >
            <fieldset disabled={busy}>
              {hero && (
                <>
                  <label className="field">
                    <span>Headline</span>
                    <input
                      value={hero.content.title}
                      maxLength={300}
                      onChange={(e) => update("title", e.target.value, true)}
                    />
                  </label>
                  <label className="field">
                    <span>Introduction</span>
                    <textarea
                      value={hero.content.body}
                      maxLength={20000}
                      rows={3}
                      onChange={(e) => update("body", e.target.value, true)}
                    />
                  </label>
                </>
              )}
              {(
                [
                  ["contactEmail", "Public contact email"],
                  ["whatsapp", "WhatsApp"],
                  ["instagram", "Instagram"],
                  ["youtube", "YouTube"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    type={key === "contactEmail" ? "email" : "text"}
                    value={site[key] ?? ""}
                    onChange={(e) => update(key, e.target.value)}
                  />
                </label>
              ))}
              <div className="button-row">
                <button className="button" disabled={!dirty}>
                  {busy ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void save(true)}
                >
                  Review and publish
                </button>
              </div>
            </fieldset>
          </form>
          <nav className="button-row" aria-label="Related website edits">
            <Link href="/trainer/design">Change photo and brand</Link>
            <Link href="/trainer/finance?view=offers">Edit offers</Link>
          </nav>
          <details>
            <summary>Preview this draft</summary>
            <div className="quick-site-preview">
              <BuilderWebsite
                builder={site.builder}
                preview
                context={{
                  name: context.tenant.name,
                  tenantSlug: slug,
                  basePath: `/coach/${slug}`,
                  joinPath: `/join-coach/${slug}`,
                  products: context.products,
                  galleries: context.galleries,
                  preview: true,
                  language: site.language,
                  photoUrl: brand.photoUrl,
                  logoUrl: brand.logoUrl,
                  contactEmail: site.contactEmail,
                  whatsapp: site.whatsapp,
                  instagram: site.instagram,
                  youtube: site.youtube,
                }}
              />
            </div>
          </details>
          <p className="muted">
            For page layouts, sections and detailed design, open the full editor
            on a desktop or laptop.
          </p>
        </>
      )}
    </div>
  );
}
