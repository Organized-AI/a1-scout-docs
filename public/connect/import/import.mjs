const fileInput = document.querySelector("#file"), status = document.querySelector("#status"), send = document.querySelector("#send");
const progress = document.querySelector("#progress"), preview = document.querySelector("#preview"), summary = document.querySelector("#summary");
let bundles = [], sessionCount = 0, app = null, worker = null, linked = false, config = {};
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
function advance(value) {
  if (window.gsap && !reduced) gsap.to(progress, { value, duration: 0.35, overwrite: true });
  else progress.value = value;
}
function fail(message) { status.textContent = message; status.classList.add("error"); send.disabled = true; }
async function connection() {
  fileInput.disabled = true;
  try {
    const response = await fetch("/api/profile", { method: "POST", credentials: "same-origin" });
    if (response.status === 401) { location.replace("/connect/link/"); return; }
    if (!response.ok) throw new Error("Connection check unavailable. Reload to try again.");
    linked = true; fileInput.disabled = false; status.textContent = "Linked. Choose an export to begin.";
  } catch (error) { fail(error.message); }
}
fetch("/api/config").then(response => response.json()).then(value => {
  config = value;
  if (/^GTM-[A-Z0-9]+$/.test(config.gtm_id || "")) {
    window.dataLayer = window.dataLayer || [];
    const script = document.createElement("script"); script.src = `https://www.googletagmanager.com/gtm.js?id=${config.gtm_id}`; script.async = true; document.head.append(script);
  }
}).catch(() => {});
fileInput.addEventListener("change", () => {
  worker?.terminate(); bundles = []; send.disabled = true; preview.hidden = true; status.classList.remove("error");
  const file = fileInput.files[0]; if (!file || !linked) return;
  if (file.size > 100 * 1024 * 1024) { fail("This file exceeds 100 MB. Extract conversations.json in Files first."); return; }
  status.textContent = "Reading on this device. Nothing is being uploaded…"; advance(10);
  worker = new Worker("/connect/import/worker.mjs", { type: "module" });
  worker.onerror = () => { fail("The local reader could not load. Check your connection and choose the file again."); worker?.terminate(); };
  worker.onmessage = ({ data }) => {
    if (data.error) { fail(data.error); worker.terminate(); return; }
    bundles = data.bundles; sessionCount = data.preview.sessions; app = data.app;
    summary.replaceChildren();
    const labels = { sessions: "Sessions", apps: "Apps", top_tools: "Tools", top_commands: "Commands", languages: "Languages", packages: "Packages", models: "Models" };
    for (const [key, label] of Object.entries(labels)) {
      const term = document.createElement("dt"), value = document.createElement("dd"); term.textContent = label;
      value.textContent = key === "sessions" ? String(data.preview[key]) : Object.entries(data.preview[key]).map(([name, count]) => `${name} (${count})`).join(", ") || "None detected";
      summary.append(term, value);
    }
    preview.hidden = false; send.disabled = !sessionCount;
    status.textContent = sessionCount ? "Ready to review. Nothing sent yet." : "No dated chat sessions found in this export.";
    advance(75);
    if (window.gsap && !reduced) gsap.fromTo(preview, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 });
    worker.terminate(); worker = null;
  };
  let environment = localStorage.getItem("scout-chat-environment");
  if (!/^[a-f0-9]{24}$/.test(environment || "")) { environment = [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, "0")).join(""); localStorage.setItem("scout-chat-environment", environment); }
  worker.postMessage({ file, environment });
});
send.addEventListener("click", async () => {
  send.disabled = true; fileInput.disabled = true; status.classList.remove("error");
  try {
    for (const [index, bundle] of bundles.entries()) {
      status.textContent = `Sending summary batch ${index + 1} of ${bundles.length}…`;
      const response = await fetch("/api/evidence", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(bundle) });
      if (response.status === 401) { location.replace("/connect/link/"); return; }
      if (!response.ok) throw new Error("Summary upload failed. Retry safely; completed batches will not duplicate sessions.");
      advance(75 + 25 * (index + 1) / bundles.length);
    }
    status.textContent = `Sent ${sessionCount} session summaries. Your chat text stayed on this device.`;
    if (/^GTM-[A-Z0-9]+$/.test(config.gtm_id || "")) (window.dataLayer ||= []).push({ event: "scout_chat_import", sessions: sessionCount, app });
    bundles = [];
  } catch (error) { fail(error.message); send.disabled = false; }
  finally { fileInput.disabled = false; }
});
connection();
