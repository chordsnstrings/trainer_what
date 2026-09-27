/**
 * Harness entry used by scripts/e2e/run.mjs once the stack is up: platform
 * setup, seeding through the public API, then the selected audience suites.
 */
import type { MockSuite } from "../mocks/index.ts";
import { createContext } from "./context.ts";
import { Reporter } from "./report.ts";
import { Client } from "./client.ts";
import { setupPlatform, superAdminScenarios } from "../scenarios/super-admin.e2e.ts";
import { setupTrainers, trainerScenarios } from "../scenarios/trainer.e2e.ts";
import { setupFollowers, followerScenarios } from "../scenarios/follower.e2e.ts";
import { publicJoinScenarios } from "../scenarios/public-join.e2e.ts";
import { extendedScenarios } from "../scenarios/extended.e2e.ts";
import { operatorCompletionScenarios } from "../scenarios/operator-completion.e2e.ts";
import { memberCompletionScenarios } from "../scenarios/member-completion.e2e.ts";
import { browserScenarios } from "../scenarios/browser.e2e.ts";
import { providerRecoveryScenarios } from "../scenarios/provider-recovery.e2e.ts";

export const SUITES = ["super-admin", "trainer", "follower", "public-join", "completion", "browser", "extended"] as const;

export async function runHarness(input: {
  publicUrl: string;
  mocks: MockSuite;
  admin: { email: string; password: string };
  migrationUrl: string;
  suites?: string[];
  featuresPath?: string;
  artifacts: string;
  log: (message: string) => void;
  /** The API process environment, for host-only operator scripts. */
  hostEnv?: Record<string, string | undefined>;
  root?: string;
  edge?: { domainAddress: string | null; domainError: string | null; asks: Array<{ at: string; name: string; status: number | string }> };
  apiPort?: number;
}) {
  const reporter = new Reporter(input.log);
  const ctx = createContext({ ...input, reporter });
  const suites = new Set(input.suites ?? SUITES);
  const phase = async (name: string, fn: () => Promise<void>) => {
    input.log(`— ${name}`);
    try {
      await fn();
    } catch (error) {
      // A setup phase that cannot continue is itself a failed step.
      reporter.results.push({
        id: `harness:${name}`,
        audience: "Super admin",
        feature: "Harness phase",
        title: name,
        status: "fail",
        durationMs: 0,
        error: String((error as Error)?.stack ?? error).slice(0, 4000),
      });
      input.log(`  FAIL  phase ${name}: ${(error as Error)?.message}`);
    }
  };
  try {
    await phase("platform setup (Super admin)", () => setupPlatform(ctx));
    await phase("trainer seed", () => setupTrainers(ctx));
    await phase("follower seed", () => setupFollowers(ctx));
    // Follower activity first: the trainer suite reviews what members produced
    // (exceptions from digital coaching, nutrition consent for photo guardrails).
    if (suites.has("follower")) await phase("follower scenarios", () => followerScenarios(ctx));
    if (suites.has("trainer")) await phase("trainer scenarios", () => trainerScenarios(ctx));
    if (suites.has("public-join")) await phase("public-join scenarios", () => publicJoinScenarios(ctx));
    if (suites.has("super-admin")) await phase("super admin scenarios", () => superAdminScenarios(ctx));
    // Features completed after the first inventory (governance, accounts, joining, discovery, HealthKit, host operations).
    if (suites.has("completion")) {
      await phase("completion: members, trainers and public", () => memberCompletionScenarios(ctx));
      await phase("completion: operators", () => operatorCompletionScenarios(ctx));
      // Lost Stripe webhooks and lost Stripe answers, recovered through the reconcile routes.
      await phase("completion: provider-loss recovery", () => providerRecoveryScenarios(ctx));
    }
    // Browser-only behaviour with the local headless Chromium (offline sync, screens).
    if (suites.has("browser")) await phase("browser (local headless Chromium)", () => browserScenarios(ctx));
    // Runs last: it erases a member, closes a workspace and reconnects a provider.
    if (suites.has("extended")) await phase("extended coverage", () => extendedScenarios(ctx));
  } finally {
    await ctx.close();
  }
  const report = reporter.summary(input.featuresPath) as ReturnType<Reporter["summary"]> & {
    run?: Record<string, unknown>;
    clockShifts?: unknown;
    providers?: unknown;
    model?: unknown;
  };
  report.clockShifts = ctx.clockShifts;
  (report as any).rateLimitWaits = Client.rateLimitWaits;
  (report as any).automaticStepUps = Client.automaticStepUps;
  (report as any).edge = { coachDomains: ctx.edge.domainAddress ? "available" : ctx.edge.domainError, asks: ctx.edge.asks };
  (report as any).dnsQueries = input.mocks.dns.queries;
  report.providers = {
    stripeWebhooks: input.mocks.stripe.deliveries.map((d) => ({ type: d.type, status: d.status })),
    stripeWebhookFailures: input.mocks.stripe.deliveries.filter((d) => d.status !== 200),
    emails: input.mocks.email.messages.length,
    pushes: input.mocks.push.deliveries.length,
    leanPayments: input.mocks.lean.payments.size,
    voiceSyntheses: input.mocks.voice.syntheses.length,
  };
  report.model = {
    calls: input.mocks.model.calls.length,
    bySource: input.mocks.model.calls.reduce<Record<string, number>>((acc, c) => {
      acc[c.source] = (acc[c.source] ?? 0) + 1;
      return acc;
    }, {}),
    byKind: input.mocks.model.calls.reduce<Record<string, number>>((acc, c) => {
      const key = c.task ?? c.kind;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
  return report;
}
