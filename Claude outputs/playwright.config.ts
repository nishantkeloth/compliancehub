import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1, // these tests share one real org's data — don't run them concurrently
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://comphub.aifexis.com",
    // Uses your already-installed Google Chrome (channel: "chrome") instead
    // of downloading Playwright's bundled Chromium — avoids the CDN
    // download entirely, which is useful if that download times out on a
    // restricted network. Set on the top-level `use` so every project,
    // including the login "setup" project, picks it up.
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome", storageState: "storageState.json" },
      dependencies: ["setup"],
    },
  ],
});
