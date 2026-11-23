// Real React/Mantine pages in Chromium; only the HTTP API is mocked.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const repo = path.resolve(__dirname, "..");
const req = createRequire(path.join(repo, "apps/client/package.json"));
async function main() {
  const { createServer } = await import(pathToFileURL(req.resolve("vite")));
  const { default: react } = await import(
    pathToFileURL(req.resolve("@vitejs/plugin-react"))
  );
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "wrenlore-social-ui-"),
  );
  const server = await createServer({
    configFile: false,
    root: path.join(__dirname, "social-ui"),
    cacheDir: temporary,
    plugins: [react()],
    define: { "process.env": {} },
    resolve: { alias: { "@": path.join(repo, "apps/client/src") } },
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: { allow: [repo, fs.realpathSync(path.join(repo, "node_modules"))] },
    },
    logLevel: "error",
  });
  let browser;
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let linkingAllowed = false;
    let submitted;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/auth/social/accounts")) {
        return route.fulfill({ json: { data: { items: [], linkingAllowed } } });
      }
      if (url.includes("/auth/mfa/")) {
        submitted = route.request().postDataJSON();
        return route.fulfill({ json: { data: { authToken: "test" } } });
      }
      return route.fulfill({ json: { data: {} } });
    });
    await page.goto(`${base}/login/mfa#mfa_token=fresh-browser-token`);
    await page
      .getByRole("heading", { name: "Multi-factor authentication" })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, "/login/mfa");
    assert.equal(await page.evaluate(() => location.hash), "");
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("wrenlore:mfaToken")),
      "fresh-browser-token",
    );
    await page.reload();
    await page
      .getByRole("heading", { name: "Multi-factor authentication" })
      .waitFor();
    await page
      .getByLabel("Authentication code", { exact: true })
      .fill("123456");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("AUTHENTICATED HOME").waitFor();
    assert.equal(submitted.mfaToken, "fresh-browser-token");
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("wrenlore:mfaToken")),
      null,
    );

    await page.evaluate(() =>
      sessionStorage.setItem("wrenlore:mfaToken", "stale-token"),
    );
    await page.goto(`${base}/login/mfa#mfa_token=new-challenge`);
    await page
      .getByRole("heading", { name: "Multi-factor authentication" })
      .waitFor();
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("wrenlore:mfaToken")),
      "new-challenge",
    );
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${base}/login/mfa`);
    await page.getByText("LOGIN FALLBACK").waitFor();

    await page.goto(`${base}/settings/account`);
    await page
      .getByText("This workspace enforces enterprise single sign-on.")
      .waitFor();
    assert.equal(
      await page.getByTestId("social-connect-github").isDisabled(),
      true,
    );
    assert.equal(
      await page.getByTestId("social-connect-google").isDisabled(),
      true,
    );
    linkingAllowed = true;
    await page.reload();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="social-connect-github"]')
          .disabled,
    );
    assert.equal(
      await page.getByTestId("social-connect-google").isDisabled(),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: fresh/reloaded MFA handoff, submission, cleanup, stale/missing token, SAML linking controls",
    );
  } finally {
    await browser?.close();
    await server.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
