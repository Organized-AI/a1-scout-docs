import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mcpHandler, chatLogBundle } from "../src/remote-mcp.js";

const input = { app: "claude-chat", model: "claude-sonnet-4-5", turns: 3, tools: { Bash: 2 }, languages: { python: 1 }, packages: ["requests"], models: ["claude-sonnet-4-5"], imports: ["json"], chat_ref: "12345678-1234-4321-8123-123456789abc" };
async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO workspaces VALUES ('ws_test','Test',NULL,'browser','2026-01-01'); INSERT INTO workspaces VALUES ('ws_other','Other',NULL,'other','2026-01-01')");
  const statement = (sql, values = []) => ({ bind: (...args) => statement(sql, args), first: async () => db.prepare(sql).get(...values), all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }) });
  const env = { DB: { prepare: statement, batch: async statements => Promise.all(statements.map(item => item.run())) } };
  const context = { props: { workspace: "ws_test" }, auth: { scope: ["scout:chat"] } };
  const call = (method, params, ctx = context, headers = {}) => mcpHandler.fetch(new Request("https://scout.example/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env, ctx);
  return { db, call, context };
}

test("remote MCP initialization, tools, authenticated logging and workspace isolation", async () => {
  const { db, call, context } = await setup();
  assert.equal((await (await call("initialize")).json()).result.protocolVersion, "2025-03-26");
  assert.deepEqual((await (await call("tools/list")).json()).result.tools.map(tool => tool.name), ["scout_log_chat", "scout_status"]);
  for (const turns of [3, 5]) {
    const response = await (await call("tools/call", { name: "scout_log_chat", arguments: { ...input, turns } })).json();
    assert.equal(response.result.isError, undefined);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM evidence").get().count, 1);
  const saved = db.prepare("SELECT * FROM evidence").get();
  assert.equal(JSON.parse(saved.observations).turns, 5);
  assert.ok(!JSON.stringify(saved).includes(input.chat_ref));
  const profile = JSON.parse((await (await call("tools/call", { name: "scout_status" })).json()).result.content[0].text);
  assert.equal(profile.sessions, 1);
  const other = JSON.parse((await (await call("tools/call", { name: "scout_status" }, { ...context, props: { workspace: "ws_other" } })).json()).result.content[0].text);
  assert.equal(other.sessions, 0);
});

test("remote MCP rejects private text, malformed signals and unauthorized requests", async () => {
  const { db, call, context } = await setup();
  for (const value of ["Write a private prompt", "https://private.example", "person@example.com", "/Users/private/file", "private.json", "sk-ant-123456789012345678901234567890"]) {
    const result = await (await call("tools/call", { name: "scout_log_chat", arguments: { ...input, packages: [value] } })).json();
    assert.equal(result.result.isError, true, value);
    assert.ok(!JSON.stringify(result).includes(value));
  }
  for (const patch of [{ turns: -1 }, { turns: 1.5 }, { prompt: "private" }, { chat_ref: "private title" }, { tools: { Bash: "secret" } }]) {
    assert.equal((await (await call("tools/call", { name: "scout_log_chat", arguments: { ...input, ...patch } })).json()).result.isError, true);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM evidence").get().count, 0);
  assert.equal((await call("tools/list", {}, {})).status, 401);
  assert.equal((await call("tools/list", {}, { ...context, auth: { scope: [] } })).status, 403);
  assert.equal((await call("tools/list", {}, context, { origin: "https://evil.example" })).status, 403);
  const bundle = await chatLogBundle({ ...input, app: "chatgpt", model: "gpt-5" }, "ws_test");
  assert.equal(bundle.session_evidence[0].source, "other");
});
