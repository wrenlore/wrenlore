// History regression against disposable Postgres/Redis; never a production DB.
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
  assert.equal(process.env.WRENLORE_HISTORY_TEST, "disposable");
  assert.match(new URL(process.env.DATABASE_URL).pathname, /_history_test$/);
  const repo = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "wrenlore-history-ci-"),
  );
  const logPath = path.join(temporary, "server.log");
  const log = fs.openSync(logPath, "w", 0o600);
  const children = [];
  try {
    const port = await freePort();
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

    const setup = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "History Test User",
        email: "history-test@example.invalid",
        password: randomBytes(24).toString("hex"),
        workspaceName: "History sandbox",
      }),
    });
    assert.ok(setup.ok, "Use a fresh disposable database for this runner");
    // Stop the sandbox app so worker timing is fully controlled by the regression.
    children[0].kill("SIGTERM");
    await once(children[0], "exit");
    const test = spawn(process.execPath, ["scripts/history-regression.cjs"], {
      cwd: repo,
      env: {
        ...env,
      },
      stdio: "inherit",
    });
    const [code] = await once(test, "exit");
    assert.equal(code, 0, "History regression failed");
    console.log(
      "PASS: history persistence, retry, ordering and API regression",
    );
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
