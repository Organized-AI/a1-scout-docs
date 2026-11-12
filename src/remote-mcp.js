import { validateBundle, assertPrivacySafe } from "./rules.mjs";
import { storeEvidence, workspaceProfile } from "./connect.js";

const namePattern = "^[A-Za-z][A-Za-z0-9_.:-]{0,79}$";
const nameSchema = { type: "string", pattern: namePattern, maxLength: 80 };
const countSchema = { type: "integer", minimum: 0, maximum: 1000000 };
const countsSchema = { type: "object", maxProperties: 100, propertyNames: nameSchema, additionalProperties: countSchema };
const namesSchema = { type: "array", maxItems: 100, items: nameSchema, uniqueItems: true };
const properties = { app: { enum: ["claude-chat", "chatgpt"] }, model: nameSchema, turns: countSchema,
  tools: countsSchema, languages: countsSchema, packages: namesSchema, models: namesSchema, imports: namesSchema,
  chat_ref: { type: "string", pattern: "^[a-fA-F0-9-]{16,128}$", description: "Stable random hex/UUID for this chat, never its title, URL or text." } };
export const remoteTools = [
  { name: "scout_log_chat", description: "With the person's permission, report cumulative work signals for this chat. Send ONLY short tool/language/package/model identifiers and integer counts. Never prompts, answers, titles, files, paths, URLs, emails or secrets. Use a stable random hex/UUID chat_ref; repeat it to update rather than duplicate. This is a model-reported summary, not automatic background capture or an on-device export reader.", inputSchema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } },
  { name: "scout_status", description: "Read the connected workspace's work profile summary: names and counts only. Does not read chats or private files.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];
const hash = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const object = value => value && typeof value === "object" && !Array.isArray(value);
const validName = value => typeof value === "string" && new RegExp(namePattern).test(value) && !/\.(?:com|net|org|io|ai|dev|vip|html|json|txt|py|js)\b/i.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
function validateArguments(input) {
  if (!object(input) || Object.keys(input).length !== Object.keys(properties).length || Object.keys(input).some(key => !Object.hasOwn(properties, key))) throw new Error("Only the documented names-and-counts fields are accepted.");
  assertPrivacySafe(JSON.stringify(input));
  if (!["claude-chat", "chatgpt"].includes(input.app) || !validName(input.model) || !count(input.turns) || !/^[a-fA-F0-9-]{16,128}$/.test(input.chat_ref)) throw new Error("Use short identifiers, counts and a random hex/UUID chat reference only.");
  for (const field of ["tools", "languages"]) {
    if (!object(input[field]) || Object.keys(input[field]).length > 100 || Object.entries(input[field]).some(([name, value]) => !validName(name) || !count(value) || ["__proto__", "constructor", "prototype"].includes(name))) throw new Error("Invalid signal name or count.");
  }
  for (const field of ["packages", "models", "imports"]) if (!Array.isArray(input[field]) || input[field].length > 100 || input[field].some(name => !validName(name))) throw new Error("Use short package, model and import identifiers only.");
}
export async function chatLogBundle(input, workspace) {
  validateArguments(input);
  const source = input.app === "claude-chat" ? "claude" : "other", date = new Date().toISOString();
  const digest = await hash(`${source}\0${input.app === "claude-chat" ? "chat:" : "chatgpt:"}${input.chat_ref}`);
  return validateBundle({ bundle_schema_version: 1, environment: { id: (await hash(`remote-mcp\0${workspace}`)).slice(0, 24), kind: "cloud" }, collected_at: date, source_coverage: [],
    session_evidence: [{ source, native_session_digest: digest, project_fingerprint: await hash(input.app === "claude-chat" ? "chat/claude" : "chat/chatgpt"), first_event: date, last_event: date,
      evidence_quality: "metadata-only", event_count: input.turns, observations: { app: input.app, model: input.model, turns: input.turns, tools: input.tools, languages: input.languages,
        packages: [...new Set(input.packages)], models: [...new Set(input.models)], imports: [...new Set(input.imports)], capture: "model-reported" } }] });
}
const reply = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const mcpHandler = {
  async fetch(req, env, ctx) {
    if (!ctx?.props?.workspace) return reply({ error: "unauthorized" }, 401);
    if (!ctx.auth?.scope?.includes("scout:chat")) return reply({ error: "insufficient_scope" }, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="scout:chat"' });
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid_origin" }, 403);
    if (new URL(req.url).pathname !== "/mcp") return reply({ error: "not_found" }, 404);
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (!(req.headers.get("content-type") || "").includes("application/json")) return reply({ error: "JSON required" }, 415);
    const reader = req.body?.getReader(), decoder = new TextDecoder();
    let raw = "", bytes = 0;
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) { await reader.cancel(); return reply({ error: "too_large" }, 413); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    let message;
    try { message = JSON.parse(raw); } catch { return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }); }
    if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return reply({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
    if (message.method.startsWith("notifications/") && message.id === undefined) return new Response(null, { status: 202 });
    const response = result => reply({ jsonrpc: "2.0", id: message.id ?? null, result });
    if (message.method === "initialize") return response({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "a1-scout-phone", version: "0.3.0" } });
    if (message.method === "ping") return response({});
    if (message.method === "tools/list") return response({ tools: remoteTools });
    if (message.method !== "tools/call") return reply({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: "Method not found" } });
    try {
      let data;
      if (message.params?.name === "scout_status") {
        if (!object(message.params.arguments || {}) || Object.keys(message.params.arguments || {}).length) throw new Error("scout_status takes no arguments.");
        data = await (await workspaceProfile(env, ctx.props.workspace)).json();
      } else if (message.params?.name === "scout_log_chat") {
        data = await (await storeEvidence(env, ctx.props.workspace, await chatLogBundle(message.params.arguments, ctx.props.workspace))).json();
      } else throw new Error("Unknown tool.");
      return response({ content: [{ type: "text", text: JSON.stringify(data) }] });
    } catch {
      return response({ isError: true, content: [{ type: "text", text: "Could not complete this call. Use only documented short names, integer counts and an opaque chat_ref. No prompts, paths, URLs, emails or secrets. Reuse the same chat_ref when retrying." }] });
    }
  },
};
