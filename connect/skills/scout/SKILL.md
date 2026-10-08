---
name: a1-scout
description: Connect this computer's Claude Code and Codex sessions to A1 Scout and answer questions about it. Use when the person wants to connect to Scout, asks what Scout knows about their work, wants open models or tools matched to what they do, or asks what is shared with Scout.
---

# A1 Scout

A1 Scout matches open models, datasets and tools from Hugging Face to the work this person does in Claude and Codex. The `a1-scout` tools read session logs on this computer and send Scout only summaries: which tools, commands, languages, libraries and models were used, with counts and dates.

## Connecting

1. Call `connect_scout`.
2. Show the person the link and the code exactly as the tool returns them. Tell them to open the link, check the code matches, and click "Connect this computer".
3. They don't need to come back. The first summary is sent automatically after they approve.
4. If they ask whether it worked, call `scout_status`.

## Questions about privacy

- Call `preview_scout_summary` to show exactly what would be sent. Nothing is sent by that call.
- Scout never receives prompts, replies, file contents, file paths, project names, web addresses, emails, passwords or keys. Say so plainly.
- To leave a project out, call `scout_settings` with `exclude` (folder names or patterns like `client-*`).
- To stop completely, call `disconnect_scout`.

## Rules

- Never read session logs yourself or paste their contents anywhere. The tools do the reading and filtering.
- Don't call `sync_scout_now` repeatedly. Automatic sync runs while the app is open and after sessions end.
- Use plain language. Most people using Scout aren't developers: say "your Claude and Codex history", not "JSONL" or "MCP".
