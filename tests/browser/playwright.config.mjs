import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["junit", { outputFile: "test-results/results.xml" }],
  ],
  use: {
    baseURL: "https://127.0.0.1:3443",
    ignoreHTTPSErrors: true,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node server.mjs",
    url: "https://127.0.0.1:3443/login",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
