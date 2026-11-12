import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

const origin = "https://scout.example";
const hash = async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const statement = (sql, values = []) => ({ bind: (...args) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values),
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }) });
  const env = { DB: { prepare: statement, batch: async statements => {
    db.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  db.prepare("INSERT INTO workspaces VALUES ('ws_test','Test',NULL,?,'2026-01-01')").run(await hash("browser-secret"));
  db.prepare("INSERT INTO device_keys (key_hash,workspace_id,client,created_at) VALUES (?,'ws_test','computer','2026-01-01')").run(await hash("computer-key"));
  const call = (path, input = {}, headers = {}) => worker.fetch(new Request(origin + path, {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(input),
  }), env);
  return { db, env, call };
}

test("phone linking: auth, cookie-only secret, one-time collection, same-origin isolation", async () => {
  const { db, env, call } = await setup();
  const link = await (await call("/api/link/start")).json();
  assert.match(link.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(db.prepare("SELECT poll_hash FROM links").get().poll_hash, link.poll_token);
  assert.equal((await call("/api/link/approve", { code: link.code })).status, 401);
  assert.equal((await (await call("/api/link/poll", { poll_token: link.poll_token })).json()).status, "pending");
  assert.equal((await call("/api/link/approve", { code: link.code }, { authorization: "Bearer computer-key" })).status, 200);
  const result = await call("/api/link/poll", { poll_token: link.poll_token });
  assert.deepEqual(await result.json(), { status: "approved" });
  const cookie = result.headers.get("set-cookie");
  const deletion = await worker.fetch(new Request(origin + "/api/transcripts", { method: "DELETE", headers: { origin, cookie: cookie.split(";")[0] } }), env);
  assert.equal(deletion.status, 401);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM device_keys WHERE client='phone-browser'").get().n, 1);
  assert.equal((await call("/api/link/poll", { poll_token: link.poll_token })).status, 409);
  assert.equal((await call("/api/link/approve", { code: link.code }, { authorization: "Bearer computer-key" })).status, 409);
  for (const requestOrigin of [null, "https://evil.example", origin]) {
    const headers = { cookie: cookie.split(";")[0] };
    if (requestOrigin) headers.origin = requestOrigin;
    const response = await worker.fetch(new Request(origin + "/api/profile", { headers }), env);
    assert.equal(response.status, requestOrigin === origin ? 200 : 401);
    if (response.ok) assert.equal((await response.json()).workspace, "ws_test");
  }
});

test("concurrent link creation cannot exceed the IP allowance", async () => {
  const { call } = await setup();
  const responses = await Promise.all(Array.from({ length: 20 }, () => call("/api/link/start", {}, { "cf-connecting-ip": "192.0.2.10" })));
  assert.equal(responses.filter(response => response.status === 200).length, 10);
  assert.equal(responses.filter(response => response.status === 429).length, 10);
});

test("returning browser, expiry after approval, rate limit, and cross-origin starts", async () => {
  const { db, call } = await setup();
  assert.equal((await call("/api/link/start", {}, { origin: "https://evil.example" })).status, 403);
  const link = await (await call("/api/link/start", {}, { cookie: "scout_ws=browser-secret" })).json();
  assert.equal(db.prepare("SELECT status FROM links WHERE code=?").get(link.code).status, "approved");
  db.prepare("UPDATE links SET expires_at='2020-01-01' WHERE code=?").run(link.code);
  assert.equal((await call("/api/link/poll", { poll_token: link.poll_token })).status, 410);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await call("/api/link/start", {}, { "cf-connecting-ip": "192.0.2.1" })).status, 200);
  assert.equal((await call("/api/link/start", {}, { "cf-connecting-ip": "192.0.2.1" })).status, 429);
  assert.equal((await call("/api/link/poll", { poll_token: "forged" })).status, 404);
});
