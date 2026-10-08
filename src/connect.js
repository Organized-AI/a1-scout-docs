// Connect: pair a computer to a Scout workspace without copying tokens, receive privacy-safe
// session summaries, and build the work profile Scout ranks Hugging Face picks against.
import { validateBundle, BundleError } from "./rules.mjs";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const now = () => new Date().toISOString();
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code8 = () => { const r = crypto.getRandomValues(new Uint8Array(8)); const c = [...r].map(x => ALPHA[x % ALPHA.length]).join(""); return c.slice(0, 4) + "-" + c.slice(4); };
const cookie = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).map(c => c.split("=")).find(([k]) => k === name)?.[1] || "";
const PAIR_MINUTES = 15;

async function ipHash(req) { const ip = req.headers.get("cf-connecting-ip") || ""; return ip ? (await sha(ip + "|scout-connect")).slice(0, 24) : null; }
async function body(req) { try { return await req.json(); } catch { return {}; } }

async function deviceAuth(req, env) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const row = await env.DB.prepare("SELECT workspace_id FROM device_keys WHERE key_hash = ?").bind(await sha(h.slice(7).trim())).first();
  if (row) await env.DB.prepare("UPDATE device_keys SET last_used = ? WHERE key_hash = ?").bind(now(), await sha(h.slice(7).trim())).run();
  return row?.workspace_id || null;
}

export async function pairStart(req, env, url) {
  const b = await body(req);
  const ih = await ipHash(req);
  if (ih) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM pairings WHERE ip_hash = ? AND created_at > ?").bind(ih, new Date(Date.now() - 3600e3).toISOString()).first();
    if ((r?.n || 0) >= 10) return json({ error: "Too many connection attempts from this network. Try again in an hour." }, 429);
  }
  const poll = rand(32), code = code8(), expires = new Date(Date.now() + PAIR_MINUTES * 60e3).toISOString();
  await env.DB.prepare("INSERT INTO pairings (code, poll_hash, client, status, ip_hash, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)")
    .bind(code, await sha(poll), String(b.client || "").slice(0, 60), ih, now(), expires).run();
  return json({ code, poll_token: poll, expires_at: expires, url: `${url.origin}/connect/?code=${code}` });
}

export async function pairInfo(req, env, url) {
  const code = String(url.searchParams.get("code") || "").toUpperCase();
  const p = await env.DB.prepare("SELECT code, client, status, expires_at FROM pairings WHERE code = ?").bind(code).first();
  if (!p) return json({ error: "That code wasn't found. Ask Claude or Codex to start connecting again." }, 404);
  if (p.expires_at < now() && p.status === "pending") return json({ error: "That code expired. Ask Claude or Codex to start connecting again." }, 410);
  const known = cookie(req, "scout_ws") ? await env.DB.prepare("SELECT name FROM workspaces WHERE browser_hash = ?").bind(await sha(cookie(req, "scout_ws"))).first() : null;
  return json({ code: p.code, client: p.client, status: p.status, returning: known ? { name: known.name } : null });
}

export async function pairApprove(req, env) {
  const b = await body(req);
  const code = String(b.code || "").toUpperCase();
  const p = await env.DB.prepare("SELECT * FROM pairings WHERE code = ?").bind(code).first();
  if (!p || p.status !== "pending") return json({ error: "That code was already used or wasn't found." }, 409);
  if (p.expires_at < now()) return json({ error: "That code expired. Ask Claude or Codex to start connecting again." }, 410);
  // The browser that approves owns the workspace. Approving again from the same browser adds another computer to it.
  let secret = cookie(req, "scout_ws");
  let ws = secret ? await env.DB.prepare("SELECT id FROM workspaces WHERE browser_hash = ?").bind(await sha(secret)).first() : null;
  if (!ws) {
    const name = String(b.name || "").trim().slice(0, 120);
    const email = String(b.email || "").trim().toLowerCase().slice(0, 254);
    if (!name) return json({ error: "Add your name." }, 400);
    secret = rand(32);
    ws = { id: "ws_" + rand(10) };
    await env.DB.prepare("INSERT INTO workspaces (id, name, email, browser_hash, created_at) VALUES (?, ?, ?, ?, ?)").bind(ws.id, name, email || null, await sha(secret), now()).run();
    if (email) await env.DB.prepare("INSERT INTO waitlist (email, name, storage, source, created_at) VALUES (?, ?, 'unsure', 'connect', ?) ON CONFLICT(email) DO NOTHING").bind(email, name, now()).run();
  }
  await env.DB.prepare("UPDATE pairings SET status = 'approved', workspace_id = ? WHERE code = ?").bind(ws.id, code).run();
  return json({ ok: true }, 200, { "set-cookie": `scout_ws=${secret}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` });
}

export async function pairPoll(req, env) {
  const b = await body(req);
  const p = await env.DB.prepare("SELECT * FROM pairings WHERE poll_hash = ?").bind(await sha(String(b.poll_token || ""))).first();
  if (!p) return json({ status: "unknown" }, 404);
  if (p.status === "pending") return json({ status: p.expires_at < now() ? "expired" : "pending" });
  if (p.status !== "approved") return json({ status: "collected" }, 409);
  const key = "sk_scout_" + rand(24); // not a pattern Scout's own privacy scan blocks in bundles; never logged
  await env.DB.batch([
    env.DB.prepare("INSERT INTO device_keys (key_hash, workspace_id, client, created_at) VALUES (?, ?, ?, ?)").bind(await sha(key), p.workspace_id, p.client, now()),
    env.DB.prepare("UPDATE pairings SET status = 'collected' WHERE code = ?").bind(p.code),
  ]);
  return json({ status: "approved", key, workspace: p.workspace_id });
}

export async function evidence(req, env) {
  const ws = await deviceAuth(req, env);
  if (!ws) return json({ error: "This computer isn't connected. Ask Claude or Codex to connect to Scout again." }, 401);
  let bundle;
  try { bundle = validateBundle(await req.json()); }
  catch (e) { return json({ error: e instanceof BundleError ? e.message : "Send a JSON evidence bundle.", code: e.code }, 400); }
  const t = now(), stmts = bundle.session_evidence.map(s => env.DB.prepare(
    `INSERT INTO evidence (workspace_id, source, digest, environment_id, project_fp, first_event, last_event, quality, event_count, observations, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, source, digest) DO UPDATE SET last_event = excluded.last_event, event_count = excluded.event_count,
       observations = excluded.observations, environment_id = excluded.environment_id, received_at = excluded.received_at`)
    .bind(ws, s.source, s.native_session_digest || s.fallback_fingerprint, bundle.environment.id, s.project_fingerprint, s.first_event, s.last_event,
      s.evidence_quality, s.event_count, JSON.stringify(s.observations), t));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return json({ ok: true, stored: stmts.length });
}

// Standard-library modules say little about what someone builds; leave them out of the profile.
const STDLIB = new Set("os sys re json time datetime pathlib typing subprocess collections argparse shutil hashlib itertools functools math random string io csv urllib logging tempfile glob copy textwrap uuid base64 struct threading asyncio dataclasses enum abc contextlib traceback inspect html http socket signal platform getpass unittest pprint __future__ assert type fs path child_process util crypto url events stream readline zlib os.path".split(" "));

export async function profile(req, env) {
  const ws = await deviceAuth(req, env);
  if (!ws) return json({ error: "This computer isn't connected." }, 401);
  const { results } = await env.DB.prepare("SELECT source, environment_id, project_fp, last_event, observations FROM evidence WHERE workspace_id = ? ORDER BY last_event DESC LIMIT 5000").bind(ws).all();
  const add = (m, k, n = 1) => { if (k) m[k] = (m[k] || 0) + n; };
  const agg = { apps: {}, tools: {}, commands: {}, languages: {}, packages: {}, models: {}, imports: {} };
  const computers = new Set(), projects = new Set();
  for (const r of results) {
    computers.add(r.environment_id); projects.add(r.project_fp);
    const o = JSON.parse(r.observations);
    add(agg.apps, o.app);
    for (const k of ["tools", "commands", "languages"]) for (const [n, c] of Object.entries(o[k] || {})) add(agg[k], n, c);
    for (const p of o.packages || []) add(agg.packages, p);
    for (const m of o.models || []) add(agg.models, m);
    for (const i of o.imports || []) if (!STDLIB.has(i)) add(agg.imports, i);
  }
  const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
  return json({
    workspace: ws, sessions: results.length, computers: computers.size, projects: projects.size, last_session: results[0]?.last_event || null,
    apps: agg.apps, top: { tools: top(agg.tools, 15), commands: top(agg.commands, 20), languages: top(agg.languages, 10),
      packages: top(agg.packages, 25), libraries: top(agg.imports, 25), models: top(agg.models, 15) },
  });
}
