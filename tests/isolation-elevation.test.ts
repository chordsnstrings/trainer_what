// Static checks of the elevation allowlist (packages/db/src/scope.ts) against
// the application source: every remaining elevation is documented where it is
// used, and no application code switches role or scope settings by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ELEVATIONS } from "@trainer/db";

const root = fileURLToPath(new URL("..", import.meta.url));
function sources(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", "build"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}
const appFiles = sources(join(root, "apps")).map((path) => ({
  file: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));
// elevated("reason", ...), actingAs(actor, "role", "reason") and a literal
// `elevation: "reason"` are the only ways an actor gets an elevation.
const usePatterns = [
  /\belevated\(\s*"([^"]+)"/g,
  /\bactingAs\(\s*[^,()]+(?:\([^()]*\))?,\s*"[a-z]+",\s*"([^"]+)"\s*,?\s*\)/g,
  /\belevation:\s*"([^"]+)"/g,
];

test("every elevation in application code is allowlisted and documented at its call site", () => {
  const used = new Map<string, Set<string>>();
  for (const { file, text } of appFiles)
    for (const pattern of usePatterns)
      for (const match of text.matchAll(pattern)) {
        if (!used.has(match[1])) used.set(match[1], new Set());
        used.get(match[1])!.add(file);
      }
  assert.ok(used.size > 0, "the scan found the known elevations");
  for (const [reason, files] of used) {
    const rule = (ELEVATIONS as Record<string, any>)[reason];
    assert.ok(rule, `elevation "${reason}" is not in the allowlist`);
    for (const file of files)
      assert.ok(
        rule.usedBy.includes(file),
        `${file} uses elevation "${reason}" but is not listed in ELEVATIONS["${reason}"].usedBy`,
      );
  }
  for (const [reason, rule] of Object.entries(ELEVATIONS)) {
    assert.ok(rule.purpose.length > 40, `${reason} documents its purpose`);
    assert.ok(rule.usedBy.length > 0, `${reason} is still used somewhere`);
    for (const file of rule.usedBy)
      assert.ok(
        used.get(reason)?.has(file),
        `ELEVATIONS["${reason}"].usedBy lists ${file}, which no longer uses it`,
      );
    // Elevations never act as a follower: a follower's own scope is not an elevation.
    assert.ok(!(rule.roles as readonly string[]).includes("subscriber"));
  }
});

test("application code never switches role or scope settings itself", () => {
  // SQL text starts inside a string literal; `UPDATE memberships SET role=`
  // (a column) is not a role switch.
  const forbidden = [
    /["'`]\s*SET\s+(LOCAL\s+|SESSION\s+)?ROLE\s+(TO\s+)?["A-Za-z_]/i,
    /["'`]\s*RESET\s+ROLE\b/i,
    /SESSION\s+AUTHORIZATION/i,
    /set_config\(\s*'(role|app\.tenant_id|app\.user_id|app\.role|app\.elevation|app\.service_tenant_id)'/i,
  ];
  const offenders = appFiles.flatMap(({ file, text }) =>
    forbidden.filter((re) => re.test(text)).map((re) => `${file}: ${re}`),
  );
  assert.deepEqual(offenders, []);
});

test("no application actor pairs the system user with a team role outside elevated()", () => {
  // A hand-built `{ userId: SYSTEM, role: "owner" }` would be refused at run
  // time (a non-member acting as owner); keep the source free of them too.
  const offenders = appFiles.filter(({ text }) =>
    /userId:\s*(?:"00000000-0000-0000-0000-000000000000"|SYSTEM_\w+)\s*,\s*role:\s*"(?:owner|staff|finance)"/.test(
      text,
    ),
  );
  assert.deepEqual(
    offenders.map((o) => o.file),
    [],
  );
});
