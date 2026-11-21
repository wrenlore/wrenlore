/*
 * Browser regression for AI result insertion with collaborative editing and
 * for streaming preview auto-follow behaviour. Requires a running WrenLore
 * workspace with Ask AI enabled and Playwright (including Chromium and
 * WebKit browsers). No inference request is sent: generation is served by a
 * local paced SSE fixture.
 *
 * WRENLORE_URL=http://localhost:3000
 * WRENLORE_TEST_AUTH=/private/test-auth.json
 *   JSON: {"token":"<short-lived authToken>","spaceId":"...","spaceSlug":"..."}
 * PLAYWRIGHT_MODULE=playwright (or a path to playwright-core)
 * Optional: TEST_BROWSERS=webkit,chromium TEST_ACTIONS="Insert below,Replace"
 *           SKIP_PREVIEW=1 to omit the streaming preview phase
 * Run: node scripts/ai-editor-insert-regression.cjs
 * Creates temporary pages through the API and removes only those pages.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.WRENLORE_URL || "http://localhost:3000";
const auth = JSON.parse(
  fs.readFileSync(process.env.WRENLORE_TEST_AUTH, "utf8"),
);
const browsers = (process.env.TEST_BROWSERS || "webkit,chromium").split(",");
const actions = (process.env.TEST_ACTIONS || "Insert below,Replace")
  .split(",")
  .filter(Boolean);
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

/*
 * Streaming preview fixture: deterministic Markdown, emitted as paced SSE
 * frames by a local server, long enough to overflow the 300px preview
 * several times over.
 */
const previewMarker = "Streaming preview fixture";
const filler =
  "Streaming words keep arriving here and the preview must keep tracking the bottom without any mouse or keyboard interaction from the user. ";
const previewMarkdown = [
  `# ${previewMarker}`,
  `This paragraph exists so the preview overflows its viewport and follow scrolling can be measured. ${filler}${filler}`,
  `A second paragraph carries a [fixture link](https://example.com/fixture) plus filler text that extends the rendered height well beyond three hundred pixels of preview. ${filler}`,
  "## Section two",
  "```js",
  "function followBottom(el) {",
  "  return el.scrollHeight - el.scrollTop - el.clientHeight <= 32;",
  "}",
  "```",
  "| Marker | Expected |",
  "| --- | --- |",
  "| Follow | bottom tracked |",
  "| Pause | stays put |",
  "| Resume | bottom tracked |",
  "## Section three",
  `- First streamed list item. ${filler}`,
  `- Second streamed list item. ${filler}`,
  `- Third streamed list item. ${filler}`,
  "## Section four",
  `A fourth block keeps the stream long enough to test pausing mid-stream. ${filler}${filler}`,
  "Final streamed sentence: the last chunk must remain visible when following.",
].join("\n\n");
const PREVIEW_CHUNK_SIZE = 25;
const PREVIEW_PACE_MS = 70;

function buildStreamFrames() {
  const frames = [
    `data: ${JSON.stringify({
      status: "fetching_source",
      url: "https://example.com/article",
    })}\n\n`,
    `data: ${JSON.stringify({
      status: "source_fetched",
      url: "https://example.com/article",
    })}\n\n`,
  ];
  for (let i = 0; i < previewMarkdown.length; i += PREVIEW_CHUNK_SIZE) {
    frames.push(
      `data: ${JSON.stringify({
        content: previewMarkdown.slice(i, i + PREVIEW_CHUNK_SIZE),
      })}\n\n`,
    );
  }
  frames.push("data: [DONE]\n\n");
  return frames;
}

function startStreamServer() {
  const state = { requests: 0, completed: 0 };
  const server = http.createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin || base,
      "access-control-allow-credentials": "true",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return;
    }
    state.requests += 1;
    res.writeHead(200, {
      ...cors,
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    });
    const frames = buildStreamFrames();
    let index = 0;
    let stopped = false;
    let timer;
    req.resume();
    res.on("close", () => {
      stopped = true;
      clearTimeout(timer);
    });
    const tick = () => {
      if (stopped) return;
      if (index >= frames.length) {
        state.completed += 1;
        res.end();
        return;
      }
      res.write(frames[index++]);
      timer = setTimeout(tick, PREVIEW_PACE_MS);
    };
    timer = setTimeout(tick, 150);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        state,
        url: `http://127.0.0.1:${server.address().port}/stream`,
      }),
    );
  });
}

// In-page helper source: locate the preview viewport via the streamed text.
const FIND_PREVIEW = `
  [...document.querySelectorAll(".mantine-ScrollArea-viewport")].find((el) =>
    el.textContent.includes(${JSON.stringify(previewMarker)}),
  )
`;

async function previewState(page) {
  return page.evaluate(
    `(() => {
      const viewport = ${FIND_PREVIEW};
      if (!viewport) return null;
      const active = document.activeElement;
      return {
        length: viewport.textContent.length,
        distance:
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
        overflow: viewport.scrollHeight - viewport.clientHeight,
        pageScrollY: window.scrollY,
        activeIsViewport: active === viewport,
        activeIsEditor: !!(active && active.classList && active.classList.contains("tiptap")),
      };
    })()`,
  );
}

async function openAiMenu(page) {
  const editor = page.locator(
    ".editor-container .tiptap[contenteditable=true]",
  );
  await editor.waitFor();
  await page.waitForFunction(() => {
    const editor = document.querySelector(".editor-container .tiptap")?.editor;
    return (
      editor?.getText().includes("Original first paragraph.") &&
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
}

async function waitForPreviewCompletion(page, stream, expectedCompletions) {
  await page
    .getByRole("menuitem", { name: "Try again", exact: true })
    .waitFor({ timeout: 20000 });
  await page.waitForFunction(
    `(() => { const v = ${FIND_PREVIEW}; return v?.textContent.includes("Final streamed sentence: the last chunk must remain visible when following."); })()`,
    null,
    { timeout: 20000 },
  );
  const deadline = Date.now() + 5000;
  while (
    stream.state.completed < expectedCompletions &&
    Date.now() < deadline
  ) {
    await delay(100);
  }
  assert.equal(
    stream.state.completed,
    expectedCompletions,
    "fixture stream did not finish",
  );
}

async function runPreviewTest(context, stream, browserName) {
  const completedBefore = stream.state.completed;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/wren-ai/generate/stream", (route) =>
    route.continue({ url: stream.url }),
  );
  const doc = await post(context, "pages/create", {
    spaceId: auth.spaceId,
    title: `Temporary AI preview regression: ${browserName}`,
    content: `<p>${originalText[0]}</p><p></p><p>${originalText[1]}</p>`,
    format: "html",
  });
  try {
    await page.goto(`${base}/s/${auth.spaceSlug}/p/${doc.slugId}`);
    await openAiMenu(page);

    // 1. Text grows and the preview follows with no user interaction.
    await page.waitForFunction(
      `(() => { const v = ${FIND_PREVIEW}; return !!v && v.textContent.length > 50; })()`,
      null,
      { timeout: 20000 },
    );
    const samples = [];
    let overflowSamples = 0;
    for (let i = 0; i < 25; i++) {
      const sample = await previewState(page);
      assert.ok(sample, "preview viewport disappeared");
      samples.push(sample);
      if (sample.overflow > 60) overflowSamples += 1;
      if (overflowSamples >= 3 && samples.length >= 6) break;
      await delay(200);
    }
    for (let i = 1; i < samples.length; i++) {
      assert.ok(
        samples[i].length >= samples[i - 1].length,
        "streamed text rendering stalled without user interaction",
      );
    }
    assert.ok(
      samples[samples.length - 1].length > samples[0].length,
      "streamed text did not grow",
    );
    const overflowing = samples.filter((s) => s.overflow > 60);
    assert.ok(
      overflowing.length >= 3,
      "preview never overflowed its viewport during the stream",
    );
    for (const sample of overflowing) {
      assert.ok(
        sample.distance <= 40,
        `preview did not follow the bottom (distance ${sample.distance})`,
      );
    }
    assert.equal(
      new Set(samples.map((s) => s.pageScrollY)).size,
      1,
      "document scrolled while the preview followed the stream",
    );
    assert.ok(
      samples.every((s) => !s.activeIsViewport && !s.activeIsEditor),
      "preview stole input focus",
    );

    // 2. Scrolling upward stays put while subsequent chunks arrive.
    const pinned = await page.evaluate(
      `(() => { const v = ${FIND_PREVIEW}; v.scrollTop = 0; return { top: v.scrollTop, height: v.scrollHeight }; })()`,
    );
    let grewWhilePaused = false;
    for (let attempt = 0; attempt < 12 && !grewWhilePaused; attempt++) {
      await delay(200);
      const now = await page.evaluate(
        `(() => { const v = ${FIND_PREVIEW}; return { top: v.scrollTop, height: v.scrollHeight }; })()`,
      );
      assert.ok(
        Math.abs(now.top - pinned.top) <= 2,
        `preview jumped while scrolled up (top ${pinned.top} -> ${now.top})`,
      );
      grewWhilePaused = now.height > pinned.height + 20;
    }
    assert.ok(
      grewWhilePaused,
      "stream stopped while the user was paused at the top",
    );

    // 3. Scrolling back to the bottom resumes following.
    await page.evaluate(
      `(() => { const v = ${FIND_PREVIEW}; v.scrollTop = v.scrollHeight; })()`,
    );
    await delay(400);
    const resumed = await previewState(page);
    assert.ok(
      resumed.distance <= 40,
      `following did not resume at the bottom (distance ${resumed.distance})`,
    );

    // 4a. Completion keeps the final chunk visible.
    await waitForPreviewCompletion(page, stream, completedBefore + 1);
    const done = await previewState(page);
    assert.ok(
      done.distance <= 40,
      `final chunk not visible after completion (distance ${done.distance})`,
    );

    // 4b. A second generation resets follow mode even if paused at the top.
    await page.evaluate(
      `(() => { const v = ${FIND_PREVIEW}; v.scrollTop = 0; })()`,
    );
    await page
      .getByRole("menuitem", { name: "Try again", exact: true })
      .click();
    await page.waitForFunction(
      `(() => { const v = ${FIND_PREVIEW}; return !!v && v.scrollHeight - v.clientHeight > 60 && v.textContent.length > 900; })()`,
      null,
      { timeout: 20000 },
    );
    const second = await previewState(page);
    assert.ok(
      second.distance <= 40,
      `second generation did not reset follow mode (distance ${second.distance})`,
    );
    await waitForPreviewCompletion(page, stream, completedBefore + 2);
    const done2 = await previewState(page);
    assert.ok(
      done2.distance <= 40,
      `final chunk of the second generation not visible (distance ${done2.distance})`,
    );

    assert.deepEqual(errors, []);
    console.log(
      `PASS ${browserName}: streaming preview follow/pause/resume, completion, second generation`,
    );
  } finally {
    await page.close();
    const response = await context.request.post(`${base}/api/pages/delete`, {
      data: { pageId: doc.id, permanentlyDelete: true },
    });
    assert.ok(response.ok(), `Could not clean up temporary page ${doc.id}`);
  }
}

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
async function runBrowsers(stream) {
  for (const browserName of browsers) {
    const browser = await playwright[browserName].launch({ headless: true });
    const context = await contextFor(browser);
    const createdIds = [];
    try {
      if (stream) {
        await runPreviewTest(context, stream, browserName);
      }
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
          const stored = await post(context, "pages/info", {
            pageId: doc.id,
          });
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
}

(async () => {
  const stream = process.env.SKIP_PREVIEW ? null : await startStreamServer();
  try {
    await runBrowsers(stream);
  } finally {
    if (stream) {
      stream.server.closeAllConnections();
      await new Promise((resolve, reject) => {
        stream.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
