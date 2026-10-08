// a1-scout-docs: public landing, docs and waitlist for A1 Scout at scout.organizedai.vip.
// Pages are static assets. This Worker only answers /api/*.
import { pairStart, pairInfo, pairApprove, pairPoll, evidence, profile, transcriptPut, transcriptsDelete } from "./connect.js";
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const STORAGE = new Set(["own", "hosted", "unsure"]);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function join(req, env) {
  let body;
  try {
    body = (req.headers.get("content-type") || "").includes("application/json")
      ? await req.json() : Object.fromEntries(await req.formData());
  } catch { return json({ ok: false, error: "Send a name and an email." }, 400); }
  if (body.website) return json({ ok: true, survey_url: env.SURVEY_URL || null }); // honeypot: pretend success
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const storage = STORAGE.has(body.storage) ? body.storage : "unsure";
  if (!name) return json({ ok: false, error: "Add your name." }, 400);
  if (!EMAIL.test(email)) return json({ ok: false, error: "That email doesn't look right." }, 400);

  const ip = req.headers.get("cf-connecting-ip") || "";
  const ipHash = ip ? (await sha256(ip + "|a1-scout-waitlist")).slice(0, 24) : null;
  // Light rate limit: at most 5 sign-ups per IP per hour.
  if (ipHash) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, new Date(Date.now() - 3600e3).toISOString()).first();
    if ((r?.n || 0) >= 5) return json({ ok: false, error: "Too many sign-ups from this network. Try again in an hour." }, 429);
  }
  let source = String(body.source || "").slice(0, 80);
  if (!source) { try { source = new URL(req.headers.get("referer") || "").hostname; } catch {} }
  const res = await env.DB.prepare(
    "INSERT INTO waitlist (email, name, storage, source, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING"
  ).bind(email, name, storage, source || null, new Date().toISOString(), ipHash).run();
  return json({ ok: true, already: res.meta.changes === 0, survey_url: env.SURVEY_URL || null });
}

// Owner export: GET /api/waitlist with Bearer ADMIN_TOKEN (a Worker secret). CSV when ?format=csv.
async function exportList(req, env, url) {
  const auth = req.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare("SELECT name, email, storage, source, created_at FROM waitlist ORDER BY created_at DESC").all();
  if (url.searchParams.get("format") === "csv") {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["name,email,storage,source,created_at", ...results.map(r => [r.name, r.email, r.storage, r.source, r.created_at].map(q).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv", "cache-control": "no-store" } });
  }
  return json({ count: results.length, people: results });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") return json({ ok: true, service: "a1-scout-docs" });
    if (url.pathname === "/api/config") return json({ survey_url: env.SURVEY_URL || null, gtm_id: env.GTM_ID || null }, 200, { "cache-control": "public, max-age=300" });
    if (url.pathname === "/api/waitlist" && req.method === "POST") return join(req, env);
    if (url.pathname === "/api/waitlist" && req.method === "GET") return exportList(req, env, url);
    if (url.pathname === "/api/pair/start" && req.method === "POST") return pairStart(req, env, url);
    if (url.pathname === "/api/pair/info" && req.method === "GET") return pairInfo(req, env, url);
    if (url.pathname === "/api/pair/approve" && req.method === "POST") return pairApprove(req, env);
    if (url.pathname === "/api/pair/poll" && req.method === "POST") return pairPoll(req, env);
    if (url.pathname === "/api/evidence" && req.method === "POST") return evidence(req, env);
    if (url.pathname === "/api/profile" && req.method === "GET") return profile(req, env);
    if (url.pathname === "/api/transcripts" && req.method === "PUT") return transcriptPut(req, env, url);
    if (url.pathname === "/api/transcripts" && req.method === "DELETE") return transcriptsDelete(req, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
  }
};
