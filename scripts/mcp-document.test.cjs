// Run after building apps/server. These use the real document schema/converters.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseMarkdown,
  planEdits,
  readBlocks,
  blockRef,
  documentRevision,
} = require("../apps/server/dist/core/mcp/document-edits");
const {
  DocumentWriteQueue,
} = require("../apps/server/dist/collaboration/document-write-queue");

test("same-position insertion and replacement preserve logical block ownership in either request order", async () => {
  const original = await parseMarkdown("First\n\nSecond\n\nThird");
  const nodes = (await parseMarkdown("New")).content;
  const ops = [
    { type: "insert_after", blockRef: blockRef(original.content[0], 0), nodes },
    {
      type: "replace_block",
      blockRef: blockRef(original.content[1], 1),
      nodes,
    },
  ];
  for (const order of [ops, [...ops].reverse()]) {
    const result = [...original.content];
    for (const edit of planEdits(original, order))
      result.splice(edit.index, edit.remove, ...edit.nodes);
    assert.equal(result.length, 4);
    assert.equal(result[0], original.content[0]);
    assert.equal(result[3], original.content[2]);
    assert.deepEqual(result.slice(1, 3), [...nodes, ...nodes]);
  }
});

test("all edits validate before touching a document and multiple appends keep request order", async () => {
  const original = await parseMarkdown("Original");
  const first = (await parseMarkdown("One")).content;
  const second = (await parseMarkdown("Two")).content;
  const result = [...original.content];
  for (const edit of planEdits(original, [
    { type: "append", nodes: first },
    { type: "append", nodes: second },
  ]))
    result.splice(edit.index, edit.remove, ...edit.nodes);
  assert.deepEqual(result, [...original.content, ...first, ...second]);
  assert.throws(
    () =>
      planEdits(original, [
        { type: "append", nodes: first },
        { type: "replace_block", blockRef: "stale", nodes: second },
      ]),
    /stale/,
  );
  assert.equal(original.content.length, 1);
  assert.throws(() =>
    planEdits(original, [
      {
        type: "replace_block",
        blockRef: blockRef(original.content[0], 0),
        nodes: [{ type: "text", text: "invalid at doc level" }],
      },
    ]),
  );
});

test("content revision ignores independent title edits; oversized blocks have a lossless cursor", async () => {
  const doc = await parseMarkdown("Long ".repeat(1500));
  assert.equal(documentRevision("Before", doc), documentRevision("After", doc));
  let result = "",
    offset = 0,
    charOffset = 0;
  do {
    const part = readBlocks(doc, {
      offset,
      charOffset,
      limit: 2,
      maxChars: 500,
      format: "blocks",
    });
    result += part.blocks.map((b) => b.markdown).join("");
    offset = part.nextOffset;
    charOffset = part.nextCharOffset;
  } while (offset !== null);
  assert.equal(result.trim(), "Long ".repeat(1500).trim());
});

test("failed writes do not block subsequent work and different documents remain independent", async () => {
  const queue = new DocumentWriteQueue();
  let release;
  const held = queue.run(
    "a",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  assert.equal(await queue.run("b", async () => "independent"), "independent");
  release();
  await held;
  await assert.rejects(
    queue.run("a", async () => {
      throw new Error("save failed");
    }),
  );
  assert.equal(await queue.run("a", async () => "recovered"), "recovered");
});
