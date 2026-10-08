// The MCP server as Claude/Codex run it: a child process speaking JSON-RPC over stdio,
// talking to the real Worker code served over HTTP with a SQLite-backed D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const db = new DatabaseSync(":memory:"); db.exec(readFileSync(join(root, "schema.sql"), "utf8"));
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) });
const env = { DB: { prepare: s => stmt(s), batch: async l => { for (const s of l) await s.run(); } } };
const worker = (await import(join(root, "src/index.js"))).default;
const http = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => http.listen(0, "127.0.0.1", r));
const SERVER = `http://127.0.0.1:${http.address().port}`;
const HOME = mkdtempSync(join(tmpdir(), "scout-mcp-"));
const { makeFixtures } = await import(join(root, "connect/test/fixtures.mjs"));
const FX = makeFixtures();

const proc = spawn(process.execPath, [join(root, "connect/mcp/server.mjs")], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env,
  SCOUT_HOME: HOME, SCOUT_ENV_ID_FILE: join(HOME, "env"), SCOUT_CLAUDE_DIR: join(FX, "claude"), SCOUT_CODEX_DIR: join(FX, "codex"),
  SCOUT_LOOKBACK_DAYS: "100000", SCOUT_SERVER: SERVER, SCOUT_NO_TIMERS: "1" } });
let buf = ""; const waiters = new Map(); let nextId = 1;
proc.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise(res => { const id = nextId++; waiters.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const tool = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result.content[0].text;

test("initialize and list tools", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.serverInfo.name, "a1-scout");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const list = await rpc("tools/list", {});
  assert.deepEqual(list.result.tools.map(t => t.name), ["connect_scout", "scout_status", "preview_scout_summary", "sync_scout_now", "scout_settings", "delete_scout_transcripts", "disconnect_scout"]);
  assert.equal((await rpc("nope", {})).error.code, -32601);
});

test("preview sends nothing and shows safe counts", async () => {
  const text = await tool("preview_scout_summary");
  assert.match(text, /3 session\(s\) would be summarized/);
  assert.match(text, /mlx-vlm/); assert.ok(!/cfat_|\/Users\/|acme/.test(text));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM evidence").get().n, 0);
});

test("connect: link + code, approve in browser, first sync happens by itself", async () => {
  assert.match(await tool("scout_status"), /Not connected/);
  const text = await tool("connect_scout");
  const url = text.match(/https?:\/\/\S+/)[0], code = text.match(/code ([A-Z2-9]{4}-[A-Z2-9]{4})/)[1];
  assert.ok(url.includes(code));
  const r = await fetch(`${SERVER}/api/pair/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Ann" }) });
  assert.equal(r.status, 200);
  for (let i = 0; i < 20 && db.prepare("SELECT COUNT(*) n FROM evidence").get().n === 0; i++) await new Promise(r => setTimeout(r, 500));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM evidence").get().n, 3);
  const st = await tool("scout_status");
  assert.match(st, /Connected to Scout\. 3 sessions from 1 computer/); assert.match(st, /mlx-community\/clef-flash-4bit/);
  assert.match(await tool("sync_scout_now"), /up to date/);
});

test("settings and disconnect", async () => {
  assert.match(await tool("scout_settings", { codex: false, exclude: ["client-*"] }), /Reading: claude\. .*Leaving out: client-\*/);
  assert.match(await tool("disconnect_scout"), /Disconnected/);
  assert.match(await tool("scout_status"), /Not connected/);
  proc.stdin.end(); http.close();
});
