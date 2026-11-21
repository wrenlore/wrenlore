/* Run only against a disposable, migrated instance. See docs/mcp.md. */
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const req = createRequire(
  path.resolve(__dirname, "../apps/server/package.json"),
);
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = req(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);
const postgres = req("postgres");
const { HocuspocusProvider, HocuspocusProviderWebsocket } = req(
  "@hocuspocus/provider",
);
const Y = req("yjs");
const WebSocket = req("ws");

async function main() {
  assert.equal(
    process.env.WRENLORE_MCP_TEST,
    "disposable",
    "Explicit disposable-instance opt-in required",
  );
  const base = process.env.WRENLORE_TEST_URL;
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
  const cookie = process.env.WRENLORE_TEST_COOKIE;
  const sql = postgres(process.env.DATABASE_URL, { max: 3 });
  const clients = [];
  const providers = [];
  const run = randomUUID().slice(0, 8);
  async function http(
    route,
    body,
    { token, status, method = "POST", headers = {} } = {},
  ) {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }),
        ...headers,
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (status) {
      assert.equal(res.status, status, `${route}: ${text}`);
      return;
    }
    assert.ok(res.ok, `${route}: ${res.status} ${text}`);
    const parsed = text ? JSON.parse(text) : {};
    return parsed.data ?? parsed;
  }
  async function connect(token) {
    const client = new Client({
      name: "wrenlore-regression",
      version: "1.0.0",
    });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(process.env.WRENLORE_TEST_MCP_URL ?? `${base}/mcp`),
        {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        },
      ),
    );
    return client;
  }
  async function tool(client, name, args = {}, error) {
    const response = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 15000 },
    );
    const value =
      response.structuredContent ?? JSON.parse(response.content[0].text);
    if (error) {
      assert.equal(response.isError, true, JSON.stringify(value));
      assert.match(JSON.stringify(value), error);
    } else assert.ok(!response.isError, `${name}: ${JSON.stringify(value)}`);
    return value;
  }
  const tokenBody = (access = "write", spaceIds = null) => ({
    name: `Regression ${run}`,
    agentName: "Francis",
    access,
    spaceIds,
  });
  const key = () => randomUUID();
  try {
    await http("/api/workspace/update", { mcpEnabled: false });
    await http("/api/agent-tokens", tokenBody(), { status: 403 });
    await http("/api/workspace/update", { mcpEnabled: true });
    const a = await http("/api/spaces/create", {
      name: `Allowed ${run}`,
      slug: `a${run}`,
    });
    const b = await http("/api/spaces/create", {
      name: `Excluded ${run}`,
      slug: `b${run}`,
    });
    const writable = await http(
      "/api/agent-tokens",
      tokenBody("write", [a.id]),
    );
    const readonly = await http("/api/agent-tokens", tokenBody("read", [a.id]));
    const all = await http("/api/agent-tokens", tokenBody());
    const listed = await http("/api/agent-tokens", null, { method: "GET" });
    assert.ok(listed.every((t) => !("token" in t) && !("tokenHash" in t)));
    const [stored] =
      await sql`select token_hash from api_keys where id=${writable.id}`;
    assert.equal(
      stored.token_hash,
      createHash("sha256").update(writable.token).digest("hex"),
    );
    assert.notEqual(stored.token_hash, writable.token);
    const rw = await connect(writable.token),
      ro = await connect(readonly.token),
      full = await connect(all.token);
    assert.equal((await rw.listTools()).tools.length, 10);
    assert.equal(
      (await ro.listTools()).tools.some((t) => t.name === "edit_page"),
      false,
    );
    const context = await tool(rw, "get_context");
    assert.equal(context.agentName, "Francis");
    assert.equal(context.attribution, "MCP Test User, via Francis");
    assert.deepEqual(
      (await tool(rw, "list_spaces")).items.map((s) => s.id),
      [a.id],
    );
    await tool(
      ro,
      "create_page",
      { spaceId: a.id, title: "No", markdown: "", requestKey: key() },
      /read-only/,
    );
    await tool(
      rw,
      "create_page",
      { spaceId: b.id, title: "No", markdown: "", requestKey: key() },
      /not available/,
    );
    await tool(rw, "delete_page", { pageId: key() }, /Unknown tool/);
    await tool(rw, "get_context", { agentName: "Spoof" }, /INVALID_ARGUMENTS/);
    const create = {
      spaceId: a.id,
      title: "MCP searchable needle",
      markdown:
        "# First\n\nOriginal paragraph.\n\n| Key | Value |\n| --- | --- |\n| keep | intact |",
      requestKey: key(),
    };
    const [page, simultaneous] = await Promise.all([
      tool(rw, "create_page", create),
      tool(rw, "create_page", create),
    ]);
    assert.equal(page.pageId, simultaneous.pageId);
    assert.equal(page.persisted, true);
    assert.equal((await tool(rw, "create_page", create)).pageId, page.pageId);
    await tool(
      rw,
      "create_page",
      { ...create, title: "Different" },
      /REQUEST_KEY_CONFLICT/,
    );
    const hidden = await tool(full, "create_page", {
      ...create,
      spaceId: b.id,
      requestKey: key(),
    });
    await tool(rw, "read_page", { pageId: hidden.pageId }, /not available/);
    assert.ok(
      (await tool(rw, "search", { query: "searchable" })).items.every(
        (p) => p.spaceId === a.id,
      ),
    );
    const read = await tool(rw, "read_page", { pageId: page.pageId });
    assert.equal(read.blocks[0].type, "heading");
    const [before] =
      await sql`select content from pages where id=${page.pageId}`;
    const table = before.content.content.find((n) => n.type === "table");
    const edit = {
      pageId: page.pageId,
      expectedRevision: read.revision,
      operations: [
        {
          type: "insert_after",
          blockRef: read.blocks[0].blockRef,
          markdown: "Inserted.",
        },
        {
          type: "replace_block",
          blockRef: read.blocks[1].blockRef,
          markdown: "Replacement.",
        },
      ],
      requestKey: key(),
    };
    const applied = await tool(rw, "edit_page", edit);
    assert.equal(applied.persisted, true);
    assert.equal((await tool(rw, "edit_page", edit)).replayed, true);
    const changed = await tool(rw, "read_page", { pageId: page.pageId });
    assert.match(changed.blocks[1].markdown, /Inserted/);
    assert.match(changed.blocks[2].markdown, /Replacement/);
    await tool(
      rw,
      "edit_page",
      { ...edit, requestKey: key() },
      /REVISION_CONFLICT/,
    );
    const [after] =
      await sql`select content from pages where id=${page.pageId}`;
    assert.deepEqual(
      after.content.content.find((n) => n.type === "table"),
      table,
    );
    // A real collaborative client changes the document before the debounced
    // SQL save. MCP must see that live state and reject a stale revision.
    const collabToken = await http("/api/auth/collab-token");
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${base.replace("http:", "ws:")}/collab`,
      WebSocketPolyfill: WebSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: `page.${page.pageId}`,
      token: collabToken.token,
      document: doc,
    });
    providers.push({ provider, socket });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Yjs client sync timed out")),
        10000,
      );
      provider.on("synced", () => {
        clearTimeout(timeout);
        resolve();
      });
      provider.on("authenticationFailed", () => {
        clearTimeout(timeout);
        reject(new Error("Yjs auth failed"));
      });
      provider.attach();
    });
    const paragraph = new Y.XmlElement("paragraph"),
      text = new Y.XmlText();
    text.insert(0, "Human live edit");
    paragraph.insert(0, [text]);
    doc.getXmlFragment("default").push([paragraph]);
    let live;
    for (let i = 0; i < 25; i++) {
      live = await tool(rw, "read_page", { pageId: page.pageId });
      if (live.blocks.some((b) => b.markdown.includes("Human live edit")))
        break;
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(live.blocks.some((b) => b.markdown.includes("Human live edit")));
    await tool(
      rw,
      "edit_page",
      {
        pageId: page.pageId,
        expectedRevision: changed.revision,
        operations: [{ type: "append", markdown: "Must conflict" }],
        requestKey: key(),
      },
      /REVISION_CONFLICT/,
    );
    await sql`update pages set title='Human renamed this' where id=${page.pageId}`;
    const concurrentEdit = await tool(rw, "edit_page", {
      pageId: page.pageId,
      expectedRevision: live.revision,
      operations: [{ type: "append", markdown: "Agent after human" }],
      requestKey: key(),
    });
    assert.equal(concurrentEdit.persisted, true);
    assert.equal(
      (await sql`select title from pages where id=${page.pageId}`)[0].title,
      "Human renamed this",
    );
    assert.ok(
      doc.getXmlFragment("default").toString().includes("Human live edit"),
    );
    // Force the explicit durable acknowledgement to fail after the CRDT edit.
    // The retry must finish persistence without appending the text twice.
    const faultRead = await tool(rw, "read_page", { pageId: page.pageId });
    const interrupted = {
      pageId: page.pageId,
      expectedRevision: faultRead.revision,
      operations: [
        { type: "append", markdown: "Exactly once after interrupted save" },
      ],
      requestKey: key(),
    };
    await sql.unsafe(
      "CREATE OR REPLACE FUNCTION mcp_test_fail_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'MCP test injected save failure'; END $$",
    );
    await sql.unsafe(
      "CREATE TRIGGER mcp_test_fail_ack BEFORE UPDATE OF result ON agent_operations FOR EACH ROW EXECUTE FUNCTION mcp_test_fail_ack()",
    );
    try {
      await tool(rw, "edit_page", interrupted, /SAVE_UNCONFIRMED/);
    } finally {
      await sql.unsafe("DROP TRIGGER mcp_test_fail_ack ON agent_operations");
      await sql.unsafe("DROP FUNCTION mcp_test_fail_ack()");
    }
    const [pending] =
      await sql`select id from agent_operations where token_id=${writable.id} and request_key=${interrupted.requestKey}`;
    const journal = doc.getMap("wrenloreAgentOperations");
    for (let i = 0; i < 100 && !journal.has(pending.id); i++)
      await new Promise((r) => setTimeout(r, 20));
    const authentic = journal.get(pending.id);
    assert.ok(authentic?.signature);
    async function syncJournal(value) {
      journal.set(pending.id, value);
      for (let i = 0; i < 100 && provider.unsyncedChanges; i++)
        await new Promise((r) => setTimeout(r, 20));
      assert.equal(provider.unsyncedChanges, 0);
    }
    await syncJournal({
      ...authentic,
      receipt: { ...authentic.receipt, revision: "f".repeat(64) },
    });
    await tool(rw, "edit_page", interrupted, /OPERATION_JOURNAL_CONFLICT/);
    await syncJournal(authentic);
    const retried = await tool(rw, "edit_page", interrupted);
    assert.equal(retried.persisted, true);
    const afterRetry = await tool(rw, "read_page", { pageId: page.pageId });
    assert.equal(
      afterRetry.blocks.filter((b) =>
        b.markdown.includes("Exactly once after interrupted save"),
      ).length,
      1,
    );
    const commentArgs = {
      pageId: page.pageId,
      markdown: "Agent comment",
      requestKey: key(),
    };
    const comment = await tool(rw, "add_comment", commentArgs);
    assert.equal(
      (await tool(rw, "add_comment", commentArgs)).commentId,
      comment.commentId,
    );
    const comments = await tool(rw, "list_comments", { pageId: page.pageId });
    assert.equal(comments.items.length, 1);
    assert.equal(comments.items[0].agentName, "Francis");
    const longComment = await tool(rw, "add_comment", {
      pageId: page.pageId,
      markdown: "Comment chunk ".repeat(500),
      requestKey: key(),
    });
    let fullComment = "",
      commentOffset = 0;
    do {
      const part = await tool(rw, "list_comments", {
        pageId: page.pageId,
        commentId: longComment.commentId,
        charOffset: commentOffset,
        maxChars: 500,
      });
      fullComment += part.markdown;
      commentOffset = part.nextCharOffset;
    } while (commentOffset !== null);
    assert.equal(fullComment.trim(), "Comment chunk ".repeat(500).trim());
    const history = await tool(rw, "get_page_history", { pageId: page.pageId });
    assert.ok(history.items.some((h) => h.agentName === "Francis"));
    await tool(
      rw,
      "get_page_history",
      { pageId: hidden.pageId, historyId: history.items[0].id },
      /not available/,
    );
    const longText = "Long block ".repeat(650);
    const long = await tool(rw, "create_page", {
      spaceId: a.id,
      title: "Large block",
      markdown: longText,
      requestKey: key(),
    });
    let parts = "",
      offset = 0,
      charOffset = 0;
    do {
      const part = await tool(rw, "read_page", {
        pageId: long.pageId,
        offset,
        charOffset,
        maxChars: 500,
      });
      parts += part.blocks.map((b) => b.markdown).join("");
      offset = part.nextOffset;
      charOffset = part.nextCharOffset;
    } while (offset !== null);
    assert.equal(parts.trim(), longText.trim());
    // Opaque tokens must not authorize browser APIs outside the scoped surface.
    await http(
      "/api/pages/delete",
      { pageId: page.pageId },
      { token: writable.token, status: 401 },
    );
    await http(
      "/api/agent/tools/get_context",
      {},
      { token: `${writable.token.slice(0, -3)}xyz`, status: 401 },
    );
    const apiContext = await http(
      "/api/agent/tools/get_context",
      {},
      { token: writable.token },
    );
    assert.equal(apiContext.user.id, context.user.id);
    await http(
      "/mcp",
      { jsonrpc: "2.0", method: "tools/list", id: 1 },
      {
        token: writable.token,
        headers: {
          Origin: "https://untrusted.invalid",
          Accept: "application/json, text/event-stream",
        },
        status: 403,
      },
    );
    // Permissions are checked afresh, including inherited restrictions.
    const [restriction] =
      await sql`insert into page_access(page_id,workspace_id,space_id,access_level) values(${page.pageId},${context.workspace.id},${a.id},'restricted') returning id`;
    await tool(
      rw,
      "read_page",
      { pageId: page.pageId },
      /[Ff]orbidden|permission|access/i,
    );
    assert.ok(
      !(await tool(rw, "search", { query: "searchable" })).items.some(
        (p) => p.id === page.pageId,
      ),
    );
    await sql`insert into page_permissions(page_access_id,user_id,role) values(${restriction.id},${context.user.id},'reader')`;
    const memberships = await sql`delete from space_members where space_id=${a.id} returning *`;
    try {
      // Explicit page access retains the same precedence as the human API.
      assert.equal((await tool(rw, "read_page", { pageId: page.pageId })).id, page.pageId);
      await tool(rw, "add_comment", { pageId: page.pageId, markdown: 'Denied', requestKey: key() }, /Forbidden|permission/i);
      await tool(rw, "read_page", { pageId: long.pageId }, /not found|Forbidden|permission/i);
    } finally {
      if (memberships.length) await sql`insert into space_members ${sql(memberships)}`;
    }
    await sql`delete from page_access where id=${restriction.id}`;
    await sql`update api_keys set expires_at=now()-interval '1 minute' where id=${readonly.id}`;
    await http(
      "/api/agent/tools/get_context",
      {},
      { token: readonly.token, status: 401 },
    );
    await sql`update users set deactivated_at=now() where id=${context.user.id}`;
    await http(
      "/api/agent/tools/get_context",
      {},
      { token: writable.token, status: 401 },
    );
    await sql`update users set deactivated_at=null where id=${context.user.id}`;
    await http(`/api/agent-tokens/${writable.id}/revoke`);
    await http(
      "/api/agent/tools/get_context",
      {},
      { token: writable.token, status: 401 },
    );
    await http("/api/workspace/update", { mcpEnabled: false });
    await http(
      "/api/agent/tools/get_context",
      {},
      { token: all.token, status: 403 },
    );
    await http("/api/workspace/update", { mcpEnabled: true });
    const audit =
      await sql`select metadata from audit where event='agent.page_edited' and resource_id=${page.pageId}`;
    assert.equal(audit.length, 3);
    assert.equal(audit[0].metadata.agentName, "Francis");
    console.log(
      "PASS: MCP handshake/discovery, scoped tools, authenticated attribution, ACL changes, direct edits, rich-block preservation, retry idempotency, conflicts, pagination, comments/history, API boundaries, expiry/revocation/disable.",
    );
  } finally {
    for (const { provider, socket } of providers) {
      provider.destroy();
      socket.destroy();
    }
    await Promise.allSettled(clients.map((c) => c.close()));
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
