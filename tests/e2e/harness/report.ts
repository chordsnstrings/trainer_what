/**
 * Scenario step recorder. Every step names the audience and the exact feature
 * name from the verified inventory, so the report reads as pass/fail per
 * feature. A failing step never hides later independent steps.
 */
import { existsSync, readFileSync } from "node:fs";

export const AUDIENCES = {
  "Super admin": "Platform operators: the Supera",
  Trainers: "Trainers: the workspace owner ",
  followers: "Trainer followers (subscribers",
  "public-join": "public-join",
} as const;
export type Audience = keyof typeof AUDIENCES;
export type StepStatus = "pass" | "fail" | "skip";
export type StepResult = {
  id: string;
  audience: Audience;
  feature: string;
  title: string;
  status: StepStatus;
  durationMs: number;
  detail?: string;
  error?: string;
};

/**
 * Inventory items of another audience that a step exercises through exactly the same flow
 * (for example the follower's two-way chat is also the trainer's messaging feature). Kept
 * deliberately narrow and listed here so the coverage claim can be audited.
 */
export const EQUIVALENT_FEATURES: Record<string, Array<[Audience, string]>> = {
  "followers:Accept a trainer's invitation link": [
    ["Trainers", "Subscriber accepts invitation with consent"],
    ["followers", "Terms, privacy and AI disclosure accepted at joining"],
    ["public-join", "Accept invitation (/join/<link>)"],
    ["public-join", "Terms acceptance recorded when joining"],
    ["followers", "Verify email address"],
  ],
  "followers:Choose a plan and pay (with discount codes)": [
    ["public-join", "Choose a plan and pay (membership checkout)"],
    ["public-join", "Discount codes at checkout"],
    ["followers", "Coaching profile questionnaire with consent"],
  ],
  "followers:Log sets (reps, weight, effort, notes)": [["Trainers", "Subscribers train the assigned program"]],
  "followers:Message your trainer": [["Trainers", "Trainer and subscriber messaging"]],
  "followers:Send photos and PDFs in chat": [["Trainers", "Photo and PDF chat attachments"]],
  "followers:Coaching context (Client Twin) view": [["Trainers", "Client profile and coaching context view"]],
  "followers:Reserve or cancel a free session": [["Trainers", "Subscribers reserve sessions"]],
  "followers:Pay for a paid session, with refund on cancellation": [["public-join", "Pay for a booked coaching session"]],
  "followers:WHOOP connection": [["Trainers", "WHOOP and Amazfit/Zepp connections"]],
  "followers:Apple Health export import": [["Trainers", "Apple Health imports"]],
  "followers:Phone and browser push notifications": [["Trainers", "Device push notifications"]],
  "followers:Email copies of notifications": [["Trainers", "Email copies of notifications"]],
  "followers:Switch between workout-only and workout + nutrition": [["Trainers", "Subscriber plan switching between tiers"]],
  "followers:Email sign-in link": [["public-join", "Email sign-in link"]],
  "followers:Forgot-password reset email": [["public-join", "Forgot and reset password"]],
  "Trainers:Email address verification": [["public-join", "Email address verification"]],
  "Trainers:Invite a subscriber by link": [["public-join", "Follower invitation link"]],
  "Trainers:Draft offers (workout and workout + nutrition tiers)": [
    ["public-join", "Draft membership offers"],
    ["public-join", "Workout + nutrition offer tier"],
  ],
  "Trainers:Free trials and promotion codes": [["public-join", "Free trial for new members"]],
  "Trainers:Publish storefront (launch)": [["public-join", "Publish storefront (go public)"]],
  "Trainers:Website editor and private preview": [
    ["public-join", "Website editor with private draft"],
    ["public-join", "Private website preview"],
  ],
  "Trainers:Publish website": [["public-join", "Publish website changes"]],
  "Trainers:Photo galleries for the website and the subscriber app": [["public-join", "Photo library and galleries"]],
  "Trainers:Custom domain": [["public-join", "Coach requests a custom domain"]],
  "Super admin:Custom domain operations": [["public-join", "Approve a price quote to buy a domain"]],
  "Super admin:Sign in with password and authenticator code, sign out": [
    ["public-join", "Email and password sign-in"],
    ["public-join", "Sign out"],
  ],
  "public-join:Contact form": [
    ["public-join", "Website inquiry inbox"],
    ["Trainers", "Website contact inquiries inbox"],
  ],
  "public-join:Public self-join from a coach website (/join-coach/<name>)": [
    ["followers", "Join from a coach's public page"],
    ["Trainers", "Public coaching page and public subscriber signup"],
    ["followers", "Verify email address"],
  ],
  "public-join:Switch between coaches": [["followers", "Switch between trainers"]],
  "public-join:Coach-branded app icon and install manifest": [["followers", "Trainer-branded app icon"]],
  "followers:Check an interrupted checkout": [["public-join", "Check an interrupted checkout"]],
  "followers:Passkeys (fingerprint or face sign-in)": [["public-join", "Passkey sign-in"]],
};

/**
 * Features the local sandbox cannot exercise, or can exercise only in part,
 * with the reason. A feature listed here that also has passing steps is
 * reported as exercised with this limit; one without steps is reported as
 * "not local" instead of silently missing. Keep every entry specific.
 */
export const LOCAL_LIMITS: Record<string, { reason: string; partial?: boolean }> = {
  "public-join:HTTPS certificates for coach domains on the live server": {
    partial: true,
    reason:
      "The API side (TLS ask endpoint, activation allowance, refusal of unmapped names) runs against a local edge that asks the API before presenting a certificate, as Caddy's on-demand TLS does. The live Caddy configuration and real ACME issuance are host work, covered by the infrastructure unit tests, not by this harness.",
  },
  "Super admin:Database backups": {
    partial: true,
    reason:
      "The real host controller code (hostops.py) takes the encrypted backup, uploads it to an S3 double and restores it into a scratch database; only its host primitives are simulated (docker compose exec becomes local pg_dump/psql/pg_restore, containers are reported healthy). The scheduled daily timer and DigitalOcean server backups are not exercised.",
  },
  "Super admin:Scaling, deploy or cloud actions from the admin": {
    partial: true,
    reason:
      "Allowlisted host actions (pause and resume deploys) are signed by the API and executed by the real controller code with simulated host primitives. Restart, rollback and re-apply need Docker and releases on a real host. Resizing, snapshots, DNS and billing are out of scope by design (no cloud token on the server) and are checked as refused.",
  },
  "Super admin:Platform's own web address": {
    partial: true,
    reason:
      "The address check (format, DNS through the sandbox resolver, coach-domain clash, passkeys) runs. Moving the address is host work (runtime.env and a re-apply) and is not performed.",
  },
  "public-join:Apple or Google sign-in": {
    partial: true,
    reason:
      "Google and Apple are OpenID Connect issuer doubles reached through a sandbox-only issuer override; the real providers' consent screens, Apple's private-relay email and key rotation are not exercised.",
  },
  "followers:Automatic Apple HealthKit sync": {
    partial: true,
    reason:
      "The native companion app does not exist; the harness plays its role against the published device API (pairing code, device token, sample batches, unpair).",
  },
  "public-join:Analytics expiry, export and erasure": {
    partial: true,
    reason:
      "The 180-day window is reached by moving one consent's expiry into the past; the expired record stops counting at once, but the worker's hourly purge is not awaited within the run.",
  },
  "followers:Install as a phone app": {
    partial: true,
    reason: "The manifest and icons are fetched over HTTP; the operating system's install prompt cannot run headless.",
  },
};

export type FeatureRow = {
  audience: Audience;
  feature: string;
  inventoryStatus: string;
  providerDependent: boolean;
  dependency: string;
  result: "pass" | "fail" | "equivalent" | "not-local" | "not-exercised";
  steps: number;
  passed: number;
  failed: number;
  skipped: number;
  via?: string;
  limit?: string;
};

/** Provider- or approval-dependent per the inventory (a dependency is named, or the status says so). */
export function isProviderDependent(entry: { status?: string; dependency?: string }) {
  const status = String(entry.status ?? "");
  return /needs_provider|needs_approval/.test(status) || !!String(entry.dependency ?? "").trim();
}

export class Reporter {
  readonly results: StepResult[] = [];
  constructor(private log: (message: string) => void = console.log) {}
  async step(
    audience: Audience,
    feature: string,
    title: string,
    fn: () => Promise<string | void> | string | void,
  ): Promise<boolean> {
    const started = Date.now();
    const id = `${audience}:${feature}:${title}`;
    try {
      const detail = await fn();
      this.results.push({
        id,
        audience,
        feature,
        title,
        status: "pass",
        durationMs: Date.now() - started,
        ...(detail ? { detail } : {}),
      });
      this.log(`  pass  [${audience}] ${feature} — ${title}`);
      return true;
    } catch (error) {
      const message = (error as Error)?.stack ?? String(error);
      this.results.push({
        id,
        audience,
        feature,
        title,
        status: "fail",
        durationMs: Date.now() - started,
        error: message.slice(0, 4000),
      });
      this.log(`  FAIL  [${audience}] ${feature} — ${title}: ${(error as Error)?.message?.slice(0, 400)}`);
      return false;
    }
  }
  skip(audience: Audience, feature: string, title: string, reason: string) {
    this.results.push({
      id: `${audience}:${feature}:${title}`,
      audience,
      feature,
      title,
      status: "skip",
      durationMs: 0,
      detail: reason,
    });
    this.log(`  skip  [${audience}] ${feature} — ${title}: ${reason}`);
  }
  /**
   * Setup that later steps need (a new person, a seeded member): a failure is
   * recorded as a failed step and `undefined` is returned, so a broken
   * prerequisite fails the run instead of silently dropping steps.
   */
  async prepare<T>(audience: Audience, feature: string, title: string, fn: () => Promise<T>): Promise<T | undefined> {
    const started = Date.now();
    try {
      return await fn();
    } catch (error) {
      const message = (error as Error)?.stack ?? String(error);
      this.results.push({
        id: `${audience}:${feature}:setup: ${title}`,
        audience,
        feature,
        title: `setup: ${title}`,
        status: "fail",
        durationMs: Date.now() - started,
        error: message.slice(0, 4000),
      });
      this.log(`  FAIL  [${audience}] ${feature} — setup: ${title}: ${(error as Error)?.message?.slice(0, 400)}`);
      return undefined;
    }
  }
  /**
   * A seeded person or record that scenarios expect is missing: recorded once
   * as a failed harness step, so the steps that needed it are not lost silently.
   */
  missingPrerequisite(what: string) {
    const id = `Super admin:Harness prerequisites:${what}`;
    if (this.results.some((r) => r.id === id)) return;
    this.results.push({
      id,
      audience: "Super admin",
      feature: "Harness prerequisites",
      title: what,
      status: "fail",
      durationMs: 0,
      error: `${what} is missing; the steps that need it did not run`,
    });
    this.log(`  FAIL  [Super admin] Harness prerequisites — ${what} is missing`);
  }
  /** Records each step that cannot run because a prerequisite is missing (never a silent return). */
  blocked(reason: string, steps: ReadonlyArray<readonly [Audience, string, string]>) {
    for (const [audience, feature, title] of steps) this.skip(audience, feature, title, reason);
  }
  summary(featuresPath?: string) {
    const count = (status: StepStatus) => this.results.filter((r) => r.status === status).length;
    const byFeature: Record<string, { audience: Audience; feature: string; status: StepStatus; steps: number }> = {};
    for (const r of this.results) {
      const key = `${r.audience}|${r.feature}`;
      const entry = (byFeature[key] ??= { audience: r.audience, feature: r.feature, status: "pass", steps: 0 });
      entry.steps++;
      if (r.status === "fail") entry.status = "fail";
      else if (r.status === "skip" && entry.status === "pass" && entry.steps === 1) entry.status = "skip";
    }
    let inventory:
      | {
          unknownFeatureNames: string[];
          coverage: Record<string, { covered: number; total: number; withEquivalents: number }>;
          notExercised: Record<string, string[]>;
          table: FeatureRow[];
          /** Provider-dependent features with neither a scenario nor a stated local limit (should be empty). */
          providerDependentUnaccounted: string[];
        }
      | undefined;
    if (featuresPath && existsSync(featuresPath)) {
      const data = JSON.parse(readFileSync(featuresPath, "utf8"));
      const unknown = new Set<string>();
      const coverage: Record<string, { covered: number; total: number; withEquivalents: number }> = {};
      const notExercised: Record<string, string[]> = {};
      const passedOrFailed = this.results.filter((r) => r.status !== "skip");
      const viaEquivalent = new Set(
        passedOrFailed.flatMap((r) =>
          (EQUIVALENT_FEATURES[`${r.audience}:${r.feature}`] ?? []).map(([a, f]) => `${a}:${f}`),
        ),
      );
      for (const [audience, key] of Object.entries(AUDIENCES)) {
        const names = new Set<string>((data[key]?.features ?? []).map((f: any) => f.feature));
        const covered = new Set(
          this.results.filter((r) => r.audience === audience && r.status !== "skip").map((r) => r.feature),
        );
        for (const name of covered) if (!names.has(name)) unknown.add(`${audience}: ${name}`);
        const exercised = (name: string) => covered.has(name) || viaEquivalent.has(`${audience}:${name}`);
        coverage[audience] = {
          covered: [...covered].filter((name) => names.has(name)).length,
          total: names.size,
          withEquivalents: [...names].filter(exercised).length,
        };
        notExercised[audience] = [...names].filter((name) => !exercised(name));
      }
      const table: FeatureRow[] = [];
      for (const [audience, key] of Object.entries(AUDIENCES) as Array<[Audience, string]>)
        for (const entry of data[key]?.features ?? []) {
          const steps = this.results.filter((r) => r.audience === audience && r.feature === entry.feature);
          const passed = steps.filter((r) => r.status === "pass").length;
          const failed = steps.filter((r) => r.status === "fail").length;
          const skipped = steps.filter((r) => r.status === "skip").length;
          const via = passedOrFailed.find((r) =>
            (EQUIVALENT_FEATURES[`${r.audience}:${r.feature}`] ?? []).some(([a, f]) => a === audience && f === entry.feature),
          );
          const limit = LOCAL_LIMITS[`${audience}:${entry.feature}`];
          const result: FeatureRow["result"] = failed
            ? "fail"
            : passed
              ? "pass"
              : via
                ? via.status === "fail"
                  ? "fail"
                  : "equivalent"
                : limit
                  ? "not-local"
                  : "not-exercised";
          table.push({
            audience,
            feature: entry.feature,
            inventoryStatus: String(entry.status ?? ""),
            providerDependent: isProviderDependent(entry),
            dependency: String(entry.dependency ?? ""),
            result,
            steps: steps.length,
            passed,
            failed,
            skipped,
            ...(via && !passed && !failed ? { via: `${via.audience}: ${via.feature}` } : {}),
            ...(limit ? { limit: limit.reason } : {}),
          });
        }
      const unaccounted = table
        .filter((row) => row.providerDependent && ["not-exercised"].includes(row.result))
        .map((row) => `${row.audience}: ${row.feature}`);
      inventory = { unknownFeatureNames: [...unknown], coverage, notExercised, table, providerDependentUnaccounted: unaccounted };
    }
    return {
      summary: { steps: this.results.length, passed: count("pass"), failed: count("fail"), skipped: count("skip") },
      features: Object.values(byFeature),
      ...(inventory ? { inventory } : {}),
      steps: this.results,
    };
  }
}
