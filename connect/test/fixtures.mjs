// Builds test session logs in a temp folder at run time, so no token-shaped strings are stored in git.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function makeFixtures() {
  const root = mkdtempSync(join(tmpdir(), "scout-fx-"));
  const CF = "cf" + "at_" + "A".repeat(40), HF = "h" + "f_" + "b".repeat(34), GH = "gh" + "p_" + "c".repeat(36);
  const claude = [
    { type: "user", sessionId: "s-1", cwd: "/Users/alex/clients/acme-secret", timestamp: "2026-10-01T10:00:00Z", message: { role: "user", content: "deploy it, my token is " + CF } },
    { type: "assistant", sessionId: "s-1", timestamp: "2026-10-01T10:00:05Z", message: { model: "claude-opus-5-5", content: [
      { type: "tool_use", name: "Bash", input: { command: `CLOUDFLARE_API_TOKEN=${CF} npx wrangler@4 deploy && curl -s https://acme.example.com/health` } },
      { type: "tool_use", name: "Bash", input: { command: `pip install mlx-vlm transformers && hf download mlx-community/clef-flash-4bit --token ${HF}` } },
      { type: "tool_use", name: "Edit", input: { file_path: "/Users/alex/clients/acme-secret/src/index.ts", old_string: "a", new_string: "from transformers import AutoModel\nAutoModel.from_pretrained('Qwen/Qwen3-4B')" } },
      { type: "tool_use", name: "Write", input: { file_path: "/Users/alex/clients/acme-secret/wrangler.jsonc", content: "{}" } },
      { type: "tool_use", name: "mcp__Claude_Docs__batch", input: {} }] } },
    { type: "user", sessionId: "s-1", timestamp: "2026-10-01T10:01:00Z", message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "failed for alex@acme.com" }] } },
    { type: "user", sessionId: "s-1", timestamp: "2026-10-01T10:02:00Z", message: { role: "user", content: [{ type: "text", text: "email alex@acme.com the result" }] } },
  ];
  const health = [
    { type: "user", sessionId: "s-2", cwd: "/Users/alex/private/health-notes", timestamp: "2026-10-03T10:00:00Z", message: { role: "user", content: "x" } },
    { type: "assistant", sessionId: "s-2", timestamp: "2026-10-03T10:00:01Z", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/Users/alex/private/health-notes/a.md" } }] } },
  ];
  const codex = [
    { timestamp: "2026-10-02T09:00:00Z", type: "session_meta", payload: { id: "c-1", cwd: "/Users/alex/work/gtm-tools", originator: "Codex Desktop", source: "vscode" } },
    { timestamp: "2026-10-02T09:00:01Z", type: "turn_context", payload: { model: "gpt-5.5-codex", cwd: "/Users/alex/work/gtm-tools" } },
    { timestamp: "2026-10-02T09:00:02Z", type: "event_msg", payload: { type: "task_started" } },
    { timestamp: "2026-10-02T09:00:03Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: `npm install gsap @cloudflare/workers-types && git push https://${GH}@github.com/x/y`, workdir: "/Users/alex/work/gtm-tools" }) } },
    { timestamp: "2026-10-02T09:00:04Z", type: "response_item", payload: { type: "function_call_output", output: "{\"exit_code\": 1}" } },
    { timestamp: "2026-10-02T09:00:05Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "const r = await tools.exec_command({cmd: \"rg -n stape src && ffmpeg -i in.mp4 out.gif\"});\nconst p = await tools.apply_patch(`*** Begin Patch\n*** Update File: src/tags/meta.liquid\n*** End Patch`);" } },
    { timestamp: "2026-10-02T09:00:06Z", type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Add File: /Users/alex/work/gtm-tools/worker.py\n+import requests\n*** End Patch" } },
    { timestamp: "2026-10-02T09:00:07Z", type: "response_item", payload: { type: "function_call", name: "mcp__codex_apps__github_fetch_file", arguments: "{}" } },
  ];
  const w = (dir, name, rows) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, name), rows.map(r => JSON.stringify(r)).join("\n") + "\n"); };
  w("claude/-Users-alex-clients-acme-secret", "s-1.jsonl", claude);
  w("claude/-Users-alex-private-health", "s-2.jsonl", health);
  w("codex/2026/10/02", "rollout-2026-10-02T09-00-00-c-1.jsonl", codex);
  return root;
}

// Separate root for token usage, active minutes, subagents and shared session ids, so the counts above stay intact.
export const CODEX_ID = "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001", CODEX_NEXT = "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0002";
export function makeUsageFixtures() {
  const root = mkdtempSync(join(tmpdir(), "scout-ux-"));
  const at = m => new Date(Date.parse("2026-10-04T10:00:00Z") + m * 60e3).toISOString();
  const use = (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens) => ({ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens });
  const as = (m, id, model, usage) => ({ type: "assistant", sessionId: "u-1", timestamp: at(m), message: { id, model, usage, content: [] } });
  const claude = [
    { type: "user", sessionId: "u-1", cwd: "/Users/alex/work/usage", timestamp: at(0), message: { role: "user", content: "go" } },
    as(0.1, "m1", "claude-opus-5-5", use(10, 1, 100, 5)), as(0.2, "m1", "claude-opus-5-5", use(10, 20, 100, 5)), // same message: last wins
    as(7, "m2", "claude-sonnet-5", use(3, 4, 0, 0)), as(7.1, "m3", "<synthetic>", use(999, 999, 999, 999)),
    { type: "user", sessionId: "u-1", isSidechain: true, parentUuid: null, timestamp: at(12), message: { role: "user", content: "sub task" } },
    { type: "user", sessionId: "u-1", isSidechain: true, parentUuid: "p-1", timestamp: at(12.5), message: { role: "user", content: [] } },
  ];
  const agent = [
    { type: "user", sessionId: "u-1", isSidechain: true, timestamp: at(1), message: { role: "user", content: "sub task" } },
    as(2, "m9", "claude-haiku-5", use(1, 2, 0, 0)),
  ];
  const tc = (m, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens) => ({ timestamp: at(m), type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens } } } });
  const codex = [
    { timestamp: at(0), type: "session_meta", payload: { id: CODEX_ID, cwd: "/Users/alex/work/usage", originator: "codex_cli_rs" } },
    { timestamp: at(0), type: "turn_context", payload: { model: "gpt-5.5-codex" } },
    tc(1, 1000, 400, 50, 0, 1050), tc(6, 2000, 900, 80, 10, 2080), tc(7, 300, 0, 200, 0, 500), // running totals: keep the largest
    { timestamp: at(8), type: "turn_context", payload: { model: "openai/gpt-oss-120b" } },
  ];
  const next = [
    { timestamp: at(30), type: "session_meta", payload: { id: CODEX_ID, cwd: "/Users/alex/work/usage", originator: "codex_cli_rs" } },
    { timestamp: at(31), type: "turn_context", payload: { model: "gpt-5.5-codex" } },
  ];
  const w = (dir, name, rows) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, name), rows.map(r => JSON.stringify(r)).join("\n") + "\n"); };
  w("claude/-Users-alex-work-usage", "u-1.jsonl", claude);
  w("claude/-Users-alex-work-usage/u-1/subagents", "agent-x.jsonl", agent);
  w("codex/2026/10/04", `rollout-2026-10-04T10-00-00-${CODEX_ID}.jsonl`, codex);
  w("codex/2026/10/04", `rollout-2026-10-04T10-30-00-${CODEX_ID}_${CODEX_NEXT}.jsonl`, next);
  return root;
}
