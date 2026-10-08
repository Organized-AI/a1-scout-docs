#!/usr/bin/env node
// Runs when a Claude Code (or Codex) session ends or a turn stops. Starts a background sync and exits at once,
// so it never slows the app down. Syncs at most every 10 minutes.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => (input += c));
process.stdin.on("end", () => {
  let event = ""; try { event = JSON.parse(input).hook_event_name || ""; } catch {}
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "core", "cli.mjs");
  try { spawn(process.execPath, [cli, "sync", "--if-due", "--quiet"], { detached: true, stdio: "ignore" }).unref(); } catch {}
  if (event === "Stop") process.stdout.write(JSON.stringify({ continue: true }) + "\n");
  process.exit(0);
});
setTimeout(() => process.exit(0), 800).unref();
