import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFixtures, makeUsageFixtures, CODEX_ID, CODEX_NEXT } from "./fixtures.mjs";
const FX = makeFixtures();
process.env.SCOUT_HOME = mkdtempSync(join(tmpdir(), "scout-"));
process.env.SCOUT_ENV_ID_FILE = join(process.env.SCOUT_HOME, "env-id");
process.env.SCOUT_CLAUDE_DIR = join(FX, "claude");
process.env.SCOUT_CODEX_DIR = join(FX, "codex");
process.env.SCOUT_LOOKBACK_DAYS = "100000";
const C = await import("../core/collect.mjs");
const { findPrivacyProblem } = await import("../core/rules.mjs");

test("reads Claude and Codex sessions and keeps only safe signals", () => {
  const { rows } = C.collect({ onlyChanged: false });
  assert.equal(rows.length, 3);
  const s = JSON.stringify(rows);
  for (const bad of ["cfat_", "hf_bbbb", "ghp_", "/Users/", "acme.example.com", "alex@acme.com", "acme-secret", "health-notes", "my token"])
    assert.ok(!s.includes(bad), `leaked ${bad}`);
  assert.equal(findPrivacyProblem(s), null);
  const claude = rows.find(r => r.source === "claude" && r.observations.tools.Bash).observations;
  assert.equal(claude.app, "claude-code"); assert.equal(claude.model, "claude-opus-5-5");
  assert.deepEqual(Object.keys(claude.commands).sort(), ["curl", "hf", "npx", "pip"]);
  assert.ok(claude.packages.includes("wrangler") && claude.packages.includes("mlx-vlm") && claude.packages.includes("transformers"));
  assert.deepEqual(claude.models.sort(), ["Qwen/Qwen3-4B", "mlx-community/clef-flash-4bit"]);
  assert.equal(claude.languages.typescript, 1); assert.equal(claude.languages["cloudflare-config"], 1);
  assert.equal(claude.tools["mcp:claude_docs"], 1); assert.equal(claude.errors, 1); assert.equal(claude.edits, 2); assert.equal(claude.turns, 2);
  const codex = rows.find(r => r.source === "codex").observations;
  assert.equal(codex.app, "codex-desktop"); assert.equal(codex.model, "gpt-5.5-codex");
  for (const c of ["npm", "git", "rg", "ffmpeg"]) assert.ok(codex.commands[c], `codex command ${c}`);
  assert.ok(codex.packages.includes("gsap") && codex.packages.includes("@cloudflare/workers-types"));
  assert.equal(codex.languages.liquid, 1); assert.equal(codex.languages.python, 1);
  assert.ok(codex.tools.exec_command >= 2 && codex.tools.apply_patch >= 1); assert.equal(codex.errors, 1);
  assert.ok(codex.imports.includes("requests"));
});

test("bundle passes Scout's rules and the AI Work Assessment validator", async () => {
  const { rows } = C.collect({ onlyChanged: false });
  const [b] = C.toBundles(rows);
  assert.match(b.environment.id, /^[a-f0-9]{24}$/);
  try {
    const upstream = await import("/tmp/claude-0/awa/src/evidence-bundle.js");
    const v = upstream.validateBundle(b);
    assert.equal(v.session_evidence.length, 3);
  } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND") return; throw e; }
});

test("exclude list skips matching projects locally", () => {
  process.env.SCOUT_EXCLUDE = "*acme*,health-*";
  const { rows, skipped } = C.collect({ onlyChanged: false, settings: C.loadSettings() });
  delete process.env.SCOUT_EXCLUDE;
  assert.equal(rows.length, 1); assert.equal(rows[0].source, "codex"); assert.equal(skipped.excluded, 2);
});

test("source checkboxes: Codex only", () => {
  process.env.SCOUT_CLAUDE = "false";
  const { rows } = C.collect({ onlyChanged: false, settings: C.loadSettings() });
  delete process.env.SCOUT_CLAUDE;
  assert.ok(rows.length === 1 && rows[0].source === "codex");
});

test("cursor: only changed sessions are collected next time", () => {
  const first = C.collect();
  assert.equal(first.rows.length, 3);
  C.commitCursor(first.seen);
  assert.equal(C.collect().rows.length, 0);
  const f = join(FX, "codex/2026/10/02", readdirSync(join(FX, "codex/2026/10/02"))[0]);
  const t = new Date(); utimesSync(f, t, t);
  assert.equal(C.collect().rows.length, 1);
});

test("planted secret inside observations makes toBundles throw", () => {
  const { rows } = C.collect({ onlyChanged: false });
  rows[0].observations.packages.push("cfat_" + "Z".repeat(30));
  assert.throws(() => C.toBundles(rows), /credential/);
});

test("inline scripts count as code, not commands", () => {
  const sig = { commands: {}, packages: new Set(), models: new Set(), imports: new Set(), languages: {} };
  C.shellSignals("python3 - <<'PY'\nimport pandas as pd\nfrom sklearn import svm\nconst x = 1\nPY\nnode -e \"const fs=require('fs'); import('x')\" && git status", sig);
  assert.deepEqual(Object.keys(sig.commands).sort(), ["git", "node", "python3"]);
  assert.ok(sig.imports.has("pandas") && sig.imports.has("sklearn"));
});

// Reads the usage fixtures by pointing the source folders there for one call.
function collectUsage() {
  const UX = makeUsageFixtures(), saved = { ...C.SOURCE_DIRS };
  Object.assign(C.SOURCE_DIRS, { claude: join(UX, "claude"), codex: join(UX, "codex") });
  try { return C.collect({ onlyChanged: false }).rows; } finally { Object.assign(C.SOURCE_DIRS, saved); }
}

test("token usage, models used, active minutes and subagents (numbers and model names only)", () => {
  const rows = collectUsage();
  assert.equal(rows.length, 4);
  assert.equal(findPrivacyProblem(JSON.stringify(rows)), null);
  assert.ok(!JSON.stringify(rows).includes("/Users/"));
  const by = id => rows.find(r => r.native_session_digest === C.sessionDigest(id.source, id.id))?.observations;
  const main = by({ source: "claude", id: "u-1" });
  assert.deepEqual(main.tokens, { input: 13, output: 24, cache_read: 100, cache_write: 5 }); // m1 once (last wins), <synthetic> skipped
  assert.deepEqual(main.llms, { "claude-opus-5-5": 1, "claude-sonnet-5": 1 });
  assert.equal(main.active_minutes, 15); assert.equal(main.subagents, 1);
  const codex = by({ source: "codex", id: CODEX_ID });
  assert.deepEqual(codex.tokens, { input: 1100, output: 80, cache_read: 900, cache_write: 0, reasoning: 10 });
  assert.deepEqual(codex.llms, { "gpt-5.5-codex": 1, "openai/gpt-oss-120b": 1 });
  assert.equal(codex.active_minutes, 10); assert.equal(codex.subagents, undefined);
});

test("files that reuse a session id get their own rows", () => {
  const rows = collectUsage();
  const has = (source, id) => rows.some(r => r.native_session_digest === C.sessionDigest(source, id));
  assert.ok(has("claude", "u-1") && has("claude", "u-1:agent-x"));
  assert.ok(has("codex", CODEX_ID) && has("codex", `${CODEX_ID}:rollout-2026-10-04T10-30-00-${CODEX_ID}_${CODEX_NEXT}`));
  assert.deepEqual(rows.find(r => r.native_session_digest === C.sessionDigest("claude", "u-1:agent-x")).observations.llms, { "claude-haiku-5": 1 });
});
