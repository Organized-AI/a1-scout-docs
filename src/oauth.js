import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { deviceAuth } from "./connect.js";
import { mcpHandler } from "./remote-mcp.js";
const escape = value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
async function authorize(req, env) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (req.method === "POST") {
      if (req.headers.get("origin") !== new URL(req.url).origin) return new Response("Use the same-origin consent page.", { status: 403 });
      const form = await req.formData(), handle = String(form.get("handle") || "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const workspace = await deviceAuth(req, env);
      if (!workspace) return new Response("Link this browser first, then return to the consent page.", { status: 401 });
      const approved = await oauth.approveConsent(req, handle, { scope: ["scout:chat"] });
      const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: workspace, metadata: {}, scope: approved.request.scope, props: { workspace } });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    if (req.method !== "GET") return new Response(null, { status: 405 });
    const request = await oauth.parseAuthRequest(req), details = await oauth.describeConsent(request), consent = await oauth.beginConsent(request);
    consent.headers.set("Content-Type", "text/html; charset=utf-8");
    consent.headers.set("Cache-Control", "no-store");
    consent.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect chat · A1 Scout</title><link rel="stylesheet" href="/connect/phone.css"></head><body><main class="wrap"><a href="/">← A1 Scout</a><h1>Connect ${escape(details.clientName)}</h1><section class="card"><p>${details.clientDomain ? `Published by <strong>${escape(details.clientDomain)}</strong>.` : "This app registered itself; its name is unverified."}</p><p>Access returns to <strong>${escape(details.redirectHost)}</strong>.</p>${details.redirectIsLoopback ? "<p>This sends access to an app on your computer. Continue only if you started connecting it.</p>" : ""}<p>Permission: <strong>scout:chat</strong> — read your work profile and log names and counts to this workspace.</p><p>Live logging sends a model-reported summary when you ask. It is not automatic or guaranteed device-local processing. For deterministic on-device parsing, use <a href="/connect/import/">export import</a>.</p></section><section class="card"><h2>Link this browser</h2><p id="connection" role="status">Checking connection…</p><a href="/connect/link/" target="_blank" rel="noopener">Link in a new tab using the phone code</a><button id="check" type="button">Check again</button></section><form method="post" action="/authorize" class="card"><input type="hidden" name="handle" value="${escape(consent.handle)}"><p>Allow only if you trust this client. You can remove the connector in your chat app.</p><button id="allow" name="decision" value="approve" disabled>Allow names-and-counts access</button><button name="decision" value="deny">Deny</button></form></main><script type="module" src="/connect/authorize.mjs"></script></body></html>`;
    return new Response(html, { headers: consent.headers });
  } catch { return new Response("This authorization request is invalid or expired. Restart from your chat app.", { status: 400, headers: { "cache-control": "no-store", "content-type": "text/plain" } }); }
}
export const oauthWorker = { fetch(req, env, ctx) {
  const origin = new URL(req.url).origin;
  return new OAuthProvider({
  apiRoute: "/mcp", apiHandler: mcpHandler,
  defaultHandler: { fetch: (req, env) => new URL(req.url).pathname === "/authorize" ? authorize(req, env) : new Response("Not found", { status: 404 }) },
  authorizeEndpoint: "/authorize", tokenEndpoint: "/oauth/token", clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["scout:chat"], requiredScopes: ["scout:chat"], accessTokenTTL: 3600, refreshTokenTTL: 2592000, clientIdMetadataDocumentEnabled: false,
  resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
  }).fetch(req, env, ctx);
} };
