#!/usr/bin/env node
// Scout MCP server (stdio). Works in Claude Desktop (.mcpb), Claude Code and Codex plugins.
// It reads session logs on this computer, keeps prompts and paths here, and sends only summaries to Scout.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startPairing, finishPairing, previewNow, sync, syncIfDue, status, disconnect } from "../core/client.mjs";
import { loadSettings, saveSettings, VERSION } from "../core/collect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "core", "cli.mjs");
const AUTO_MINUTES = Number(process.env.SCOUT_SYNC_MINUTES || 30);

const TOOLS = [
  { name: "connect_scout", title: "Connect to A1 Scout",
    description: "Connect this computer to A1 Scout so it can match Hugging Face models and tools to the work you do in Claude and Codex. Returns a short code and a link for the person to open and approve. After they approve, the first summary is sent automatically.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: "scout_status", title: "Scout status",
    description: "Show whether this computer is connected to Scout, when it last synced, and a summary of the work profile Scout has (top tools, languages, libraries, models).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "preview_scout_summary", title: "Preview what Scout receives",
    description: "Show exactly what would be sent to Scout from this computer's Claude and Codex sessions: counts of tools, commands, languages, packages and models. Nothing is sent.",
    inputSchema: { type: "object", properties: { all: { type: "boolean", description: "Include sessions already sent before." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "sync_scout_now", title: "Send to Scout now",
    description: "Send summaries of new or changed sessions to Scout right away.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: "scout_settings", title: "Scout settings",
    description: "Change what Scout reads: Claude Code sessions, Codex sessions, automatic syncing, and project folders to leave out (folder names or patterns like client-*).",
    inputSchema: { type: "object", properties: {
      claude: { type: "boolean", description: "Read Claude Code and Cowork sessions." },
      codex: { type: "boolean", description: "Read Codex sessions." },
      auto_sync: { type: "boolean", description: "Send new sessions automatically while this app is open." },
      exclude: { type: "array", items: { type: "string" }, description: "Project folder names or patterns to never read." } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "disconnect_scout", title: "Disconnect from Scout",
    description: "Stop sending to Scout from this computer and forget its connection key.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];

let pollTimer = null;
function watchPairing() {
  clearInterval(pollTimer);
  const until = Date.now() + 15 * 60e3;
  pollTimer = setInterval(async () => {
    try {
      const r = await finishPairing();
      if (r.status === "connected") { clearInterval(pollTimer); await sync(); }
      else if (r.status !== "waiting" || Date.now() > until) clearInterval(pollTimer);
    } catch { /* offline: keep trying until the code expires */ }
  }, 4000);
}

const fmtList = (items, n = 8) => (items || []).slice(0, n).map(x => `${x.name} (${x.count})`).join(", ") || "none yet";
const fmtObj = (o, n = 10) => Object.entries(o || {}).slice(0, n).map(([k, v]) => `${k} (${v})`).join(", ") || "none";

async function callTool(name, args = {}) {
  if (name === "connect_scout") {
    const s = loadSettings();
    if (s.key) { const r = await sync(); return `This computer is already connected to Scout. ${r.status === "sent" ? `Sent ${r.sessions} new session summaries.` : "Everything is up to date."}`; }
    const p = await startPairing();
    watchPairing();
    return [`Open this link to connect: ${p.url}`, `Check that the page shows the code ${p.code}, then click "Connect this computer".`,
      "The link works for 15 minutes. After you approve, Scout gets its first summary automatically; you don't need to come back here.",
      "Show the person the link and the code exactly as written above."].join("\n");
  }
  if (name === "scout_status") {
    const st = await status();
    if (!st.connected) return `Not connected to Scout yet. Reading: ${st.sources.join(" and ") || "nothing"}. Use connect_scout to connect.`;
    if (st.error) return `Connected, but Scout couldn't be reached: ${st.error}`;
    const p = st.profile, t = p.top;
    return [`Connected to Scout. ${p.sessions} sessions from ${p.computers} computer(s) and ${p.projects} project(s). Last session: ${p.last_session || "none"}.`,
      `Automatic sync: ${st.auto_sync ? "on" : "off"}. Reading: ${st.sources.join(" and ")}.${st.exclude.length ? ` Leaving out: ${st.exclude.join(", ")}.` : ""}`,
      `Languages: ${fmtList(t.languages)}`, `Libraries: ${fmtList(t.libraries)}`, `Packages: ${fmtList(t.packages)}`,
      `Models: ${fmtList(t.models)}`, `Commands: ${fmtList(t.commands)}`].join("\n");
  }
  if (name === "preview_scout_summary") {
    const p = previewNow({ all: Boolean(args.all) });
    return [`${p.sessions} session(s) would be summarized (${p.files_scanned} log files checked; ${p.skipped.unchanged} unchanged, ${p.skipped.excluded} left out by your settings).`,
      `Apps: ${fmtObj(p.apps)}`, `Languages: ${fmtObj(p.languages)}`, `Packages: ${fmtObj(p.packages, 15)}`, `Models: ${fmtObj(p.models)}`,
      `Commands: ${fmtObj(p.top_commands, 12)}`, `Tools: ${fmtObj(p.top_tools)}`,
      "Prompts, replies, file contents, file paths, project names, web addresses, emails and keys are not included."].join("\n");
  }
  if (name === "sync_scout_now") {
    const r = await sync();
    if (r.status === "not_connected") return "Not connected yet. Use connect_scout first.";
    return r.status === "sent" ? `Sent ${r.sessions} session summaries to Scout.` : "Scout is up to date; nothing new to send.";
  }
  if (name === "scout_settings") {
    const patch = {};
    if (typeof args.claude === "boolean") patch.claude = args.claude;
    if (typeof args.codex === "boolean") patch.codex = args.codex;
    if (typeof args.auto_sync === "boolean") patch.autoSync = args.auto_sync;
    if (Array.isArray(args.exclude)) patch.exclude = args.exclude.map(String).map(x => x.trim()).filter(Boolean).slice(0, 50);
    saveSettings(patch);
    const s = loadSettings();
    return `Saved. Reading: ${s.sources.join(" and ") || "nothing"}. Automatic sync: ${s.autoSync ? "on" : "off"}.${s.exclude.length ? ` Leaving out: ${s.exclude.join(", ")}.` : ""}`;
  }
  if (name === "disconnect_scout") { disconnect(); return "Disconnected. This computer no longer sends anything to Scout."; }
  throw new Error(`Unknown tool ${name}`);
}

// ---- JSON-RPC over stdio ----
const send = m => process.stdout.write(JSON.stringify(m) + "\n");
async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: {
    protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} },
    serverInfo: { name: "a1-scout", title: "A1 Scout", version: VERSION },
    instructions: "A1 Scout matches open models and tools to the work this person does. Use connect_scout when they want to connect, and always show them the link and code it returns. Use preview_scout_summary when they ask what is shared." } });
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    try { return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: await callTool(params?.name, params?.arguments || {}) }] } }); }
    catch (e) { return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Scout: ${e.message}` }], isError: true } }); }
  }
  if (id !== undefined && id !== null && !String(method || "").startsWith("notifications/"))
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    handle(msg);
  }
});

// Automatic sync while the app is open, and one last sync when it closes.
if (process.env.SCOUT_NO_TIMERS !== "1") {
  setTimeout(() => { if (loadSettings().autoSync) syncIfDue({ minutes: 5 }).catch(() => {}); }, 20e3).unref();
  setInterval(() => { if (loadSettings().autoSync) syncIfDue({ minutes: AUTO_MINUTES - 1 }).catch(() => {}); }, AUTO_MINUTES * 60e3).unref();
  process.stdin.on("end", () => {
    if (loadSettings().autoSync && loadSettings().key) spawn(process.execPath, [CLI, "sync", "--if-due", "--quiet"], { detached: true, stdio: "ignore" }).unref();
    process.exit(0);
  });
}
