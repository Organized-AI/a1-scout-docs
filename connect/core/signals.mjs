// Mirrors collect.mjs pure signal helpers. Keep behavior in sync; see signals parity tests.
import { findPrivacyProblem } from "./rules.mjs";
const basename = value => String(value).replace(/\/+$/, "").split("/").at(-1) || "";
const extname = value => { const position = value.lastIndexOf("."); return position > 0 && value !== ".." ? value.slice(position) : ""; };
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
    errors: 0, edits: 0, turns: 0, events: 0, first: null, last: null, id: null, cwd: null, repo: null, model: null, app: null,
    usage: new Map(), codexTokens: null, llms: {}, buckets: new Set(), subagents: 0, headless: false, failure: null, succeeded: false };
}
function stamp(sig, ts) {
  const t = Date.parse(ts || ""); if (!Number.isFinite(t)) return;
  sig.buckets.add(Math.floor(t / 300e3)); // 5-minute slots with activity, for active minutes
  if (!sig.first || t < sig.first) sig.first = t;
  if (!sig.last || t > sig.last) sig.last = t;
}

const top = (m, n) => Object.fromEntries(Object.entries(m).filter(([k]) => k && k !== "null").sort((a, b) => b[1] - a[1]).slice(0, n));
const safeList = (set, n, re) => [...set].filter(x => re.test(x) && !findPrivacyProblem(x)).slice(0, n);

// A short category for a failed run; the error text itself never leaves the computer.
export function failureKind(text) {
  const t = String(text || "");
  if (/not supported|model_not_found|does not exist|unknown model/i.test(t)) return "model_not_supported";
  if (/high demand|rate.?limit|429|quota|usage limit/i.test(t)) return "rate_limited";
  if (/401|403|unauthori[sz]ed|forbidden|log ?in/i.test(t)) return "auth";
  if (/5\d\d|service unavailable|overloaded|timed? ?out/i.test(t)) return "server_error";
  if (/404|not found/i.test(t)) return "not_found";
  return "other";
}
// Orchestrators that launch coding agents on their own, recognized by their workspace folder. Only the label is sent.
const HARNESS = [[/[\\/]\.paperclip[\\/]/i, "paperclip"], [/[\\/]\.?openclaw[\\/]/i, "openclaw"], [/[\\/]\.hermes[\\/]/i, "hermes"],
  [/[\\/]factory-foreman[\\/]/i, "factory-foreman"], [/[\\/]\.conductor[\\/]|[\\/]conductor[\\/]workspaces[\\/]/i, "conductor"]];
export const harnessOf = cwd => (HARNESS.find(([re]) => re.test(String(cwd || ""))) || [])[1];

const MODEL_RE = /^[a-z0-9][a-z0-9._:\/-]{0,40}$/i;
function tokensOf(sig) {
  if (sig.codexTokens) { const { total, ...t } = sig.codexTokens; return t; }
  if (!sig.usage.size) return undefined;
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const u of sig.usage.values()) { t.input += u.input; t.output += u.output; t.cache_read += u.cache_read; t.cache_write += u.cache_write; bump(sig.llms, String(u.model || "").slice(0, 40)); }
  return t;
}

// The only shape that leaves the computer.
export function observationsOf(sig) {
  const tokens = tokensOf(sig);
  const llms = Object.fromEntries(Object.entries(sig.llms).filter(([k]) => MODEL_RE.test(k)).slice(0, 8));
  const obs = {
    app: sig.app, model: sig.model && MODEL_RE.test(sig.model) ? sig.model : undefined,
    turns: sig.turns, edits: sig.edits, errors: sig.errors,
    active_minutes: sig.buckets.size * 5, subagents: sig.subagents || undefined,
    launch: sig.headless ? "headless" : "interactive", harness: harnessOf(sig.cwd),
    failure: sig.failure && !sig.succeeded && !tokens ? sig.failure : undefined,
    tokens, llms: Object.keys(llms).length ? llms : undefined,
    tools: top(sig.tools, 25), commands: top(Object.fromEntries(Object.entries(sig.commands).filter(([k]) => WORD.test(k))), 30),
    languages: top(sig.languages, 12),
    packages: safeList(sig.packages, 40, PKG), models: safeList(sig.models, 20, HF_REPO),
    imports: safeList(sig.imports, 30, /^[a-z_][a-z0-9_]{1,40}$/),
  };
  for (const k of Object.keys(obs)) if (obs[k] === undefined) delete obs[k];
  return obs;
}


export { langOf, codeSignals, patchSignals, toolName, newSig, stamp, top, bump };

