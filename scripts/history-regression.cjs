/* Disposable PostgreSQL integration proofs. No production credentials or data. */
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const req = createRequire(
  path.resolve(__dirname, "../apps/server/package.json"),
);
const { Kysely, CamelCasePlugin, sql } = req("kysely");
const { PostgresJSDialect } = req("kysely-postgres-js");
const { PageRepo } = req("./dist/database/repos/page/page.repo");
const { PageHistoryRepo } = req("./dist/database/repos/page/page-history.repo");
const { PageHistoryService } = req(
  "./dist/core/page/services/page-history.service",
);
const { PageService } = req("./dist/core/page/services/page.service");
const { PersistenceExtension } = req(
  "./dist/collaboration/extensions/persistence.extension",
);
const { DocumentWriteQueue } = req("./dist/collaboration/document-write-queue");
const { HistoryProcessor } = req(
  "./dist/collaboration/processors/history.processor",
);
const { HistoryScheduler } = req(
  "./dist/collaboration/services/history-scheduler.service",
);
const { TiptapTransformer } = req("@hocuspocus/transformer");
const { tiptapExtensions } = req("./dist/collaboration/collaboration.util");
req("@nestjs/common").Logger.overrideLogger([]);
const body = (text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const noop = { add: async () => {} };
async function main() {
  assert.equal(process.env.WRENLORE_HISTORY_TEST, "disposable");
  assert.match(new URL(process.env.DATABASE_URL).pathname, /_history_test$/);
  const db = new Kysely({
    dialect: new PostgresJSDialect({
      postgres: req("postgres")(process.env.DATABASE_URL, { max: 5 }),
    }),
    plugins: [new CamelCasePlugin()],
  });
  try {
    const user = await db
      .selectFrom("users")
      .selectAll()
      .executeTakeFirstOrThrow();
    const space = await db
      .selectFrom("spaces")
      .selectAll()
      .executeTakeFirstOrThrow();
    const pages = new PageRepo(db, {}, { emit: () => {} });
    let histories = new PageHistoryRepo(db);
    async function fixture(title) {
      return db
        .insertInto("pages")
        .values({
          id: randomUUID(),
          slugId: randomUUID().slice(0, 10),
          title,
          content: body("Original"),
          position: "a0",
          creatorId: user.id,
          spaceId: space.id,
          workspaceId: space.workspaceId,
          createdAt: new Date(Date.now() - 3600000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    async function due(id) {
      await db
        .updateTable("pageHistoryPending")
        .set({ dueAt: new Date(Date.now() - 1000) })
        .where("pageId", "=", id)
        .execute();
    }
    async function count(id) {
      return (
        await db
          .selectFrom("pageHistory")
          .selectAll()
          .where("pageId", "=", id)
          .execute()
      ).length;
    }
    async function edit(page, text, general = noop) {
      const ext = new PersistenceExtension(
        pages,
        db,
        general,
        noop,
        histories,
        noop,
        new DocumentWriteQueue(),
      );
      const document = TiptapTransformer.toYdoc(
        body(text),
        "default",
        tiptapExtensions,
      );
      const data = {
        documentName: `page.${page.id}`,
        document,
        context: { user: { id: user.id } },
      };
      await ext.onChange(data);
      try {
        await ext.onStoreDocument(data);
      } finally {
        document.destroy();
      }
    }
    const page = await fixture("Durability");
    await histories.saveHistory(page);
    await assert.rejects(
      edit(page, "Saved despite queue outage", {
        add: async () => {
          throw new Error("Injected queue outage");
        },
      }),
      /Injected queue outage/,
    );
    assert.equal(
      (await pages.findById(page.id, { includeContent: true })).content
        .content[0].content[0].text,
      "Saved despite queue outage",
    );
    const first = await db
      .selectFrom("pageHistoryPending")
      .selectAll()
      .where("pageId", "=", page.id)
      .executeTakeFirstOrThrow();
    assert.deepEqual(first.contributorIds, [user.id]);
    await edit(page, "Second coalesced edit");
    const second = await db
      .selectFrom("pageHistoryPending")
      .selectAll()
      .where("pageId", "=", page.id)
      .executeTakeFirstOrThrow();
    assert.equal(first.dueAt.getTime(), second.dueAt.getTime());
    assert.deepEqual(second.contributorIds, [user.id]);
    histories = new PageHistoryRepo(db); // No in-memory queue state survives this replacement.
    await due(page.id);
    await histories.savePendingHistory(page.id);
    assert.equal(
      (await histories.findPageLastHistory(page.id, { includeContent: true }))
        .content.content[0].content[0].text,
      "Second coalesced edit",
    );
    console.log(
      "PASS committed edit survives ancillary queue outage/restart; coalescing and contributors persist",
    );

    const before = await pages.findById(page.id, { includeContent: true });
    const originalSchedule = histories.scheduleHistory.bind(histories);
    histories.scheduleHistory = async () => {
      throw new Error("Injected outbox write failure");
    };
    await assert.rejects(
      edit(page, "Must roll back"),
      /Injected outbox write failure/,
    );
    assert.deepEqual(
      (await pages.findById(page.id, { includeContent: true })).content,
      before.content,
    );
    histories.scheduleHistory = originalSchedule;
    console.log("PASS page save and pending snapshot roll back together");

    const pageService = new PageService(
      pages,
      {},
      {},
      db,
      {},
      noop,
      noop,
      noop,
      {},
      {},
      {},
      histories,
    );
    await pageService.update(
      before,
      { pageId: page.id, title: "Renamed only" },
      user,
    );
    assert.equal((await histories.getHistoryStatus(page.id)).pending, true);
    await due(page.id);
    await histories.savePendingHistory(page.id);
    assert.equal(
      (await histories.findPageLastHistory(page.id)).title,
      "Renamed only",
    );
    console.log("PASS title-only update schedules and persists history");

    await edit(page, "Retry me");
    await due(page.id);
    const originalInsert = histories.insertPageHistory.bind(histories);
    histories.insertPageHistory = async () => {
      throw Object.assign(new Error("Injected insert failure"), {
        code: "TEST_FAILURE",
      });
    };
    const scheduler = new HistoryScheduler(histories, {
      addPageWatchers: async () => {
        throw new Error("Injected watcher failure");
      },
    });
    const priorCount = await count(page.id);
    await scheduler.drain();
    assert.equal(await count(page.id), priorCount);
    const retry = await db
      .selectFrom("pageHistoryPending")
      .selectAll()
      .where("pageId", "=", page.id)
      .executeTakeFirstOrThrow();
    assert.equal(retry.attempts, 1);
    assert.equal(retry.lastError, "TEST_FAILURE");
    assert.ok(retry.dueAt > new Date());
    histories.insertPageHistory = originalInsert;
    await due(page.id);
    await scheduler.drain();
    assert.equal(await count(page.id), priorCount + 1);
    assert.equal((await histories.getHistoryStatus(page.id)).pending, false);
    console.log(
      "PASS failed snapshots retain diagnostics and retry; watcher failure cannot lose saved history",
    );

    await edit(page, "Worker A snapshot");
    await due(page.id);
    let enter, release;
    const entered = new Promise((r) => (enter = r));
    const unblock = new Promise((r) => (release = r));
    histories.insertPageHistory = async (...args) => {
      enter();
      await unblock;
      return originalInsert(...args);
    };
    const worker = histories.savePendingHistory(page.id);
    await entered;
    const competing = await new PageHistoryRepo(db).savePendingHistory(page.id);
    assert.equal(competing, null);
    const writer = edit(page, "Edit while snapshot is running");
    release();
    await worker;
    await writer;
    histories.insertPageHistory = originalInsert;
    assert.equal((await histories.getHistoryStatus(page.id)).pending, true);
    await due(page.id);
    await histories.savePendingHistory(page.id);
    assert.equal(
      (await histories.findPageLastHistory(page.id, { includeContent: true }))
        .content.content[0].content[0].text,
      "Edit while snapshot is running",
    );
    console.log(
      "PASS concurrent workers skip locked pages; edits during snapshot retain follow-up work",
    );

    const ordering = await fixture("Mixed IDs");
    const entries = [
      ["ffffffff-ffff-4fff-bfff-ffffffffffff", "2026-11-01T10:00:00.000100Z"],
      ["00000000-0000-4000-8000-000000000001", "2026-11-01T10:00:00.000200Z"],
      ["00000000-0000-4000-8000-000000000002", "2026-11-01T10:00:00.000200Z"],
    ];
    for (const [id, createdAt] of entries)
      await histories.insertPageHistory({
        pageId: ordering.id,
        id,
        createdAt: sql.raw("'" + createdAt + "'::timestamptz"),
        title: ordering.title,
        content: ordering.content,
        spaceId: space.id,
        workspaceId: space.workspaceId,
      });
    const listService = new PageHistoryService(histories);
    const seen = [];
    let cursor;
    do {
      const list = await listService.findHistoryByPageId(ordering.id, {
        limit: 1,
        cursor,
      });
      assert.equal(list.status.pending, false);
      seen.push(...list.items.map((i) => i.id));
      cursor = list.meta.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, [entries[2][0], entries[1][0], entries[0][0]]);
    const firstPage = await histories.findPageHistoryByPageId(ordering.id, {
      limit: 1,
    });
    const nextPage = await histories.findPageHistoryByPageId(ordering.id, {
      limit: 1,
      cursor: firstPage.meta.nextCursor,
    });
    const previousPage = await histories.findPageHistoryByPageId(ordering.id, {
      limit: 1,
      beforeCursor: nextPage.meta.prevCursor,
    });
    assert.equal(previousPage.items[0].id, entries[2][0]);
    console.log(
      "PASS chronological ordering, timestamp ties, microsecond precision, forward/backward pagination",
    );
    const clockPage = await fixture("Capture time");
    await db.transaction().execute(async (trx) => {
      await sql`select now()`.execute(trx); // Start a transaction before another version exists.
      await histories.saveHistory({ ...clockPage, title: "Earlier capture" });
      await histories.saveHistory(
        { ...clockPage, title: "Later capture" },
        { trx },
      );
    });
    assert.equal(
      (await histories.findPageLastHistory(clockPage.id)).title,
      "Later capture",
    );
    console.log(
      "PASS snapshot order uses capture time rather than transaction start",
    );

    const legacy = await fixture("Legacy queue");
    const legacyWorker = new HistoryProcessor(
      histories,
      pages,
      {
        popContributors: async () => [user.id],
        addContributors: async () => {},
      },
      db,
    );
    await legacyWorker.process({
      name: "page-history",
      data: { pageId: legacy.id },
    });
    assert.equal((await histories.getHistoryStatus(legacy.id)).pending, true);
    await histories.savePendingHistory(legacy.id);
    assert.equal(await count(legacy.id), 1);
    const noChangeCount = await count(legacy.id);
    await db.transaction().execute(async (trx) => {
      const locked = await pages.findById(legacy.id, { trx, withLock: true });
      await histories.scheduleHistory(locked, [user.id], trx, 0);
    });
    await histories.savePendingHistory(legacy.id);
    assert.equal(await count(legacy.id), noChangeCount);
    console.log(
      "PASS old queue jobs transfer to durable work; unchanged documents do not create duplicate versions",
    );
  } finally {
    await db.destroy();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
