import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "@tiptap/pm/model";
import { compareHistory } from "../apps/client/src/features/page-history/lib/compare-history";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", attrs: { align: { default: null } } },
    text: { group: "inline" },
    image: { group: "inline", inline: true, attrs: { src: {} } },
  },
  marks: { bold: {}, link: { attrs: { href: {} } } },
});
const doc = (text: string, marks: any[] = [], align: string | null = null) =>
  schema.node("doc", null, [
    schema.node("paragraph", { align }, [schema.text(text, marks)]),
  ]);

test("bold-only and link-target edits are detected despite having no text highlights", () => {
  const plain = doc("same words");
  assert.equal(
    compareHistory(plain, doc("same words", [schema.mark("bold")]))
      .unhighlightedChanges,
    true,
  );
  const oldLink = doc("same words", [
    schema.mark("link", { href: "https://example.org/old" }),
  ]);
  const newLink = doc("same words", [
    schema.mark("link", { href: "https://example.org/new" }),
  ]);
  assert.equal(compareHistory(oldLink, newLink).unhighlightedChanges, true);
});

test("block and image attributes are not mistaken for an unchanged version", () => {
  assert.equal(
    compareHistory(doc("same"), doc("same", [], "center")).unhighlightedChanges,
    true,
  );
  const image = (src: string) =>
    schema.node("doc", null, [
      schema.node("paragraph", null, [schema.node("image", { src })]),
    ]);
  const result = compareHistory(image("old.png"), image("new.png"));
  assert.ok(result.unhighlightedChanges || result.changes.length > 0);
});

test("identical content and ordinary text edits keep their existing behaviour", () => {
  assert.deepEqual(compareHistory(doc("same"), doc("same")), {
    changes: [],
    unhighlightedChanges: false,
  });
  assert.ok(
    compareHistory(doc("same"), doc("same with an addition")).changes.length >
      0,
  );
});
