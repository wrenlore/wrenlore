/*
 * Browser regression for AI result insertion with collaborative editing.
 * Requires a running WrenLore workspace with Ask AI enabled and Playwright
 * (including Chromium and WebKit browsers). No inference request is sent.
 *
 * WRENLORE_URL=http://localhost:3000
 * WRENLORE_TEST_AUTH=/private/test-auth.json
 *   JSON: {"token":"<short-lived authToken>","spaceId":"...","spaceSlug":"..."}
 * PLAYWRIGHT_MODULE=playwright (or a path to playwright-core)
 * Optional: TEST_BROWSERS=webkit,chromium TEST_ACTIONS="Insert below,Replace"
 * Run: node scripts/ai-editor-insert-regression.cjs
 * Creates temporary pages through the API and removes only those pages.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.WRENLORE_URL || "http://localhost:3000";
const auth = JSON.parse(
  fs.readFileSync(process.env.WRENLORE_TEST_AUTH, "utf8"),
);
const browsers = (process.env.TEST_BROWSERS || "webkit,chromium").split(",");
const actions = (process.env.TEST_ACTIONS || "Insert below,Replace").split(",");
const originalText = ["Original first paragraph.", "Original final paragraph."];
const generatedText = [
  "Generated summary",
  "Source repository",
  "console.log(42);",
  "A retained detail",
];
const markdown =
  "## Generated summary\n\n[Source repository](https://github.com/wrenlore/wrenlore)\n\n```js\nconsole.log(42);\n```\n\n| Feature | Status |\n| --- | --- |\n| Insertion | Verified |\n\n- A retained detail";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function texts(node) {
  return [node?.text || "", ...(node?.content || []).map(texts)].join(" ");
}
function checkContent(doc) {
  const text = texts(doc);
  for (const expected of [...originalText, ...generatedText]) {
    assert.ok(text.includes(expected), `Missing document text: ${expected}`);
  }
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.content || []) walk(child);
  };
  walk(doc);
  assert.ok(
    nodes.some((node) => node.type === "codeBlock"),
    "Code block structure lost",
  );
  assert.ok(
    nodes.some((node) => node.type === "table"),
    "Table structure lost",
  );
  assert.ok(
    nodes.some((node) =>
      node.marks?.some(
        (mark) =>
          mark.type === "link" &&
          mark.attrs.href === "https://github.com/wrenlore/wrenlore",
      ),
    ),
    "Link lost",
  );
}
async function post(context, path, data) {
  const response = await context.request.post(`${base}/api/${path}`, { data });
  assert.ok(response.ok(), `${path}: HTTP ${response.status()}`);
  const json = await response.json();
  return json.data ?? json;
}
async function contextFor(browser) {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1100 },
  });
  await context.addCookies([
    { name: "authToken", value: auth.token, url: base, httpOnly: true },
  ]);
  return context;
}
(async () => {
  for (const browserName of browsers) {
    const browser = await playwright[browserName].launch({ headless: true });
    const context = await contextFor(browser);
    const createdIds = [];
    try {
      for (const action of actions) {
        const doc = await post(context, "pages/create", {
          spaceId: auth.spaceId,
          title: `Temporary AI insertion regression: ${browserName} ${action}`,
          content: `<p>${originalText[0]}</p><p></p><p>${originalText[1]}</p>`,
          format: "html",
        });
        createdIds.push(doc.id);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/api/wren-ai/generate/stream", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `data: ${JSON.stringify({ content: markdown })}\n\ndata: [DONE]\n\n`,
          }),
        );
        const url = `${base}/s/${auth.spaceSlug}/p/${doc.slugId}`;
        await page.goto(url);
        const editor = page.locator(
          ".editor-container .tiptap[contenteditable=true]",
        );
        await editor.waitFor();
        // Allow the initial collaboration handshake and editor replacement to settle.
        await page.waitForFunction(() => {
          const editor = document.querySelector(
            ".editor-container .tiptap",
          )?.editor;
          return (
            editor?.getText().includes("Original final paragraph.") &&
            editor?.schema.marks.link
          );
        });
        await page.waitForTimeout(1000);
        await editor.locator("p").nth(1).click();
        await page.keyboard.type("/ai");
        await page
          .getByText("Ask AI", { exact: true })
          .filter({ visible: true })
          .click();
        await page
          .getByPlaceholder("Ask AI...")
          .fill("Summarize https://example.com/article");
        await page.getByPlaceholder("Ask AI...").press("Enter");
        // The AI menu owns focus, not the formatting toolbar.
        assert.equal(
          await page
            .getByRole("button", { name: "Ask AI", exact: true })
            .isVisible(),
          false,
        );
        await page.getByRole("menuitem", { name: action, exact: true }).click();
        await page.waitForTimeout(500);
        checkContent(
          await editor.evaluate((element) => element.editor.getJSON()),
        );
        assert.equal(await page.getByPlaceholder("Ask AI...").count(), 0);
        assert.deepEqual(errors, []);
        // Wait for the server's debounced save, rather than trusting IndexedDB.
        let saved = false;
        for (let attempt = 0; attempt < 55; attempt++) {
          const stored = await post(context, "pages/info", { pageId: doc.id });
          try {
            checkContent(stored.content);
            saved = true;
            break;
          } catch {
            await delay(1000);
          }
        }
        assert.ok(saved, "Inserted content was not persisted by the server");
        await page.close();
        const fresh = await contextFor(browser);
        try {
          const reopened = await fresh.newPage();
          reopened.on("pageerror", (error) => errors.push(error.message));
          await reopened.goto(url);
          const freshEditor = reopened.locator(
            ".editor-container .tiptap[contenteditable=true]",
          );
          await freshEditor.waitFor();
          await reopened.waitForTimeout(1000);
          checkContent(
            await freshEditor.evaluate((element) => element.editor.getJSON()),
          );
          assert.deepEqual(errors, []);
        } finally {
          await fresh.close();
        }
        console.log(
          `PASS ${browserName}: ${action}; document model, server save, fresh browser reload`,
        );
      }
    } finally {
      // These IDs were all created by this run, never existing user pages.
      try {
        for (const pageId of createdIds) {
          const response = await context.request.post(
            `${base}/api/pages/delete`,
            { data: { pageId, permanentlyDelete: true } },
          );
          assert.ok(
            response.ok(),
            `Could not clean up temporary page ${pageId}`,
          );
        }
      } finally {
        await browser.close();
      }
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
