#!/usr/bin/env node
// scout-connect: used by the hooks and for testing. People don't need to run this; the plugin does.
import { startPairing, finishPairing, previewNow, sync, syncIfDue, status, disconnect } from "./client.mjs";
import { saveSettings } from "./collect.mjs";
const [cmd = "status", ...rest] = process.argv.slice(2);
const flag = f => rest.includes(f);
const out = v => process.stdout.write(JSON.stringify(v, null, 2) + "\n");
try {
  if (cmd === "preview") out(previewNow({ all: flag("--all") }));
  else if (cmd === "connect") out(await startPairing());
  else if (cmd === "finish") out(await finishPairing({ wait: Number(rest[0]) || 0 }));
  else if (cmd === "sync") { const r = flag("--if-due") ? await syncIfDue() : await sync({ all: flag("--all") }); if (!flag("--quiet")) out(r); }
  else if (cmd === "status") out(await status());
  else if (cmd === "disconnect") out(disconnect());
  else if (cmd === "set") { const [k, v] = rest; saveSettings({ [k]: v === "true" ? true : v === "false" ? false : k === "exclude" ? v.split(",") : v }); out({ ok: true }); }
  else { out({ error: `unknown command ${cmd}`, commands: ["preview", "connect", "finish", "sync", "status", "disconnect", "set"] }); process.exitCode = 2; }
} catch (e) { if (!flag("--quiet")) out({ error: e.message }); process.exitCode = 1; }
