import { test, expect } from "@playwright/test";
import { claude, chatgpt } from "../../connect/test/chat-fixtures.mjs";
import { validateBundle } from "../../connect/core/rules.mjs";
import { zipSync, strToU8 } from "fflate";

for (const [format, fixture] of [["claude", claude], ["chatgpt", chatgpt]]) {
  test(`${format}: local iPhone preview and consent-gated summaries`, async ({ page }) => {
    const sent = [];
    await page.route("**/api/profile", route => route.fulfill({ json: { workspace: "synthetic" } }));
    await page.route("**/api/evidence", route => { sent.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
    await page.goto("/connect/import/");
    await expect(page.locator("#file")).toBeEnabled();
    await page.locator("#file").setInputFiles({ name: "conversations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await expect(page.locator("#preview")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.gsap?.version)).toBe("3.12.5");
    await expect(page.locator("#summary")).toContainText(format === "claude" ? "claude-chat" : "chatgpt");
    expect(sent).toHaveLength(0);
    await expect.poll(() => page.locator("#preview").evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
    await expect.poll(() => page.locator("#progress").evaluate(element => Math.round(element.value))).toBe(75);
    for (const width of [393, 375]) {
      await page.setViewportSize({ width, height: 852 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: `test-results/${format}-iphone-preview.png`, fullPage: true });
    await page.locator("#send").click();
    await expect(page.locator("#status")).toContainText("Sent 1 session summaries");
    expect(sent).toHaveLength(1); validateBundle(sent[0]);
    expect(JSON.stringify(sent)).not.toContain("private text");
    expect(await page.evaluate(() => (window.dataLayer || []).some(entry => entry.event === "scout_chat_import"))).toBe(false);
  });
}
test("unlinked browser goes to the link page", async ({ page }) => {
  await page.route("**/api/profile", route => route.fulfill({ status: 401, json: { error: "unlinked" } }));
  await page.route("**/api/link/start", route => route.fulfill({ json: { code: "TEST-CODE", poll_token: "synthetic" } }));
  await page.route("**/api/link/poll", route => route.fulfill({ json: { status: "pending" } }));
  await page.goto("/connect/import/");
  await expect(page).toHaveURL(/\/connect\/link\//);
  await expect(page.locator("#code")).toHaveText("TEST-CODE");
  await page.screenshot({ path: "test-results/link-iphone.png", fullPage: true });
});

test("ZIP reads only conversations.json and emits count-only configured tracking", async ({ page }) => {
  await page.route("**/api/profile", route => route.fulfill({ json: { workspace: "synthetic" } }));
  await page.route("**/api/config", route => route.fulfill({ json: { gtm_id: "GTM-TESTONLY" } }));
  await page.route("https://www.googletagmanager.com/**", route => route.fulfill({ body: "" }));
  await page.route("**/api/evidence", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/connect/import/");
  await expect(page.locator("#file")).toBeEnabled();
  const buffer = Buffer.from(zipSync({ "export/conversations.json": strToU8(JSON.stringify(claude)), "ignore.txt": strToU8("private unrelated data") }));
  await page.locator("#file").setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer });
  await expect(page.locator("#preview")).toBeVisible();
  await page.locator("#send").click();
  await expect(page.locator("#status")).toContainText("Sent 1 session summaries");
  expect(await page.evaluate(() => window.dataLayer.filter(entry => entry.event === "scout_chat_import"))).toEqual([{ event: "scout_chat_import", sessions: 1, app: "claude-chat" }]);
});

test("malformed export never enables sending", async ({ page }) => {
  await page.route("**/api/profile", route => route.fulfill({ json: { workspace: "synthetic" } }));
  await page.goto("/connect/import/");
  await expect(page.locator("#file")).toBeEnabled();
  await page.locator("#file").setInputFiles({ name: "conversations.json", mimeType: "application/json", buffer: Buffer.from('{"secret":"private malformed') });
  await expect(page.locator("#status")).toContainText("Could not read this export safely");
  await expect(page.locator("#send")).toBeDisabled();
});
