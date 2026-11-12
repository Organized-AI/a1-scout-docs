import { newSig, stamp, toolName, codeSignals, shellSignals, observationsOf, bump, top } from "./signals.mjs";
import { findPrivacyProblem, validateBundle, BUNDLE_SCHEMA_VERSION } from "./rules.mjs";

const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value ?? ""))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const sessionDigest = (source, id) => sha256(`${source}\0${String(id || "").trim()}`);
export const projectFingerprint = key => sha256(String(key || "").trim().toLowerCase().replace(/^git@([^:]+):/, "$1/").replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/[?#].*$/, "").replace(/\\/g, "/").replace(/\/+$/, "").split("/").slice(-2).join("/") || "unknown-project");
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,40}$/i;
const LANGUAGES = new Map(Object.entries({ py: "python", python: "python", js: "javascript", javascript: "javascript", ts: "typescript", typescript: "typescript", tsx: "typescript", jsx: "javascript", bash: "shell", sh: "shell", zsh: "shell", shell: "shell", html: "html", css: "css", json: "json", sql: "sql", rust: "rust", go: "go", swift: "swift", ruby: "ruby", java: "java", kotlin: "kotlin", php: "php", yaml: "yaml", toml: "toml", c: "c", cpp: "cpp", csharp: "csharp", r: "r", lua: "lua" }));
const timestamp = value => typeof value === "number" ? (Number.isFinite(value * 1000) && Math.abs(value * 1000) <= 8640000000000000 ? new Date(value * 1000).toISOString() : null) : value;
const safeModel = value => typeof value === "string" && MODEL.test(value) && !findPrivacyProblem(value) ? value : null;
function signal(app) {
  const sig = newSig();
  for (const name of ["tools", "commands", "languages", "llms"]) sig[name] = Object.create(null);
  sig.app = app;
  return sig;
}
function tool(sig, name) {
  const safe = toolName(name);
  if (safe && !findPrivacyProblem(safe)) bump(sig.tools, safe);
}
function fences(text, sig) {
  if (typeof text !== "string") return;
  for (const match of text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    const language = LANGUAGES.get(match[1].trim().toLowerCase());
    if (language) bump(sig.languages, language);
    codeSignals(match[2], sig);
    if (language === "shell") shellSignals(match[2], sig);
  }
}
async function row(sig, source, id, project) {
  if (!sig.events || sig.first === null || sig.last === null) return null;
  for (const name of ["commands", "tools", "languages", "llms"]) {
    for (const key of Object.keys(sig[name])) if (findPrivacyProblem(key)) delete sig[name][key];
  }
  const observations = observationsOf(sig);
  return { source, native_session_digest: await sessionDigest(source, id), project_fingerprint: await projectFingerprint(project),
    first_event: new Date(sig.first).toISOString(), last_event: new Date(sig.last).toISOString(),
    evidence_quality: "full-transcript", event_count: sig.events, observations };
}
export function detectExport(json) {
  if (!Array.isArray(json) || !json.length) return null;
  if (json.every(item => item && Array.isArray(item.chat_messages) && typeof item.uuid === "string")) return "claude";
  if (json.every(item => item && item.mapping && typeof item.mapping === "object" && typeof item.id === "string")) return "chatgpt";
  return null;
}
export async function readClaudeExport(conversations) {
  if (detectExport(conversations) !== "claude") throw new Error("Not a Claude conversations export.");
  const rows = [];
  for (const conversation of conversations) {
    const sig = signal("claude-chat");
    for (const message of conversation.chat_messages) {
      if (!message || !["human", "assistant"].includes(message.sender)) continue;
      sig.events++; if (message.sender === "human") sig.turns++;
      stamp(sig, timestamp(message.created_at));
      if (!message.content?.some?.(content => content.type === "text")) fences(message.text, sig);
      const model = safeModel(message.model); if (model) bump(sig.llms, model);
      for (const content of Array.isArray(message.content) ? message.content : []) {
        if (content.type === "tool_use") tool(sig, content.name);
        if (content.type === "tool_result" && content.is_error === true) sig.errors++;
        if (content.type === "text") fences(content.text, sig);
      }
    }
    sig.model = Object.keys(top(sig.llms, 1))[0] || null;
    const result = await row(sig, "claude", "chat:" + conversation.uuid, "chat/claude");
    if (result) rows.push(result);
  }
  return rows;
}
export async function readChatGPTExport(conversations) {
  if (detectExport(conversations) !== "chatgpt") throw new Error("Not a ChatGPT conversations export.");
  const rows = [];
  for (const conversation of conversations) {
    const sig = signal("chatgpt"), branch = [], visited = new Set();
    let node = conversation.current_node;
    while (typeof node === "string" && !visited.has(node) && Object.hasOwn(conversation.mapping, node)) {
      visited.add(node); const entry = conversation.mapping[node]; if (!entry) break;
      branch.push(entry.message); node = entry.parent;
    }
    for (const message of branch.reverse()) {
      const role = message?.author?.role, metadata = message?.metadata || {};
      if (!message || !["user", "assistant", "tool"].includes(role) || metadata.is_visually_hidden_from_conversation || metadata.is_hidden || message.is_hidden) continue;
      sig.events++; if (role === "user") sig.turns++;
      stamp(sig, timestamp(message.create_time));
      const model = safeModel(metadata.model_slug); if (model) bump(sig.llms, model);
      if (role === "tool") tool(sig, message.author.name);
      if (role === "assistant" && message.recipient && message.recipient !== "all") tool(sig, message.recipient);
      if (metadata.is_error === true || message.content?.is_error === true || message.status === "error" || metadata.execution_status === "error") sig.errors++;
      const content = message.content || {};
      if (content.content_type === "code") {
        codeSignals(content.text, sig);
        const language = LANGUAGES.get(String(content.language || "").toLowerCase());
        if (language) bump(sig.languages, language);
        if (language === "shell") shellSignals(content.text, sig);
      }
      for (const part of Array.isArray(content.parts) ? content.parts : []) fences(part, sig);
    }
    sig.model = Object.keys(top(sig.llms, 1))[0] || null;
    const result = await row(sig, "other", "chatgpt:" + conversation.id, "chat/chatgpt");
    if (result) rows.push(result);
  }
  return rows;
}
export function chatBundles(rows, environmentId) {
  const bundles = [];
  for (let offset = 0; offset < rows.length; offset += 400) {
    const bundle = { bundle_schema_version: BUNDLE_SCHEMA_VERSION, collector: "scout-chat-import@0.3.0", collector_prompt_version: 8,
      environment: { id: environmentId, kind: "other", label: "Chat export" }, collected_at: new Date().toISOString(),
      source_coverage: [], session_evidence: rows.slice(offset, offset + 400), collection_limits: [], privacy_scan: { passed: true, scanner_version: 1 } };
    validateBundle(bundle); bundles.push(bundle);
  }
  return bundles;
}
export function chatPreview(rows) {
  const counts = { apps: Object.create(null), tools: Object.create(null), commands: Object.create(null), languages: Object.create(null), packages: Object.create(null), models: Object.create(null) };
  for (const { observations } of rows) {
    bump(counts.apps, observations.app);
    for (const key of ["tools", "commands", "languages"]) for (const [name, count] of Object.entries(observations[key] || {})) bump(counts[key], name, count);
    for (const key of ["packages", "models"]) for (const name of observations[key] || []) bump(counts[key], name);
  }
  return { sessions: rows.length, apps: { ...counts.apps }, top_tools: top(counts.tools, 12), top_commands: top(counts.commands, 15), languages: top(counts.languages, 10), packages: top(counts.packages, 20), models: top(counts.models, 10) };
}
