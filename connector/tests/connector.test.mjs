import assert from "node:assert/strict";
import test from "node:test";

const worker = (await import("../worker/index.js")).default;

const env = {
  OWNER_EMAIL: "owner@example.com",
  DB: {
    prepare() {
      throw new Error("Database should not be used by this test");
    },
  },
};

test("publishes OAuth discovery metadata", async () => {
  const response = await worker.fetch(
    new Request("https://hakuto-diary-connector.hirokazu601218.chatgpt.site/.well-known/oauth-authorization-server"),
    env
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.issuer, "https://hakuto-diary-connector.hirokazu601218.chatgpt.site");
  assert.deepEqual(body.code_challenge_methods_supported, ["S256"]);
  assert.ok(body.scopes_supported.includes("diary.write"));
});

test("MCP endpoint challenges requests without an OAuth token", async () => {
  const response = await worker.fetch(
    new Request("https://hakuto-diary-connector.hirokazu601218.chatgpt.site/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    }),
    env
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
});

test("authorization accepts only ChatGPT clients", async () => {
  const response = await worker.fetch(
    new Request("https://hakuto-diary-connector.hirokazu601218.chatgpt.site/oauth/authorize?client_id=https%3A%2F%2Fevil.example%2Fclient&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback&response_type=code&scope=diary.write&resource=https%3A%2F%2Fhakuto-diary-connector.hirokazu601218.chatgpt.site%2Fapi%2Fmcp&code_challenge=x&code_challenge_method=S256"),
    env
  );
  assert.equal(response.status, 400);
});
