/* Browser regression using real history components, synthetic API and basic editor schema. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const os = require("node:os");
const repo = path.resolve(__dirname, "..");
const req = createRequire(path.join(repo, "apps/client/package.json"));
async function main() {
  const { createServer } = await import(pathToFileURL(req.resolve("vite")));
  const { default: react } = await import(
    pathToFileURL(req.resolve("@vitejs/plugin-react"))
  );
  const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const root = path.join(__dirname, "history-ui");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "wrenlore-history-ui-"),
  );
  let reads = 0,
    versions = 2,
    pending = true;
  let scenario = "formatting";
  const navigationContent = (n) => ({
    type: "doc",
    content: Array.from({ length: 65 }, (_, i) => {
      const changed = scenario === "single" ? i === 0 : [3, 30, 60].includes(i);
      const paragraph = {
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              `Paragraph ${i}: Stable reference text for navigation across a long article.` +
              (n >= 2 && changed ? " Added detail." : ""),
          },
        ],
      };
      return scenario === "table" && i === 30
        ? {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [{ type: "tableCell", content: [paragraph] }],
              },
            ],
          }
        : paragraph;
    }),
  });
  const item = (n) => ({
    id: `version-${n}`,
    title: "Synthetic article",
    createdAt: new Date(Date.UTC(2026, 10, 1, 10, n)).toISOString(),
    lastUpdatedBy: { name: "Test editor" },
    contributors: [],
    content:
      scenario !== "formatting"
        ? navigationContent(n)
        : {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Same words",
                    ...(n >= 2 ? { marks: [{ type: "bold" }] } : {}),
                  },
                ],
              },
            ],
          },
  });
  const aliases = [
    ["@/main", "query.ts"],
    ["@/lib/api-client", "api.ts"],
    ["@/i18n.ts", "i18n.ts"],
    ["react-i18next", "i18n.ts"],
    ["@/features/editor/extensions/extensions", "schema.ts"],
  ].map(([find, file]) => ({ find, replacement: path.join(root, file) }));
  aliases.push({
    find: /^(?:@\/features\/page-history\/hooks|\.\.\/hooks)$/,
    replacement: path.join(root, "hooks.ts"),
  });
  aliases.push({ find: "@", replacement: path.join(repo, "apps/client/src") });
  // Use normal package exports (not aliases to CommonJS entry files).
  const modules = path.join(root, "node_modules");
  const linked = !fs.existsSync(modules);
  if (linked)
    fs.symlinkSync(path.join(repo, "apps/client/node_modules"), modules, "dir");
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(temporary, "cache"),
    plugins: [
      react(),
      {
        name: "synthetic-api",
        configureServer(s) {
          s.middlewares.use((request, response, next) => {
            if (!request.url.startsWith("/api/")) return next();
            response.setHeader("Content-Type", "application/json");
            if (request.url === "/api/pages/history") {
              reads++;
              return response.end(
                JSON.stringify({
                  items: Array.from({ length: versions }, (_, i) =>
                    item(versions - i),
                  ),
                  meta: {},
                  status: { pending, retrying: false, dueAt: null },
                }),
              );
            }
            if (request.url === "/api/pages/history/info") {
              let body = "";
              request.on("data", (b) => (body += b));
              request.on("end", () =>
                response.end(
                  JSON.stringify(
                    item(Number(JSON.parse(body).historyId.split("-")[1])),
                  ),
                ),
              );
              return;
            }
            response.end("{}");
          });
        },
      },
    ],
    resolve: { alias: aliases, dedupe: ["react", "react-dom", "jotai"] },
    css: { postcss: path.join(repo, "apps/client") },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } },
    define: { "process.env": JSON.stringify({ APP_URL: "http://127.0.0.1" }) },
  });
  let browser;
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const name of ["chromium", "webkit"]) {
      browser = await playwright[name].launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1366, height: 768 },
      });
      const errors = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error(
          name,
          JSON.stringify({ message: e.message, stack: e.stack, name: e.name }),
        );
      });
      page.on("console", (m) => {
        if (m.type() === "error") console.error(m.text());
      });
      await page.goto(base);
      await page
        .getByRole("button", { name: "Open history", exact: true })
        .click();
      await page
        .getByText("Formatting or block properties changed.", { exact: false })
        .waitFor();

      await page
        .getByText("Your page is saved. A history snapshot is pending.", {
          exact: true,
        })
        .waitFor();
      for (const [width, height] of [
        [1366, 768],
        [1280, 720],
        [1024, 600],
        [900, 450],
        [420, 800],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        const dialog = await page.getByRole("dialog").boundingBox();
        assert.ok(
          dialog && dialog.y >= -1 && dialog.y + dialog.height <= height + 1,
          `${name}: dialog must fit viewport`,
        );
        await page.screenshot({
          path: path.join(temporary, `${name}-${width}x${height}.png`),
        });
        for (const text of ["Restore", "Cancel", "Highlight changes"]) {
          const visible = await page
            .getByText(text, { exact: true })
            .evaluate((el) => {
              const r = el.getBoundingClientRect(),
                hit = document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                );
              const target = el.closest("label") ?? el;
              return {
                visible: !!hit && (hit === target || target.contains(hit)),
                rect: r.toJSON(),
                tag: el.tagName,
                hit: hit?.tagName,
              };
            });
          assert.ok(
            visible.visible,
            `${name} ${width}x${height}: ${text} is clipped ${JSON.stringify(visible)}; screenshots: ${temporary}`,
          );
        }
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      const before = reads;
      versions++;
      pending = false;
      await page
        .getByText(
          "Edits are grouped into snapshots, usually within five minutes.",
          { exact: true },
        )
        .waitFor({ timeout: 12000 });
      assert.ok(
        reads > before,
        "Open dialog must refresh when a snapshot arrives",
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForTimeout(400);
      const closedReads = reads;
      await page.waitForTimeout(5500);
      assert.equal(reads, closedReads, "Hidden dialog must not keep polling");
      for (const testScenario of ["single", "multiple", "table"]) {
        scenario = testScenario;
        versions = 2;
        pending = false;
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
          const total = scenario === "single" ? 1 : 3;
          await page.getByText(`1 of ${total}`, { exact: true }).waitFor();
          const measure = (index) =>
            page
              .locator(`[data-diff-index="${index}"]`)
              .first()
              .evaluate((el) => {
                const viewport = el.closest(".mantine-ScrollArea-viewport");
                const rect = el.getBoundingClientRect(),
                  v = viewport.getBoundingClientRect();
                return {
                  visible: rect.top >= v.top - 2 && rect.bottom <= v.bottom + 2,
                  top: rect.top,
                  viewportTop: v.top,
                  height: v.height,
                  scrollTop: viewport.scrollTop,
                  offsetTop: el.offsetTop,
                  offsetParent: el.offsetParent?.tagName,
                };
              });
          const settle = async (index) => {
            for (let retry = 0; retry < 25; retry++) {
              const state = await measure(index);
              if (state.visible) return state;
              await page.waitForTimeout(100);
            }
            return measure(index);
          };
          await settle(1);
          for (const [button, index] of total === 1
            ? [
                ["Next change", 1],
                ["Previous change", 1],
              ]
            : [
                ["Next change", 2],
                ["Next change", 3],
                ["Next change", 1],
                ["Previous change", 3],
                ["Previous change", 2],
                ["Previous change", 1],
              ]) {
            await page
              .getByRole("button", { name: button, exact: true })
              .click();
            await page
              .getByText(`${index} of ${total}`, { exact: true })
              .waitFor();
            const result = await settle(index);
            assert.ok(
              result.visible,
              `Target not visible: ${JSON.stringify({ name, scenario, width, height, index, ...result })}`,
            );
          }
          // Manual scrolling must not prevent the next arrow finding the change.
          await page
            .locator('[data-diff-index="1"]')
            .first()
            .evaluate((el) => {
              const viewport = el.closest(".mantine-ScrollArea-viewport");
              viewport.scrollTop = viewport.scrollHeight;
            });
          await page
            .getByRole("button", { name: "Next change", exact: true })
            .click();
          const result = await settle(total === 1 ? 1 : 2);
          assert.ok(
            result.visible,
            `Manual scroll must not break navigation: ${JSON.stringify({ name, scenario, width, height, ...result })}`,
          );
        }
        console.log(
          `PASS ${name}: ${scenario} change navigation, desktop/short/mobile, wraparound, manual scrolling`,
        );
      }
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${name}: short/narrow screens, formatting notice, pending state, automatic refresh, no hidden polling`,
      );
      await browser.close();
      browser = undefined;
      pending = true;
      versions = 2;
      scenario = "formatting";
    }
    console.log("Synthetic screenshots:", temporary);
  } finally {
    if (browser) await browser.close();
    await server.close();
    if (linked) fs.unlinkSync(modules);
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
