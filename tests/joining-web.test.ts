import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CoachSwitcher,
  FollowerInvitations,
  InvitationJoin,
} from "../apps/web/components/joining.tsx";
import {
  AdminComplimentaryAccess,
  ComplimentaryAccessManager,
  MemberAccessCard,
} from "../apps/web/components/complimentary-access.tsx";

// Server rendering covers the first paint only; data loads in effects.
const html = (type: any, props: any) =>
  renderToStaticMarkup(createElement(type, props));

test("joining components render their first state for each audience", () => {
  assert.match(
    html(InvitationJoin, {
      token: "t".repeat(40),
      onAuthenticated: async () => {},
    }),
    /Checking your invitation/,
  );
  assert.match(
    html(FollowerInvitations, { role: "staff" }),
    /The workspace owner invites new followers/,
  );
  const owner = html(FollowerInvitations, { role: "owner" });
  assert.match(owner, /Create invitation/);
  assert.match(owner, /Email the invitation link/);
  assert.match(
    owner,
    /<label class="field"><span id="[^"]+">Email address<\/span>/,
  );
  assert.match(owner, /type="email"[^>]*aria-labelledby="[^"]+"/);
  assert.equal(html(ComplimentaryAccessManager, { role: "subscriber" }), "");
  assert.match(
    html(ComplimentaryAccessManager, { role: "owner" }),
    /Complimentary access/,
  );
  assert.equal(html(MemberAccessCard, {}), "");
  assert.equal(
    html(CoachSwitcher, { current: "a", userId: "b" }),
    "",
    "Hidden until the account has more than one coach",
  );
  assert.equal(html(AdminComplimentaryAccess, { platformRole: "none" }), "");
  assert.match(
    html(AdminComplimentaryAccess, { platformRole: "admin" }),
    /Complimentary access/,
  );
});

test("joining styles use logical properties for a later right-to-left pass", async () => {
  const css = await readFile(
    new URL("../apps/web/app/joining.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    css,
    /(margin|padding|border)-(left|right)|text-align:\s*(left|right)|(^|[\s;{])(left|right):/m,
  );
  const layout = await readFile(
    new URL("../apps/web/app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /import "\.\/joining\.css";/);
});

test("the coach switcher replays device queues before leaving, like the sidebar switcher", async () => {
  const source = await readFile(
    new URL("../apps/web/components/joining.tsx", import.meta.url),
    "utf8",
  );
  const switcher = source.slice(
    source.indexOf("export function CoachSwitcher"),
  );
  assert.ok(
    switcher.indexOf("leaveSession(") > 0 &&
      switcher.indexOf("leaveSession(") < switcher.indexOf('"/auth/workspace"'),
  );
});
