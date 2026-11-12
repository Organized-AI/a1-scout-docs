# A1 Scout connector (Claude + Codex)

Reads Claude Code, Cowork and Codex session logs **on the user's computer** and sends A1 Scout only privacy-safe summaries (tool, command, language, library, package and model counts per session). Prompts, replies, file contents, paths, project names, URLs, emails and keys never leave the machine. Bundles use the AI Work Assessment evidence-bundle schema v1, so they also validate there.

## Ways in (no terminal)

| App | Install | Sync |
|---|---|---|
| Claude Desktop | Double-click `a1-scout.mcpb` (from scout.organizedai.vip/#connect). Checkboxes: Claude history, Codex history, sync automatically, projects to leave out. | Every 30 min while Claude is open, and when it closes |
| Claude Code / Cowork | `/plugin marketplace add Organized-AI/a1-scout-docs` then `/plugin install a1-scout@organized-ai` | After each session (SessionEnd/Stop hooks, at most every 10 min) + timer |
| Codex app / CLI | Plugins → Add plugin marketplace: Source `Organized-AI/a1-scout-docs`, Git ref `main`, Sparse paths empty → install A1 Scout | Timer while Codex is open + on close; hooks where Codex runs plugin hooks |

Then ask: "connect me to A1 Scout". The person opens the link, checks the code, clicks Connect. No tokens to copy.

## Phone chats and remote MCP

Link a phone browser at `/connect/link/`. Ask an already connected computer's Claude or Codex to “link my phone to A1 Scout, code XXXX-XXXX” (`link_phone`). The phone receives an HttpOnly device cookie, never a key in JSON. Then use `/connect/import/` to read an export locally. Exports cover **all chats on the account**, not only phone chats. Nothing is sent until you review the names-and-counts preview and press Send.

For optional live summaries, add `https://scout.organizedai.vip/mcp` on **claude.ai web: Customize → Connectors → Add custom** (some layouts use Settings → Connectors → Add custom connector). Complete OAuth, link the browser if needed, check the client/redirect shown, and allow `scout:chat`. A connector configured on the web can be used from the Claude iPhone app under the same account; real-app verification is still pending for this release. Ask Claude to log this chat's names and counts using `scout_log_chat`; `scout_status` reads the summary. No background logging is promised.

For ChatGPT, use the **web** app's Settings → Apps → Advanced settings → Developer mode, then add a custom MCP app with the same URL and OAuth. Availability depends on account/workspace permissions. **ChatGPT phone support: to verify**; do not assume the phone app can use it. Export import works independently of remote connector availability.

Remote MCP calls run through the chat provider's infrastructure, not a device-local collector. Live logging is explicitly **model-reported** and opt-in; export parsing remains deterministic and on-device. Tools accept identifiers and counts, not transcripts, titles, URLs, paths or emails. Stable opaque chat references are hashed before storage. Reusing a reference updates its row. Remove the connector in the chat app to stop its use; access tokens expire after an hour and refresh grants after 30 days.

Setup references: [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [ChatGPT developer mode](https://help.openai.com/en/articles/12584461).

## Connector files

- `core/rules.mjs` bundle schema + privacy rules (shared with the Worker, runs in Node and Workers)
- `core/collect.mjs` readers for Claude Code, Claude Desktop (Cowork) and Codex logs, signal extraction, bundles, cursor
- `core/client.mjs` pairing, sync, status
- `mcp/server.mjs` stdio MCP server: connect_scout, link_phone, scout_status, preview_scout_summary, sync_scout_now, scout_settings, disconnect_scout
- `hooks/` session-end hook (Claude format; Codex sets CLAUDE_PLUGIN_ROOT for compatibility)
- `skills/scout/SKILL.md`, `.claude-plugin/`, `.codex-plugin/`, `.mcp.json` plugin packaging
- `mcpb/` Claude Desktop extension manifest + icon; `scripts/build-mcpb.sh` builds `public/download/a1-scout.mcpb`

Local state lives in `~/.scout/` (settings, connection key, cursor), mode 600.

## Tests

`node --test test/*.test.mjs connect/test/*.test.mjs` from the repo root (Node 22+, uses node:sqlite for a local D1).
