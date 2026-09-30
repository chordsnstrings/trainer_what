import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SETUP_HREF,
  moreGroups,
  sectionFor,
  trainerSections,
  trainerTitle,
} from "../apps/web/components/workspace-nav.tsx";
import { hubTab } from "../apps/web/components/workspace-clients.tsx";

// The trainer's daily workspace (docs/features/trainer-workspace.md).
const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

test("four sections, with More grouped into Business, My page and Account", () => {
  assert.deepEqual(
    trainerSections("owner").map((s) => s.label),
    ["Inbox", "Clients", "My Brain", "More"],
  );
  assert.deepEqual(
    moreGroups("owner").map((g) => g.title),
    ["Business", "My page", "Account"],
  );
  const hrefs = (role: string) =>
    moreGroups(role).flatMap((g) => g.links.map((l) => l.href));
  // Coaches on the team do not manage the owner's money, page or team.
  for (const href of ["/trainer/finance", "/trainer/design", "/trainer/team"])
    assert.equal(hrefs("staff").includes(href), false, href);
  assert.ok(hrefs("staff").includes("/trainer/settings"));
  // Finance helpers see money and their own account only.
  assert.deepEqual(
    hrefs("finance").sort(),
    [
      "/trainer/analytics",
      "/trainer/finance",
      "/trainer/notifications",
      "/trainer/settings",
      "/trainer/settings#privacy",
    ].sort(),
  );
  assert.equal(SETUP_HREF, "/setup");
});

test("every older address still belongs to one section", () => {
  const cases: [string, string][] = [
    ["/trainer", "inbox"],
    ["/trainer/messages", "inbox"],
    ["/trainer/messages/abc", "inbox"],
    ["/trainer/exceptions", "inbox"],
    ["/trainer/subscribers", "clients"],
    ["/trainer/subscribers/abc/plan", "clients"],
    ["/trainer/programs", "clients"],
    ["/trainer/nutrition/clients/abc", "clients"],
    ["/trainer/brain", "brain"],
    ["/trainer/brain/plans", "brain"],
    ["/trainer/finance", "more"],
    ["/trainer/settings", "more"],
    ["/trainer/more", "more"],
  ];
  for (const [path, section] of cases)
    assert.equal(sectionFor(path), section, path);
  assert.equal(trainerTitle("/trainer", "owner"), "Inbox");
  assert.equal(trainerTitle("/trainer/exceptions", "owner"), "Needs you");
  assert.equal(trainerTitle("/trainer/domains", "owner"), "Web address");
  assert.equal(hubTab("/trainer/subscribers/abc"), "message");
  assert.equal(hubTab("/trainer/subscribers/abc/notes"), "notes");
  assert.equal(hubTab("/trainer/subscribers/abc/unknown"), "message");
});

test("the shell routes the inbox, chats, client hub and More", async () => {
  const shell = await source("apps/web/components/workspace.tsx");
  assert.match(shell, /<Inbox state=\{view\} \/>/);
  assert.match(shell, /path === "\/trainer\/messages" \? \(\s*<Chats \/>/);
  assert.match(shell, /<ChatThread state=\{view\} clientId=/);
  assert.match(shell, /\(plan\|notes\|membership\)/);
  assert.match(shell, /<TrainerMore/);
  assert.match(shell, /<TrainerTabBar/);
  // The old 21-item menu is gone.
  assert.doesNotMatch(shell, /\["Exceptions", "\/trainer\/exceptions"/);
  const css = await source("apps/web/app/trainer-workspace.css");
  assert.doesNotMatch(
    css,
    /(^|[\s;{])(margin|padding)-(left|right|top|bottom)\s*:/m,
  );
  assert.match(
    await source("apps/web/app/layout.tsx"),
    /import "\.\/trainer-workspace\.css";/,
  );
});

test("coach screens use plain words and never name the model or its vendor", async () => {
  const files = [
    "apps/web/components/workspace.tsx",
    "apps/web/components/workspace-brain.tsx",
    "apps/web/components/workspace-home.tsx",
    "apps/web/components/workspace-messages.tsx",
    "apps/web/components/workspace-clients.tsx",
    "apps/web/components/workspace-inbox.tsx",
    "apps/web/components/workspace-nav.tsx",
    "apps/web/components/coaching-studio.tsx",
    "apps/web/components/brain-plans.tsx",
    "apps/web/components/client-twin.tsx",
    "apps/web/components/training-workspace.tsx",
  ];
  const jargon = [
    /"Constitution"/,
    /Scenario lab/,
    /Independent checks/,
    /Readiness & releases/,
    /CLIENT TWIN/,
    /storefront/i,
    /Qualified automatic coaching/,
    /Return to qualified digital coaching/,
    /Start shadow mode/,
    /Confidence threshold/,
    /The attention list/,
    /Publish supervised release/,
  ];
  for (const file of files) {
    const text = await source(file);
    for (const word of jargon) assert.doesNotMatch(text, word, `${file}: ${word}`);
  }
  // Advanced plan settings are collapsed, with the defaults.
  assert.match(
    await source("apps/web/components/brain-plans.tsx"),
    /<details className="advanced-settings">\s*<summary>Advanced<\/summary>/,
  );
  // Coach-facing screens never show the model id or provider name.
  assert.doesNotMatch(
    await source("apps/web/components/coaching-studio.tsx"),
    /\{data\.modelPin\.model \?\?/,
  );
  assert.doesNotMatch(
    await source("apps/web/components/finance-completion.tsx"),
    /\{r\.provider\} \/ \{r\.model/,
  );
});
