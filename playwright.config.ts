// End-to-end tests on the mobile browsers guests actually use, each with a fake camera.
//   npm test                                  → starts `next dev` on :3000 and tests it
//   BASE_URL=https://your.site npm test       → tests a deployment
// Tests read .env.local for the database and storage: each test makes its own throwaway event and deletes it after.
import { defineConfig, devices } from "@playwright/test";

try { process.loadEnvFile(".env.local"); } catch {}
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

const fakeCamera = { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] };

export default defineConfig({
  testDir: "e2e",
  timeout: process.env.BASE_URL ? 300_000 : 90_000, // a deployment develops on the worker's minute timer
  expect: { timeout: 15_000 },
  retries: process.env.BASE_URL ? 1 : 0, // a cold Azure function can eat one attempt
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  webServer: process.env.BASE_URL ? undefined : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: "node", testMatch: /(api|filter)\.spec\.ts/ },
    {
      name: "android-chrome",
      testMatch: /guest\.spec\.ts/,
      use: { ...devices["Pixel 7"], permissions: ["camera"], launchOptions: fakeCamera },
    },
    {
      // Samsung Internet runs on Chromium: same engine, its own user agent.
      name: "samsung-internet",
      testMatch: /guest\.spec\.ts/,
      use: {
        ...devices["Galaxy S9+"],
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
        permissions: ["camera"],
        launchOptions: fakeCamera,
      },
    },
    {
      name: "ios-safari",
      testMatch: /guest\.spec\.ts/,
      use: { ...devices["iPhone 15"] },
    },
    {
      // Playwright's Firefox can't emulate isMobile; a phone-sized touch viewport and Firefox Android's UA is the closest.
      name: "android-firefox",
      testMatch: /guest\.spec\.ts/,
      use: {
        browserName: "firefox",
        viewport: { width: 412, height: 915 },
        hasTouch: true,
        userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
        launchOptions: { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } },
      },
    },
  ],
});
