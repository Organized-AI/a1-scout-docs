import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { claude, chatgpt } from "./chat-fixtures.mjs";
import * as chats from "../core/chats.mjs";
import * as signals from "../core/signals.mjs";
import { findPrivacyProblem, validateBundle } from "../core/rules.mjs";
import { preview } from "../core/collect.mjs";

test("Claude tools, fences, packages, hashes, minutes and bundle validation", async () => {
  const rows = await chats.readClaudeExport(claude), observations = rows[0].observations;
  assert.equal(observations.turns, 1); assert.equal(observations.errors, 1);
  assert.equal(observations.tools["mcp:docs"], 1); assert.equal(observations.active_minutes, 10);
  assert.deepEqual(observations.packages, ["transformers", "gsap"]);
  assert.deepEqual(observations.imports, ["requests", "transformers"]);
  assert.equal(rows[0].native_session_digest, createHash("sha256").update("claude\0chat:synthetic-claude").digest("hex"));
  assert.equal(rows[0].project_fingerprint, createHash("sha256").update("chat/claude").digest("hex"));
  for (const bundle of chats.chatBundles(rows, "a".repeat(24))) validateBundle(bundle);
  assert.deepEqual(chats.chatPreview(rows), preview(rows));
});
test("ChatGPT uses only visible active branch, tools, errors and primary model", async () => {
  const rows = await chats.readChatGPTExport(chatgpt), observations = rows[0].observations;
  assert.equal(observations.turns, 1); assert.equal(observations.model, "gpt-5");
  assert.deepEqual({ ...observations.llms }, { "gpt-5": 2 });
  assert.equal(observations.tools.python, 2); assert.equal(observations.errors, 1);
  assert.deepEqual(observations.imports, ["numpy"]);
  assert.equal(rows[0].source, "other"); assert.equal(observations.app, "chatgpt");
  for (const bundle of chats.chatBundles(rows, "a".repeat(24))) validateBundle(bundle);
});
test("private text, URLs, paths, secrets and emails never enter the bundle", async () => {
  const fixture = structuredClone(claude), secret = "sk-" + "a".repeat(30);
  fixture[0].uuid = secret;
  fixture[0].chat_messages.push({ sender: "assistant", created_at: "2026-01-01", model: secret, text: `PRIVATE TITLE https://private.example /Users/alex/private.json alex@private.example ${secret}\n\`\`\`bash\npip install ${secret} https://private.example\n\`\`\`` });
  const serialized = JSON.stringify(chats.chatBundles(await chats.readClaudeExport(fixture), "a".repeat(24)));
  for (const forbidden of [secret, "PRIVATE TITLE", "private.example", "/Users/", "alex@", "private.json"]) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(findPrivacyProblem(serialized), null);
  assert.equal(chats.detectExport({}), null); assert.equal(chats.detectExport([]), null);
});
test("browser signal helpers match collector helpers on identical inputs", () => {
  const source = readFileSync(new URL("../core/collect.mjs", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const WORD ="), source.indexOf("export function readClaude("));
  const tail = source.slice(source.indexOf("const top ="), source.indexOf("// ---------- state ----------"));
  const original = new Function("basename", "extname", "findPrivacyProblem", (block + tail).replace(/export /g, "") + ";return {langOf,shellSignals,codeSignals,patchSignals,toolName,newSig,stamp,observationsOf}")(basename, extname, findPrivacyProblem);
  const results = [];
  for (const helper of [signals, original]) {
    const sig = helper.newSig(); sig.app = "claude-chat"; sig.harness = "scheduled-task";
    helper.shellSignals('npm install gsap; pip install requests; python3 app.py', sig);
    helper.codeSignals('import requests\nfrom_pretrained("Qwen/Qwen3-4B")', sig);
    helper.patchSignals('*** Add File: code.ts\n+import numpy', sig);
    helper.stamp(sig, "2026-01-01T10:00:00Z");
    sig.tools[helper.toolName("mcp__docs__search")] = 2;
    results.push(helper.observationsOf(sig));
  }
  assert.deepEqual(results[0], results[1]);
  for (const path of ["Dockerfile", "wrangler.toml", "a/b/.hidden", "a/b/file.py", "foo.", "..", "a/b/thing.ts/", "a/.x.py"]) assert.equal(signals.langOf(path), original.langOf(path));
});
