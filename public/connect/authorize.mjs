async function check() {
  const status = document.querySelector("#connection"), allow = document.querySelector("#allow");
  allow.disabled = true;
  try {
    const response = await fetch("/api/profile", { method: "POST", credentials: "same-origin" });
    if (!response.ok) { status.textContent = "Not linked. Open the link page in a new tab, approve its code, then check again here."; return; }
    status.textContent = "Linked to your workspace. Review the client and permission before allowing access.";
    allow.disabled = false;
  } catch { status.textContent = "Could not check the connection. Try again."; }
}
document.querySelector("#check").addEventListener("click", check);
check();
