import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OIDC_REDIRECT_CODES } from "../apps/api/src/oidc-sign-in.ts";
import { signInErrorMessage } from "../apps/web/components/account-request.ts";
import { AccountSettings } from "../apps/web/components/account-settings.tsx";
import {
  EmailChangeConfirm,
  RecoveryLinkReset,
} from "../apps/web/components/account-links.tsx";
import { SocialSignInVerify } from "../apps/web/components/social-sign-in.tsx";
import { FollowerRemoval } from "../apps/web/components/membership-exit.tsx";

test("account styles use logical properties so a right-to-left pass needs no changes", async () => {
  const css = await readFile(
    new URL("../apps/web/app/account-settings.css", import.meta.url),
    "utf8",
  );
  // Media-query conditions are not layout widths; everything else must not
  // use physical sides or a fixed width that overflows a 390px screen.
  assert.doesNotMatch(
    css.replace(/@media[^{]*/g, ""),
    /(margin|padding|border)-(left|right)|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)|(min-|max-)?width\s*:\s*\d{3,}px/m,
  );
  const layout = await readFile(new URL("../apps/web/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /account-settings\.css/);
});

test("every sign-in outcome the API can report has wording for the member", () => {
  const generic = signInErrorMessage("SOMETHING_UNKNOWN");
  for (const code of OIDC_REDIRECT_CODES) {
    const message = signInErrorMessage(code);
    assert.ok(message.length > 10, code);
    if (!["OIDC_UNAVAILABLE", "OIDC_TOKEN_INVALID", "OIDC_TOKEN_REJECTED"].includes(code))
      assert.notEqual(message, generic, code);
  }
  assert.equal(signInErrorMessage(null), "");
});

test("link pages wait for an explicit action and initial states are labelled", () => {
  const confirm = renderToStaticMarkup(createElement(EmailChangeConfirm, { token: "t".repeat(40) }));
  assert.match(confirm, /<button[^>]*type="button"[^>]*>Confirm new email<\/button>/);
  assert.match(confirm, /href="\/login"/);
  const recovery = renderToStaticMarkup(createElement(RecoveryLinkReset, { token: "t".repeat(40) }));
  assert.match(recovery, /Account recovery/);
  assert.doesNotMatch(recovery, /<form/, "no form before the link is checked");
  assert.match(renderToStaticMarkup(createElement(SocialSignInVerify)), /Checking your sign-in/);
  assert.match(
    renderToStaticMarkup(createElement(AccountSettings, { returnTo: "/trainer/settings" })),
    /aria-busy="true"/,
  );
  const removal = renderToStaticMarkup(
    createElement(FollowerRemoval, { userId: "00000000-0000-4000-8000-000000000000", name: "Sam" }),
  );
  assert.match(removal, /aria-expanded="false"/);
  assert.match(removal, /End Sam’s membership/);
});
