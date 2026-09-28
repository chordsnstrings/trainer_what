import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareStep } from "../apps/web/components/onboarding.tsx";

test("the share step shows the workspace's tagged links before the channel choice", () => {
  const html = renderToStaticMarkup(
    createElement(
      ShareStep,
      {
        storefrontPath: "/coach/alex-morgan",
        busy: false,
        saved: ["instagram_bio"],
        onSave: () => {},
      },
      createElement("section", { id: "tagged-links" }, "Instagram bio link"),
    ),
  );
  assert.match(html, /\/coach\/alex-morgan/);
  const links = html.indexOf('id="tagged-links"');
  assert.ok(links > 0, "The tagged links promised by the copy must render");
  assert.ok(
    links < html.indexOf("Where did you share your link?"),
    "Links come before recording where they were shared",
  );
});
