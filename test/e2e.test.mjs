// End to end: real client code + real Worker code, D1 backed by SQLite (node:sqlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(root, "schema.sql"), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); return []; } };
}
const env = { DB: d1(), SURVEY_URL: "", GTM_ID: "", ADMIN_TOKEN: "admin" };
const worker = (await import(join(root, "src/index.js"))).default;
const ORIGIN = "https://scout.test";
let jar = "";
const browser = async (path, init = {}) => {
  const r = await worker.fetch(new Request(ORIGIN + path, { ...init, headers: { "content-type": "application/json", cookie: jar, "cf-connecting-ip": "9.9.9.9", ...(init.headers || {}) } }), env);
  const sc = r.headers.get("set-cookie"); if (sc) jar = sc.split(";")[0];
  return [r.status, await r.json()];
};

const { makeFixtures } = await import(join(root, "connect/test/fixtures.mjs"));
const FX = makeFixtures();
process.env.SCOUT_HOME = mkdtempSync(join(tmpdir(), "scout-e2e-"));
process.env.SCOUT_ENV_ID_FILE = join(process.env.SCOUT_HOME, "env");
process.env.SCOUT_CLAUDE_DIR = join(FX, "claude");
process.env.SCOUT_CODEX_DIR = join(FX, "codex");
process.env.SCOUT_LOOKBACK_DAYS = "100000";
process.env.SCOUT_SERVER = ORIGIN;
globalThis.fetch = (url, init) => worker.fetch(new Request(url, init), env); // the client talks to the Worker directly
const client = await import(join(root, "connect/core/client.mjs"));

test("pair, approve in the browser, sync, read profile", async () => {
  assert.deepEqual(await client.sync(), { status: "not_connected" });
  const start = await client.startPairing();
  assert.match(start.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(start.url.endsWith(`/connect/?code=${start.code}`));
  assert.equal((await client.finishPairing()).status, "waiting");

  const [s1, info] = await browser(`/api/pair/info?code=${start.code}`);
  assert.equal(s1, 200); assert.equal(info.status, "pending"); assert.equal(info.returning, null);
  assert.equal((await browser("/api/pair/approve", { method: "POST", body: JSON.stringify({ code: start.code }) }))[0], 400); // name required
  const [s2] = await browser("/api/pair/approve", { method: "POST", body: JSON.stringify({ code: start.code, name: "Ann", email: "ann@example.com" }) });
  assert.equal(s2, 200); assert.ok(jar.startsWith("scout_ws="));
  assert.equal((await browser("/api/pair/approve", { method: "POST", body: JSON.stringify({ code: start.code, name: "Ann" }) }))[0], 409); // single use

  const fin = await client.finishPairing();
  assert.equal(fin.status, "connected");
  const settings = JSON.parse(readFileSync(join(process.env.SCOUT_HOME, "settings.json"), "utf8"));
  assert.match(settings.key, /^sk_scout_[a-f0-9]{48}$/);
  const keyRows = env.DB.db.prepare("SELECT key_hash FROM device_keys").all();
  assert.equal(keyRows.length, 1); assert.notEqual(keyRows[0].key_hash, settings.key); // stored hashed only

  const sent = await client.sync();
  assert.equal(sent.status, "sent"); assert.equal(sent.sessions, 3); assert.equal(sent.stored, 3);
  assert.equal((await client.sync()).status, "up_to_date");
  const raw = JSON.stringify(env.DB.db.prepare("SELECT * FROM evidence").all());
  for (const bad of ["cfat_", "ghp_", "/Users/", "alex@acme.com", "acme-secret"]) assert.ok(!raw.includes(bad), `stored ${bad}`);

  const st = await client.status();
  assert.equal(st.connected, true); assert.equal(st.profile.sessions, 3); assert.equal(st.profile.computers, 1);
  const names = k => st.profile.top[k].map(x => x.name);
  assert.ok(names("packages").includes("mlx-vlm") && names("models").includes("mlx-community/clef-flash-4bit"));
  assert.ok(!names("libraries").includes("os"));
  assert.ok(env.DB.db.prepare("SELECT 1 FROM waitlist WHERE email = 'ann@example.com'").get());
});

test("a second computer approved from the same browser joins the same workspace", async () => {
  const before = env.DB.db.prepare("SELECT COUNT(*) n FROM workspaces").get().n;
  const p = await worker.fetch(new Request(ORIGIN + "/api/pair/start", { method: "POST", body: "{}" }), env).then(r => r.json());
  const [, info] = await browser(`/api/pair/info?code=${p.code}`);
  assert.equal(info.returning.name, "Ann");
  assert.equal((await browser("/api/pair/approve", { method: "POST", body: JSON.stringify({ code: p.code }) }))[0], 200);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) n FROM workspaces").get().n, before);
});

test("evidence is refused without a key, with a forged key, or with a leaking bundle", async () => {
  const post = (b, key) => worker.fetch(new Request(ORIGIN + "/api/evidence", { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: JSON.stringify(b) }), env);
  assert.equal((await post({})).status, 401);
  assert.equal((await post({}, "sk_scout_" + "0".repeat(48))).status, 401);
  const key = JSON.parse(readFileSync(join(process.env.SCOUT_HOME, "settings.json"), "utf8")).key;
  const leak = { bundle_schema_version: 1, environment: { id: "a".repeat(24), kind: "computer" }, collected_at: new Date().toISOString(),
    source_coverage: [], session_evidence: [{ source: "claude", native_session_digest: "b".repeat(64), project_fingerprint: "c".repeat(64),
      first_event: "2026-10-01T00:00:00Z", last_event: "2026-10-01T01:00:00Z", evidence_quality: "full-transcript", event_count: 2,
      observations: { note: "see /Users/ann/secret" } }] };
  const r = await post(leak, key);
  assert.equal(r.status, 400); assert.equal((await r.json()).code, "BUNDLE_PRIVATE_DATA_DETECTED");
});

test("expired and unknown codes", async () => {
  env.DB.db.prepare("INSERT INTO pairings (code, poll_hash, status, created_at, expires_at) VALUES ('OLD1-OLD1','x','pending','2020-01-01','2020-01-01')").run();
  assert.equal((await browser("/api/pair/info?code=OLD1-OLD1"))[0], 410);
  assert.equal((await browser("/api/pair/info?code=NOPE-NOPE"))[0], 404);
});

test("full transcripts are opt-in: nothing until turned on, then history, then deleted on request", async () => {
  const store = new Map();
  env.TRANSCRIPTS = {
    put: async (k, v) => { store.set(k, new Uint8Array(await new Response(v).arrayBuffer())); return { size: store.get(k).length }; },
    list: async ({ prefix }) => ({ objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }),
    delete: async keys => { for (const k of [].concat(keys)) store.delete(k); },
  };
  const { saveSettings } = await import(join(root, "connect/core/collect.mjs"));
  const off = await client.sync({ all: true });
  assert.equal(off.transcripts, 0); assert.equal(store.size, 0);            // default: summaries only
  saveSettings({ transcripts: true });
  const on = await client.sync();                                           // first sync after opting in sends history
  assert.ok(on.transcripts > 0); assert.equal(store.size, on.transcripts);
  const ws = [...store.keys()][0].split("/")[1];
  assert.ok([...store.keys()].every(k => k.startsWith(`ws/${ws}/`) && k.endsWith(".jsonl.gz")));
  assert.equal((await client.sync()).status, "up_to_date");                 // then only what changed
  const st = await client.status();
  assert.equal(st.transcripts, true); assert.equal(st.profile.transcripts.n, store.size);
  // A transcript for a session this workspace never summarized is refused.
  const settings = JSON.parse(readFileSync(join(process.env.SCOUT_HOME, "settings.json"), "utf8"));
  const r = await worker.fetch(new Request(`${ORIGIN}/api/transcripts?source=claude&digest=${"f".repeat(64)}`, { method: "PUT", body: "x", headers: { authorization: `Bearer ${settings.key}` } }), env);
  assert.equal(r.status, 409);
  const del = await client.deleteTranscripts();
  assert.equal(del.deleted, on.transcripts); assert.equal(store.size, 0);
  assert.equal((await client.status()).transcripts, false);
});
