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
    let inventory: { unknownFeatureNames: string[]; coverage: Record<string, { covered: number; total: number }> } | undefined;
    if (featuresPath && existsSync(featuresPath)) {
      const data = JSON.parse(readFileSync(featuresPath, "utf8"));
      const unknown = new Set<string>();
      const coverage: Record<string, { covered: number; total: number }> = {};
      for (const [audience, key] of Object.entries(AUDIENCES)) {
        const names = new Set<string>((data[key]?.features ?? []).map((f: any) => f.feature));
        const covered = new Set(
          this.results.filter((r) => r.audience === audience && r.status !== "skip").map((r) => r.feature),
        );
        for (const name of covered) if (!names.has(name)) unknown.add(`${audience}: ${name}`);
        coverage[audience] = {
          covered: [...covered].filter((name) => names.has(name)).length,
          total: names.size,
        };
      }
      inventory = { unknownFeatureNames: [...unknown], coverage };
    }
    return {
      summary: { steps: this.results.length, passed: count("pass"), failed: count("fail"), skipped: count("skip") },
      features: Object.values(byFeature),
      ...(inventory ? { inventory } : {}),
      steps: this.results,
    };
  }
}
