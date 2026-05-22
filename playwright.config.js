import { defineConfig, devices } from "@playwright/test";

const previewBaseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = previewBaseUrl || "http://127.0.0.1:5173";
const protectionBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const extraHTTPHeaders = protectionBypassSecret
  ? {
      "x-vercel-protection-bypass": protectionBypassSecret,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "output/playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders,
  },
  webServer: previewBaseUrl
    ? undefined
    : [
        {
          command: "uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000",
          url: "http://127.0.0.1:8000/health",
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "npm run dev --prefix frontend -- --host 127.0.0.1 --port 5173",
          url: "http://127.0.0.1:5173",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
