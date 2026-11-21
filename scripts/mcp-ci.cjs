// Two app processes against disposable Postgres/Redis; never a production DB.
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function main() {
  assert.equal(process.env.WRENLORE_MCP_TEST, "disposable");
  assert.match(new URL(process.env.DATABASE_URL).pathname, /_mcp_test$/);
  const repo = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wrenlore-mcp-ci-"));
  const logPath = path.join(temporary, "server.log");
  const log = fs.openSync(logPath, "w", 0o600);
  const children = [];
  try {
    const [port, otherPort] = await Promise.all([freePort(), freePort()]);
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      APP_SECRET: randomBytes(32).toString("hex"),
      APP_URL: base,
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      MAIL_DRIVER: "log",
      DISABLE_TELEMETRY: "true",
      STORAGE_DRIVER: "local",
      // Concurrent retries must not need a spare pool connection while their
      // transaction holds an advisory lock.
      DATABASE_MAX_POOL: "2",
    };
    async function start(serverPort) {
      const child = spawn(process.execPath, ["dist/main.js"], {
        cwd: path.join(repo, "apps/server"),
        env: { ...env, PORT: String(serverPort) },
        stdio: ["ignore", log, log],
      });
      children.push(child);
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null)
          throw new Error("Sandbox app exited during startup");
        try {
          if (
            (
              await fetch(`http://127.0.0.1:${serverPort}/api/health`, {
                signal: AbortSignal.timeout(500),
              })
            ).ok
          )
            return;
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("Sandbox app did not become healthy");
    }
    await start(port);
    await start(otherPort);
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "MCP Test User",
        email: "mcp-test@example.invalid",
        password: randomBytes(24).toString("hex"),
        workspaceName: "MCP sandbox",
      }),
    });
    assert.ok(setup.ok, "Use a fresh disposable database for this runner");
    const cookie = setup.headers.get("set-cookie").split(";", 1)[0];
    const test = spawn(process.execPath, ["scripts/mcp-regression.cjs"], {
      cwd: repo,
      env: {
        ...env,
        WRENLORE_TEST_URL: base,
        WRENLORE_TEST_MCP_URL: `http://127.0.0.1:${otherPort}/mcp`,
        WRENLORE_TEST_COOKIE: cookie,
      },
      stdio: "inherit",
    });
    const [code] = await once(test, "exit");
    assert.equal(code, 0, "Multi-process MCP regression failed");
    console.log("PASS: separate HTTP and live-document owners through Redis");
  } catch (error) {
    console.error(`Sandbox server log: ${logPath}`);
    throw error;
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.race([
      Promise.all(
        children.map((child) =>
          child.exitCode === null ? once(child, "exit") : Promise.resolve(),
        ),
      ),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
    fs.closeSync(log);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
