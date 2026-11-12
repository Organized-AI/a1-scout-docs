# Privacy

## Local session summaries

The connector reads enabled Claude Code, Claude Desktop (Cowork) and Codex logs locally. Exclude projects by folder name. It sends session dates and counts, tools, commands, languages, libraries, packages, model names and opaque computer/project fingerprints. Prompts, replies, contents, paths, client/project names, URLs, emails and credentials are excluded by default. Scout validates uploads again server-side.

## Phone chat exports

Claude and ChatGPT exports cover all account chats, not just phone chats. The browser worker reads only conversations.json, including from ZIP, on your device. The export is never uploaded. Preview names and counts before pressing Send. Only validated signals, dates and hashed identifiers reach the linked workspace. Chat titles and text are excluded. Imports never send full transcripts, regardless of the computer connector setting.

## Optional live logging

The OAuth connector reads your work profile and accepts model-reported names/counts when asked. Your chat provider produces that summary; this is not guaranteed device-local processing or automatic background capture. Scout rejects prompt-like text, URLs, paths, emails and recognized secrets. Opaque chat references are hashed before storage. Access tokens last one hour; refresh access lasts up to 30 days. Remove the connector in the chat app to stop using it. Real-app verification is pending; ChatGPT phone support is to verify.

## Full transcripts: separate computer opt-in

Off by default. Enabling full transcripts sends whole computer session logs, including prompts, replies, code and paths. Recognized credentials are redacted locally, but detection is not exhaustive. The first sync sends history, later syncs changed logs. Storage is workspace-private and requires an accepted summary. Ask “delete my transcripts from Scout” to delete them and disable the setting; summaries remain.

## Access and stopping

Only your approved workspace sees your data. Scout uses it to rank models/tools; it is not sold or shared. Disconnect or remove the computer extension to stop syncing. To delete the workspace, contact the address on your invite. [Open-source connector](https://github.com/Organized-AI/a1-scout-docs/tree/main/connect).
