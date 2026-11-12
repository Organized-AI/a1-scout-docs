export const claude = [{ uuid: "synthetic-claude", name: "PRIVATE TITLE", chat_messages: [
  { sender: "human", created_at: "2026-01-01T10:00:00Z", text: "Please help me with private work" },
  { sender: "assistant", created_at: "2026-01-01T10:06:00Z", content: [
    { type: "tool_use", name: "mcp__docs__search" }, { type: "tool_result", is_error: true },
    { type: "text", text: '```python\nimport requests\nfrom transformers import AutoModel\nAutoModel.from_pretrained("Qwen/Qwen3-4B")\n```\n```bash\npip install transformers\nnpm install gsap\n```' },
  ] },
] }];
const message = (role, extra = {}) => ({ author: { role }, create_time: 1767261600, content: { parts: ["private text"] }, ...extra });
export const chatgpt = [{ id: "synthetic-chatgpt", current_node: "answer", mapping: {
  root: { parent: null, message: null },
  system: { parent: "root", message: message("system") },
  question: { parent: "system", message: message("user") },
  ignored: { parent: "question", message: message("assistant", { metadata: { model_slug: "wrong-branch" } }) },
  hidden: { parent: "question", message: message("assistant", { metadata: { is_visually_hidden_from_conversation: true, model_slug: "hidden-model" } }) },
  code: { parent: "hidden", message: message("assistant", { recipient: "python", metadata: { model_slug: "gpt-5" }, content: { content_type: "code", language: "python", text: "import numpy" } }) },
  tool: { parent: "code", message: message("tool", { author: { role: "tool", name: "python" }, metadata: { is_error: true } }) },
  answer: { parent: "tool", message: message("assistant", { metadata: { model_slug: "gpt-5" } }) },
} }];
