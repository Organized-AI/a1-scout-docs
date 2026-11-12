import { test, expect } from "@playwright/test";

test("health and OAuth discovery advertise the protected MCP resource", async ({ request, baseURL }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  const authorization = await request.get("/.well-known/oauth-authorization-server");
  expect(authorization.status()).toBe(200);
  expect((await authorization.json()).issuer).toBe(baseURL);
  const challenge = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(challenge.status()).toBe(401);
  const metadataURL = /resource_metadata="([^"]+)"/.exec(challenge.headers()["www-authenticate"])?.[1];
  expect(metadataURL).toBe(`${baseURL}/.well-known/oauth-protected-resource/mcp`);
  const metadata = await request.get(metadataURL);
  expect(metadata.status()).toBe(200);
  expect(await metadata.json()).toMatchObject({ resource: `${baseURL}/mcp`, authorization_servers: [baseURL] });
});

test("phone entry, privacy, Markdown and existing landing transitions", async ({ page, request }) => {
  await page.goto("/");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => window.gsap?.version)).toBe("3.12.5");
  expect(await page.evaluate(() => gsap.globalTimeline.getChildren().length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const phoneCard = page.locator(".card").filter({ hasText: "Phone chats" });
  await expect(phoneCard.getByRole("link", { name: "Import chat export" })).toHaveAttribute("href", "/connect/import/");
  await expect(phoneCard.getByRole("link", { name: "Connector setup" })).toHaveAttribute("href", /#phone-chats-and-remote-mcp$/);
  await phoneCard.screenshot({ path: "test-results/phone-card-iphone.png" });
  await page.locator("#wl input[name=name]").focus();
  await page.locator("[data-copy]").first().click();
  const events = await page.evaluate(() => dataLayer.map(entry => entry.event));
  expect(events).toContain("docs_view");
  expect(events).toContain("signup_start");
  expect(events).toContain("connect_copy_codex_source");
  await page.goto("/privacy/");
  await expect(page.getByRole("heading", { name: "Chat exports on your phone" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Optional live chat logging" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/privacy-iphone.png", fullPage: true });
  for (const [path, text] of [["/index.md", "Phone chats"], ["/privacy.md", "model-reported"], ["/connect/import.md", "all chats"], ["/connect/link.md", "Link my phone"], ["/llms.txt", "/connect/import/"]]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(await response.text(), path).toContain(text);
  }
});
