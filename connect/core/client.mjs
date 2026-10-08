// Talk to Scout: pair this computer (no tokens to copy), send bundles, read the profile.
import { readFileSync } from "node:fs";
import { settingsPath } from "./collect.mjs";
const readPending = () => { try { return JSON.parse(readFileSync(settingsPath(), "utf8")).pending || null; } catch { return null; } };
import { collect, commitCursor, loadSettings, preview, saveSettings, toBundles, VERSION } from "./collect.mjs";

async function call(path, { method = "GET", body, key, settings = loadSettings() } = {}) {
  const r = await fetch(settings.server + path, {
    method, headers: { "content-type": "application/json", "user-agent": `scout-connect/${VERSION}`, ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || `Scout answered ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// Step 1: ask Scout for a short code and a link the person opens to approve this computer.
export async function startPairing() {
  const s = loadSettings();
  const j = await call("/api/pair/start", { method: "POST", body: { client: `scout-connect/${VERSION}` }, settings: s });
  saveSettings({ pending: { poll: j.poll_token, code: j.code, expires_at: j.expires_at } });
  return { code: j.code, url: j.url, expires_at: j.expires_at };
}
// Step 2: check whether the person approved it. Saves the key on success; the key is never shown.
export async function finishPairing({ wait = 0 } = {}) {
  const s = loadSettings();
  const pending = readPending();
  if (!pending?.poll) return { status: "not_started" };
  const until = Date.now() + wait * 1000;
  for (;;) {
    const j = await call("/api/pair/poll", { method: "POST", body: { poll_token: pending.poll }, settings: s });
    if (j.status === "approved" && j.key) { saveSettings({ key: j.key, workspace: j.workspace, pending: null }); return { status: "connected", workspace: j.workspace }; }
    if (j.status === "expired") { saveSettings({ pending: null }); return { status: "expired" }; }
    if (Date.now() >= until) return { status: "waiting", code: pending.code };
    await new Promise(r => setTimeout(r, 3000));
  }
}

export function previewNow({ all = false } = {}) {
  const { rows, skipped, filesScanned } = collect({ onlyChanged: !all });
  return { ...preview(rows), files_scanned: filesScanned, skipped };
}

// Collect what changed since last time and send it. Returns counts only.
export async function sync({ all = false } = {}) {
  const s = loadSettings();
  if (!s.key) return { status: "not_connected" };
  const { rows, seen, skipped, filesScanned } = collect({ onlyChanged: !all, settings: s });
  if (!rows.length) { commitCursor(seen); return { status: "up_to_date", files_scanned: filesScanned, skipped }; }
  let stored = 0;
  for (const b of toBundles(rows)) stored += (await call("/api/evidence", { method: "POST", body: b, key: s.key, settings: s })).stored || 0;
  commitCursor(seen);
  saveSettings({ lastSync: new Date().toISOString() });
  return { status: "sent", sessions: rows.length, stored, files_scanned: filesScanned, skipped };
}

// Debounced sync for hooks and timers: at most once every `minutes`.
export async function syncIfDue({ minutes = 10 } = {}) {
  const s = loadSettings();
  if (!s.key) return { status: "not_connected" };
  let last = 0; try { last = Date.parse(JSON.parse(readFileSync(settingsPath(), "utf8")).lastAttempt || "") || 0; } catch {}
  if (Date.now() - last < minutes * 60e3) return { status: "skipped_recent" };
  saveSettings({ lastAttempt: new Date().toISOString() });
  return sync();
}

export async function status() {
  const s = loadSettings();
  const base = { connected: Boolean(s.key), server: s.server, sources: s.sources, auto_sync: s.autoSync, exclude: s.exclude };
  if (!s.key) return base;
  try { return { ...base, profile: await call("/api/profile", { key: s.key, settings: s }) }; }
  catch (e) { return { ...base, error: e.message }; }
}

export function disconnect() { saveSettings({ key: null, workspace: null, pending: null }); return { status: "disconnected" }; }
