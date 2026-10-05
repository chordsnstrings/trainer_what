// No hard-coded English in converted member components
// (docs/features/arabic.md). Each listed component, or each listed function
// of a file that also holds trainer screens, takes every sentence a member
// reads from the message catalogs (lib/i18n/messages). The check parses the
// source and reports JSX text, labelled attributes (label, placeholder,
// aria-label, title, alt, …), prose string literals ("Two words" or
// more) that are not passed to a translator or used as data, and any string
// or template literal rendered directly as JSX children — one word included
// ({n === 1 ? "set" : "sets"}, {`${reps} reps`}).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Next.js ships Babel's parser; the TypeScript 7 compiler has no JS API.
const { parse } = require("next/dist/compiled/babel/parser") as {
  parse: (source: string, options: object) => { program: Node };
};
type Node = { type: string; [key: string]: any };

/** Whole files (true) or the member functions of a mixed file. */
const MEMBER_SCOPE: Record<string, true | string[]> = {
  "member-shell.tsx": true,
  "pwa-ui.tsx": true,
  "phone-ui.tsx": true,
  "subscriber-footer.tsx": true,
  "public-header.tsx": true,
  "social-sign-in.tsx": true,
  "auth-page.tsx": true,
  "push-notifications.tsx": true,
  "appearance.tsx": true,
  "legal-acceptance.tsx": true,
  "suspended-member-billing.tsx": true,
  "account-settings.tsx": true,
  "account-security.tsx": true,
  "support.tsx": true,
  "programme-today.tsx": true,
  // The member screens rebuilt phone first (docs/features/member-screens.md).
  "member-today.tsx": true,
  "member-today-model.ts": true,
  "member-program.tsx": true,
  "member-chat.tsx": true,
  "member-intake.tsx": true,
  "member-membership.tsx": true,
  "member-context.tsx": true,
  "member-states.tsx": true,
  "programme-membership.tsx": true,
  "voice-session.tsx": true,
  "meal-capture.tsx": true,
  "nutrition.tsx": [
    "useNutrition",
    "NutritionSubscriber",
    "WeekView",
    "ProfileForm",
    "GroceryList",
    "DiaryForm",
    "ClientTargetSummary",
    "NutritionConsumed",
    "NutritionCopyMeal",
    "NutritionSavedMeals",
    "NutritionShopping",
  ],
  "complimentary-access.tsx": ["MemberAccessCard"],
  "finance-completion.tsx": ["BillingHistory"],
  "membership-exit.tsx": ["Blockers", "LeaveTrainer"],
  "joining.tsx": [
    "JoinAccountChoice",
    "joinErrorMessage",
    "AccountJoinForm",
    "InvitationJoin",
    "CoachSwitcher",
  ],
  "public-pages.tsx": [
    "MembershipEnded",
    "LeftCoachNotice",
    "SignInPage",
    "JoinCoachPage",
  ],
  "passkeys.tsx": ["PasskeySettings"],
  "trainer-design.tsx": ["CoachIdentity", "CoachWelcome", "ClientHomeSections"],
  "programme-offers.tsx": ["localTerms", "OfferTerms"],
  "brain-plans.tsx": ["MemberPlan", "PlanIntakeNotice"],
  "coaching-completion.tsx": ["TrainingHoldNotice"],
  "privacy-lifecycle.tsx": ["PersonalPrivacyStatus"],
  "notifications.tsx": ["NotificationInbox"],
  "chat-attachments.tsx": ["ChatAttachmentList", "ChatAttachmentPicker"],
  "account-completion.tsx": ["MagicAccess"],
  "acquisition.tsx": ["ConsentBar", "ConsentSheet", "AnalyticsSetting"],
  "coach-directory.tsx": [
    "CoachCard",
    "CoachDirectory",
    "DirectoryEmpty",
    "CoachDirectoryClosed",
  ],
  "healthkit-sync.tsx": ["HealthKitActivityCard", "HealthKitActivityList"],
};
/** English that is data, not wording: stored values sent to the server. */
const DATA: Record<string, string[]> = {
  // An internal error replaced by the catalog's own message when shown.
  "appearance.tsx": ["not saved"],
  // English names kept for other callers; screens use the catalog.
  "legal-acceptance.tsx": [
    "terms of service",
    "privacy policy",
    "digital coaching disclosure",
  ],
  "meal-capture.tsx": [
    "User-provided estimate",
    "Product label data; verify your exact package and serving unit",
  ],
};
const LABELLED = new Set([
  "label",
  "placeholder",
  "aria-label",
  "title",
  "alt",
  "eyebrow",
  "detail",
  "heading",
  "description",
  "hint",
]);
/** Calls whose string arguments are keys, paths or data, not wording. */
const QUIET =
  /^(t|tr|mt|[a-z]+T|say|common|explain|t\.dynamic|t\.template|mt\.dynamic|api|fetch|request|localStorage\..*|sessionStorage\..*|console\..*|document\..*|window\.location\..*|JSON\..*|Object\..*|.*\.(includes|startsWith|endsWith|replace|replaceAll|split|join|match|test|get|set|has|delete|add|addEventListener|removeEventListener|postMessage|toLocaleDateString|toLocaleString|getItem|setItem|removeItem|querySelector|querySelectorAll|getUserMedia|assign|push)|useState|useT|matchMedia|createElement|Intl\..*|new Intl\..*)$/;

function calleeName(node: Node | undefined): string {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  )
    return `${calleeName(node.object)}.${node.property.name ?? node.property.value ?? ""}`;
  return "";
}
const prose = (s: string) =>
  /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s) && /[a-z]/.test(s);

function findings(source: string, scope: true | string[], data: string[]) {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const out: string[] = [];
  const seen = new Set<string>();
  const report = (node: Node, text: string) => {
    if (!data.includes(text)) out.push(`${node.loc.start.line}: ${text}`);
  };
  type Context = { quiet?: boolean; labelled?: boolean; rendered?: boolean };
  /** Expressions whose value (or a branch of it) is what gets shown. */
  const SHOWN = new Set([
    "StringLiteral",
    "TemplateLiteral",
    "ConditionalExpression",
    "LogicalExpression",
    "BinaryExpression",
    "ParenthesizedExpression",
  ]);
  const visit = (node: Node | null | undefined, ctx: Context): void => {
    if (!node || typeof node.type !== "string") return;
    if (node.type.startsWith("TS") || node.type === "ImportDeclaration") return;
    // Call arguments, object values and array items are data, not the text
    // shown; only literals reached through branches and joins are rendered.
    if (ctx.rendered && !SHOWN.has(node.type))
      ctx = { ...ctx, rendered: false };
    if (ctx.rendered && node.type === "ConditionalExpression") {
      visit(node.test, { ...ctx, rendered: false });
      visit(node.consequent, ctx);
      visit(node.alternate, ctx);
      return;
    }
    if (
      ctx.rendered &&
      node.type === "LogicalExpression" &&
      node.operator === "&&"
    ) {
      visit(node.left, { ...ctx, rendered: false });
      visit(node.right, ctx);
      return;
    }
    switch (node.type) {
      case "JSXText": {
        const text = node.value.replace(/\s+/g, " ").trim();
        if (/[A-Za-z]{2,}/.test(text)) report(node, text);
        return;
      }
      case "JSXExpressionContainer":
        // A child expression's strings are shown as they are.
        visit(node.expression, {
          ...ctx,
          rendered: !ctx.quiet && !ctx.labelled,
        });
        return;
      case "JSXElement":
      case "JSXFragment":
        // Attributes and children of a nested element start afresh.
        for (const key of ["openingElement", "children"]) {
          const value = node[key];
          if (Array.isArray(value))
            value.forEach((v) => visit(v, { ...ctx, rendered: false }));
          else visit(value, { ...ctx, rendered: false });
        }
        return;
      case "JSXAttribute": {
        const name =
          typeof node.name.name === "string"
            ? node.name.name
            : node.name.name.name;
        const value = node.value;
        if (!value) return;
        if (LABELLED.has(name) && value.type === "StringLiteral") {
          if (/[A-Za-z]{2,}/.test(value.value)) report(node, value.value);
          return;
        }
        // Other attributes (className, href, type, …) hold no wording.
        if (LABELLED.has(name)) visit(value, { ...ctx, labelled: true });
        else visit(value, { ...ctx, quiet: true });
        return;
      }
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression": {
        visit(node.callee, ctx);
        const quiet = ctx.quiet || QUIET.test(calleeName(node.callee));
        for (const arg of node.arguments) visit(arg, { ...ctx, quiet });
        return;
      }
      case "BinaryExpression":
        // Comparisons read stored values ("delivered", "photo").
        if (["===", "!==", "==", "!="].includes(node.operator)) return;
        break;
      case "ObjectProperty":
        if (node.computed) visit(node.key, ctx);
        visit(node.value, ctx);
        return;
      case "SwitchCase":
        for (const statement of node.consequent) visit(statement, ctx);
        return;
      case "StringLiteral":
        if (
          !ctx.quiet &&
          (ctx.rendered
            ? /[A-Za-z]{2,}/.test(node.value)
            : ctx.labelled
              ? /[A-Za-z]{2,}\s/.test(node.value)
              : prose(node.value))
        )
          report(node, node.value);
        return;
      case "TemplateLiteral": {
        const text = node.quasis.map((q: Node) => q.value.cooked).join("{}");
        if (
          !ctx.quiet &&
          (ctx.rendered ? /[A-Za-z]{2,}/.test(text) : prose(text))
        )
          report(node, text);
        for (const expression of node.expressions) visit(expression, ctx);
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (
        [
          "loc",
          "start",
          "end",
          "extra",
          "leadingComments",
          "trailingComments",
          "innerComments",
        ].includes(key)
      )
        continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach((v) => visit(v, ctx));
      else if (value && typeof value.type === "string") visit(value, ctx);
    }
  };
  const walk = (node: Node | null | undefined): void => {
    if (!node || typeof node.type !== "string") return;
    const name =
      node.type === "FunctionDeclaration"
        ? node.id?.name
        : node.type === "VariableDeclarator"
          ? node.id?.name
          : undefined;
    if (name && scope !== true && scope.includes(name)) {
      seen.add(name);
      visit(node.type === "VariableDeclarator" ? node.init : node.body, {});
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "loc") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === "string") walk(value);
    }
  };
  if (scope === true) visit(ast.program, {});
  else walk(ast.program);
  const missing = scope === true ? [] : scope.filter((name) => !seen.has(name));
  return { out, missing };
}

test("converted member components take their wording from the catalogs", async () => {
  const problems: string[] = [];
  for (const [file, scope] of Object.entries(MEMBER_SCOPE)) {
    const source = await readFile(
      new URL(`../apps/web/components/${file}`, import.meta.url),
      "utf8",
    );
    const { out, missing } = findings(source, scope, DATA[file] ?? []);
    for (const name of missing) problems.push(`${file}: no function ${name}`);
    for (const line of out) problems.push(`${file}:${line}`);
  }
  assert.deepEqual(problems, [], "hard-coded English in member components");
});

test("the check itself notices English", () => {
  const source = `
    function Screen() {
      const t = useT("nutrition");
      setError("Something broke here");
      return <p title="Plain title" aria-label={t("label")}>Hello there {t("ok")}{n === 1 ? "set" : "sets"}{\`\${reps} reps\`}<span className={big ? "large" : "small"}>{t("x")}</span></p>;
    }
    function Trainer() { return <p>Trainer only</p>; }`;
  const { out, missing } = findings(source, ["Screen"], []);
  assert.deepEqual(missing, []);
  assert.deepEqual(
    out.map((line) => line.replace(/^\d+: /, "")),
    [
      "Something broke here",
      "Plain title",
      "Hello there",
      "set",
      "sets",
      "{} reps",
    ],
  );
});
