// Read Claude Code and Codex session logs on this computer and turn each session into a small,
// privacy-safe summary. Raw prompts, replies, file contents, paths and command arguments never leave this module.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { findPrivacyProblem, validateBundle, BUNDLE_SCHEMA_VERSION } from "./rules.mjs";

export const VERSION = "0.1.0";
const HOME = homedir();
export const STATE_DIR = process.env.SCOUT_HOME || join(HOME, ".scout");
const sha256 = v => createHash("sha256").update(String(v ?? "")).digest("hex");

export const SOURCE_DIRS = {
  claude: process.env.SCOUT_CLAUDE_DIR || join(HOME, ".claude", "projects"),
  codex: process.env.SCOUT_CODEX_DIR || join(HOME, ".codex", "sessions"),
};

// Same salt file as the AI Work Assessment, so both tools report the same opaque computer ID.
export function environmentId() {
  const p = process.env.SCOUT_ENV_ID_FILE || join(HOME, ".ai-work-assessment", "environment-id");
  let salt = "";
  try { salt = readFileSync(p, "utf8").trim(); } catch {}
  if (!/^[a-f0-9]{64}$/.test(salt)) {
    salt = randomBytes(32).toString("hex");
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    writeFileSync(p, salt + "\n", { mode: 0o600 });
  }
  return sha256(`ai-work-assessment-environment\0${salt}`).slice(0, 24);
}

// Matches the assessment's project fingerprint: last two segments of a repo key or folder.
export function projectFingerprint(key) {
  const k = String(key || "").trim().toLowerCase().replace(/^git@([^:]+):/, "$1/").replace(/^https?:\/\//, "")
    .replace(/\.git$/, "").replace(/[?#].*$/, "").replace(/\\/g, "/").replace(/\/+$/, "").split("/").slice(-2).join("/");
  return sha256(k || "unknown-project");
}
export const sessionDigest = (source, id) => sha256(`${source}\0${String(id || "").trim()}`);

function walk(dir, test, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (e.isFile() && test(e.name)) out.push(p);
  }
  return out;
}
export function listSessionFiles(sources = ["claude", "codex"]) {
  const files = [];
  if (sources.includes("claude")) for (const f of walk(SOURCE_DIRS.claude, n => n.endsWith(".jsonl"))) files.push({ source: "claude", file: f });
  if (sources.includes("codex")) for (const f of walk(SOURCE_DIRS.codex, n => /^rollout-.*\.jsonl$/.test(n))) files.push({ source: "codex", file: f });
  return files;
}

// ---------- signal extraction (local only) ----------
const WORD = /^[a-z0-9][a-z0-9._+-]{0,30}$/i;
const PKG = /^(?:@[a-z0-9][a-z0-9._-]{0,40}\/)?[a-z0-9][a-z0-9._-]{0,60}(?:\[[a-z0-9,_-]+\])?$/i;
const HF_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{1,60}\/[A-Za-z0-9][A-Za-z0-9._-]{1,96}$/;
const EXT_LANG = { py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript",
  html: "html", css: "css", json: "json", jsonc: "json", md: "markdown", sh: "shell", zsh: "shell", bash: "shell", toml: "toml", yaml: "yaml",
  yml: "yaml", sql: "sql", rs: "rust", go: "go", swift: "swift", rb: "ruby", java: "java", kt: "kotlin", php: "php", ipynb: "notebook",
  liquid: "liquid", vue: "vue", svelte: "svelte", c: "c", cpp: "cpp", h: "c", cs: "csharp", r: "r", lua: "lua", tf: "terraform", dockerfile: "docker" };
const SKIP_WORDS = new Set(["const", "let", "var", "import", "from", "def", "print", "return", "await", "async", "function", "class", "#", "{", "}", ")", "sudo", "env", "time", "nohup", "exec", "then", "do", "done", "fi", "else", "if", "for", "while", "echo", "cd", "export", "set", "true", "false"]);

const bump = (m, k, n = 1) => { if (k) m[k] = (m[k] || 0) + n; };
function langOf(path) {
  const b = basename(String(path || "")).toLowerCase();
  if (b === "dockerfile") return "docker";
  if (b === "wrangler.jsonc" || b === "wrangler.toml") return "cloudflare-config";
  const e = extname(b).slice(1);
  return EXT_LANG[e] || null;
}

// Split a shell line into commands; keep only the program word, plus package names for install commands.
export function shellSignals(cmd, sig) {
  let s = String(cmd || "");
  const m = s.match(/^\s*(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/);
  if (m) s = m[2];
  // Inline scripts (python3 - <<'PY' ... PY) are code, not commands: read their imports, then drop them.
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n([\s\S]*?)\n\s*\2\b/g, (all, q, tag, body) => { codeSignals(body, sig); return ""; });
  s = s.replace(/\s-c\s+(['"])([\s\S]*?)\1/g, (all, q, body) => { if (/\bimport\b|\brequire\(/.test(body)) codeSignals(body.replace(/;\s*/g, "\n"), sig); return " "; });
  for (const part of s.split(/&&|\|\||;|\||\n/)) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    while (toks.length && (/^[A-Z_][A-Z0-9_]*=/.test(toks[0]) || SKIP_WORDS.has(toks[0]))) toks.shift();
    if (!toks.length) continue;
    const prog = basename(toks[0]);
    if (!WORD.test(prog) || /^[A-Z]{1,4}$/.test(prog) || SKIP_WORDS.has(prog)) continue;
    bump(sig.commands, prog);
    const args = toks.slice(1).filter(t => !t.startsWith("-"));
    const take = list => { for (const p of list) if (PKG.test(p) && !p.includes("..")) sig.packages.add(p.toLowerCase()); };
    if (["npm", "pnpm", "yarn", "bun"].includes(prog) && ["i", "install", "add"].includes(args[0])) take(args.slice(1));
    else if (["pip", "pip3", "pipx"].includes(prog) && args[0] === "install") take(args.slice(1));
    else if (prog === "uv" && (args[0] === "add" || (args[0] === "pip" && args[1] === "install"))) take(args.slice(args[0] === "add" ? 1 : 2));
    else if (prog === "brew" && args[0] === "install") take(args.slice(1));
    else if (prog === "cargo" && args[0] === "add") take(args.slice(1));
    else if (prog === "npx" || prog === "bunx") { const p = args[0]; if (p && PKG.test(p.replace(/@[\d.^~x-]+$/, ""))) sig.packages.add(p.replace(/@[\d.^~x-]+$/, "").toLowerCase()); }
    else if ((prog === "hf" || prog === "huggingface-cli") && args[0] === "download" && HF_REPO.test(args[1] || "")) sig.models.add(args[1]);
    else if (prog === "python" || prog === "python3" || prog === "node") { for (const a of args.slice(0, 1)) { const l = langOf(a); if (l) bump(sig.languages, l); } }
  }
}
function codeSignals(text, sig) {
  const t = String(text || "");
  for (const m of t.matchAll(/from_pretrained\(\s*["']([^"']+)["']/g)) if (HF_REPO.test(m[1])) sig.models.add(m[1]);
  for (const m of t.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w]*)/gm)) if (m[1].length > 1) sig.imports.add(m[1].toLowerCase());
}
function patchSignals(text, sig) {
  const t = String(text || "");
  for (const m of t.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) { bump(sig.languages, langOf(m[1].trim())); sig.edits++; }
  codeSignals(t.split("\n").filter(l => l.startsWith("+")).map(l => l.slice(1)).join("\n"), sig);
}
function toolName(name) {
  const n = String(name || "");
  if (n.startsWith("mcp__")) { const server = n.split("__")[1] || "mcp"; return "mcp:" + server.replace(/[^a-z0-9_-]/gi, "").slice(0, 30).toLowerCase(); }
  return WORD.test(n) ? n : null;
}

function newSig() {
  return { tools: {}, commands: {}, languages: {}, packages: new Set(), models: new Set(), imports: new Set(),
    errors: 0, edits: 0, turns: 0, events: 0, first: null, last: null, id: null, cwd: null, repo: null, model: null, app: null };
}
function stamp(sig, ts) {
  const t = Date.parse(ts || ""); if (!Number.isFinite(t)) return;
  if (!sig.first || t < sig.first) sig.first = t;
  if (!sig.last || t > sig.last) sig.last = t;
}

export function readClaude(lines) {
  const sig = newSig(); sig.app = "claude-code";
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    sig.events++; stamp(sig, o.timestamp);
    if (o.sessionId && !sig.id) sig.id = o.sessionId;
    if (o.cwd && !sig.cwd) sig.cwd = o.cwd;
    if (o.entrypoint && /desktop|cowork/i.test(o.entrypoint)) sig.app = "claude-desktop";
    const msg = o.message;
    if (o.type === "user" && msg && typeof msg.content === "string") sig.turns++;
    if (o.type === "user" && Array.isArray(msg?.content)) {
      if (msg.content.some(c => c.type === "text")) sig.turns++;
      for (const c of msg.content) if (c.type === "tool_result" && c.is_error) sig.errors++;
    }
    if (o.type === "assistant" && msg) {
      if (msg.model && !sig.model) sig.model = String(msg.model).slice(0, 40);
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c.type !== "tool_use") continue;
        bump(sig.tools, toolName(c.name));
        const inp = c.input || {};
        if (c.name === "Bash" && inp.command) shellSignals(inp.command, sig);
        if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(c.name)) { sig.edits++; bump(sig.languages, langOf(inp.file_path || inp.notebook_path)); codeSignals(inp.content || inp.new_string, sig); }
        if (c.name === "Read") bump(sig.languages, langOf(inp.file_path));
      }
    }
  }
  return sig;
}

export function readCodex(lines) {
  const sig = newSig(); sig.app = "codex";
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    sig.events++; stamp(sig, o.timestamp);
    const p = o.payload && typeof o.payload === "object" ? o.payload : {};
    if (o.type === "session_meta") {
      sig.id = sig.id || p.id || p.session_id; sig.cwd = sig.cwd || p.cwd;
      if (p.git?.repository_url) sig.repo = p.git.repository_url;
      if (/desktop/i.test(p.originator || "")) sig.app = "codex-desktop"; else if (/vscode/i.test(p.originator || p.source || "")) sig.app = "codex-ide"; else sig.app = "codex-cli";
    }
    if (o.type === "turn_context" && p.model && !sig.model) sig.model = String(p.model).slice(0, 40);
    if (o.type === "event_msg" && p.type === "task_started") sig.turns++;
    if (o.type === "event_msg" && p.type === "user_message") sig.turns += 0; // counted via task_started
    if (o.type !== "response_item") continue;
    if (p.type === "function_call") {
      bump(sig.tools, toolName(p.name));
      let a = {}; try { a = JSON.parse(p.arguments || "{}"); } catch {}
      if (p.name === "exec_command" || p.name === "shell" || p.name === "local_shell") shellSignals(Array.isArray(a.cmd || a.command) ? (a.cmd || a.command).join(" ") : (a.cmd || a.command), sig);
      if (p.name === "js" || p.name === "python") codeSignals(a.code, sig);
    } else if (p.type === "custom_tool_call") {
      bump(sig.tools, toolName(p.name));
      if (p.name === "apply_patch") patchSignals(p.input, sig);
      if (p.name === "exec") { // code-mode: a small JS program that calls tools
        for (const m of String(p.input || "").matchAll(/tools\.([a-zA-Z_]\w*)\s*\(/g)) bump(sig.tools, toolName(m[1]));
        for (const m of String(p.input || "").matchAll(/\bcmd\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) shellSignals(m[2].replace(/\\n/g, "\n").replace(/\\(["'`])/g, "$1"), sig);
        patchSignals(p.input, sig); codeSignals(p.input, sig);
      }
    } else if (p.type === "local_shell_call") {
      bump(sig.tools, "shell"); shellSignals((p.action?.command || []).join(" "), sig);
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const out = typeof p.output === "string" ? p.output : JSON.stringify(p.output || "");
      if (/"exit_code"\s*:\s*[1-9]|Process exited with code [1-9]/.test(out.slice(0, 4000))) sig.errors++;
    }
  }
  return sig;
}

const top = (m, n) => Object.fromEntries(Object.entries(m).filter(([k]) => k && k !== "null").sort((a, b) => b[1] - a[1]).slice(0, n));
const safeList = (set, n, re) => [...set].filter(x => re.test(x) && !findPrivacyProblem(x)).slice(0, n);

// The only shape that leaves the computer.
export function observationsOf(sig) {
  const obs = {
    app: sig.app, model: sig.model && /^[a-z0-9][a-z0-9._:-]{0,40}$/i.test(sig.model) ? sig.model : undefined,
    turns: sig.turns, edits: sig.edits, errors: sig.errors,
    tools: top(sig.tools, 25), commands: top(Object.fromEntries(Object.entries(sig.commands).filter(([k]) => WORD.test(k))), 30),
    languages: top(sig.languages, 12),
    packages: safeList(sig.packages, 40, PKG), models: safeList(sig.models, 20, HF_REPO),
    imports: safeList(sig.imports, 30, /^[a-z_][a-z0-9_]{1,40}$/),
  };
  for (const k of Object.keys(obs)) if (obs[k] === undefined) delete obs[k];
  return obs;
}

// ---------- state ----------
function loadJson(p, d) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } }
function saveJson(p, v) { mkdirSync(dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 }); }
export const settingsPath = () => join(STATE_DIR, "settings.json");
export const cursorPath = () => join(STATE_DIR, "cursor.json");
export function loadSettings() {
  const s = loadJson(settingsPath(), {});
  const envBool = (k, d) => (process.env[k] == null ? d : !/^(0|false|no|off)$/i.test(process.env[k]));
  return {
    server: process.env.SCOUT_SERVER || s.server || "https://scout.organizedai.vip",
    key: process.env.SCOUT_KEY || s.key || null,
    sources: [envBool("SCOUT_CLAUDE", s.claude !== false) && "claude", envBool("SCOUT_CODEX", s.codex !== false) && "codex"].filter(Boolean),
    exclude: (process.env.SCOUT_EXCLUDE ?? (s.exclude || []).join(",")).split(",").map(x => x.trim()).filter(Boolean),
    autoSync: envBool("SCOUT_AUTOSYNC", Boolean(s.autoSync)),
    lookbackDays: Number(process.env.SCOUT_LOOKBACK_DAYS || s.lookbackDays || 180),
  };
}
export function saveSettings(patch) { saveJson(settingsPath(), { ...loadJson(settingsPath(), {}), ...patch }); }

const globRe = g => new RegExp("^" + g.toLowerCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
export function isExcluded(cwd, exclude) {
  const c = String(cwd || "").toLowerCase().replace(/\\/g, "/");
  return exclude.some(g => { const name = c.split("/").filter(Boolean).pop() || ""; return globRe(g).test(c) || globRe(g).test(name); });
}

// ---------- build ----------
export function collect({ onlyChanged = true, settings = loadSettings(), limit = 5000 } = {}) {
  const cursor = onlyChanged ? loadJson(cursorPath(), {}) : {};
  const since = Date.now() - settings.lookbackDays * 86400e3;
  const rows = [], seen = {}, skipped = { excluded: 0, empty: 0, old: 0, unchanged: 0 };
  const files = listSessionFiles(settings.sources);
  for (const { source, file } of files) {
    let st; try { st = statSync(file); } catch { continue; }
    if (st.mtimeMs < since) { skipped.old++; continue; }
    const key = sha256(file);
    const mark = `${st.size}:${Math.round(st.mtimeMs)}`;
    seen[key] = mark;
    if (cursor[key] === mark) { skipped.unchanged++; continue; }
    let lines; try { lines = readFileSync(file, "utf8").split("\n").filter(Boolean); } catch { continue; }
    const sig = source === "claude" ? readClaude(lines) : readCodex(lines);
    if (!sig.first || sig.events < 2) { skipped.empty++; continue; }
    if (isExcluded(sig.cwd, settings.exclude)) { skipped.excluded++; continue; }
    const id = sig.id || basename(file, ".jsonl");
    rows.push({
      source, native_session_digest: sessionDigest(source, id),
      first_event: new Date(sig.first).toISOString(), last_event: new Date(sig.last).toISOString(),
      project_fingerprint: projectFingerprint(sig.repo || sig.cwd), evidence_quality: "full-transcript",
      event_count: sig.events, observations: observationsOf(sig),
    });
    if (rows.length >= limit) break;
  }
  return { rows, seen, skipped, filesScanned: files.length };
}

export function toBundles(rows, { chunk = 400 } = {}) {
  const env = { id: environmentId(), kind: "computer", label: `${platform() === "darwin" ? "macOS" : platform()} ${arch()}` };
  const out = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += chunk) {
    const part = rows.slice(i, i + chunk);
    if (!part.length && rows.length) break;
    const bySource = {};
    for (const r of part) (bySource[r.source] ||= []).push(r);
    const coverage = Object.entries(bySource).map(([source, list]) => {
      const from = list.reduce((a, r) => (r.first_event < a ? r.first_event : a), list[0].first_event).slice(0, 10);
      const to = list.reduce((a, r) => (r.last_event > a ? r.last_event : a), list[0].last_event).slice(0, 10);
      return { source, from, to, coverage_days: Math.round((Date.parse(to) - Date.parse(from)) / 86400e3) + 1, sessions: list.length, retention: "unknown", limitations: [] };
    });
    out.push({ bundle_schema_version: BUNDLE_SCHEMA_VERSION, collector_prompt_version: 8, collector: `scout-connect@${VERSION}`,
      environment: env, collected_at: new Date().toISOString(), source_coverage: coverage, session_evidence: part,
      collection_limits: [], privacy_scan: { passed: true, scanner_version: 1 } });
  }
  return out.map(b => { validateBundle(b); return b; }); // throws before anything is sent
}

export function commitCursor(seen) { saveJson(cursorPath(), { ...loadJson(cursorPath(), {}), ...seen }); }

// Human-readable preview of exactly what would be sent.
export function preview(rows) {
  const agg = { sessions: rows.length, apps: {}, tools: {}, commands: {}, languages: {}, packages: {}, models: {} };
  for (const r of rows) {
    const o = r.observations; bump(agg.apps, o.app);
    for (const k of ["tools", "commands", "languages"]) for (const [n, c] of Object.entries(o[k] || {})) bump(agg[k], n, c);
    for (const p of o.packages || []) bump(agg.packages, p);
    for (const m of o.models || []) bump(agg.models, m);
  }
  return { sessions: agg.sessions, apps: agg.apps, top_tools: top(agg.tools, 12), top_commands: top(agg.commands, 15),
    languages: top(agg.languages, 10), packages: top(agg.packages, 20), models: top(agg.models, 10) };
}
