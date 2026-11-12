import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
process.env.SCOUT_HOME = mkdtempSync(join(tmpdir(), "scout-desktop-state-"));
process.env.SCOUT_ENV_ID_FILE = join(process.env.SCOUT_HOME, "env");
const { SOURCE_DIRS, collect, toBundles, loadSettings } = await import("../core/collect.mjs");

test("Desktop and Cowork metadata is allowlisted, scheduled and subagent aware", () => {
  const root = mkdtempSync(join(tmpdir(), "scout-desktop-"));
  const original = { ...SOURCE_DIRS };
  const put = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); };
  const transcript = (id, entrypoint) => [{ type: "user", sessionId: id, entrypoint, timestamp: "2026-11-10T12:00:00Z", message: { content: "private prompt" } },
    { type: "assistant", sessionId: id, timestamp: "2026-11-10T12:01:00Z", message: { id: "msg", model: "claude-sonnet-4", content: [] } }].map(JSON.stringify).join("\n");
  try {
    for (const source of Object.keys(original)) SOURCE_DIRS[source] = join(root, source);
    const secrets = { title: "PRIVATE_TITLE", initialMessage: "PRIVATE_PROMPT", systemPrompt: "PRIVATE_SYSTEM", emailAddress: "nobody@example.org", accountName: "PRIVATE_NAME", egressAllowedDomains: ["https://private.example.org"], remoteMcpServersConfig: { token: "PRIVATE_TOKEN" }, cwd: "/Users/private/secret" };
    put(join(SOURCE_DIRS.desktop, "account/org/local_code.json"), JSON.stringify({ ...secrets, sessionId: "code", scheduledTaskId: "scheduled" }));
    put(join(SOURCE_DIRS.claude, "project/code.jsonl"), transcript("code", "claude-desktop"));
    put(join(SOURCE_DIRS.cowork, "account/org/local_work.json"), JSON.stringify({ ...secrets, cliSessionId: "work", scheduledTaskId: "scheduled", userSelectedFolders: ["/Users/private/project"] }));
    const project = join(SOURCE_DIRS.cowork, "account/org/local_work/.claude/projects/project");
    put(join(project, "work.jsonl"), transcript("work"));
    put(join(project, "work/subagents/agent-one.jsonl"), transcript("work"));
    put(join(project, "work/subagents/agent-two.jsonl"), transcript("work"));
    put(join(SOURCE_DIRS.cowork, "account/org/local_work/audit.jsonl"), transcript("audit"));
    const result = collect({ onlyChanged: false, settings: { sources: ["claude", "cowork"], lookbackDays: 3650, exclude: [] } });
    assert.equal(result.rows.length, 4);
    assert.equal(new Set(result.rows.map(row => row.native_session_digest)).size, 4);
    assert.equal(result.rows.filter(row => row.observations.app === "claude-cowork").length, 3);
    for (const row of result.rows) { assert.equal(row.observations.launch, "headless"); assert.equal(row.observations.harness, "scheduled-task"); }
    const serialized = JSON.stringify(toBundles(result.rows));
    for (const secret of ["PRIVATE_", "nobody@", "https://", "/Users/"]) assert.ok(!serialized.includes(secret), secret);
    SOURCE_DIRS.cowork = join(root, "missing");
    assert.equal(collect({ onlyChanged: false, settings: { sources: ["cowork"], lookbackDays: 3650, exclude: [] } }).rows.length, 0);
  } finally { Object.assign(SOURCE_DIRS, original); rmSync(root, { recursive: true, force: true }); }
});

test("Cowork toggle defaults to Claude and supports override", () => {
  const previous = [process.env.SCOUT_CLAUDE, process.env.SCOUT_COWORK];
  try {
    process.env.SCOUT_CLAUDE = "false"; delete process.env.SCOUT_COWORK;
    assert.ok(!loadSettings().sources.includes("cowork"));
    process.env.SCOUT_COWORK = "true";
    assert.ok(loadSettings().sources.includes("cowork"));
  } finally {
    for (const [index, key] of ["SCOUT_CLAUDE", "SCOUT_COWORK"].entries()) if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
  }
});
