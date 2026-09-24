"use client";
import { Onboarding } from "./onboarding";
import { ClientTwin } from "./client-twin";
import { MarketingPage } from "./marketing-pages";
import { PrivacyOperations } from "./privacy-operations";
import { FinanceOperations } from "./finance-operations";
import { Bookings } from "./bookings";
import { Support } from "./support";
import { AccountSecurity, AccountRecovery } from "./account-security";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  ChevronRight,
  Layers,
  Users,
  MessageCircle,
  Activity,
  Wallet,
  Settings,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Shield,
  Globe,
  FileText,
  Brain,
  RefreshCw,
  AlertCircle,
  Play,
  Pause,
  CheckCircle,
  Clock,
  Download,
  Link2,
  Upload,
} from "lucide-react";
import { money, projectedCommission } from "@trainer/domain";
type Row = {
  id: string;
  kind: string;
  status: string;
  data: any;
  owner_user_id: string;
  created_at: string;
  version: number;
};
type State = {
  user: any;
  tenant: any;
  records: Row[];
  sets: any[];
  members?: any[];
  subscriptions: any[];
  integrations: any[];
  events?: any[];
  finance?: any;
  journals?: any[];
  payouts?: any[];
  costs?: any[];
  usageStatements?: any[];
  consents: any[];
  environment?: string;
};
const nav = [
  ["Overview", "/trainer", LayoutDashboard],
  ["Setup", "/trainer/onboarding/account", CheckCircle],
  ["My Brain", "/trainer/brain", Brain],
  ["Subscribers", "/trainer/subscribers", Users],
  ["Programs", "/trainer/programs", Layers],
  ["Messages", "/trainer/messages", MessageCircle],
  ["Bookings", "/trainer/bookings", Activity],
  ["Support", "/trainer/support", MessageCircle],
  ["Exceptions", "/trainer/exceptions", AlertCircle],
  ["Business", "/trainer/analytics", Activity],
  ["Finance", "/trainer/finance", Wallet],
  ["Storefront", "/trainer/brand", Globe],
  ["Integrations", "/trainer/integrations", Link2],
  ["Settings", "/trainer/settings", Settings],
] as const;
const subNav = [
  ["Today", "/app", LayoutDashboard],
  ["My program", "/app/program", Layers],
  ["Coach chat", "/app/chat", MessageCircle],
  ["Bookings", "/app/bookings", Activity],
  ["Support", "/app/support", MessageCircle],
  ["Progress", "/app/progress", Activity],
  ["Coaching context", "/app/twin", Brain],
  ["Membership", "/app/membership", Wallet],
  ["Connections", "/app/wearables", Link2],
  ["My profile", "/app/profile", Settings],
] as const;
const questions = [
  "Who do you coach best, and what outcomes do you prioritize?",
  "How do you progress a beginner?",
  "How does progression change for experienced clients?",
  "How do you choose exercises?",
  "How do you replace an exercise when equipment is missing?",
  "How do you prescribe sets, reps, RIR and RPE?",
  "When do you change weekly volume or frequency?",
  "What do you change when fatigue rises?",
  "How do you handle a missed workout?",
  "What is your sequence for resolving a plateau?",
  "What triggers a deload?",
  "What equipment constraints matter most?",
  "How do you shorten a session?",
  "How do you program conditioning?",
  "What do you refuse to program?",
  "When must a human review a decision?",
  "How do you motivate a client with low adherence?",
  "How do you give difficult feedback?",
  "How much explanation do your clients need?",
  "What distinguishes your method from generic coaching?",
];
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
    });
  return data;
}
function Button({
  children,
  onClick,
  type = "button",
  secondary = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      className={"button " + (secondary ? "secondary" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({
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
function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={"card " + className}>{children}</section>;
}
function Heading({
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

export default function Workspace() {
  const path = usePathname(),
    router = useRouter();
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [online, setOnline] = useState(true);
  const publicPath =
    path === "/" ||
    [
      "/how-it-works",
      "/demo",
      "/pricing",
      "/faq",
      "/terms",
      "/privacy",
      "/ai-disclosure",
      "/login",
      "/signup",
    ].includes(path) ||
    path === "/forgot-password" ||
    path.startsWith("/reset-password/") ||
    path.startsWith("/verify-email/") ||
    path.startsWith("/join-coach/") ||
    path.startsWith("/join/") ||
    path.startsWith("/coach/");
  const load = useCallback(async () => {
    try {
      const next = await api("/bootstrap");
      setState(next);
      if (next.user.role === "subscriber")
        localStorage.setItem(
          "trainer:offline",
          JSON.stringify({
            expires: Date.now() + 12 * 3600000,
            state: {
              ...next,
              records: next.records.filter((r: any) =>
                ["workout", "program"].includes(r.kind),
              ),
              consents: [],
              integrations: [],
              subscriptions: [],
            },
          }),
        );
    } catch (e) {
      if ((e as any).status === 401)
        for (const k of Object.keys(localStorage))
          if (k.startsWith("trainer:")) localStorage.removeItem(k);
      const cached = localStorage.getItem("trainer:offline");
      if (!navigator.onLine && cached) {
        try {
          const offline = JSON.parse(cached);
          if (offline.expires > Date.now()) {
            setState(offline.state);
            return;
          }
        } catch {
          localStorage.removeItem("trainer:offline");
        }
      }
      if (!publicPath) {
        setError((e as Error).message);
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }, [publicPath, router]);
  useEffect(() => {
    setError("");
    setSuccess("");
    setMobile(false);
    if (!publicPath) {
      setLoading(true);
      void load();
    } else setLoading(false);
  }, [path, publicPath, load]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const action = async (fn: () => Promise<any>, message = "Saved") => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await fn();
      setSuccess(message);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  if (publicPath)
    return (
      <Public
        path={path}
        onAuthenticated={async () => {
          await load();
          const s = await api("/bootstrap");
          router.push(
            s.user.role === "subscriber"
              ? "/app"
              : path === "/signup"
                ? "/trainer/onboarding/identity"
                : "/trainer",
          );
        }}
      />
    );
  if (loading || !state)
    return (
      <main className="loading-screen">
        <div className="brand-mark">b.</div>
        <p>Opening your workspace…</p>
      </main>
    );
  const subscriber = state.user.role === "subscriber";
  const items = subscriber
    ? subNav
    : state.user.role === "finance"
      ? nav.filter((item) =>
          ["Overview", "Finance", "Settings"].includes(item[0]),
        )
      : state.user.role === "staff"
        ? nav.filter((item) => !["Finance", "Storefront"].includes(item[0]))
        : nav;
  const records = (kind: string) =>
    state.records.filter((x) => x.kind === kind);
  const firstName = state.user.name.split(" ")[0];
  const topTitle = path.startsWith("/admin")
    ? "Platform operations"
    : (items.find((x) => x[1] === path)?.[0] ?? "Your workspace");
  const props = { state, records, action, busy, path };
  return (
    <div className="workspace">
      <aside className={"sidebar " + (mobile ? "is-open" : "")}>
        <Link href={subscriber ? "/app" : "/trainer"} className="wordmark">
          <span className="brand-mark">b.</span>
          <span>
            trainer<span className="wordmark-light">brain</span>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <div className="workspace-label">
          <span className="avatar">{state.tenant.name.slice(0, 1)}</span>
          <div>
            <strong>{state.tenant.name}</strong>
            <span>
              {subscriber ? "Your coaching space" : "Your coaching business"}
            </span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {items.map(([label, url, Icon]) => (
            <Link
              key={url}
              className={
                url === path ||
                (url !== "/trainer" && url !== "/app" && path.startsWith(url))
                  ? "active"
                  : ""
              }
              href={url}
            >
              <Icon size={18} />
              {label}
              {label === "Exceptions" &&
                records("exception").filter((x) => x.status === "open").length >
                  0 && (
                  <span className="nav-count">
                    {
                      records("exception").filter((x) => x.status === "open")
                        .length
                    }
                  </span>
                )}
            </Link>
          ))}
          {state.user.platformRole !== "none" && (
            <Link href="/admin">
              <Shield size={18} />
              Platform admin
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-label">BUILT AROUND YOU</div>
          <p>
            Your methods.
            <br />
            Your brand. Your business.
          </p>
          <button
            className="text-button"
            onClick={async () => {
              await api("/auth/logout", "POST", {});
              for (const k of Object.keys(localStorage))
                if (k.startsWith("trainer:")) localStorage.removeItem(k);
              router.push("/login");
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <strong>{topTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection-dot" />
            <span>
              {state.tenant.published ? "Published" : "Private workspace"}
            </span>
            <span className="avatar small">{firstName[0]}</span>
          </div>
        </header>
        <div className="content">
          {state.environment === "development" && (
            <div className="dev-banner">
              Development environment · payment connections are gated · demo
              records, when seeded, are synthetic
            </div>
          )}
          {!online && (
            <div className="notice">
              You’re offline. Workout logs are kept on this device until they
              can sync.
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={17} />
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {success && (
            <div className="notice success" role="status">
              <Check size={17} />
              {success}
            </div>
          )}
          {path.startsWith("/admin") ? (
            <Admin {...props} />
          ) : path.includes("/onboarding") ? (
            <OnboardingView {...props} />
          ) : path.includes("/brand") ? (
            <Brand {...props} />
          ) : path.includes("/bookings") ? (
            <Bookings role={state.user.role} />
          ) : path.includes("/support") ? (
            <Support records={records("support")} action={action} busy={busy} />
          ) : path.includes("/brain") ? (
            <BrainView {...props} />
          ) : /^\/trainer\/subscribers\/[^/]+$/.test(path) ? (
            <ClientTwin
              userId={path.split("/")[3]}
              name={
                state.members?.find((m) => m.id === path.split("/")[3])?.name
              }
            />
          ) : path.includes("/subscribers") ? (
            <Members {...props} />
          ) : path === "/app/twin" ? (
            <ClientTwin userId={state.user.userId} subscriber />
          ) : path.includes("/program") ? (
            <Programs {...props} />
          ) : path.includes("/workouts") ? (
            <Workout {...props} />
          ) : path.includes("/messages") || path.includes("/chat") ? (
            <Messages {...props} />
          ) : path.includes("/exceptions") ? (
            <Exceptions {...props} />
          ) : path.includes("/finance") ||
            path.includes("/payout") ||
            path.includes("/membership") ||
            path.includes("/products") ? (
            <Finance {...props} />
          ) : path.includes("/integrations") ||
            path.includes("/wearables") ||
            path.includes("/voice") ||
            path.includes("/domains") ? (
            <Integrations {...props} />
          ) : path.includes("/settings") ||
            path.includes("/profile") ||
            path.includes("/intake") ? (
            <SettingsView {...props} />
          ) : path.includes("/analytics") || path.includes("/progress") ? (
            <Analytics {...props} />
          ) : (
            <Overview {...props} />
          )}
        </div>
        <footer className="workspace-footer">
          <span>Trainer Brain · Your coaching, amplified.</span>
          <Link href="/privacy">Privacy & your data</Link>
        </footer>
      </main>
    </div>
  );
}
type ViewProps = {
  state: State;
  records: (kind: string) => Row[];
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  busy: boolean;
  path: string;
};

function Overview({ state, records }: ViewProps) {
  const sub = state.user.role === "subscriber";
  const rules = records("rule").filter((x) => x.status === "confirmed"),
    exceptions = records("exception").filter((x) => x.status === "open"),
    programs = records("program"),
    workouts = records("workout");
  const steps = [
    ["Shape your identity", !!state.tenant.theme?.bio, "/trainer/brand"],
    [
      "Teach your coaching rules",
      rules.length > 0,
      "/trainer/brain/constitution",
    ],
    [
      "Add your source material",
      records("source").length > 0,
      "/trainer/brain/knowledge",
    ],
    ["Create your first program", programs.length > 0, "/trainer/programs"],
    ["Prepare your offer", records("product").length > 0, "/trainer/products"],
  ] as const;
  return (
    <>
      <Heading
        eyebrow={new Intl.DateTimeFormat("en-AE", {
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(new Date())}
        title={`Good to see you, ${state.user.name.split(" ")[0]}.`}
        detail={
          sub
            ? "One workout. A little progress. Your next step is here."
            : "A clear view of your people, your coaching and your business."
        }
        action={
          <Link
            className="button secondary"
            href={sub ? "/app/program" : "/trainer/brand"}
          >
            {sub ? "View my program" : "Edit storefront"}
            <ArrowUpRight size={16} />
          </Link>
        }
      />
      <div className="stats-grid">
        {(sub
          ? [
              [
                "Completed workouts",
                workouts.filter((w) => w.status === "completed").length,
                "Every session counts",
              ],
              ["Sets recorded", state.sets.length, "Your actual training log"],
              ["My programs", programs.length, "Created by your trainer"],
              [
                "Coach messages",
                records("message").length,
                "Personal and digital coaching",
              ],
            ]
          : [
              [
                "Subscribers",
                state.members?.filter((m) => m.role === "subscriber").length ??
                  0,
                "People in your coaching space",
              ],
              [
                state.finance ? "Trainer earnings" : "Programs",
                state.finance
                  ? money(state.finance.earnedMinor)
                  : programs.length,
                state.finance
                  ? "Reconciled ledger balance"
                  : "Training blocks in this workspace",
              ],
              ["Confirmed rules", rules.length, "Your methodology, captured"],
              [
                "Need your attention",
                exceptions.length,
                "Open coaching exceptions",
              ],
            ]
        ).map(([label, value, note], i) => (
          <Card key={String(label)} className={"stat stat-" + i}>
            <span className="small-label">{label}</span>
            <strong>{value}</strong>
            <span className="muted">{note}</span>
          </Card>
        ))}
      </div>
      <div className="two-columns wide-left">
        <Card className="feature-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">
                {sub ? "YOUR NEXT SESSION" : "THE COACHING ENGINE"}
              </p>
              <h2>
                {sub
                  ? "Ready when you are."
                  : "Make your experience teachable."}
              </h2>
            </div>
            <span className="round-icon">
              <Brain size={28} />
            </span>
          </div>
          <p className="muted lead">
            {sub
              ? "Your program holds the details. Focus on a clear, controlled session and record what actually happens."
              : "The best part of your coaching isn’t a template. It’s knowing what to change, when to change it, and why."}
          </p>
          <div className="brain-flow">
            <div>
              <span>01</span>
              <strong>{sub ? "Prepare" : "Teach"}</strong>
              <small>
                {sub ? "Check your program" : "Share your decisions"}
              </small>
            </div>
            <ArrowRight size={18} />
            <div>
              <span>02</span>
              <strong>{sub ? "Train" : "Refine"}</strong>
              <small>{sub ? "Log each set" : "Review the rules"}</small>
            </div>
            <ArrowRight size={18} />
            <div>
              <span>03</span>
              <strong>{sub ? "Reflect" : "Release"}</strong>
              <small>{sub ? "See your progress" : "Stay in control"}</small>
            </div>
          </div>
          <Link
            className="button"
            href={sub ? "/app/program" : "/trainer/brain"}
          >
            {sub ? "Open my program" : "Continue building my Brain"}
            <ArrowRight size={16} />
          </Link>
        </Card>
        <Card>
          <div className="card-heading">
            <h2>{sub ? "Your coaching space" : "Your launch checklist"}</h2>
            <Badge>
              {sub
                ? "PERSONAL"
                : `${steps.filter((s) => s[1]).length} / ${steps.length}`}
            </Badge>
          </div>
          {sub ? (
            <>
              <p className="muted">
                Your coach’s method, with space for your real life.
              </p>
              <Link className="checklist-row" href="/app/intake">
                <span className="step-circle">
                  <FileText size={17} />
                </span>
                <span>Complete your coaching profile</span>
                <ChevronRight size={16} />
              </Link>
              <Link className="checklist-row" href="/app/chat">
                <span className="step-circle">
                  <MessageCircle size={17} />
                </span>
                <span>Talk to your trainer</span>
                <ChevronRight size={16} />
              </Link>
            </>
          ) : (
            steps.map(([label, done, url], i) => (
              <Link className="checklist-row" href={url} key={url}>
                <span className={"step-circle " + (done ? "done" : "")}>
                  {done ? <Check size={15} /> : i + 1}
                </span>
                <span>{label}</span>
                <ChevronRight size={16} />
              </Link>
            ))
          )}
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <h2>{sub ? "Recent sessions" : "The attention list"}</h2>
          <Link
            href={sub ? "/app/progress" : "/trainer/exceptions"}
            className="text-link"
          >
            View all <ArrowUpRight size={14} />
          </Link>
        </div>
        {sub ? (
          workouts.length ? (
            workouts.slice(0, 4).map((w) => (
              <div className="list-row" key={w.id}>
                <span>{w.data.program?.title ?? "Workout"}</span>
                <Badge>{w.status.replaceAll("_", " ")}</Badge>
              </div>
            ))
          ) : (
            <Empty
              title="Your first session is ahead"
              detail="Once your trainer assigns a program, you can start logging here."
            />
          )
        ) : exceptions.length ? (
          exceptions.slice(0, 4).map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>{e.data.category.replaceAll("_", " ")}</strong>
                <p className="muted">{e.data.description}</p>
              </div>
              <Badge tone="amber">Needs review</Badge>
            </div>
          ))
        ) : (
          <Empty
            title="A little breathing room"
            detail="Your open coaching exceptions will appear here, with the context you need to act."
          />
        )}
      </Card>
    </>
  );
}

function OnboardingView(props: ViewProps) {
  const step = props.path.split("/")[3] ?? "account";
  const child =
    step === "brand" ? (
      <Brand {...props} />
    ) : [
        "interview",
        "uploads",
        "knowledge",
        "scenarios",
        "readiness",
      ].includes(step) ? (
      <BrainView
        {...props}
        path={
          step === "readiness"
            ? "/trainer/brain/releases"
            : step === "scenarios"
              ? "/trainer/brain/scenarios"
              : "/trainer/brain"
        }
      />
    ) : step === "offer" ? (
      <Finance {...props} path="/trainer/products" />
    ) : step === "payout" ? (
      <PayoutView {...props} />
    ) : null;
  return (
    <Onboarding
      stepKey={step}
      key={step}
      revision={JSON.stringify([
        props.state.tenant.theme,
        props.state.records.map((r) => [r.id, r.version, r.status]),
      ])}
    >
      {child}
    </Onboarding>
  );
}

function Brand({ state, action, busy }: ViewProps) {
  const t = state.tenant.theme ?? {};
  return (
    <>
      <Heading
        eyebrow="YOUR IDENTITY"
        title="A business that feels like you."
        detail="Keep your expertise at the center. We take care of the structure."
      />
      <div className="two-columns">
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(
                () => api("/tenant/brand", "PUT", Object.fromEntries(f)),
                "Brand saved",
              );
            }}
          >
            <Field label="Coach / business name">
              <input
                name="name"
                defaultValue={state.tenant.name}
                required
                minLength={2}
              />
            </Field>
            <Field label="Your headline">
              <input
                name="headline"
                defaultValue={t.headline ?? ""}
                placeholder="Strong for life. Built around you."
                maxLength={160}
              />
            </Field>
            <Field label="About your coaching">
              <textarea
                name="bio"
                defaultValue={t.bio ?? ""}
                placeholder="Who do you help, and how do you work?"
                rows={5}
              />
            </Field>
            <Field label="Coaching specialty">
              <input
                name="category"
                defaultValue={t.category ?? ""}
                placeholder="Strength & sustainable progress"
              />
            </Field>
            <Field label="Brand accent">
              <input
                type="color"
                name="accent"
                defaultValue={t.accent ?? "#264a48"}
              />
            </Field>
            <input name="timezone" type="hidden" value="Asia/Dubai" />
            <Button type="submit" disabled={busy}>
              Save identity <Check size={16} />
            </Button>
          </form>
        </Card>
        <Card className="storefront-preview">
          <p className="eyebrow">YOUR STOREFRONT PREVIEW</p>
          <div
            className="coach-monogram"
            style={{ background: t.accent ?? "#264a48" }}
          >
            {state.tenant.name
              .split(" ")
              .map((n: string) => n[0])
              .slice(0, 2)
              .join("")}
          </div>
          <span className="small-label">
            {t.category || "YOUR COACHING SPECIALTY"}
          </span>
          <h2>{t.headline || "Your coaching. Their next chapter."}</h2>
          <p>
            {t.bio ||
              "Your introduction will appear here. Give people a clear sense of your approach and the progress you help them make."}
          </p>
          <div className="preview-name">
            {state.tenant.name}
            <Badge>Digital coaching</Badge>
          </div>
          <div className="divider" />
          <p className="muted">Address: /coach/{state.tenant.slug}</p>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void action(
                () => api("/tenant/publish", "POST", {}),
                "Storefront published",
              )
            }
          >
            Publish when ready <Globe size={16} />
          </Button>
        </Card>
      </div>
    </>
  );
}

function BrainView({ state, records, action, busy, path }: ViewProps) {
  const [tab, setTab] = useState(
    path.includes("constitution")
      ? "rules"
      : path.includes("knowledge")
        ? "sources"
        : path.includes("scenarios")
          ? "scenarios"
          : path.includes("releases")
            ? "releases"
            : "interview",
  );
  const sources = records("source"),
    rules = records("rule"),
    answers = records("interview");
  const question =
    questions.find((q) => !answers.some((a) => a.data.question === q)) ??
    questions[0];
  return (
    <>
      <Heading
        eyebrow="YOUR MOST VALUABLE ASSET"
        title="Your coaching mind, made clear."
        detail="Teach the decisions behind your method. Confirm the rules. Keep control of every release."
      />
      <div className="tabs">
        {[
          ["interview", "Interview"],
          ["sources", "Knowledge"],
          ["rules", "Constitution"],
          ["scenarios", "Scenario lab"],
          ["releases", "Readiness & releases"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "interview" && (
        <div className="two-columns wide-left">
          <Card>
            <p className="eyebrow">
              CONVERSATION {Math.min(answers.length + 1, 20)} OF 20
            </p>
            <h2>{question}</h2>
            <p className="muted">
              Use a real example. The reasoning matters more than the perfect
              wording.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const answer = String(new FormData(form).get("answer"));
                void action(
                  () => api("/brain/interviews", "POST", { question, answer }),
                  "Answer saved",
                ).then((r) => {
                  if (r) form.reset();
                });
              }}
            >
              <Field label="Your approach">
                <textarea
                  name="answer"
                  required
                  minLength={3}
                  rows={8}
                  placeholder="When I work with a client like this…"
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Save and continue <ArrowRight size={16} />
              </Button>
            </form>
          </Card>
          <Card>
            <h2>A little context goes a long way.</h2>
            <p className="muted">
              Describe the situation, the choice you made, and the reason. Your
              confirmed rules stay separate from draft answers.
            </p>
            <div className="large-number">
              {answers.length}
              <span>/ 20</span>
            </div>
            <p className="small-label">METHOD TOPICS CAPTURED</p>
            <div className="progress-track">
              <span
                style={{ width: `${Math.min(100, answers.length * 5)}%` }}
              />
            </div>
            <div className="divider" />
            {answers.slice(0, 3).map((a) => (
              <div key={a.id} className="answer-preview">
                <CheckCircle size={16} />
                <p>{a.data.question}</p>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === "sources" && (
        <div className="two-columns">
          <Card>
            <h2>Your knowledge library</h2>
            <p className="muted">
              Add your own notes, programs and coaching explanations as text.
              Source ownership stays with your workspace.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void action(
                  () =>
                    api("/brain/sources", "POST", {
                      title: f.get("title"),
                      text: f.get("text"),
                      rights: true,
                    }),
                  "Source added",
                ).then((r) => {
                  if (r) form.reset();
                });
              }}
            >
              <Field label="Source title">
                <input
                  name="title"
                  required
                  placeholder="My approach to beginner progression"
                />
              </Field>
              <Field label="Coaching material">
                <textarea name="text" required minLength={10} rows={10} />
              </Field>
              <label className="check-field">
                <input type="checkbox" required />I have the right to use this
                material and have removed unnecessary personal information.
              </label>
              <Button type="submit" disabled={busy}>
                Add to knowledge <Plus size={16} />
              </Button>
            </form>
            <details>
              <summary>Import a document</summary>
              <p className="muted">
                PDF with selectable text, DOCX, Markdown, CSV or UTF-8 text. Up
                to 5 MB and 60,000 extracted characters. Scanned documents need
                OCR first.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    file = f.get("file") as File;
                  void action(async () => {
                    if (file.size > 5 * 1024 * 1024)
                      throw new Error("Choose a file smaller than 5 MB");
                    const base64 = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onerror = () =>
                          reject(new Error("Could not read this file"));
                        reader.onload = () =>
                          resolve(String(reader.result).split(",")[1]);
                        reader.readAsDataURL(file);
                      },
                    );
                    return api("/brain/documents", "POST", {
                      fileName: file.name,
                      title: f.get("title"),
                      contentBase64: base64,
                      rights: true,
                    });
                  }, "Document imported for review");
                }}
              >
                <Field label="Document title">
                  <input name="title" minLength={2} maxLength={120} required />
                </Field>
                <Field label="Document">
                  <input
                    type="file"
                    name="file"
                    accept=".pdf,.docx,.txt,.md,.csv"
                    required
                  />
                </Field>
                <label className="check-field">
                  <input type="checkbox" required />I have rights to use this
                  document and have removed unnecessary personal information.
                </label>
                <Button type="submit" secondary disabled={busy}>
                  Import document
                </Button>
              </form>
            </details>
          </Card>
          <Card>
            <div className="card-heading">
              <h2>Sources</h2>
              <Badge>{sources.length}</Badge>
            </div>
            <Button
              disabled={busy || !sources.length}
              onClick={() =>
                void action(
                  () =>
                    api("/brain/compile", "POST", {
                      sourceIds: sources.slice(0, 20).map((s) => s.id),
                    }),
                  "Draft rules compiled for your review",
                )
              }
            >
              Compile draft rules
            </Button>
            {records("conflict")
              .filter((c) => c.status === "open")
              .map((c) => (
                <div className="notice" key={c.id}>
                  <p>{c.data.description}</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void action(
                        () =>
                          api("/brain/conflicts/" + c.id + "/resolve", "POST", {
                            resolution: f.get("resolution"),
                          }),
                        "Conflict resolution recorded",
                      );
                    }}
                  >
                    <Field label="Your resolution">
                      <textarea name="resolution" minLength={10} required />
                    </Field>
                    <Button type="submit" secondary disabled={busy}>
                      Resolve conflict
                    </Button>
                  </form>
                </div>
              ))}
            {sources.length ? (
              sources.map((s) => (
                <div key={s.id} className="source-row">
                  <span className="file-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <strong>{s.data.title}</strong>
                    <p>
                      {s.data.text.length.toLocaleString()} characters ·{" "}
                      {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge>Ready</Badge>
                </div>
              ))
            ) : (
              <Empty
                title="Your knowledge starts here"
                detail="Add a piece of your coaching experience. Every source remains traceable."
              />
            )}
          </Card>
        </div>
      )}
      {tab === "rules" && (
        <div className="two-columns">
          <Card>
            <h2>Write a coaching rule</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = new FormData(form);
                void action(
                  () =>
                    api("/brain/rules", "POST", {
                      ...Object.fromEntries(f),
                      sourceIds: [],
                    }),
                  "Rule drafted",
                ).then((r) => {
                  if (r) form.reset();
                });
              }}
            >
              <Field label="Rule name">
                <input
                  name="title"
                  required
                  placeholder="Progress only when technique is consistent"
                />
              </Field>
              <Field label="Category">
                <select name="category">
                  {[
                    "progression",
                    "substitution",
                    "schedule",
                    "recovery",
                    "communication",
                    "safety",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="When this applies">
                <textarea
                  name="condition"
                  required
                  rows={2}
                  placeholder="A beginner completes all sets with stable technique…"
                />
              </Field>
              <Field label="What I do">
                <textarea
                  name="directive"
                  required
                  rows={3}
                  placeholder="Increase the load by the smallest available increment."
                />
              </Field>
              <Field label="Why">
                <textarea name="reason" rows={2} />
              </Field>
              <Button type="submit" disabled={busy}>
                Save draft rule <Plus size={16} />
              </Button>
            </form>
          </Card>
          <div className="card-stack">
            {rules.length ? (
              rules.map((r) => (
                <Card key={r.id}>
                  <div className="card-heading">
                    <Badge>{r.data.category}</Badge>
                    <Badge tone={r.status === "confirmed" ? "green" : "amber"}>
                      {r.status}
                    </Badge>
                  </div>
                  <h3>{r.data.title}</h3>
                  <p className="muted">
                    <strong>When </strong>
                    {r.data.condition}
                  </p>
                  <p>{r.data.directive}</p>
                  {r.data.reason && <p className="muted">{r.data.reason}</p>}
                  {r.status !== "confirmed" && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () => api(`/brain/rules/${r.id}/confirm`, "POST", {}),
                          "Rule confirmed",
                        )
                      }
                    >
                      Confirm this rule <Check size={16} />
                    </Button>
                  )}
                </Card>
              ))
            ) : (
              <Card>
                <Empty
                  title="Your Constitution is taking shape"
                  detail="These are the rules you explicitly stand behind. Confirm a draft when it represents your judgment."
                />
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === "scenarios" && (
        <div className="two-columns">
          <Card>
            <h2>Test the reasoning, not the wording.</h2>
            <p className="muted">
              Create held-out situations for evaluation. They are kept separate
              from the Brain’s learning material.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () =>
                    api("/brain/scenarios", "POST", {
                      prompt: f.get("prompt"),
                      expectedEvidenceId: f.get("expectedEvidenceId"),
                      expectEscalation: f.get("escalation") === "on",
                      heldOut: true,
                    }),
                  "Scenario saved",
                );
              }}
            >
              <Field label="Client situation">
                <textarea name="prompt" required minLength={10} rows={5} />
              </Field>
              <Field label="Expected coaching rule">
                <select name="expectedEvidenceId" required>
                  <option value="">Select a confirmed rule</option>
                  {rules
                    .filter((r) => r.status === "confirmed")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.data.title}
                      </option>
                    ))}
                </select>
              </Field>
              <label className="check-field">
                <input type="checkbox" name="escalation" />
                This case must be escalated
              </label>
              <Button type="submit" disabled={busy}>
                Save held-out scenario
              </Button>
            </form>
          </Card>
          <Card>
            <h2>Evaluation set</h2>
            {records("scenario").map((r) => (
              <div className="list-row" key={r.id}>
                <p>{r.data.prompt}</p>
                <Badge>Held out</Badge>
              </div>
            ))}
            {!records("scenario").length && (
              <Empty
                title="No scenarios yet"
                detail="Vary experience, equipment, schedule and safety conditions to test where your method holds up."
              />
            )}
          </Card>
        </div>
      )}
      {tab === "releases" && (
        <div className="two-columns">
          <Card>
            <h2>Earn confidence before release.</h2>
            <div className="readiness-row">
              <span>Confirmed coaching rules</span>
              <strong>
                {rules.filter((r) => r.status === "confirmed").length}
              </strong>
            </div>
            <div className="readiness-row">
              <span>Held-out scenarios</span>
              <strong>{records("scenario").length} / 20 minimum</strong>
            </div>
            <div className="readiness-row">
              <span>Model connection</span>
              <Badge>
                {state.integrations.find((x) => x.id === "model")?.configured
                  ? "Configured"
                  : "Required"}
              </Badge>
            </div>
            <p className="muted">
              A passing evaluation unlocks a supervised release. Your trainer
              reviews generated coaching before it reaches a subscriber.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void action(
                  () => api("/brain/evaluate", "POST", {}),
                  "Evaluation recorded",
                )
              }
            >
              Run evaluation <Activity size={16} />
            </Button>
          </Card>
          <div className="card-stack">
            {records("evaluation").map((e) => (
              <Card key={e.id}>
                <div className="card-heading">
                  <h3>
                    {e.data.passed} / {e.data.total} passed
                  </h3>
                  <Badge>{e.status}</Badge>
                </div>
                <p className="muted">
                  {new Date(e.created_at).toLocaleString()}
                </p>
                {e.status === "passed" && (
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api("/brain/releases", "POST", {
                            evaluationId: e.id,
                            notes: "Trainer-approved supervised release",
                          }),
                        "Brain released",
                      )
                    }
                  >
                    Publish supervised release
                  </Button>
                )}
              </Card>
            ))}
            {records("brain_release").map((r) => (
              <Card key={r.id}>
                <h3>Brain release</h3>
                <Badge>{r.status}</Badge>
                <p>{r.data.notes}</p>
                <p className="muted">
                  Supervised · {new Date(r.created_at).toLocaleString()}
                </p>
                {r.status === "archived" && (
                  <Button
                    secondary
                    onClick={() =>
                      void action(
                        () =>
                          api(`/brain/releases/${r.id}/rollback`, "POST", {}),
                        "Release restored",
                      )
                    }
                  >
                    Restore this release
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Members({ state, records, action, busy }: ViewProps) {
  const [invite, setInvite] = useState(""),
    [query, setQuery] = useState("");
  const members = (state.members ?? []).filter(
    (m) =>
      m.role === "subscriber" &&
      `${m.name} ${m.email}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="THE PEOPLE BEHIND THE NUMBERS"
        title="Your subscribers."
        detail="The right context for a more personal kind of coaching."
      />
      <div className="two-columns wide-left">
        <Card>
          <input
            className="search"
            placeholder="Search by name or email"
            aria-label="Search subscribers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {members.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subscriber</th>
                    <th>Program</th>
                    <th>Membership</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/trainer/subscribers/${m.id}`}>
                          <strong>{m.name}</strong>
                        </Link>
                        <small>{m.email}</small>
                      </td>
                      <td>
                        {
                          records("program").filter(
                            (p) => p.owner_user_id === m.id,
                          ).length
                        }{" "}
                        assigned
                      </td>
                      <td>
                        <Badge>
                          {state.subscriptions.find((s) => s.user_id === m.id)
                            ?.status ?? "Invited"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Make room for your first subscriber"
              detail="Invite someone into your coaching space. Paid access starts through your configured membership offer."
            />
          )}
        </Card>
        <Card>
          <h2>Invite a subscriber</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(
                () =>
                  api("/invitations", "POST", {
                    email: f.get("email"),
                    role: "subscriber",
                  }),
                "Invitation created",
              ).then((r) => {
                if (r) setInvite(r.url);
              });
            }}
          >
            <Field label="Email address">
              <input type="email" name="email" required />
            </Field>
            <Button type="submit" disabled={busy}>
              Create invitation <ArrowUpRight size={16} />
            </Button>
          </form>
          {invite && (
            <div className="invite-result">
              <p>Share this single-use invitation:</p>
              <input value={invite} readOnly aria-label="Invitation link" />
              <Button
                secondary
                onClick={() => void navigator.clipboard.writeText(invite)}
              >
                Copy link
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Programs({ state, records, action, busy }: ViewProps) {
  const [exercises, setExercises] = useState([
    { name: "", sets: 3, reps: 10, restSeconds: 90, loadKg: 0, cue: "" },
  ]);
  const sub = state.user.role === "subscriber";
  const router = useRouter();
  return (
    <>
      <Heading
        eyebrow="STRUCTURE WITH INTENTION"
        title={
          sub
            ? "Your training program."
            : "Good coaching starts with a clear plan."
        }
        detail="Simple prescriptions, useful cues and room for thoughtful progression."
      />
      {!sub && (
        <Card>
          <h2>Create a program</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void action(
                () =>
                  api("/programs", "POST", {
                    program: {
                      title: f.get("title"),
                      goal: f.get("goal"),
                      daysPerWeek: Number(f.get("days")),
                      exercises,
                    },
                    ...(f.get("subscriber")
                      ? { subscriberId: f.get("subscriber") }
                      : {}),
                  }),
                "Program saved",
              );
            }}
          >
            <div className="form-grid">
              <Field label="Program name">
                <input name="title" required />
              </Field>
              <Field label="Sessions per week">
                <input
                  name="days"
                  type="number"
                  defaultValue={3}
                  min={1}
                  max={7}
                  required
                />
              </Field>
              <Field label="Goal / approach">
                <input name="goal" required />
              </Field>
              <Field label="Assign to">
                <select name="subscriber">
                  <option value="">Save as my template</option>
                  {state.members
                    ?.filter((m) => m.role === "subscriber")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="exercise-editor">
              {exercises.map((ex, i) => (
                <div className="exercise-inputs" key={i}>
                  <Field label="Exercise">
                    <input
                      value={ex.name}
                      required
                      onChange={(e) =>
                        setExercises((xs) =>
                          xs.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  {[
                    ["sets", "Sets"],
                    ["reps", "Reps"],
                    ["restSeconds", "Rest (s)"],
                    ["loadKg", "Load (kg)"],
                  ].map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        type="number"
                        value={(ex as any)[key]}
                        min={key === "sets" || key === "reps" ? 1 : 0}
                        onChange={(e) =>
                          setExercises((xs) =>
                            xs.map((x, j) =>
                              j === i
                                ? { ...x, [key]: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                  ))}
                </div>
              ))}
            </div>
            <div className="button-row">
              <Button
                secondary
                onClick={() =>
                  setExercises((x) => [
                    ...x,
                    {
                      name: "",
                      sets: 3,
                      reps: 10,
                      restSeconds: 90,
                      loadKg: 0,
                      cue: "",
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add exercise
              </Button>
              <Button type="submit" disabled={busy}>
                Save program <Check size={16} />
              </Button>
            </div>
          </form>
        </Card>
      )}
      <div className="two-columns">
        {records("program").map((p) => (
          <Card key={p.id}>
            <div className="card-heading">
              <Badge>{p.status}</Badge>
              <span className="muted">{p.data.daysPerWeek} days / week</span>
            </div>
            <h2>{p.data.title}</h2>
            <p className="muted">{p.data.goal}</p>
            {p.data.exercises.map((x: any, i: number) => (
              <div className="program-exercise" key={i}>
                <span className="step-circle">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{x.name}</strong>
                  <small>
                    {x.sets} × {x.reps} · {x.loadKg ? `${x.loadKg} kg · ` : ""}
                    {x.restSeconds}s rest
                  </small>
                </div>
              </div>
            ))}
            {sub && (
              <Button
                disabled={busy}
                onClick={() =>
                  void action(
                    () => api("/workouts/start", "POST", { programId: p.id }),
                    "Workout started",
                  ).then((r) => {
                    if (r) router.push(`/app/workouts/${r.id}`);
                  })
                }
              >
                Start workout <Play size={16} />
              </Button>
            )}
          </Card>
        ))}
      </div>
      {!records("program").length && (
        <Card>
          <Empty
            title={
              sub
                ? "Your program is being prepared"
                : "Your program library starts here"
            }
            detail={
              sub
                ? "Your trainer will assign a program built around your intake."
                : "Create a useful training block, then assign it to a subscriber."
            }
          />
        </Card>
      )}
    </>
  );
}

function Workout({ state, records, action, busy, path }: ViewProps) {
  const workout = records("workout").find(
    (w) => w.id === path.split("/").pop(),
  );
  const [queued, setQueued] = useState(0),
    [notice, setNotice] = useState("");
  const key = `trainer:queue:${state.user.tenantId}:${state.user.userId}`;
  const syncing = useRef(false);
  const [localDone, setLocalDone] = useState<string[]>([]);
  const receiptKey = key + ":receipts";
  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      const pending = JSON.parse(localStorage.getItem(key) ?? "[]");
      for (const item of pending) {
        try {
          await api(item.path, "POST", item.body);
          const latest = JSON.parse(localStorage.getItem(key) ?? "[]").filter(
            (p: any) => p.body.eventKey !== item.body.eventKey,
          );
          localStorage.setItem(key, JSON.stringify(latest));
          const receipts = [
            ...new Set<string>([
              ...JSON.parse(localStorage.getItem(receiptKey) ?? "[]"),
              item.logicalKey,
            ]),
          ];
          localStorage.setItem(receiptKey, JSON.stringify(receipts));
          setLocalDone(receipts);
          setQueued(latest.length);
        } catch (e) {
          setNotice("Saved on this device. " + (e as Error).message);
          break;
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [key, receiptKey]);
  useEffect(() => {
    setQueued(JSON.parse(localStorage.getItem(key) ?? "[]").length);
    setLocalDone(JSON.parse(localStorage.getItem(receiptKey) ?? "[]"));
    window.addEventListener("online", sync);
    void sync();
    return () => window.removeEventListener("online", sync);
  }, [sync, key, receiptKey]);
  useEffect(() => {
    if (!workout || !navigator.onLine || !("caches" in window)) return;
    let active = true;
    void (async () => {
      try {
        await navigator.serviceWorker.ready;
        const cache = await caches.open("trainer-workout-shell-v1");
        const assets = performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((url) => url.startsWith(location.origin + "/_next/static/"));
        await Promise.all(
          [path, ...new Set(assets)].map((url) => cache.add(url)),
        );
        if (active)
          setNotice(
            "Workout saved for this device. Set logs can sync after a connection loss.",
          );
      } catch {
        if (active)
          setNotice(
            "Keep this workout open. Offline reload is not ready; reconnect to save it for this device.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [workout?.id, path]);
  if (!workout)
    return (
      <Empty
        title="Workout unavailable"
        detail="Choose a program to start your session."
      />
    );
  return (
    <>
      <Heading
        eyebrow="ONE SET AT A TIME"
        title={workout.data.program.title}
        detail="Log what you actually do. You can adjust the weight and reps for every set."
        action={<Badge>{workout.status.replaceAll("_", " ")}</Badge>}
      />
      {queued > 0 && (
        <div className="notice">
          {queued} set logs waiting to sync.{" "}
          <button className="text-button" onClick={() => void sync()}>
            Sync now
          </button>
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {workout.data.program.exercises.map((ex: any, i: number) => (
        <Card key={i}>
          <div className="card-heading">
            <div className="exercise-title">
              <span className="step-circle">{i + 1}</span>
              <h2>{ex.name}</h2>
            </div>
            <span className="muted">
              {ex.sets} × {ex.reps} · {ex.restSeconds}s rest
            </span>
          </div>
          <p className="muted">{ex.cue}</p>
          {Array.from({ length: ex.sets }, (_, set) => {
            const logicalKey = workout.id + ":" + ex.name + ":" + (set + 1);
            const pendingHere = JSON.parse(
              localStorage.getItem(key) ?? "[]",
            ).some((p: any) => p.logicalKey === logicalKey);
            const done =
              pendingHere ||
              localDone.includes(logicalKey) ||
              state.sets.some(
                (s) =>
                  s.workout_id === workout.id &&
                  s.data.exercise === ex.name &&
                  s.data.set === set + 1,
              );
            return (
              <form
                className="set-row"
                key={set}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    body = {
                      eventKey: crypto.randomUUID(),
                      exercise: ex.name,
                      set: set + 1,
                      reps: Number(f.get("reps")),
                      loadKg: Number(f.get("load")),
                    };
                  const endpoint = `/workouts/${workout.id}/sets`;
                  const pending = JSON.parse(localStorage.getItem(key) ?? "[]");
                  if (
                    pending.some((p: any) => p.logicalKey === logicalKey) ||
                    localDone.includes(logicalKey)
                  )
                    return;
                  pending.push({ path: endpoint, body, logicalKey });
                  localStorage.setItem(key, JSON.stringify(pending));
                  setQueued(pending.length);
                  setNotice(
                    `Set ${set + 1} saved on this device. It will sync when your connection is available.`,
                  );
                  await sync();
                }}
              >
                <span>Set {set + 1}</span>
                <label>
                  <input
                    type="number"
                    name="load"
                    aria-label={`${ex.name} set ${set + 1} load`}
                    defaultValue={ex.loadKg}
                    min={0}
                    step={0.5}
                  />
                  <small>kg</small>
                </label>
                <label>
                  <input
                    type="number"
                    name="reps"
                    aria-label={`${ex.name} set ${set + 1} reps`}
                    defaultValue={ex.reps}
                    min={0}
                  />
                  <small>reps</small>
                </label>
                <Button
                  type="submit"
                  secondary
                  disabled={busy || done || workout.status !== "active"}
                >
                  {done ? (
                    <>
                      <Check size={16} />
                      {pendingHere ? "Saved offline" : "Logged"}
                    </>
                  ) : (
                    "Log set"
                  )}
                </Button>
              </form>
            );
          })}
        </Card>
      ))}
      <div className="button-row">
        <Button
          disabled={busy || queued > 0 || workout.status !== "active"}
          onClick={() =>
            void action(
              () => api(`/workouts/${workout.id}/finish`, "POST", {}),
              "Workout completed",
            )
          }
        >
          Finish workout <CheckCircle size={17} />
        </Button>
        <Button
          secondary
          disabled={busy || workout.status !== "active"}
          onClick={() => {
            const description = window.prompt(
              "Describe the pain or issue. Your workout will pause for review.",
            );
            if (description)
              void action(
                () =>
                  api(`/workouts/${workout.id}/pain`, "POST", { description }),
                "Workout paused for trainer review",
              );
          }}
        >
          <Pause size={16} />
          Pain or an issue
        </Button>
      </div>
    </>
  );
}

function Messages({ state, records, action, busy }: ViewProps) {
  const sub = state.user.role === "subscriber";
  const [target, setTarget] = useState(
    sub
      ? state.user.userId
      : (state.members?.find((m) => m.role === "subscriber")?.id ?? ""),
  );
  const [text, setText] = useState("");
  const messages = records("message")
    .filter((m) => m.data.subscriberId === target)
    .reverse();
  return (
    <>
      <Heading
        eyebrow="A HUMAN CONNECTION"
        title={sub ? "Talk to your coach." : "Stay close to your people."}
        detail="Digital guidance is identified clearly. Human conversations always have room here."
      />
      <Card>
        {!sub && (
          <div className="button-row">
            <select
              aria-label="Select subscriber"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose subscriber</option>
              {state.members
                ?.filter((m) => m.role === "subscriber")
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <Button
              secondary
              onClick={() =>
                void action(
                  () =>
                    api("/takeover", "POST", {
                      subscriberId: target,
                      active: true,
                    }),
                  "Human takeover enabled",
                )
              }
            >
              Take over
            </Button>
            <Button
              secondary
              onClick={() =>
                void action(
                  () =>
                    api("/takeover", "POST", {
                      subscriberId: target,
                      active: false,
                    }),
                  "Digital review flow resumed",
                )
              }
            >
              Resume digital review
            </Button>
          </div>
        )}
        <div className="conversation">
          {messages.length ? (
            messages.map((m) => (
              <div
                key={m.id}
                className={
                  "message " +
                  (m.data.author === "subscriber" ? "from-client" : "")
                }
              >
                <span className="small-label">
                  {m.data.author === "digital_reviewed"
                    ? "Digital coach · trainer reviewed"
                    : m.data.author}
                </span>
                <p>{m.data.text}</p>
                <small>
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </div>
            ))
          ) : (
            <Empty
              title="Start a useful conversation"
              detail="Share a question, an observation or the context behind a workout."
            />
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () => api("/messages", "POST", { text, subscriberId: target }),
              "Message sent",
            ).then((r) => {
              if (r) setText("");
            });
          }}
        >
          <Field label="Your message">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              minLength={1}
              required
              rows={3}
              placeholder="What would you like your coach to know?"
            />
          </Field>
          <div className="button-row">
            <Button type="submit" disabled={busy || !target}>
              Send to {sub ? "trainer" : "subscriber"}
              <ArrowRight size={16} />
            </Button>
            {sub && (
              <Button
                secondary
                disabled={busy || !text}
                onClick={() =>
                  void action(
                    () => api("/coaching/ask", "POST", { message: text }),
                    "Sent to digital coaching for review",
                  ).then((r) => {
                    if (r) setText("");
                  })
                }
              >
                Ask digital coach <Brain size={16} />
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}

function Exceptions({ records, state, action, busy }: ViewProps) {
  const exceptions = records("exception").filter((e) => e.status === "open");
  return (
    <>
      <Heading
        eyebrow="YOUR JUDGMENT MATTERS"
        title="The attention list."
        detail="Review the evidence, make a decision, and help your coaching improve."
      />
      {exceptions.length ? (
        exceptions.map((e) => (
          <Card key={e.id}>
            <div className="card-heading">
              <Badge tone={e.data.category === "safety" ? "amber" : ""}>
                {e.data.category.replaceAll("_", " ")}
              </Badge>
              <span className="muted">
                {state.members?.find((m) => m.id === e.data.subscriberId)
                  ?.name ?? "Subscriber"}
              </span>
            </div>
            <h3>{e.data.description}</h3>
            {e.data.decisionId && (
              <blockquote>
                {
                  records("decision").find((d) => d.id === e.data.decisionId)
                    ?.data.message
                }
              </blockquote>
            )}
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                const f = new FormData(ev.currentTarget);
                void action(
                  () =>
                    api(`/exceptions/${e.id}/resolve`, "POST", {
                      note: f.get("note"),
                      approveDecision: f.get("approve") === "on",
                    }),
                  "Review recorded",
                );
              }}
            >
              <Field label="Resolution / trainer note">
                <textarea name="note" minLength={3} required rows={2} />
              </Field>
              {e.data.decisionId && (
                <label className="check-field">
                  <input name="approve" type="checkbox" />
                  Approve and send this digital response
                </label>
              )}
              <Button type="submit" disabled={busy}>
                Resolve with my review <Check size={16} />
              </Button>
            </form>
          </Card>
        ))
      ) : (
        <Card>
          <Empty
            title="Nothing needs your attention right now"
            detail="Safety reports, uncertain coaching decisions and human review requests will appear here."
          />
        </Card>
      )}
    </>
  );
}

function Finance({ state, records, action, busy, path }: ViewProps) {
  const sub = state.user.role === "subscriber",
    membership = state.subscriptions[0];
  const [offer, setOffer] = useState(path.includes("products"));
  return (
    <>
      <Heading
        eyebrow="CLEAR NUMBERS. NO GUESSWORK."
        title={sub ? "Your membership." : "Your coaching, accounted for."}
        detail={
          sub
            ? "See your access, renewal and refund options in one place."
            : "Track the ledger from subscriber payments through to your monthly payout."
        }
        action={
          !sub ? (
            <a className="button secondary" href="/api/v1/finance/export">
              <Download size={16} />
              Export ledger
            </a>
          ) : undefined
        }
      />
      {sub ? (
        <>
          <Card>
            <h2>
              {membership
                ? "Your current plan"
                : "Choose your coaching membership"}
            </h2>
            {membership ? (
              <>
                <div className="membership-price">
                  {money(membership.price_minor)}
                  <span>/ month</span>
                </div>
                <Badge>{membership.status}</Badge>
                <p className="muted">
                  {membership.cancel_at_period_end
                    ? "Access continues until"
                    : "Current period ends"}{" "}
                  {membership.period_end
                    ? new Date(membership.period_end).toLocaleDateString()
                    : "—"}
                </p>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        api(
                          `/membership/${membership.cancel_at_period_end ? "reactivate" : "cancel"}`,
                          "POST",
                          {},
                        ),
                      membership.cancel_at_period_end
                        ? "Renewal reactivated"
                        : "Renewal stopped; your paid access remains",
                    )
                  }
                >
                  {membership.cancel_at_period_end
                    ? "Reactivate renewal"
                    : "Cancel renewal"}
                </Button>
              </>
            ) : (
              records("product")
                .filter((p) => p.status === "published")
                .map((p) => (
                  <div className="list-row" key={p.id}>
                    <div>
                      <h3>{p.data.name}</h3>
                      <p>{p.data.description}</p>
                      <strong>{money(p.data.priceMinor)} / month</strong>
                    </div>
                    <Button
                      onClick={() =>
                        void action(
                          () =>
                            api("/payments/checkout", "POST", {
                              productId: p.id,
                            }),
                          "Opening checkout",
                        ).then((r) => {
                          if (r?.url) window.location.assign(r.url);
                        })
                      }
                    >
                      Join this plan
                    </Button>
                  </div>
                ))
            )}
          </Card>
          <Card>
            <h2>Request a refund</h2>
            <p className="muted">
              Requests are separate from cancellation and can be submitted
              within seven days of the charge. Your trainer reviews each
              request.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () => api("/refund-requests", "POST", Object.fromEntries(f)),
                  "Refund request sent",
                );
              }}
            >
              <Field label="Charge reference from your receipt">
                <input name="chargeId" required />
              </Field>
              <Field label="Reason">
                <textarea name="reason" required minLength={5} />
              </Field>
              <Button type="submit" secondary disabled={busy}>
                Submit request
              </Button>
            </form>
            {records("refund").map((r) => (
              <div className="list-row" key={r.id}>
                <span>{r.data.reason}</span>
                <Badge>{r.status}</Badge>
              </div>
            ))}
          </Card>
        </>
      ) : (
        <>
          <div className="stats-grid">
            <Card className="stat">
              <span className="small-label">Trainer payable</span>
              <strong>{money(state.finance?.earnedMinor ?? 0)}</strong>
              <span className="muted">After booked adjustments</span>
            </Card>
            <Card className="stat">
              <span className="small-label">Allocated to payouts</span>
              <strong>{money(state.finance?.reservedMinor ?? 0)}</strong>
              <span className="muted">Held or in progress</span>
            </Card>
            <Card className="stat">
              <span className="small-label">Available to allocate</span>
              <strong>{money(state.finance?.availableMinor ?? 0)}</strong>
              <span className="muted">Funding and eligibility still apply</span>
            </Card>
            <Card className="stat">
              <span className="small-label">Platform commission</span>
              <strong>{money(state.finance?.commissionMinor ?? 0)}</strong>
              <span className="muted">Marginal subscriber bands</span>
            </Card>
          </div>
          {!!state.usageStatements?.length && (
            <Card>
              <h2>Reviewed monthly usage charges</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Provider cost</th>
                      <th>AED per USD</th>
                      <th>Charged to earnings</th>
                      <th>Fee schedule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.usageStatements.map((s) => (
                      <tr key={s.period}>
                        <td>{s.period}</td>
                        <td>${Number(s.total_cost_usd).toFixed(4)}</td>
                        <td>{Number(s.fx_aed_per_usd)}</td>
                        <td>{money(Number(s.charge_minor))}</td>
                        <td>{s.fee_schedule_version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <div className="tabs">
            {[
              ["ledger", "Ledger"],
              ["offers", "Offers"],
              ["refunds", "Refunds"],
              ["payouts", "Payouts"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={
                  (offer === true && v === "offers") || (offer as any) === v
                    ? "selected"
                    : ""
                }
                onClick={() => setOffer(v as any)}
              >
                {l}
              </button>
            ))}
          </div>
          {offer === true || (offer as any) === "offers" ? (
            <div className="two-columns">
              <Card>
                <h2>A clear offer</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action(
                      () =>
                        api("/products", "POST", {
                          name: f.get("name"),
                          description: f.get("description"),
                          priceMinor: Math.round(Number(f.get("price")) * 100),
                        }),
                      "Offer saved",
                    );
                  }}
                >
                  <Field label="Plan name">
                    <input name="name" required />
                  </Field>
                  <Field label="What is included">
                    <textarea name="description" rows={3} />
                  </Field>
                  <Field label="Monthly price (AED)">
                    <input
                      name="price"
                      type="number"
                      min={1}
                      step={0.01}
                      required
                    />
                  </Field>
                  <Button type="submit" disabled={busy}>
                    Create offer
                  </Button>
                </form>
              </Card>
              <div className="card-stack">
                {records("product").map((p) => (
                  <Card key={p.id}>
                    <Badge>{p.status}</Badge>
                    <h2>{p.data.name}</h2>
                    <div className="membership-price">
                      {money(p.data.priceMinor)}
                      <span>/ month</span>
                    </div>
                    <p>{p.data.description}</p>
                    {p.status !== "published" && (
                      <Button
                        secondary
                        onClick={() =>
                          void action(
                            () => api(`/products/${p.id}/activate`, "POST", {}),
                            "Offer activated",
                          )
                        }
                      >
                        Activate with Stripe
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ) : (offer as any) === "refunds" ? (
            <Card>
              <h2>Refund requests</h2>
              {records("refund").length ? (
                records("refund").map((r) => (
                  <div className="refund-item" key={r.id}>
                    <Badge>{r.status}</Badge>
                    <h3>{money(r.data.amountMinor)}</h3>
                    <p>{r.data.reason}</p>
                    {["submitting", "submitted", "unknown"].includes(
                      r.status,
                    ) && (
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () =>
                              api(
                                "/refund-requests/" + r.id + "/reconcile",
                                "POST",
                                {},
                              ),
                            "Provider status reconciled",
                          )
                        }
                      >
                        Reconcile provider status
                      </Button>
                    )}
                    {r.status === "requested" && (
                      <div className="button-row">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                api(
                                  `/refund-requests/${r.id}/decision`,
                                  "POST",
                                  {
                                    approve: true,
                                    reason: "Approved by trainer",
                                  },
                                ),
                              "Refund approved",
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          secondary
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt(
                              "Reason for declining",
                            );
                            if (reason)
                              void action(
                                () =>
                                  api(
                                    `/refund-requests/${r.id}/decision`,
                                    "POST",
                                    { approve: false, reason },
                                  ),
                                "Decision recorded",
                              );
                          }}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  title="No refund requests"
                  detail="Eligible subscriber requests will appear here for your decision."
                />
              )}
            </Card>
          ) : (offer as any) === "payouts" || path.includes("payout") ? (
            <PayoutView
              state={state}
              records={records}
              action={action}
              busy={busy}
              path={path}
            />
          ) : (
            <Card>
              <div className="card-heading">
                <h2>Financial activity</h2>
                <Badge>Immutable ledger</Badge>
              </div>
              {state.journals?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Gross</th>
                        <th>Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.journals.map((j) => (
                        <tr key={j.id}>
                          <td>{new Date(j.created_at).toLocaleDateString()}</td>
                          <td>{j.description}</td>
                          <td>
                            {j.data.grossMinor ? money(j.data.grossMinor) : "—"}
                          </td>
                          <td>
                            {j.data.commissionMinor
                              ? money(j.data.commissionMinor)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Every amount will have a source"
                  detail="Verified payment activity creates your ledger. No earnings are estimated into this balance."
                />
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

function PayoutView({ state, records, action, busy }: ViewProps) {
  return (
    <div className="two-columns">
      <Card>
        <h2>Your payout destination</h2>
        {records("beneficiary").map((b) => (
          <div className="list-row" key={b.id}>
            <div>
              <strong>{b.data.name}</strong>
              <p>{b.data.maskedIban}</p>
            </div>
            <Badge>{b.status}</Badge>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            void action(
              () => api("/payout-beneficiaries", "POST", Object.fromEntries(f)),
              "Bank destination submitted for verification",
            ).then((r) => {
              if (r) form.reset();
            });
          }}
        >
          {[
            ["name", "Account holder"],
            ["iban", "UAE IBAN"],
            ["address", "Address"],
            ["city", "City"],
          ].map(([name, label]) => (
            <Field key={name} label={label}>
              <input name={name} required autoComplete="off" />
            </Field>
          ))}
          <p className="muted">
            Lean verifies the destination before it can receive a monthly
            payment.
          </p>
          <Button type="submit" disabled={busy}>
            Submit destination
          </Button>
        </form>
      </Card>
      <Card>
        <h2>Monthly payouts</h2>
        <form
          className="button-row"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api("/payout-runs/prepare", "POST", {
                  period: new FormData(e.currentTarget).get("period"),
                }),
              "Payout dry run prepared",
            );
          }}
        >
          <input
            type="month"
            name="period"
            aria-label="Payout period"
            required
            defaultValue={new Date().toISOString().slice(0, 7)}
          />
          <Button type="submit" secondary disabled={busy}>
            Prepare dry run
          </Button>
        </form>
        {state.payouts?.length ? (
          state.payouts.map((p) => (
            <div className="list-row" key={p.id}>
              <div>
                <strong>{money(p.amount_minor)}</strong>
                <p>{p.period}</p>
              </div>
              <Badge>{p.status}</Badge>
            </div>
          ))
        ) : (
          <Empty
            title="Payments, with a clear trail"
            detail="Monthly statements and confirmed bank outcomes will appear here."
          />
        )}
      </Card>
    </div>
  );
}

function Integrations({ state, action, busy, path }: ViewProps) {
  return (
    <>
      <Heading
        eyebrow="A CONNECTED COACHING PRACTICE"
        title="Useful connections. Clear permissions."
        detail="See what is available and what still needs provider setup. Your data stays tied to its allowed purpose."
      />
      <div className="integration-grid">
        {state.integrations.map((i) => (
          <Card key={i.id}>
            <div className="card-heading">
              <span className="integration-letter">{i.name[0]}</span>
              <Badge tone={i.configured && i.approved ? "green" : "amber"}>
                {i.configured && i.approved
                  ? "Available"
                  : i.configured
                    ? "Approval required"
                    : "Not connected"}
              </Badge>
            </div>
            <h2>{i.name}</h2>
            <p className="muted">{i.purpose}</p>
            {i.id === "lean" && (
              <Link className="text-link" href="/trainer/payouts">
                Manage bank destination <ArrowUpRight size={14} />
              </Link>
            )}
            {i.id === "apple" && (
              <p className="small-label">IMPORT · NO ADVERTISING USE</p>
            )}
          </Card>
        ))}
      </div>
      <Card>
        <h2>Import Apple Health observations</h2>
        <p className="muted">
          Select an Apple Health export.xml file. Supported numeric records are
          imported with their source, unit and measurement time. They remain
          excluded from model inputs and marketing.
        </p>
        <input
          type="file"
          accept=".xml"
          aria-label="Apple Health export XML"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) {
              window.alert("Use an export under 15 MB for this import.");
              return;
            }
            const xml = new DOMParser().parseFromString(
              await file.text(),
              "text/xml",
            );
            const observations = Array.from(xml.querySelectorAll("Record"))
              .map((node) => ({
                type: node.getAttribute("type") ?? "",
                value: Number(node.getAttribute("value")),
                unit: node.getAttribute("unit") ?? "",
                measuredAt: node.getAttribute("startDate") ?? "",
              }))
              .filter(
                (x) =>
                  Number.isFinite(x.value) &&
                  x.measuredAt &&
                  Number.isFinite(Date.parse(x.measuredAt)),
              )
              .map((x) => ({
                ...x,
                measuredAt: new Date(x.measuredAt).toISOString(),
              }));
            if (observations.length > 2000) {
              window.alert(
                "This import supports up to 2,000 numeric observations. Select a smaller date range; no partial import has been made.",
              );
              return;
            }
            await action(
              () =>
                api("/wearables/import", "POST", {
                  source: "apple_health",
                  observations,
                  consent: true,
                }),
              `${observations.length} observations imported`,
            );
          }}
        />
      </Card>
    </>
  );
}

function SettingsView({ state, records, action, busy, path }: ViewProps) {
  const intake = records("intake")[0]?.data ?? {},
    sub = state.user.role === "subscriber";
  const [invite, setInvite] = useState("");
  return (
    <>
      <Heading
        eyebrow="YOUR SPACE, YOUR CHOICES"
        title={sub ? "Your coaching profile." : "Your workspace settings."}
        detail="Keep your information useful, your permissions clear and your data under your control."
      />
      <AccountSecurity />
      {sub && (
        <Card>
          <h2>Help your coach understand you</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(
                () =>
                  api("/intake", "POST", {
                    age: Number(f.get("age")),
                    goal: f.get("goal"),
                    experience: f.get("experience"),
                    daysPerWeek: Number(f.get("days")),
                    equipment: f.get("equipment"),
                    limitations: f.get("limitations"),
                    consent: true,
                  }),
                "Coaching profile saved",
              );
            }}
          >
            <div className="form-grid">
              <Field label="Age (18+)">
                <input
                  type="number"
                  name="age"
                  min={18}
                  max={100}
                  defaultValue={intake.age}
                  required
                />
              </Field>
              <Field label="Experience">
                <select
                  name="experience"
                  defaultValue={intake.experience ?? "beginner"}
                >
                  {["beginner", "intermediate", "advanced"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Main goal">
                <input name="goal" defaultValue={intake.goal} required />
              </Field>
              <Field label="Days available each week">
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={7}
                  defaultValue={intake.daysPerWeek ?? 3}
                  required
                />
              </Field>
              <Field label="Equipment available">
                <input name="equipment" defaultValue={intake.equipment} />
              </Field>
              <Field label="Limitations your trainer should know">
                <textarea
                  name="limitations"
                  defaultValue={intake.limitations}
                />
              </Field>
            </div>
            <label className="check-field">
              <input type="checkbox" required />I agree to the coaching use of
              this information and understand that digital coaching does not
              replace medical care.
            </label>
            <Button type="submit" disabled={busy}>
              Save coaching profile
            </Button>
          </form>
        </Card>
      )}
      <div className="two-columns">
        <Card>
          <h2>Notifications</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(
                () =>
                  api("/settings", "POST", {
                    emailNotifications: f.get("email") === "on",
                    workoutReminders: f.get("workouts") === "on",
                    marketing: f.get("marketing") === "on",
                  }),
                "Preferences saved",
              );
            }}
          >
            {[
              ["email", "Coaching and account email"],
              ["workouts", "Workout reminders"],
              ["marketing", "Optional product news"],
            ].map(([key, label]) => (
              <label className="check-field" key={key}>
                <input
                  type="checkbox"
                  name={key}
                  defaultChecked={key !== "marketing"}
                />
                {label}
              </label>
            ))}
            <Button type="submit" secondary disabled={busy}>
              Save preferences
            </Button>
          </form>
        </Card>
        <Card>
          <h2>Your data</h2>
          <p className="muted">
            Download your coaching records, manage consent, or request account
            deletion. Required financial records follow the applicable retention
            policy.
          </p>
          <div className="button-row">
            <a className="button secondary" href="/api/v1/privacy/export">
              <Download size={16} />
              Export my data
            </a>
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void action(
                  () => api("/privacy/delete-request", "POST", {}),
                  "Deletion request recorded for review",
                )
              }
            >
              Request deletion
            </Button>
          </div>
          <div className="divider" />
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void action(
                () =>
                  api("/privacy/consent", "POST", {
                    type: "coaching",
                    granted: false,
                  }),
                "New model use of your intake has been disabled",
              )
            }
          >
            Withdraw coaching-data consent
          </Button>
        </Card>
      </div>
      {state.user.role === "owner" && (
        <Card>
          <h2>Invite a team member</h2>
          <form
            className="button-row"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () =>
                  api("/invitations", "POST", {
                    email: new FormData(e.currentTarget).get("email"),
                    role: new FormData(e.currentTarget).get("role"),
                  }),
                "Team invitation created",
              ).then((r) => {
                if (r) setInvite(r.url);
              });
            }}
          >
            <input
              type="email"
              name="email"
              required
              aria-label="Staff email"
              placeholder="colleague@example.com"
            />
            <Button type="submit" disabled={busy}>
              Create invitation
            </Button>
          </form>
          {invite && (
            <input readOnly value={invite} aria-label="Team invitation URL" />
          )}
          {state.members
            ?.filter((m) => ["staff", "finance"].includes(m.role))
            .map((m) => (
              <div className="list-row" key={m.id}>
                <span>
                  {m.name} · {m.email}
                </span>
                <Button
                  secondary
                  onClick={() =>
                    void action(
                      () => api(`/team/${m.id}`, "DELETE"),
                      "Access revoked",
                    )
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
        </Card>
      )}
    </>
  );
}

function Analytics({ state, records }: ViewProps) {
  const completed = records("workout").filter((w) => w.status === "completed"),
    count = state.sets.length,
    volume = state.sets.reduce(
      (sum, s) => sum + s.data.reps * s.data.loadKg,
      0,
    );
  return (
    <>
      <Heading
        eyebrow="PROGRESS WITH EVIDENCE"
        title="See what is actually changing."
        detail="These numbers come from recorded activity. More useful history arrives with each real session."
      />
      <div className="stats-grid">
        <Card className="stat">
          <span className="small-label">Completed workouts</span>
          <strong>{completed.length}</strong>
        </Card>
        <Card className="stat">
          <span className="small-label">Recorded sets</span>
          <strong>{count}</strong>
        </Card>
        <Card className="stat">
          <span className="small-label">Recorded volume</span>
          <strong>
            {volume.toLocaleString()}
            <small> kg</small>
          </strong>
        </Card>
        <Card className="stat">
          <span className="small-label">Active subscriptions</span>
          <strong>
            {state.subscriptions.filter((s) => s.status === "active").length}
          </strong>
        </Card>
      </div>
      <Card>
        <h2>Workout history</h2>
        {records("workout").length ? (
          records("workout").map((w) => (
            <div className="list-row" key={w.id}>
              <div>
                <strong>{w.data.program?.title ?? "Workout"}</strong>
                <p className="muted">
                  {new Date(w.created_at).toLocaleString()}
                </p>
              </div>
              <Badge>{w.status.replaceAll("_", " ")}</Badge>
            </div>
          ))
        ) : (
          <Empty
            title="A baseline starts with the first session"
            detail="Log workouts consistently to build a useful picture of progress."
          />
        )}
      </Card>
      {state.costs && (
        <Card>
          <h2>AI usage</h2>
          {state.costs.length ? (
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Model</th>
                  <th>Tokens</th>
                  <th>Provider cost</th>
                </tr>
              </thead>
              <tbody>
                {state.costs.map((c) => (
                  <tr key={c.id}>
                    <td>{c.task}</td>
                    <td>{c.model}</td>
                    <td>
                      {c.input_tokens === null || c.output_tokens === null
                        ? "Unknown"
                        : c.input_tokens + c.output_tokens}
                    </td>
                    <td>
                      {c.cost_usd === null
                        ? "Unpriced"
                        : `$${Number(c.cost_usd).toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              No model calls have been recorded. Unconfigured pricing will be
              shown as unpriced, never as free.
            </p>
          )}
        </Card>
      )}
    </>
  );
}

function Admin({ state }: ViewProps) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/admin/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <Heading
        eyebrow="PLATFORM OPERATIONS"
        title="An accountable view of the platform."
        detail="Financial totals, open exceptions and provider readiness. Every workspace inspection is audited."
      />
      {error && <div className="notice error">{error}</div>}
      {data ? (
        <>
          {["admin", "finance"].includes(state.user.platformRole) && (
            <FinanceOperations tenants={data.tenants} />
          )}
          {state.user.platformRole === "admin" && (
            <PrivacyOperations tenants={data.tenants} />
          )}
          <div className="stats-grid">
            <Card className="stat">
              <span className="small-label">Trainer workspaces</span>
              <strong>{data.tenants.length}</strong>
            </Card>
            <Card className="stat">
              <span className="small-label">Published</span>
              <strong>
                {data.tenants.filter((t: any) => t.published).length}
              </strong>
            </Card>
            <Card className="stat">
              <span className="small-label">Open exceptions</span>
              <strong>
                {data.tenants.reduce(
                  (s: number, t: any) => s + t.exceptions.length,
                  0,
                )}
              </strong>
            </Card>
            <Card className="stat">
              <span className="small-label">Trainer liabilities</span>
              <strong>
                {money(
                  data.tenants.reduce(
                    (s: number, t: any) => s + (t.finance?.earnedMinor ?? 0),
                    0,
                  ),
                )}
              </strong>
            </Card>
          </div>
          <Card>
            <h2>Trainer workspaces</h2>
            <table>
              <thead>
                <tr>
                  <th>Trainer</th>
                  <th>Status</th>
                  <th>Payable</th>
                  <th>Exceptions</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((t: any) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                      <small>{t.slug}</small>
                    </td>
                    <td>
                      <Badge>{t.published ? "Published" : "Private"}</Badge>
                    </td>
                    <td>
                      {t.finance ? money(t.finance.earnedMinor) : "Restricted"}
                    </td>
                    <td>{t.exceptions.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        !error && <p>Loading platform evidence…</p>
      )}
    </>
  );
}

function Public({
  path,
  onAuthenticated,
}: {
  path: string;
  onAuthenticated: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(100),
    [price, setPrice] = useState(199),
    [store, setStore] = useState<any>(null);
  const enroll = path.startsWith("/join-coach/");
  const join = path.startsWith("/join/"),
    auth =
      path === "/forgot-password" ||
      path.startsWith("/reset-password/") ||
      path.startsWith("/verify-email/") ||
      path === "/login" ||
      path === "/signup" ||
      join ||
      enroll,
    signup = path === "/signup";
  useEffect(() => {
    if (path.startsWith("/coach/"))
      api("/public/trainers/" + path.split("/").pop())
        .then(setStore)
        .catch((e) => setError(e.message));
  }, [path]);
  const fees = projectedCommission(count, price * 100);
  return (
    <div className="public">
      <header className="public-header">
        <Link href="/" className="wordmark">
          <span className="brand-mark">b.</span>
          <span>
            trainer<span className="wordmark-light">brain</span>
          </span>
        </Link>
        <nav>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/pricing">The economics</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <Link className="button" href="/signup">
          Build my Brain <ArrowUpRight size={16} />
        </Link>
      </header>
      {path.startsWith("/reset-password/") ||
      path.startsWith("/verify-email/") ||
      path === "/forgot-password" ? (
        <AccountRecovery path={path} />
      ) : auth ? (
        <main className="auth-layout">
          <div className="auth-story">
            <p className="eyebrow">YOUR KNOWLEDGE. YOUR NEXT CHAPTER.</p>
            <h1>
              {join
                ? "Meet your next chapter."
                : signup
                  ? "You’ve built the experience.\nNow build the business."
                  : "Welcome back to your coaching space."}
            </h1>
            <p>
              Your judgment is the part that matters. Give it a place to grow.
            </p>
            <div className="auth-lines">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <Card>
            <h2>
              {enroll
                ? "Join this coaching space"
                : join
                  ? "Accept your invitation"
                  : signup
                    ? "Create your coaching space"
                    : "Sign in"}
            </h2>
            <p className="muted">
              {signup
                ? "Start with your identity. Your Brain comes next."
                : join
                  ? "Use the email address your trainer invited."
                  : "Pick up exactly where you left off."}
            </p>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = new FormData(e.currentTarget);
                try {
                  await api(
                    enroll
                      ? "/auth/enroll"
                      : join
                        ? "/invitations/accept"
                        : signup
                          ? "/auth/register"
                          : "/auth/login",
                    "POST",
                    enroll
                      ? {
                          name: f.get("name"),
                          email: f.get("email"),
                          password: f.get("password"),
                          coachSlug: path.split("/").pop(),
                          accepted: true,
                          ...(f.get("code") ? { code: f.get("code") } : {}),
                        }
                      : join
                        ? {
                            name: f.get("name"),
                            email: f.get("email"),
                            password: f.get("password"),
                            token: path.split("/").pop(),
                            ...(f.get("code") ? { code: f.get("code") } : {}),
                          }
                        : signup
                          ? {
                              name: f.get("name"),
                              email: f.get("email"),
                              password: f.get("password"),
                              slug: f.get("slug"),
                              accepted: true,
                            }
                          : {
                              email: f.get("email"),
                              password: f.get("password"),
                              ...(f.get("code") ? { code: f.get("code") } : {}),
                            },
                  );
                  await onAuthenticated();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {(signup || join || enroll) && (
                <Field label="Your name">
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    minLength={2}
                  />
                </Field>
              )}
              <Field label="Email address">
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </Field>
              {signup && (
                <Field label="Your coaching address">
                  <div className="input-affix">
                    <span>/coach/</span>
                    <input
                      name="slug"
                      pattern="[a-z][a-z0-9-]{2,39}"
                      placeholder="your-name"
                      required
                    />
                  </div>
                </Field>
              )}
              <Field label="Password">
                <input
                  name="password"
                  type="password"
                  minLength={signup || join || enroll ? 12 : 1}
                  autoComplete={
                    signup || join || enroll
                      ? "new-password"
                      : "current-password"
                  }
                  required
                />
                {(signup || join || enroll) && (
                  <small>At least 12 characters.</small>
                )}
              </Field>
              {!signup && (
                <>
                  <Field label="Authenticator code (if enabled)">
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                    />
                  </Field>
                  <p>
                    <Link className="text-link" href="/forgot-password">
                      Forgot your password?
                    </Link>
                  </p>
                </>
              )}
              {(signup || enroll) && (
                <label className="check-field">
                  <input type="checkbox" required />I accept the published terms
                  and understand the digital coaching disclosure.
                </label>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Opening your workspace…"
                  : join || enroll
                    ? "Join my coach"
                    : signup
                      ? "Create my workspace"
                      : "Sign in"}
                <ArrowRight size={16} />
              </Button>
            </form>
            <div className="divider" />
            <p className="muted">
              {signup
                ? "Already have a coaching space?"
                : "New to Trainer Brain?"}{" "}
              <Link href={signup ? "/login" : "/signup"}>
                {signup ? "Sign in" : "Get started"}
              </Link>
            </p>
          </Card>
        </main>
      ) : path.startsWith("/coach/") ? (
        <main className="public-section">
          {store ? (
            <>
              <p className="eyebrow">{store.trainer.name}</p>
              <h1>
                {store.trainer.theme?.headline ?? "Coaching built around you."}
              </h1>
              <p className="lead">{store.trainer.theme?.bio}</p>
              {store.products.map((p: any) => (
                <Card key={p.id}>
                  <h2>{p.data.name}</h2>
                  <p>{p.data.description}</p>
                  <strong>{money(p.data.priceMinor)} / month</strong>
                  <p>
                    <Link
                      className="button"
                      href={"/join-coach/" + store.trainer.slug}
                    >
                      Join this coaching space <ArrowRight size={16} />
                    </Link>
                  </p>
                </Card>
              ))}
            </>
          ) : (
            <p>{error || "Loading coaching page…"}</p>
          )}
        </main>
      ) : ["/how-it-works", "/demo", "/pricing", "/faq"].includes(path) ? (
        <MarketingPage path={path} />
      ) : ["/terms", "/privacy", "/ai-disclosure"].includes(path) ? (
        <main className="legal public-section">
          <p className="eyebrow">TRANSPARENCY</p>
          <h1>
            {path === "/privacy"
              ? "Your data belongs in a clear conversation."
              : path === "/terms"
                ? "Terms of service"
                : "Digital coaching, clearly identified."}
          </h1>
          <Card>
            <Badge tone="amber">Draft · production review required</Badge>
            <p>
              This development build does not publish approved legal terms or
              accept live customers until the operator’s reviewed documents and
              consent configuration are in place.
            </p>
            <p>
              Digital coaching uses trainer-approved methods and is identified
              separately from personally written trainer messages. It does not
              replace medical assessment or emergency services. Fitness data is
              used within its recorded permissions. Trainer material stays
              scoped to that trainer, and provider restrictions remain
              enforceable.
            </p>
            <p>
              Account controls include export, consent management, a
              deletion-request workflow, and separate renewal cancellation and
              refund requests. Final rights, responsibilities, retention periods
              and contact details must be stated in the reviewed documents
              before launch.
            </p>
          </Card>
        </main>
      ) : (
        <>
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="tiny-line" />
                FOR COACHES WITH A METHOD OF THEIR OWN
              </p>
              <h1>
                Put your
                <br />
                coaching mind
                <br />
                <em>online.</em>
              </h1>
              <p className="hero-description">
                Your programs. Your judgment. Your brand.
                <br />
                Build a digital coaching practice around the experience only you
                can bring.
              </p>
              <div className="button-row">
                <Link className="button large" href="/signup">
                  Build my coaching Brain <ArrowUpRight size={18} />
                </Link>
                <a className="text-link" href="#how">
                  See how it works <ArrowRight size={17} />
                </a>
              </div>
              <div className="hero-notes">
                <span>
                  <Check size={14} />
                  Your method stays yours
                </span>
                <span>
                  <Check size={14} />
                  You stay in control
                </span>
              </div>
            </div>
            <div className="hero-art">
              <div className="art-label">THE VALUE IS IN YOUR JUDGMENT.</div>
              <div className="orb orb-one" />
              <div className="orb orb-two" />
              <div className="floating-rule">
                <div className="card-heading">
                  <span className="small-label">
                    A COACHING RULE, MADE CLEAR
                  </span>
                  <span className="rule-dot" />
                </div>
                <h3>
                  Good technique
                  <br />
                  before more weight.
                </h3>
                <div className="rule-condition">
                  <span>WHEN</span>
                  <p>A beginner is still finding consistency.</p>
                </div>
                <div className="rule-condition">
                  <span>MY APPROACH</span>
                  <p>
                    Build confidence in the movement.
                    <br />
                    Then progress the load.
                  </p>
                </div>
                <div className="rule-bottom">
                  <CheckCircle size={16} />
                  Illustrative trainer-confirmed rule
                </div>
              </div>
              <div className="art-bottom">
                <span>YOUR EXPERIENCE</span>
                <ArrowRight size={20} />
                <span>A TEACHABLE METHOD</span>
              </div>
            </div>
          </section>
          <div className="principle-strip">
            <span>THE COACH IS THE PRODUCT.</span>
            <span>Technology should make that clearer.</span>
            <ArrowUpRight size={23} />
          </div>
          <section className="public-section" id="how">
            <div className="section-intro">
              <p className="eyebrow">FROM EXPERIENCE TO EVERYDAY COACHING</p>
              <h2>
                Teach it. Shape it.
                <br />
                Make it yours.
              </h2>
            </div>
            <div className="three-columns">
              {[
                [
                  "01",
                  "Teach your method",
                  "Talk through real decisions. Add your own material. Turn the why behind your coaching into clear, reviewable rules.",
                ],
                [
                  "02",
                  "Keep your judgment",
                  "Test scenarios, correct assumptions and decide what can run automatically. Your Brain earns your confidence.",
                ],
                [
                  "03",
                  "Build your business",
                  "Publish your brand, create your membership and coach through a clear program, workout log and personal conversation.",
                ],
              ].map(([n, title, body]) => (
                <div className="step-card" key={n}>
                  <span className="step-number">{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="economics public-section" id="economics">
            <div>
              <p className="eyebrow">GROW WITH ROOM TO GROW</p>
              <h2>
                A share that gets
                <br />
                lighter as you scale.
              </h2>
              <p className="muted lead">
                Transparent marginal commission. Each new band applies to the
                subscribers in that band.
              </p>
              <div className="fee-bands">
                <span>
                  1–100 <strong>25%</strong>
                </span>
                <span>
                  101–300 <strong>20%</strong>
                </span>
                <span>
                  301–1,000 <strong>15%</strong>
                </span>
                <span>
                  1,001+ <strong>10%</strong>
                </span>
              </div>
            </div>
            <Card className="calculator">
              <div className="card-heading">
                <h3>Imagine your coaching business</h3>
                <Badge>Illustration</Badge>
              </div>
              <Field label={`Paying subscribers: ${count}`}>
                <input
                  type="range"
                  min={1}
                  max={1500}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </Field>
              <Field label="Monthly membership (AED)">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={price}
                  onChange={(e) =>
                    setPrice(
                      Math.max(1, Math.min(10000, Number(e.target.value))),
                    )
                  }
                />
              </Field>
              <div className="readiness-row">
                <span>Subscription revenue</span>
                <strong>{money(count * price * 100)}</strong>
              </div>
              <div className="readiness-row">
                <span>Platform commission</span>
                <strong>{money(fees)}</strong>
              </div>
              <div className="calculator-total">
                <span>Before other costs and tax</span>
                <strong>{money(count * price * 100 - fees)}</strong>
              </div>
              <p className="muted fine-print">
                Illustrative arithmetic, not an earnings promise. Payment
                processing, AI, voice, bank fees, refunds and applicable tax are
                additional.
              </p>
            </Card>
          </section>
          <section className="closing public-section">
            <p className="eyebrow">YOU ALREADY HAVE THE EXPERIENCE.</p>
            <h2>
              Give it somewhere
              <br />
              new to go.
            </h2>
            <Link className="button large" href="/signup">
              Build my coaching Brain <ArrowUpRight size={18} />
            </Link>
          </section>
        </>
      )}
      <footer className="public-footer">
        <span>Trainer Brain · Built around your judgment.</span>
        <div>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/ai-disclosure">Digital coaching</Link>
        </div>
      </footer>
    </div>
  );
}
