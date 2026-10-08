# A1 Scout connector (Claude + Codex)

Reads Claude Code, Cowork and Codex session logs **on the user's computer** and sends A1 Scout only privacy-safe summaries (tool, command, language, library, package and model counts per session). Prompts, replies, file contents, paths, project names, URLs, emails and keys never leave the machine. Bundles use the AI Work Assessment evidence-bundle schema v1, so they also validate there.

## Ways in (no terminal)

| App | Install | Sync |
|---|---|---|
| Claude Desktop | Double-click `a1-scout.mcpb` (from scout.organizedai.vip/#connect). Checkboxes: Claude history, Codex history, sync automatically, projects to leave out. | Every 30 min while Claude is open, and when it closes |
| Claude Code / Cowork | `/plugin marketplace add Organized-AI/a1-scout-docs` then `/plugin install a1-scout@organized-ai` | After each session (SessionEnd/Stop hooks, at most every 10 min) + timer |
| Codex app / CLI | Plugins → add marketplace `Organized-AI/a1-scout-docs` → install A1 Scout | Timer while Codex is open + on close; hooks where Codex runs plugin hooks |

Then ask: "connect me to A1 Scout". The person opens the link, checks the code, clicks Connect. No tokens to copy.

## Layout

- `core/rules.mjs` bundle schema + privacy rules (shared with the Worker, runs in Node and Workers)
- `core/collect.mjs` readers for Claude and Codex logs, signal extraction, bundles, cursor
- `core/client.mjs` pairing, sync, status
- `mcp/server.mjs` stdio MCP server: connect_scout, scout_status, preview_scout_summary, sync_scout_now, scout_settings, disconnect_scout
- `hooks/` session-end hook (Claude format; Codex sets CLAUDE_PLUGIN_ROOT for compatibility)
- `skills/scout/SKILL.md`, `.claude-plugin/`, `.codex-plugin/`, `.mcp.json` plugin packaging
- `mcpb/` Claude Desktop extension manifest + icon; `scripts/build-mcpb.sh` builds `public/download/a1-scout.mcpb`

Local state lives in `~/.scout/` (settings, connection key, cursor), mode 600.

## Tests

`node --test test/*.test.mjs connect/test/*.test.mjs` from the repo root (Node 22+, uses node:sqlite for a local D1).
