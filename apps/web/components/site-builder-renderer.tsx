"use client";

import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  getBuilderVideoEmbedUrl,
  isBuilderGloballyHidden,
  isSafeBuilderLink,
  type SiteBuilderAction,
  type SiteBuilderDocument,
  type SiteBuilderElement,
  type SiteBuilderItem,
  type SiteBuilderPage,
  type SiteBuilderSection,
  type SiteBuilderTheme,
} from "@trainer/contracts";
import { offerTermsText } from "./programme-offers";
import { translator } from "../lib/i18n/core";
import siteMessages from "../lib/i18n/messages/site";
import authMessages from "../lib/i18n/messages/auth";
import { errorText } from "../lib/i18n/errors";
import {
  builderContrastText,
  builderPagePath,
  builderStyleVariables,
  resolveBuilderActionHref,
  safeBuilderImage,
  type BuilderContext,
  type BuilderGallery,
  type BuilderInquiry,
} from "./site-builder-render-utils";

export type {
  BuilderContext,
  BuilderInquiry,
} from "./site-builder-render-utils";
export { resolveBuilderActionHref } from "./site-builder-render-utils";

type TextChange = (sectionId: string, field: string, value: string) => void;
type SectionProps = {
  section: SiteBuilderSection;
  context: BuilderContext;
  builder?: SiteBuilderDocument;
  firstHeading?: boolean;
  selected?: boolean;
  onSelect?: (sectionId: string) => void;
  onTextChange?: TextChange;
};
type ChromeProps = {
  builder: SiteBuilderDocument;
  context: BuilderContext;
  path?: string;
  onNavigate?: (slug: string) => void;
};
const labels = {
  en: {
    menu: "Menu",
    close: "Close menu",
    pages: "Website pages",
    play: "Play video",
    videoPrivacy: "Playing loads this video from its video provider.",
    videoMissing: "A video will appear here when the coach adds one.",
    photosMissing: "Photos will appear here when the coach shares them.",
    addPhotos: "Choose photos from your media library.",
    reviewMissing: "Add a client story shared with their permission.",
    proofMissing: "Add your verified figures and what they measure.",
    before: "Before",
    after: "After",
    comparison: "Coaching comparison",
    more: "Learn more",
    open: "Open",
    book: "Join to book a session",
    bookingNote:
      "Bookings are available in your member account after you join.",
    unavailable: "This link needs a destination.",
    preview: "This action is available on your published website.",
    skip: "Skip to content",
    steps: "Your next steps",
    safeMessage:
      "Send a question about coaching. Share health details privately after you join.",
    credentials: "Qualifications",
    social: "Social links",
    contents: "On this website",
    location: "Location",
    details: "Details",
  },
  ar: {
    menu: "القائمة",
    close: "إغلاق القائمة",
    pages: "صفحات الموقع",
    play: "تشغيل الفيديو",
    videoPrivacy: "يؤدي التشغيل إلى تحميل الفيديو من مزوّده.",
    videoMissing: "سيظهر الفيديو هنا عندما يضيفه المدرب.",
    photosMissing: "ستظهر الصور هنا عندما يشاركها المدرب.",
    addPhotos: "اختر صورًا من مكتبة الوسائط.",
    reviewMissing: "أضف قصة عميل بموافقته.",
    proofMissing: "أضف أرقامًا موثقة مع توضيح ما تقيسه.",
    before: "قبل",
    after: "بعد",
    comparison: "مقارنة التدريب",
    more: "اعرف المزيد",
    open: "فتح",
    book: "انضم لحجز جلسة",
    bookingNote: "يمكنك حجز الجلسات في حسابك بعد الانضمام.",
    unavailable: "يحتاج هذا الرابط إلى وجهة.",
    preview: "يتوفر هذا الإجراء في موقعك المنشور.",
    skip: "انتقل إلى المحتوى",
    steps: "خطواتك التالية",
    safeMessage:
      "أرسل سؤالًا عن التدريب. شارك تفاصيلك الصحية بشكل خاص بعد الانضمام.",
    credentials: "المؤهلات",
    social: "روابط التواصل",
    contents: "في هذا الموقع",
    location: "الموقع",
    details: "التفاصيل",
  },
};
const words = (context: BuilderContext) =>
  labels[context.language === "ar" ? "ar" : "en"];
const fontStacks = {
  sans: "var(--font-inter, Arial), Helvetica, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  display: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
  rounded: '"Trebuchet MS", Arial, sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
};

/** The public site has its own theme; editing it never mutates member-app CSS. */
export function BuilderTheme({
  theme,
  language = "en",
  className = "",
  children,
}: {
  theme: SiteBuilderTheme;
  language?: "en" | "ar";
  className?: string;
  children: ReactNode;
}) {
  const style = {
    "--sb-bg": theme.background,
    "--sb-text": theme.text,
    "--sb-accent": theme.accent,
    "--sb-surface": theme.surface,
    "--sb-muted": theme.muted,
    "--sb-border": theme.border,
    "--sb-radius": `${theme.radius}px`,
    "--sb-width": `${theme.width}px`,
    "--sb-on-accent": builderContrastText(theme.accent),
    "--sb-heading-font": fontStacks[theme.font] ?? fontStacks.sans,
    "--sb-body-font": theme.font === "mono" ? fontStacks.mono : fontStacks.sans,
  } as CSSProperties;
  return (
    <div
      className={`sb-site ${className}`}
      style={style}
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      data-font={theme.font}
    >
      {children}
    </div>
  );
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <span className="sb-arrow" aria-hidden="true">
      {diagonal ? "↗" : "→"}
    </span>
  );
}

function PageLink({
  page,
  context,
  path,
  children,
  className = "",
}: {
  page: SiteBuilderPage;
  context: BuilderContext;
  path?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={builderPagePath(context.basePath, page.slug)}
      className={className}
      aria-current={page.slug === path ? "page" : undefined}
      onClick={(event) => {
        if (context.onNavigate) {
          event.preventDefault();
          context.onNavigate(page.slug);
        } else if (context.preview) event.preventDefault();
        event.currentTarget
          .closest<HTMLDetailsElement>(".sb-mobile-menu")
          ?.removeAttribute("open");
      }}
    >
      <bdi>{children ?? page.title}</bdi>
    </a>
  );
}

function Action({
  action,
  context,
  builder,
  secondary = false,
  plain = false,
}: {
  action: SiteBuilderAction;
  context: BuilderContext;
  builder?: SiteBuilderDocument;
  secondary?: boolean;
  plain?: boolean;
}) {
  const href = resolveBuilderActionHref(action, builder, context);
  const className = plain
    ? "sb-text-link"
    : `sb-button${secondary ? " sb-button-secondary" : ""}`;
  if (!href || !action.label.trim())
    return context.preview && action.label.trim() ? (
      <span
        className={`${className} sb-disabled`}
        title={words(context).unavailable}
      >
        {action.label}
      </span>
    ) : null;
  return (
    <a
      href={href}
      className={className}
      target={action.newTab ? "_blank" : undefined}
      rel={action.newTab ? "noopener noreferrer" : undefined}
      onClick={(event) => {
        if (context.preview) event.preventDefault();
        if (context.onNavigate && builder && action.kind === "page") {
          const page = builder.pages.find(
            (candidate) => candidate.id === action.pageId,
          );
          if (page) {
            event.preventDefault();
            context.onNavigate(page.slug);
          }
        }
      }}
    >
      <span dir="auto">{action.label}</span>
      <Arrow diagonal={action.kind === "url"} />
    </a>
  );
}

function Actions({
  actions,
  context,
  builder,
}: {
  actions: SiteBuilderAction[];
  context: BuilderContext;
  builder?: SiteBuilderDocument;
}) {
  return actions.length ? (
    <div className="sb-actions">
      {actions.map((action, index) => (
        <Action
          key={`${action.kind}-${index}`}
          action={action}
          context={context}
          builder={builder}
          secondary={index > 0}
        />
      ))}
    </div>
  ) : null;
}

function SiteIdentity({
  context,
  builder,
}: {
  context: BuilderContext;
  builder: SiteBuilderDocument;
}) {
  const logo = safeBuilderImage(context.logoUrl);
  const home =
    builder.pages.find((page) => page.slug === "") ?? builder.pages[0];
  return (
    <PageLink page={home} context={context} className="sb-identity">
      {builder.header.showLogo && logo && (
        <img
          src={logo}
          width={56}
          height={56}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
        />
      )}
      {(builder.header.showTitle || !logo || !builder.header.showLogo) && (
        <span>{context.name}</span>
      )}
    </PageLink>
  );
}

export function BuilderHeader({
  builder,
  context,
  path = "",
  onNavigate,
}: ChromeProps) {
  const ctx = onNavigate ? { ...context, onNavigate } : context;
  const pages = builder.pages.filter(
    (page) => page.visible && page.inNavigation,
  );
  const roots = pages.filter(
    (page) =>
      !page.parentId || !pages.some((parent) => parent.id === page.parentId),
  );
  const nav = (mobile = false) => (
    <nav
      className={mobile ? "sb-mobile-nav" : "sb-desktop-nav"}
      aria-label={words(ctx).pages}
    >
      {roots.map((page) => {
        const children = pages.filter(
          (candidate) => candidate.parentId === page.id,
        );
        return children.length ? (
          <details className="sb-nav-group" key={page.id}>
            <summary>
              <bdi>{page.title}</bdi>
              <span aria-hidden="true">⌄</span>
            </summary>
            <div className="sb-nav-dropdown">
              <PageLink page={page} context={ctx} path={path} />
              {children.map((child) => (
                <PageLink
                  key={child.id}
                  page={child}
                  context={ctx}
                  path={path}
                />
              ))}
            </div>
          </details>
        ) : (
          <PageLink key={page.id} page={page} context={ctx} path={path} />
        );
      })}
      {mobile && builder.header.action && (
        <Action
          action={builder.header.action}
          builder={builder}
          context={ctx}
        />
      )}
    </nav>
  );
  return (
    <header
      className="sb-header"
      data-variant={builder.header.variant}
      data-sticky={
        builder.header.sticky && !context.preview ? "true" : undefined
      }
    >
      <div className="sb-header-inner">
        <SiteIdentity context={ctx} builder={builder} />
        {nav()}
        {builder.header.action && (
          <div className="sb-header-action">
            <Action
              action={builder.header.action}
              builder={builder}
              context={ctx}
            />
          </div>
        )}
        <details className="sb-mobile-menu">
          <summary aria-label={words(ctx).menu}>
            <span>{words(ctx).menu}</span>
            <span className="sb-menu-icon" aria-hidden="true">
              <i />
              <i />
            </span>
          </summary>
          {nav(true)}
        </details>
      </div>
    </header>
  );
}

function SocialLinks({ context }: { context: BuilderContext }) {
  const links: Array<[string, string]> = [];
  if (context.instagram && isSafeBuilderLink(context.instagram))
    links.push(["Instagram", context.instagram]);
  if (context.youtube && isSafeBuilderLink(context.youtube))
    links.push(["YouTube", context.youtube]);
  if (context.whatsapp && /^\+[1-9][0-9]{6,14}$/.test(context.whatsapp))
    links.push(["WhatsApp", `https://wa.me/${context.whatsapp.slice(1)}`]);
  if (
    context.contactEmail &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.contactEmail)
  )
    links.push([context.contactEmail, `mailto:${context.contactEmail}`]);
  return links.length ? (
    <ul className="sb-social" aria-label={words(context).social}>
      {links.map(([label, href]) => (
        <li key={href}>
          <a
            href={href}
            rel="noopener noreferrer"
            target={href.startsWith("https:") ? "_blank" : undefined}
            onClick={
              context.preview ? (event) => event.preventDefault() : undefined
            }
          >
            <bdi>{label}</bdi>
            <Arrow diagonal />
          </a>
        </li>
      ))}
    </ul>
  ) : null;
}

export function BuilderFooter({ builder, context, onNavigate }: ChromeProps) {
  const ctx = onNavigate ? { ...context, onNavigate } : context;
  const t = translator(authMessages, context.language ?? "en");
  return (
    <footer className="sb-footer" data-variant={builder.footer.variant}>
      <div className="sb-container sb-footer-main">
        <div className="sb-footer-brand">
          <strong dir="auto">{context.name}</strong>
          {builder.footer.text && <p dir="auto">{builder.footer.text}</p>}
          {builder.footer.action && (
            <Action
              action={builder.footer.action}
              builder={builder}
              context={ctx}
            />
          )}
        </div>
        <nav className="sb-footer-pages" aria-label={words(ctx).contents}>
          {builder.pages
            .filter((page) => page.visible && page.inNavigation)
            .map((page) => (
              <PageLink page={page} context={ctx} key={page.id} />
            ))}
        </nav>
        {builder.footer.showSocial && <SocialLinks context={ctx} />}
      </div>
      <div className="sb-container sb-footer-legal">
        <small>
          © {new Date().getFullYear()} <bdi>{context.name}</bdi>
        </small>
        <nav aria-label={t("helpAndLegal")}>
          <a
            href="/login"
            onClick={
              context.preview ? (event) => event.preventDefault() : undefined
            }
          >
            {t("memberSignIn")}
          </a>
          <a
            href="/terms"
            onClick={
              context.preview ? (event) => event.preventDefault() : undefined
            }
          >
            {t("terms")}
          </a>
          <a
            href="/privacy"
            onClick={
              context.preview ? (event) => event.preventDefault() : undefined
            }
          >
            {t("privacy")}
          </a>
          <a
            href="/ai-disclosure"
            onClick={
              context.preview ? (event) => event.preventDefault() : undefined
            }
          >
            {t("digitalCoaching")}
          </a>
          {!context.preview && (
            <button type="button" data-analytics-preferences="">
              {t("analyticsPreferences")}
            </button>
          )}
        </nav>
      </div>
    </footer>
  );
}

function Editable({
  as: Tag = "p",
  value,
  field,
  props,
  className = "",
}: {
  as?: "p" | "h1" | "h2" | "h3" | "div" | "span";
  value: string;
  field: string;
  props: SectionProps;
  className?: string;
}) {
  const editable = !!props.onTextChange;
  if (!value && !editable) return null;
  return (
    <Tag
      className={className}
      dir="auto"
      contentEditable={editable || undefined}
      suppressContentEditableWarning={editable}
      data-builder-field={field}
      data-placeholder={editable && !value ? field : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Edit ${field}` : undefined}
      onFocus={editable ? () => props.onSelect?.(props.section.id) : undefined}
      onClick={editable ? (event) => event.stopPropagation() : undefined}
      onKeyDown={
        editable
          ? (event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "s"
              ) {
                event.preventDefault();
                event.currentTarget.blur();
                return; // Let the editor's save shortcut commit the now-current draft.
              }
              event.stopPropagation();
              if (event.key === "Escape") {
                event.currentTarget.textContent = value;
                event.currentTarget.blur();
              }
              if (event.key === "Enter" && field !== "body") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }
          : undefined
      }
      onPaste={
        editable
          ? (event) => {
              // Paste text only. The persisted model never contains authored HTML.
              event.preventDefault();
              const pasted = event.clipboardData.getData("text/plain");
              const selection = window.getSelection();
              if (selection?.rangeCount) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const text = document.createTextNode(pasted);
                range.insertNode(text);
                range.setStartAfter(text);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            }
          : undefined
      }
      onBlur={
        editable
          ? (event) => {
              const text = (
                event.currentTarget.innerText ??
                event.currentTarget.textContent ??
                ""
              ).slice(
                0,
                field === "body"
                  ? 20000
                  : field === "title"
                    ? 300
                    : field === "caption"
                      ? 1000
                      : 100,
              );
              if (text !== value)
                props.onTextChange?.(props.section.id, field, text);
            }
          : undefined
      }
    >
      {value}
    </Tag>
  );
}

function Intro({
  props,
  body = true,
}: {
  props: SectionProps;
  body?: boolean;
}) {
  const c = props.section.content;
  return (
    <div className="sb-intro">
      <Editable
        value={c.eyebrow}
        field="eyebrow"
        props={props}
        className="sb-eyebrow"
      />
      <Editable
        as={props.firstHeading ? "h1" : "h2"}
        value={c.title}
        field="title"
        props={props}
        className="sb-title"
      />
      {body && (
        <Editable
          value={c.body}
          field="body"
          props={props}
          className="sb-copy"
        />
      )}
    </div>
  );
}

function Media({
  image,
  alt = "",
  context,
  className = "",
  priority = false,
}: {
  image?: string;
  alt?: string;
  context: BuilderContext;
  className?: string;
  priority?: boolean;
}) {
  const src = safeBuilderImage(image);
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? (
    <img
      className={`sb-image ${className}`}
      src={src}
      alt={alt}
      width={1200}
      height={1000}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  ) : (
    <div className={`sb-image sb-media-art ${className}`} aria-hidden="true">
      <span className="sb-art-orbit" />
      <span className="sb-art-line" />
      <span className="sb-art-word">
        {context.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")}
      </span>
    </div>
  );
}

function Video({
  url,
  poster,
  caption,
  context,
}: {
  url: string;
  poster?: string;
  caption?: string;
  context: BuilderContext;
}) {
  const src = getBuilderVideoEmbedUrl(url);
  const [playing, setPlaying] = useState(false);
  if (!src)
    return context.preview ? (
      <div className="sb-media-empty">
        <span aria-hidden="true">▷</span>
        <p>{words(context).videoMissing}</p>
      </div>
    ) : null;
  return (
    <figure className="sb-video">
      <div className="sb-video-frame">
        {playing ? (
          <iframe
            src={src}
            title={caption || words(context).play}
            loading="lazy"
            allow="fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            className="sb-video-play"
            onClick={(event) => {
              event.stopPropagation();
              setPlaying(true);
            }}
            aria-label={
              caption
                ? `${words(context).play}: ${caption}`
                : words(context).play
            }
          >
            <Media image={poster} context={context} />
            <span className="sb-play-symbol" aria-hidden="true">
              ▶
            </span>
            <span className="sb-play-label">{words(context).play}</span>
          </button>
        )}
      </div>
      {caption && <figcaption dir="auto">{caption}</figcaption>}
      {!playing && <small>{words(context).videoPrivacy}</small>}
    </figure>
  );
}

function ItemLink({
  item,
  props,
  children,
}: {
  item: SiteBuilderItem;
  props: SectionProps;
  children?: ReactNode;
}) {
  if (item.action)
    return (
      <Action
        action={item.action}
        context={props.context}
        builder={props.builder}
        plain
      />
    );
  if (item.href && isSafeBuilderLink(item.href))
    return (
      <a
        className="sb-text-link"
        href={item.href}
        rel="noopener noreferrer"
        onClick={
          props.context.preview ? (event) => event.preventDefault() : undefined
        }
      >
        {children ?? words(props.context).more}
        <Arrow diagonal />
      </a>
    );
  return null;
}

function ItemCards({
  props,
  numbered = false,
  images = false,
  className = "",
  quotes = false,
}: {
  props: SectionProps;
  numbered?: boolean;
  images?: boolean;
  className?: string;
  quotes?: boolean;
}) {
  return (
    <div className={`sb-items ${className}`}>
      {props.section.content.items.map((item, index) => (
        <article className="sb-item" key={item.id}>
          {images && (
            <Media
              image={item.image}
              alt={item.imageAlt || item.title}
              context={props.context}
            />
          )}
          <div className="sb-item-content">
            {numbered && (
              <span className="sb-item-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
            )}
            {item.eyebrow && (
              <p className="sb-eyebrow" dir="auto">
                {item.eyebrow}
              </p>
            )}
            {quotes ? (
              <>
                <blockquote dir="auto">{item.quote || item.body}</blockquote>
                {(item.author || item.title) && (
                  <p className="sb-attribution">
                    <strong dir="auto">{item.author || item.title}</strong>
                    {item.role && <span dir="auto">{item.role}</span>}
                  </p>
                )}
              </>
            ) : (
              <>
                {item.title && <h3 dir="auto">{item.title}</h3>}
                {item.body && <p dir="auto">{item.body}</p>}
                {item.caption && <small dir="auto">{item.caption}</small>}
              </>
            )}
            <ItemLink item={item} props={props} />
          </div>
        </article>
      ))}
    </div>
  );
}

function Pricing({ props }: { props: SectionProps }) {
  const { context, section, builder } = props;
  const t = translator(siteMessages, context.language ?? "en");
  const products = (context.products ?? []).filter(
    (product) =>
      (!section.content.productIds.length ||
        section.content.productIds.includes(product.id)) &&
      typeof product.data?.priceMinor === "number" &&
      Number.isSafeInteger(product.data.priceMinor) &&
      product.data.priceMinor >= 0,
  );
  return (
    <>
      <Intro props={props} />
      {products.length ? (
        <div className="sb-plans">
          {products.map((product) => {
            const terms = offerTermsText(
              product.data,
              context.language ?? "en",
            );
            return (
              <article className="sb-plan" key={product.id}>
                <p className="sb-eyebrow">
                  {product.data.tier === "workout_nutrition"
                    ? t("tierNutrition")
                    : t("tierWorkout")}
                </p>
                <h3 dir="auto">{product.data.name}</h3>
                {product.data.description && (
                  <p className="sb-plan-description" dir="auto">
                    {product.data.description}
                  </p>
                )}
                <p className="sb-plan-price" dir="auto">
                  {terms.price}
                </p>
                <p className="sb-plan-term">{terms.length}</p>
                {terms.voice && (
                  <p className="sb-plan-inclusion">
                    <span aria-hidden="true">✓</span>
                    {terms.voice}
                  </p>
                )}
                {!!product.data.trialDays && product.data.trialDays > 0 && (
                  <p className="sb-plan-inclusion">
                    {t("trial", { count: product.data.trialDays })}
                  </p>
                )}
                <Action
                  action={{
                    kind: "signup",
                    label: t("joinName", { name: context.name }),
                    newTab: false,
                  }}
                  context={context}
                  builder={builder}
                />
              </article>
            );
          })}
        </div>
      ) : (
        <div className="sb-empty">
          <h3>{t("plansNotListed")}</h3>
          <p>{t("plansNotListedText", { name: context.name })}</p>
          <Action
            action={{ kind: "contact", label: t("contact"), newTab: false }}
            context={context}
            builder={builder}
          />
        </div>
      )}
      {products.length > 0 && (
        <p className="sb-note">
          {context.preview
            ? t("signupOnPublished")
            : t("joinFirst", { name: context.name })}
        </p>
      )}
      <Actions
        actions={section.content.actions}
        context={context}
        builder={builder}
      />
    </>
  );
}

function ContactForm({ context }: { context: BuilderContext }) {
  const t = translator(siteMessages, context.language ?? "en");
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [problem, setProblem] = useState("");
  const id = useId();
  if (sent)
    return (
      <div className="sb-contact-success" role="status">
        <span className="sb-success-mark" aria-hidden="true">
          ✓
        </span>
        <h3>{t("messageSent")}</h3>
        <p>{t("messageSentText", { name: context.name })}</p>
        <button
          type="button"
          className="sb-button sb-button-secondary"
          onClick={() => setSent(false)}
        >
          {t("sendAnother")}
        </button>
      </div>
    );
  return (
    <form
      className="sb-contact-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (context.preview) {
          setProblem(t("publishFirst"));
          return;
        }
        const form = event.currentTarget,
          data = new FormData(form);
        if (data.get("consent") !== "on") return;
        const inquiry: BuilderInquiry = {
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          message: String(data.get("message") ?? ""),
          consent: true,
          website: String(data.get("website") ?? ""),
        };
        setBusy(true);
        setProblem("");
        try {
          if (context.onInquiry) await context.onInquiry(inquiry);
          else if (context.tenantSlug) {
            const response = await fetch(
              `/api/v1/public/sites/${encodeURIComponent(context.tenantSlug)}/contact`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(inquiry),
              },
            );
            if (!response.ok) {
              const result = await response.json().catch(() => ({}));
              throw new Error(result.message || "Please try again.");
            }
          } else throw new Error(t("publishFirst"));
          form.reset();
          setSent(true);
        } catch (error) {
          setProblem(errorText(error, context.language ?? "en"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`${id}-name`}>
        {t("yourName")}
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={100}
          autoComplete="name"
        />
      </label>
      <label htmlFor={`${id}-email`}>
        {t("email")}
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          dir="ltr"
        />
      </label>
      <label htmlFor={`${id}-message`}>
        {t("howHelp")}
        <textarea
          id={`${id}-message`}
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={4}
          aria-describedby={`${id}-hint`}
        />
      </label>
      <small id={`${id}-hint`}>{t("messageHint")}</small>
      <input
        className="sb-honeypot"
        name="website"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
      />
      <label className="sb-consent">
        <input name="consent" type="checkbox" required />
        <span>{t("consent")}</span>
      </label>
      {problem && (
        <p className="sb-form-error" role="alert">
          {problem}
        </p>
      )}
      <button className="sb-button" type="submit" disabled={busy}>
        {busy
          ? t("sending")
          : context.preview
            ? t("previewInquiry")
            : t("sendMessage")}
        <Arrow />
      </button>
    </form>
  );
}

function Element({
  element,
  props,
  depth = 0,
}: {
  element: SiteBuilderElement;
  props: SectionProps;
  depth?: number;
}) {
  if (depth > 4 || (!props.context.preview && isBuilderGloballyHidden(element)))
    return null;
  const content =
    element.type === "heading" ? (
      <h3 dir="auto">{element.text}</h3>
    ) : element.type === "text" ? (
      <div className="sb-copy" dir="auto">
        {element.text}
      </div>
    ) : element.type === "image" ? (
      <Media
        image={element.image}
        alt={element.imageAlt}
        context={props.context}
      />
    ) : element.type === "button" ? (
      element.action && (
        <Action
          action={element.action}
          builder={props.builder}
          context={props.context}
        />
      )
    ) : element.type === "video" ? (
      <Video
        url={element.videoUrl ?? ""}
        context={props.context}
        caption={element.text}
      />
    ) : element.type === "columns" ? (
      element.children.map((child) => (
        <div className="sb-column-cell" key={child.id}>
          <Element element={child} props={props} depth={depth + 1} />
        </div>
      ))
    ) : null;
  return (
    <div
      className={`sb-element sb-element-${element.type} sb-responsive`}
      style={builderStyleVariables(element.style, element.responsive)}
      data-element-id={element.id}
      aria-hidden={element.type === "spacer" ? true : undefined}
    >
      {content}
    </div>
  );
}

function GalleryModule({ props }: { props: SectionProps }) {
  const {
    section: { content },
    context,
    builder,
  } = props;
  const [loaded, setLoaded] = useState<BuilderGallery[]>([]);
  const [offset, setOffset] = useState<number | null>(
    context.galleries?.length === 24 ? 24 : null,
  );
  const [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  useEffect(() => {
    setLoaded([]);
    setOffset(context.galleries?.length === 24 ? 24 : null);
    setProblem("");
  }, [context.galleries, context.tenantSlug]);
  const t = translator(siteMessages, context.language ?? "en");
  const all = content.galleryId
    ? [...(context.galleries ?? []), ...(context.boundGalleries ?? [])]
    : [...(context.galleries ?? []), ...loaded];
  const seen = new Set<string>();
  const galleries = all.filter((gallery) => {
    if (
      (content.galleryId && gallery.id !== content.galleryId) ||
      seen.has(gallery.id)
    )
      return false;
    seen.add(gallery.id);
    return true;
  });
  const grid = (
    photos: Array<{
      id: string;
      image?: string;
      alt?: string;
      caption?: string;
    }>,
  ) => (
    <div className="sb-gallery">
      {photos.map((photo) => (
        <figure key={photo.id}>
          <Media image={photo.image} alt={photo.alt} context={context} />
          {photo.caption && <figcaption dir="auto">{photo.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
  return (
    <>
      <Intro props={props} />
      {content.items.length ? (
        grid(
          content.items.map((item) => ({
            id: item.id,
            image: item.image,
            alt: item.imageAlt || item.title,
            caption: item.caption || item.body,
          })),
        )
      ) : galleries.length ? (
        galleries.map((gallery) => (
          <div className="sb-gallery-group" key={gallery.id}>
            {gallery.title && (
              <h3 className="sb-gallery-title" dir="auto">
                {gallery.title}
              </h3>
            )}
            {gallery.description && (
              <p className="sb-gallery-description" dir="auto">
                {gallery.description}
              </p>
            )}
            {grid(
              (gallery.photos ?? []).map((photo, index) => ({
                id: photo.media_id || `${gallery.id}-${index}`,
                image: photo.url,
                alt: photo.alt,
                caption: photo.caption,
              })),
            )}
          </div>
        ))
      ) : (
        <p className="sb-empty-copy">
          {context.preview
            ? words(context).addPhotos
            : words(context).photosMissing}
        </p>
      )}
      {!content.items.length &&
        !content.galleryId &&
        offset !== null &&
        context.tenantSlug && (
          <button
            className="sb-button sb-button-secondary sb-gallery-more"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setProblem("");
              try {
                const path = context.preview
                  ? `/api/v1/tenant/galleries?offset=${offset}`
                  : `/api/v1/public/sites/${encodeURIComponent(context.tenantSlug!)}/galleries?offset=${offset}`;
                const response = await fetch(path, {
                  credentials: "same-origin",
                });
                const value = await response.json();
                if (!response.ok)
                  throw new Error(value.message || "Please try again.");
                setLoaded((previous) => [
                  ...previous,
                  ...(Array.isArray(value.galleries) ? value.galleries : []),
                ]);
                setOffset(
                  Number.isSafeInteger(value.nextOffset) &&
                    value.nextOffset > offset
                    ? value.nextOffset
                    : null,
                );
              } catch (error) {
                setProblem(errorText(error, context.language ?? "en"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? context.language === "ar"
                ? "جارٍ التحميل…"
                : "Loading…"
              : t("moreGalleries")}
          </button>
        )}
      {problem && (
        <p className="sb-form-error" role="alert">
          {problem}
        </p>
      )}
      <Actions actions={content.actions} context={context} builder={builder} />
    </>
  );
}

function ModuleBody({ props }: { props: SectionProps }) {
  const {
    section: { moduleId: family, variant, content: c },
    context,
    builder,
  } = props;
  const intro = <Intro props={props} />;
  const actions = (
    <Actions actions={c.actions} context={context} builder={builder} />
  );
  const media = (
    <Media
      image={c.image}
      alt={c.imageAlt}
      context={context}
      priority={props.firstHeading}
    />
  );
  switch (family) {
    case "hero":
      return (
        <div className="sb-hero-layout">
          <div className="sb-hero-copy">
            {intro}
            {actions}
            {c.caption && (
              <Editable
                value={c.caption}
                field="caption"
                props={props}
                className="sb-note"
              />
            )}
          </div>
          {variant === "video" ? (
            <div className="sb-hero-media">
              <Video
                url={c.videoUrl}
                poster={c.poster || c.image}
                caption={c.caption}
                context={context}
              />
            </div>
          ) : (
            <div className="sb-hero-media">{media}</div>
          )}
        </div>
      );
    case "intro":
      return (
        <>
          {intro}
          {actions}
          {variant === "editorial" && c.items.length > 0 && (
            <ItemCards props={props} />
          )}
        </>
      );
    case "about":
      return (
        <div className="sb-split-layout">
          <div className="sb-feature-media">
            <Media
              image={c.image || context.photoUrl}
              alt={c.imageAlt || context.name}
              context={context}
            />
          </div>
          <div>
            {intro}
            {c.items.length > 0 && (
              <ItemCards props={props} className="sb-compact-items" />
            )}
            {actions}
          </div>
        </div>
      );
    case "split":
      return (
        <div className="sb-split-layout">
          <div className="sb-feature-media">{media}</div>
          <div>
            {intro}
            {actions}
          </div>
        </div>
      );
    case "team":
      return (
        <>
          {intro}
          <ItemCards props={props} images />
          {actions}
        </>
      );
    case "benefits":
      return (
        <>
          {intro}
          <ItemCards props={props} numbered={variant === "icons"} />
          {actions}
        </>
      );
    case "services":
      return (
        <>
          {intro}
          <ItemCards props={props} numbered images={variant === "spotlight"} />
          {actions}
        </>
      );
    case "process":
      return (
        <>
          {intro}
          <ol className="sb-process" aria-label={words(context).steps}>
            {c.items.map((item, index) => (
              <li key={item.id}>
                <span className="sb-step-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 dir="auto">{item.title}</h3>
                  <p dir="auto">{item.body}</p>
                  <ItemLink item={item} props={props} />
                </div>
              </li>
            ))}
          </ol>
          {actions}
        </>
      );
    case "programmes":
    case "programme-detail":
    case "pricing":
      return <Pricing props={props} />;
    case "booking":
      return (
        <div className="sb-booking-layout">
          <div>
            {intro}
            {actions}
            {!c.actions.length && (
              <Action
                action={{
                  kind: "booking",
                  label: words(context).book,
                  newTab: false,
                }}
                builder={builder}
                context={context}
              />
            )}
            <p className="sb-note">{words(context).bookingNote}</p>
          </div>
          <div className="sb-booking-art" aria-hidden="true">
            <span className="sb-booking-orbit" />
            <div className="sb-booking-calendar">
              {Array.from({ length: 28 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
            <span className="sb-booking-plus">+</span>
          </div>
        </div>
      );
    case "call-to-action":
      return (
        <div className="sb-cta-layout">
          <div>{intro}</div>
          {actions}
          {variant === "split" && c.image && (
            <div className="sb-feature-media">{media}</div>
          )}
        </div>
      );
    case "gallery":
      return <GalleryModule props={props} />;
    case "transformation":
      return (
        <>
          {intro}
          <div className="sb-transformations">
            {c.items
              .filter(
                (item) => item.beforeImage || item.afterImage || item.body,
              )
              .map((item) => (
                <article key={item.id}>
                  <div className="sb-transform-pair">
                    <figure>
                      <Media
                        image={item.beforeImage}
                        alt={
                          item.imageAlt ||
                          `${item.title} — ${words(context).before}`
                        }
                        context={context}
                      />
                      <figcaption>{words(context).before}</figcaption>
                    </figure>
                    <figure>
                      <Media
                        image={item.afterImage}
                        alt={
                          item.imageAlt ||
                          `${item.title} — ${words(context).after}`
                        }
                        context={context}
                      />
                      <figcaption>{words(context).after}</figcaption>
                    </figure>
                  </div>
                  <div className="sb-transform-story">
                    <h3 dir="auto">{item.title}</h3>
                    <p dir="auto">{item.body}</p>
                    {item.caption && <small dir="auto">{item.caption}</small>}
                  </div>
                </article>
              ))}
          </div>
          {!c.items.length && context.preview && (
            <p className="sb-empty-copy">{words(context).reviewMissing}</p>
          )}
          {actions}
        </>
      );
    case "testimonials":
      return (
        <>
          {intro}
          <ItemCards props={props} quotes />
          {!c.items.length && context.preview && (
            <p className="sb-empty-copy">{words(context).reviewMissing}</p>
          )}
          {actions}
        </>
      );
    case "logos":
      return (
        <>
          {intro}
          <ul className="sb-logos">
            {c.items.map((item) => (
              <li key={item.id}>
                {safeBuilderImage(item.image) ? (
                  <img
                    src={safeBuilderImage(item.image)}
                    alt={item.imageAlt || item.title}
                    width={180}
                    height={80}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span dir="auto">{item.title}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      );
    case "faq":
      return (
        <div className="sb-faq-layout">
          <div>
            {intro}
            {actions}
          </div>
          <div className="sb-faq-items">
            {c.items.map((item) =>
              variant === "list" ? (
                <article key={item.id}>
                  <h3 dir="auto">{item.question || item.title}</h3>
                  <p dir="auto">{item.answer || item.body}</p>
                </article>
              ) : (
                <details key={item.id}>
                  <summary>
                    <span dir="auto">{item.question || item.title}</span>
                    <span className="sb-faq-mark" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p dir="auto">{item.answer || item.body}</p>
                </details>
              ),
            )}
          </div>
        </div>
      );
    case "stats":
      return (
        <>
          {intro}
          <dl className="sb-stats">
            {c.items
              .filter((item) => item.value)
              .map((item) => (
                <div key={item.id}>
                  <dt dir="auto">{item.title}</dt>
                  <dd>
                    <strong dir="auto">{item.value}</strong>
                    {item.body && <span dir="auto">{item.body}</span>}
                  </dd>
                </div>
              ))}
          </dl>
          {!c.items.some((item) => item.value) && context.preview && (
            <p className="sb-empty-copy">{words(context).proofMissing}</p>
          )}
        </>
      );
    case "schedule":
      return (
        <>
          {intro}
          {variant === "table" ? (
            <div className="sb-table-scroll">
              <table className="sb-schedule">
                <caption className="sb-sr-only">{c.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {context.language === "ar" ? "الجلسة" : "Session"}
                    </th>
                    <th scope="col">
                      {context.language === "ar" ? "الوقت" : "When"}
                    </th>
                    <th scope="col">{words(context).details}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((item) => (
                    <tr key={item.id}>
                      <th scope="row" dir="auto">
                        {item.title}
                      </th>
                      <td dir="auto">{item.eyebrow || item.value}</td>
                      <td dir="auto">
                        {item.body}
                        <ItemLink item={item} props={props} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ItemCards props={props} />
          )}
          {actions}
        </>
      );
    case "video":
      return (
        <div className="sb-video-layout">
          <div>
            {intro}
            {actions}
          </div>
          <Video
            url={c.videoUrl}
            poster={c.poster || c.image}
            caption={c.caption}
            context={context}
          />
        </div>
      );
    case "contact":
    case "lead":
      return (
        <div className="sb-contact-layout">
          <div>
            {intro}
            <SocialLinks context={context} />
            {c.image && <div className="sb-contact-image">{media}</div>}
            {actions}
          </div>
          <ContactForm context={context} />
        </div>
      );
    case "divider":
      return (
        <div className="sb-divider">
          {variant === "label" && (
            <Editable as="span" value={c.title} field="title" props={props} />
          )}
        </div>
      );
    case "columns":
      return (
        <>
          {(c.title || c.body) && intro}
          <div className="sb-custom-columns">
            {c.elements.map((element) => (
              <div className="sb-column-cell" key={element.id}>
                <Element element={element} props={props} />
              </div>
            ))}
          </div>
          {actions}
        </>
      );
    case "credentials":
      return (
        <div className="sb-credentials-layout">
          <div>
            {intro}
            {actions}
          </div>
          <ul className="sb-credentials">
            {c.items.map((item) => (
              <li key={item.id}>
                <span className="sb-seal" aria-hidden="true">
                  ✳
                </span>
                <div>
                  <h3 dir="auto">{item.title}</h3>
                  <p dir="auto">{item.body}</p>
                  {item.caption && <small dir="auto">{item.caption}</small>}
                  <ItemLink item={item} props={props} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    case "social":
      return (
        <>
          {intro}
          <SocialLinks context={context} />
          <ItemCards props={props} />
          {actions}
        </>
      );
    case "navigation":
      return (
        <>
          {intro}
          <nav className="sb-page-links" aria-label={words(context).contents}>
            {builder?.pages
              .filter((page) => page.visible && page.inNavigation)
              .map((page, index) => (
                <PageLink key={page.id} page={page} context={context}>
                  <span className="sb-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {page.title}
                  <Arrow />
                </PageLink>
              ))}
          </nav>
          {actions}
        </>
      );
    case "footer":
      return (
        <div className="sb-footer-module">
          <div>
            {intro}
            {actions}
          </div>
          <SocialLinks context={context} />
          <ItemCards props={props} />
        </div>
      );
    case "text":
      return (
        <>
          {intro}
          {actions}
        </>
      );
    case "quote":
      return (
        <figure className="sb-quote">
          <Editable
            value={c.eyebrow}
            field="eyebrow"
            props={props}
            className="sb-eyebrow"
          />
          <blockquote>
            <Editable
              as={props.firstHeading ? "h1" : "h2"}
              value={c.title || c.body}
              field={c.title ? "title" : "body"}
              props={props}
            />
          </blockquote>
          {c.caption && (
            <figcaption>
              <Editable
                as="span"
                value={c.caption}
                field="caption"
                props={props}
              />
            </figcaption>
          )}
          {actions}
        </figure>
      );
    case "image":
      return (
        <figure className="sb-image-layout">
          {media}
          <figcaption>
            {(c.title || c.body) && intro}
            {c.caption && (
              <Editable value={c.caption} field="caption" props={props} />
            )}
            {actions}
          </figcaption>
        </figure>
      );
    case "resources":
      return (
        <>
          {intro}
          <ItemCards
            props={props}
            images={variant !== "list"}
            numbered={variant === "list"}
          />
          {actions}
        </>
      );
    case "comparison":
      return (
        <>
          {intro}
          {variant === "table" ? (
            <div className="sb-table-scroll">
              <table className="sb-comparison">
                <caption className="sb-sr-only">
                  {c.title || words(context).comparison}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{words(context).details}</th>
                    <th scope="col">{context.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((item) => (
                    <tr key={item.id}>
                      <th scope="row" dir="auto">
                        {item.title}
                      </th>
                      <td dir="auto">{item.body || item.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ItemCards props={props} />
          )}
          {actions}
        </>
      );
    case "community":
      return (
        <div className="sb-community-layout">
          <div>
            {intro}
            {actions}
          </div>
          {variant === "split" && (
            <div className="sb-feature-media">{media}</div>
          )}
          <ItemCards props={props} />
        </div>
      );
    case "nutrition":
      return (
        <div className="sb-nutrition-layout">
          <div>
            {intro}
            {actions}
          </div>
          {variant === "split" && (
            <div className="sb-feature-media">{media}</div>
          )}
          <ItemCards props={props} images={variant === "cards"} />
        </div>
      );
    case "app-preview":
      return (
        <div className="sb-app-layout">
          <div>
            {intro}
            <ItemCards props={props} numbered={variant === "steps"} />
            {actions}
          </div>
          <div className="sb-device-frame">{media}</div>
        </div>
      );
    case "announcement":
      return (
        <div className="sb-announcement-layout">
          {intro}
          {actions}
        </div>
      );
    default:
      return null;
  }
}

/** Shared by public pages and the editor, so previews render the real website. */
export function BuilderSection(props: SectionProps) {
  const { section, selected, onSelect } = props;
  if (!props.context.preview && isBuilderGloballyHidden(section)) return null;
  return (
    <section
      id={section.id}
      className={`sb-section sb-responsive sb-module-${section.moduleId}${selected ? " sb-section-selected" : ""}`}
      data-module={section.moduleId}
      data-variant={section.variant}
      data-section-id={section.id}
      style={builderStyleVariables(section.style, section.responsive)}
      onClick={onSelect ? () => onSelect(section.id) : undefined}
      aria-label={
        !section.content.title && props.context.preview
          ? section.moduleId
          : undefined
      }
    >
      <div className="sb-container">
        <ModuleBody props={props} />
      </div>
    </section>
  );
}

export function BuilderWebsite({
  builder,
  context,
  path = "",
  preview,
  onNavigate,
  selectedSectionId,
  onSelectSection,
  onTextChange,
}: {
  builder: SiteBuilderDocument;
  context: BuilderContext;
  path?: string;
  preview?: boolean;
  onNavigate?: (slug: string) => void;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
  onTextChange?: TextChange;
}) {
  const ctx = {
    ...context,
    preview: preview ?? context.preview,
    onNavigate: onNavigate ?? context.onNavigate,
  };
  const slug = path.split("/").filter(Boolean).join("/");
  const page = builder.pages.find(
    (candidate) =>
      candidate.slug === slug && (candidate.visible || ctx.preview),
  );
  const mainId = `builder-main-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const t = translator(siteMessages, ctx.language ?? "en");
  const firstHeading = page?.sections.find(
    (section) =>
      section.content.title &&
      section.moduleId !== "divider" &&
      (ctx.preview || !isBuilderGloballyHidden(section)),
  )?.id;
  return (
    <BuilderTheme
      theme={builder.theme}
      language={ctx.language}
      className={ctx.preview ? "sb-preview" : ""}
    >
      <a className="sb-skip" href={`#${mainId}`}>
        {words(ctx).skip}
      </a>
      <BuilderHeader builder={builder} context={ctx} path={slug} />
      <main id={mainId} className="sb-main">
        {page ? (
          <>
            {!firstHeading && <h1 className="sb-sr-only">{page.title}</h1>}
            {page.sections.map((section) => (
              <BuilderSection
                key={section.id}
                section={section}
                builder={builder}
                context={ctx}
                firstHeading={section.id === firstHeading}
                selected={section.id === selectedSectionId}
                onSelect={onSelectSection}
                onTextChange={onTextChange}
              />
            ))}
          </>
        ) : (
          <section className="sb-section">
            <div className="sb-container">
              <h1>{t("notFound")}</h1>
              <a className="sb-button" href={builderPagePath(ctx.basePath, "")}>
                {t("returnHome")}
              </a>
            </div>
          </section>
        )}
      </main>
      <BuilderFooter builder={builder} context={ctx} />
    </BuilderTheme>
  );
}
