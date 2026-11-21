const assert = require("node:assert/strict");

const paragraph = (text) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

// Original synthetic content: an empty paragraph beyond the previous document's
// size reproduces the placeholder crash with the full editor configuration.
function renderingContent(version) {
  if (version === 1) {
    return { type: "doc", content: [paragraph("Initial snapshot")] };
  }
  if (version === 3) {
    return {
      type: "doc",
      content: [paragraph("Short snapshot"), paragraph()],
    };
  }
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Long snapshot" }],
      },
      ...Array.from({ length: 25 }, (_, i) =>
        paragraph(`Section ${i}: synthetic reference material.`),
      ),
      {
        type: "codeBlock",
        attrs: { language: "bash" },
        content: [{ type: "text", text: 'printf "example\\n"' }],
      },
      {
        type: "blockquote",
        content: [paragraph("Quoted material"), paragraph()],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [paragraph("Table entry"), paragraph()],
              },
              { type: "tableCell", content: [paragraph()] },
            ],
          },
        ],
      },
      paragraph(),
    ],
  };
}

async function checkRendering(page, base, browserName, errors) {
  for (const [width, height] of [
    [1280, 720],
    [900, 450],
    [420, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base);
    await page
      .getByRole("button", { name: "Open history", exact: true })
      .click();
    const editor = page.locator(".tiptap");
    await editor.getByText("Short snapshot", { exact: true }).waitFor();

    // Exercise growth, shrinkage, and loading a version without a predecessor.
    for (const version of [2, 1, 3, 2, 3]) {
      const label = new RegExp(`10:0${version}AM`);
      if (width <= 800) {
        await page.getByPlaceholder("Select version").click();
        await page.getByRole("option", { name: label }).click();
      } else {
        await page.getByRole("button", { name: label }).click();
      }
      const marker =
        version === 1
          ? "Initial snapshot"
          : version === 2
            ? "Long snapshot"
            : "Short snapshot";
      await editor.getByText(marker, { exact: true }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 1);
      assert.equal(await editor.getAttribute("contenteditable"), "false");
      assert.equal(await editor.locator("[data-placeholder]").count(), 0);
      if (version !== 1) {
        await page.getByLabel("Highlight changes", { exact: true }).uncheck();
        await page.getByLabel("Highlight changes", { exact: true }).check();
        await editor.getByText(marker, { exact: true }).waitFor();
      }
    }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Open history", exact: true })
      .click();
    await editor.getByText("Short snapshot", { exact: true }).waitFor();
    assert.deepEqual(
      errors,
      [],
      `${browserName}: snapshot rendering must not throw`,
    );
  }
  console.log(
    `PASS ${browserName}: full editor, empty paragraphs, nested blocks, snapshot switching, highlight toggle, reopen, desktop/short/mobile`,
  );
}

module.exports = { renderingContent, checkRendering };
