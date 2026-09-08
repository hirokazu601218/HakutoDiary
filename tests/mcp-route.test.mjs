import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./cloudflare-loader.mjs", import.meta.url);

function testContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

function assets() {
  return {
    fetch: async () => new Response("Not found", { status: 404 }),
  };
}

function fakeDatabase() {
  const entries = new Map();
  return {
    entries,
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.startsWith("SELECT id FROM diary_entries")) {
            return entries.get(bindings[0]) ?? null;
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO diary_entries")) {
            entries.set(bindings[0], { id: entries.size + 1, values: bindings });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
    },
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("mcp-test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

function rpcRequest(method, params, id = 1, email = "owner@example.com") {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-email": email,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

test("MCP lists only the safe new-entry tool", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    rpcRequest("tools/list"),
    {
      ASSETS: assets(),
      DB: fakeDatabase(),
      HAKUTO_MCP_ALLOWED_EMAILS: "owner@example.com",
    },
    testContext()
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name), [
    "register_diary_entry",
  ]);
  assert.equal(body.result.tools[0].annotations.destructiveHint, false);
  assert.equal(body.result.tools[0].annotations.readOnlyHint, false);
});

test("MCP rejects callers outside the allowlist", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    rpcRequest("tools/list", undefined, 1, "someone@example.com"),
    {
      ASSETS: assets(),
      DB: fakeDatabase(),
      HAKUTO_MCP_ALLOWED_EMAILS: "owner@example.com",
    },
    testContext()
  );

  assert.equal(response.status, 403);
});

test("MCP registers once and refuses duplicate dates", async () => {
  const worker = await loadWorker();
  const database = fakeDatabase();
  const runtime = {
    ASSETS: assets(),
    DB: database,
    HAKUTO_MCP_ALLOWED_EMAILS: "owner@example.com",
  };
  const args = {
    diary_date: "2026-09-02",
    daycare_reply: "清水先生より\n今日は水遊びをしました＾＾笑♪",
    parent_message: "元気です。",
  };

  const first = await worker.fetch(
    rpcRequest("tools/call", {
      name: "register_diary_entry",
      arguments: args,
    }),
    runtime,
    testContext()
  );
  const firstBody = await first.json();
  assert.equal(firstBody.result.structuredContent.saved, true);
  assert.equal(database.entries.size, 1);
  assert.equal(database.entries.get("2026-09-02").values[1], args.daycare_reply);

  const duplicate = await worker.fetch(
    rpcRequest("tools/call", {
      name: "register_diary_entry",
      arguments: args,
    }, 2),
    runtime,
    testContext()
  );
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.result.structuredContent.duplicate, true);
  assert.equal(database.entries.size, 1);
});

test("internal connector requires its service token", async () => {
  const worker = await loadWorker();
  const database = fakeDatabase();
  const runtime = {
    ASSETS: assets(),
    DB: database,
    HAKUTO_CONNECTOR_SERVICE_TOKEN: "test-service-token",
  };
  const body = JSON.stringify({
    diary_date: "2026-09-03",
    daycare_reply: "先生より\n元気に遊びました♪",
    parent_message: "",
  });

  const denied = await worker.fetch(
    new Request("http://localhost/internal/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    runtime,
    testContext()
  );
  assert.equal(denied.status, 401);
  assert.equal(database.entries.size, 0);

  const allowed = await worker.fetch(
    new Request("http://localhost/internal/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-service-token",
      },
      body,
    }),
    runtime,
    testContext()
  );
  const result = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(result.structuredContent.saved, true);
  assert.equal(database.entries.size, 1);
});
