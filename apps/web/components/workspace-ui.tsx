"use client";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import { pageKey } from "./workspace-paging";
import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Layers, Brain } from "lucide-react";
export type Row = {
  id: string;
  kind: string;
  status: string;
  data: any;
  owner_user_id: string;
  created_at: string;
  version: number;
};
export type State = {
  trainerPreview?: { profileId: string; userId: string; trainerUserId: string; trainerName: string };
  user: any;
  tenant: any;
  records: Row[];
  sets: any[];
  members?: any[];
  subscriptions: any[];
  complimentary?: any[];
  integrations: any[];
  events?: any[];
  finance?: any;
  journals?: any[];
  payouts?: any[];
  costs?: any[];
  usageStatements?: any[];
  consents: any[];
  environment?: string;
  providerSandbox?: string | null;
  platform?: { name?: string; supportEmail?: string };
  /** The workspace is a platform administration workspace (no coaching page). */
  platformWorkspace?: boolean;
  /** Superadmins only: whether an authenticator is enrolled. */
  superadmin?: { mfaEnabled: boolean };
  /** False while the owner has switched authenticator requirements off. */
  authenticatorRequired?: boolean;
  /** First-page positions: { hasMore, cursor } per collection (records per kind). */
  pages?: Record<string, any>;
  /** Exact counts, independent of how many rows are loaded. */
  totals?: Record<string, any>;
};
export type More = {
  has: (collection: string, kind?: string) => boolean;
  load: (collection: string, kind?: string) => Promise<void>;
  loading: string;
};
/** Shown while a paged list has rows beyond those loaded. */
export function LoadMore({
  more,
  collection,
  kind,
  label = "Load more",
}: {
  more: More;
  collection: string;
  kind?: string;
  label?: string;
}) {
  if (!more.has(collection, kind)) return null;
  const loading = more.loading === pageKey(collection, kind);
  return (
    <div className="button-row load-more">
      <button
        type="button"
        className="button secondary"
        disabled={loading}
        onClick={() => void more.load(collection, kind)}
      >
        {loading ? "Loading…" : label}
      </button>
    </div>
  );
}
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) {
  const r = await fetch(memberApiUrl("/api/v1" + path), {
    method,
    headers:
      body !== undefined
        ? { "Content-Type": "application/json", ...headers }
        : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
export function Button({
  children,
  onClick,
  type = "button",
  secondary = false,
  disabled = false,
  variant = "primary",
  size = "default",
  loading = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  secondary?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "default" | "small";
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      {...rest}
      className={`button ${secondary ? "secondary" : variant} ${size === "small" ? "button-small" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      {loading && <span className="button-spinner" aria-hidden="true" />}{children}
    </button>
  );
}
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" {...props} className={`icon-button ${props.className ?? ""}`} aria-label={label} title={label}>{children}</button>;
}

/** One panel at a time, with roving focus and direction-aware arrow keys. */
export function WorkspaceTabs({ label, items, value, onChange, panelId }: {
  label: string; items: readonly (readonly [string, string])[]; value: string;
  onChange: (value: string) => void; panelId: string;
}) {
  const id = useId();
  return <div className="workspace-tabs" role="tablist" aria-label={label} onKeyDown={event => {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
    if (next < 0) return;
    event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
  }}>
    {items.map(([key, text]) => <button key={key} id={`${id}-${key}`} type="button" role="tab" aria-selected={value === key} aria-controls={panelId} tabIndex={value === key ? 0 : -1} onClick={() => onChange(key)}>{text}</button>)}
  </div>;
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Layers size={24} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
/** Trainer-facing wording for a compiled rule's flags (text-screen.ts). */
export const RULE_FLAG_TEXT: Record<string, string> = {
  medical_advice: "it gives medicine, dose or diagnosis advice",
  red_flag_not_stopped:
    "it names a red flag but does not stop the session and send the member to you or to help",
  link: "it contains a link or email address",
  contact: "it contains a phone number",
  approval_claim: "it claims your approval or tells the Brain to skip review",
  guarantee: "it guarantees results or tells the member not to check with you",
};
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={"card " + className} id={id}>
      {children}
    </section>
  );
}
export function Heading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {detail && <p className="muted">{detail}</p>}
      </div>
      {action}
    </div>
  );
}
export type ViewProps = {
  state: State;
  records: (kind: string) => Row[];
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  busy: boolean;
  path: string;
  onSaved?: () => Promise<void>;
  more: More;
};
/** Exact when the bootstrap sent totals; otherwise the loaded rows. */
export const total = (state: State, key: string, fallback: number): number =>
  typeof state.totals?.[key] === "number" ? state.totals[key] : fallback;
export const kindTotal = (state: State, kind: string, fallback: number): number =>
  typeof state.totals?.records?.[kind] === "number"
    ? state.totals.records[kind]
    : fallback;
export const openExceptionCount = (state: State, records: ViewProps["records"]) =>
  total(
    state,
    "openExceptions",
    records("exception").filter((x) => x.status === "open").length,
  );
