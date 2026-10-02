import test from "node:test";
import assert from "node:assert/strict";
import {
  createTemplate,
  createModule,
  siteBuilderSchema,
} from "@trainer/contracts";
import {
  createEditorElement,
  createEditorSaveQueue,
  applyEditorStarter,
  editHistory,
  undoHistory,
  redoHistory,
  moveEditorItem,
  moveEditorElement,
  findEditorElement,
  editorSlug,
} from "../apps/web/components/site-builder-editor-model.ts";

test("typing groups undo together, structural changes stay distinct, and a new edit clears redo", () => {
  const initial = {
    past: [] as string[],
    present: "Original",
    future: [] as string[],
  };
  const first = editHistory(initial, "First character", "title", 1000);
  const typed = editHistory(first, "Second character", "title", 1200);
  const moved = editHistory(typed, "Section moved", undefined, 1300);
  assert.deepEqual(moved.past, ["Original", "Second character"]);
  assert.equal(undoHistory(moved).present, "Second character");
  assert.equal(undoHistory(undoHistory(moved)).present, "Original");
  assert.equal(redoHistory(undoHistory(moved)).present, "Section moved");
  assert.equal(
    editHistory(undoHistory(moved), "Different edit").future.length,
    0,
  );
});

test("drop boundaries reorder without off-by-one or content loss", () => {
  const items = ["a", "b", "c"].map((id) => ({ id }));
  assert.deepEqual(
    moveEditorItem(items, "a", 3).map((x) => x.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    moveEditorItem(items, "c", 0).map((x) => x.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(moveEditorItem(items, "b", 2), items);
  assert.deepEqual(
    items.map((x) => x.id),
    ["a", "b", "c"],
  );
});

test("nested drag supports cross-column movement and refuses cycles or depth overflow", () => {
  const left = createEditorElement("columns"),
    right = createEditorElement("columns"),
    heading = createEditorElement("heading");
  left.children = [heading];
  const original = [left, right];
  const moved = moveEditorElement(original, heading.id, right.id, 0)!;
  assert.equal(findEditorElement(moved, left.id)!.children.length, 0);
  assert.equal(findEditorElement(moved, right.id)!.children[0].id, heading.id);
  assert.equal(original[0].children[0].id, heading.id);
  assert.equal(moveEditorElement(original, left.id, heading.id, 0), null);
  assert.equal(moveEditorElement(original, left.id, left.id, 0), null);
  const root = createEditorElement("columns"),
    child = createEditorElement("columns"),
    grandchild = createEditorElement("columns"),
    last = createEditorElement("columns");
  root.children = [child];
  child.children = [grandchild];
  grandchild.children = [last];
  assert.equal(
    moveEditorElement([root, heading], heading.id, last.id, 0),
    null,
  );
});

test("autosave, manual save and publish-save use successive versions even when all wait on the same request", async () => {
  const queue = createEditorSaveQueue();
  let version = 1,
    simultaneous = 0,
    peak = 0;
  const versions: number[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = (hold = false) =>
    queue(async () => {
      simultaneous++;
      peak = Math.max(peak, simultaneous);
      const expectedVersion = version;
      versions.push(expectedVersion);
      if (hold) await held;
      await Promise.resolve();
      assert.equal(
        version,
        expectedVersion,
        "a concurrent request must not advance this save's version",
      );
      version++;
      simultaneous--;
      return version;
    });
  const autosave = save(true),
    shortcut = save(),
    publishSave = save();
  release();
  assert.deepEqual(
    await Promise.all([autosave, shortcut, publishSave]),
    [2, 3, 4],
  );
  assert.deepEqual(versions, [1, 2, 3]);
  assert.equal(peak, 1);
  await assert.rejects(
    queue(async () => {
      throw new Error("network error");
    }),
  );
  assert.equal(await queue(async () => "recovered"), "recovered");
});

test("new page addresses are unique, bounded, and begin with a letter", () => {
  assert.equal(
    editorSlug("My Method", ["my-method", "my-method-2"]),
    "my-method-3",
  );
  assert.equal(editorSlug("123 Challenge", []), "page-123-challenge");
  assert.equal(editorSlug("أسلوبي", []), "page");
  assert.ok(editorSlug("Very long title ".repeat(30), []).length <= 60);
});

test("applying a starter preserves reusable sections and repairs their page references", () => {
  const current = createTemplate("editorial"),
    proposal = createTemplate("blank");
  const saved = createModule("call-to-action");
  saved.content.actions = [
    {
      kind: "page",
      pageId: current.pages.at(-1)!.id,
      label: "Find out more",
      newTab: false,
    },
  ];
  current.savedSections = [
    { id: "saved_section", name: "My reusable design", section: saved },
  ];
  const next = applyEditorStarter(current, proposal);
  assert.equal(next.savedSections.length, 1);
  assert.equal(next.savedSections[0].name, "My reusable design");
  assert.equal(
    next.savedSections[0].section.content.actions[0].pageId,
    next.pages[0].id,
  );
  assert.ok(siteBuilderSchema.safeParse(next).success);
  assert.equal(
    current.savedSections[0].section.content.actions[0].pageId,
    current.pages.at(-1)!.id,
  );
});
