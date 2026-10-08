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
