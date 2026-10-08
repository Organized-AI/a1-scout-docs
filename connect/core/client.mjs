// Talk to Scout: pair this computer (no tokens to copy), send bundles, read the profile.
import { readFileSync } from "node:fs";
import { settingsPath } from "./collect.mjs";
const readPending = () => { try { return JSON.parse(readFileSync(settingsPath(), "utf8")).pending || null; } catch { return null; } };
import { collect, commitCursor, loadSettings, preview, saveSettings, toBundles, VERSION, STATE_DIR } from "./collect.mjs";
import { packTranscript } from "./transcripts.mjs";
import { rmSync } from "node:fs";
import { join } from "node:path";
const savedFlag = k => { try { return JSON.parse(readFileSync(settingsPath(), "utf8"))[k] || null; } catch { return null; } };

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
// With full transcripts turned on (opt-in), each of those sessions' whole log is also sent, credential-scrubbed and
// gzipped; the first sync after opting in sends every session in the lookback window.
export async function sync({ all = false } = {}) {
  const s = loadSettings();
  if (!s.key) return { status: "not_connected" };
  const backfill = s.transcripts && !savedFlag("transcriptsBackfilledAt");
  const { rows, files, seen, skipped, filesScanned } = collect({ onlyChanged: !(all || backfill), settings: s, limit: all || backfill ? Infinity : 5000 });
  if (!rows.length) { commitCursor(seen); if (backfill) saveSettings({ transcriptsBackfilledAt: new Date().toISOString() }); return { status: "up_to_date", files_scanned: filesScanned, skipped }; }
  let stored = 0, transcripts = 0;
  for (const b of toBundles(rows)) stored += (await call("/api/evidence", { method: "POST", body: b, key: s.key, settings: s })).stored || 0;
  if (s.transcripts) for (const f of files) {
    const t = packTranscript(f, join(STATE_DIR, "outbox"));
    if (!t.path) continue;
    try { await putTranscript(t, s); transcripts++; } finally { rmSync(t.path, { force: true }); }
  }
  commitCursor(seen);
  saveSettings({ lastSync: new Date().toISOString(), ...(backfill ? { transcriptsBackfilledAt: new Date().toISOString() } : {}) });
  return { status: "sent", sessions: rows.length, stored, transcripts, files_scanned: filesScanned, skipped };
}

async function putTranscript(t, s) {
  const q = new URLSearchParams({ source: t.source, digest: t.digest, bytes: String(t.bytes), redacted: String(t.redacted) });
  const r = await fetch(`${s.server}/api/transcripts?${q}`, { method: "PUT", body: readFileSync(t.path),
    headers: { authorization: `Bearer ${s.key}`, "content-type": "application/gzip", "user-agent": `scout-connect/${VERSION}` } });
  if (!r.ok) { let j = {}; try { j = await r.json(); } catch {} throw new Error(j.error || `Scout answered ${r.status} for a transcript`); }
}

// Delete every transcript Scout holds for this workspace. Summaries are kept.
export async function deleteTranscripts() {
  const s = loadSettings();
  if (!s.key) return { status: "not_connected" };
  const j = await call("/api/transcripts", { method: "DELETE", key: s.key, settings: s });
  saveSettings({ transcripts: false, transcriptsBackfilledAt: null });
  return { status: "deleted", deleted: j.deleted || 0 };
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
  const base = { connected: Boolean(s.key), server: s.server, sources: s.sources, auto_sync: s.autoSync, exclude: s.exclude, transcripts: s.transcripts };
  if (!s.key) return base;
  try { return { ...base, profile: await call("/api/profile", { key: s.key, settings: s }) }; }
  catch (e) { return { ...base, error: e.message }; }
}

export function disconnect() { saveSettings({ key: null, workspace: null, pending: null }); return { status: "disconnected" }; }
