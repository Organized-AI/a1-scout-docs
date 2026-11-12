import { detectExport, readClaudeExport, readChatGPTExport, chatBundles, chatPreview } from "../modules/chats.mjs";
const MAX_JSON = 64 * 1024 * 1024;
async function extract(file) {
  if (file.name.toLowerCase().endsWith(".json")) {
    if (file.size > MAX_JSON) throw new Error("Chat JSON exceeds 64 MB. Choose a smaller export.");
    return file.text();
  }
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a .zip or conversations.json export.");
  const { Unzip, UnzipInflate, strFromU8 } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js");
  let chunks = [], bytes = 0, found = false, finished = false, failure = null;
  const unzip = new Unzip(entry => {
    if (entry.name.split("/").at(-1) !== "conversations.json") return;
    if (found) { failure = new Error("Archive contains more than one conversations.json."); return; }
    found = true;
    if (entry.originalSize > MAX_JSON) { failure = new Error("Chat JSON exceeds 64 MB."); return; }
    entry.ondata = (error, chunk, final) => {
      if (error) { failure = error; return; }
      bytes += chunk.length;
      if (bytes > MAX_JSON) { entry.terminate(); failure = new Error("Chat JSON exceeds 64 MB."); return; }
      chunks.push(chunk); if (final) finished = true;
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < file.size; offset += 65536) {
    unzip.push(new Uint8Array(await file.slice(offset, offset + 65536).arrayBuffer()), offset + 65536 >= file.size);
    if (failure) throw failure;
  }
  if (!found || !finished) throw new Error("No readable conversations.json found in this archive.");
  const json = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { json.set(chunk, offset); offset += chunk.length; }
  chunks = []; return strFromU8(json);
}
self.onmessage = async ({ data }) => {
  try {
    const json = JSON.parse(await extract(data.file)), format = detectExport(json);
    if (!format) throw new Error("This is not a recognized Claude or ChatGPT conversations export.");
    const rows = await (format === "claude" ? readClaudeExport(json) : readChatGPTExport(json));
    self.postMessage({ bundles: chatBundles(rows, data.environment), preview: chatPreview(rows), app: format === "claude" ? "claude-chat" : "chatgpt" });
  } catch {
    self.postMessage({ error: "Could not read this export safely. Choose a valid conversations.json or ZIP under the size limits. No data was sent." });
  }
};
