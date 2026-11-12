const status = document.querySelector("#status");
const retry = document.querySelector("#retry");
let timer;
async function request(path, input) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), credentials: "same-origin" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || (result.status === "expired" ? "This code expired. Get a new one." : "Link unavailable. Get a new code."));
  return result;
}
function failed(error) {
  status.textContent = error.message;
  retry.hidden = false;
}
async function start() {
  clearTimeout(timer);
  retry.hidden = true;
  status.textContent = "Getting a code…";
  try {
    const link = await request("/api/link/start", {});
    document.querySelector("#code").textContent = link.code;
    status.textContent = "Waiting for approval…";
    async function poll() {
      try {
        const result = await request("/api/link/poll", { poll_token: link.poll_token });
        if (result.status === "approved") { location.replace("/connect/import/"); return; }
        timer = setTimeout(poll, 3000);
      } catch (error) { failed(error); }
    }
    await poll();
  } catch (error) { failed(error); }
}
retry.addEventListener("click", start);
start();
