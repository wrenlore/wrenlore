// Migrate and test only an explicitly disposable social-auth database.
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "..");
const req = createRequire(path.join(repo, "apps/server/package.json"));
async function main() {
  assert.equal(process.env.WRENLORE_SOCIAL_TEST, "disposable");
  assert.match(
    new URL(process.env.SOCIAL_INTEGRATION_DB).pathname,
    /_social_test$/,
  );
  assert.ok(process.env.SOCIAL_INTEGRATION_REDIS);
  const { Kysely, CamelCasePlugin } = req("kysely");
  const { PostgresJSDialect } = req("kysely-postgres-js");
  const pg = req("postgres");
  const {
    MigrationService,
  } = require("../apps/server/dist/database/services/migration.service.js");
  const db = new Kysely({
    dialect: new PostgresJSDialect({
      postgres: pg(process.env.SOCIAL_INTEGRATION_DB),
    }),
    plugins: [new CamelCasePlugin()],
  });
  try {
    await new MigrationService(db).migrateToLatest();
  } finally {
    await db.destroy();
  }
  const result = spawnSync(
    "pnpm",
    ["exec", "jest", "--runInBand", "social-auth.integration.spec"],
    {
      cwd: path.join(repo, "apps/server"),
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "social auth integration failed");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
