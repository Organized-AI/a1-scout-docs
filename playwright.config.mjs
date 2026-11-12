import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser", outputDir: "./test-results", workers: 1,
  use: { baseURL: "http://127.0.0.1:8787", ...devices["iPhone 15"] },
  webServer: { command: "npm run dev -- --ip 127.0.0.1 --port 8787", url: "http://127.0.0.1:8787/api/health", reuseExistingServer: true },
});
