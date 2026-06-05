import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportDataset = path.join(repoRoot, "sample_data", "e2e_mock_datasets", "support_timeseries.csv");

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test("uploads a CSV, reviews the draft, and opens the final dashboard", async ({ page }) => {
  await page.goto("/upload");

  await page.getByLabel(/dataset file/i).setInputFiles(supportDataset);
  await page.getByLabel(/context/i).fill("Show support ticket volume over time by channel.");
  await page.getByRole("button", { name: /review draft dashboard/i }).click();

  await expect(page).toHaveURL(/\/update\/session_/, { timeout: 180_000 });
  await expect(page.getByRole("button", { name: /generate dashboard/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /generate dashboard/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /generate dashboard/i }).click();

  await expect(page).toHaveURL(/\/results\/session_/, { timeout: 180_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Visuals", { exact: true })).toBeVisible();
  await expect(page.locator(".dashboard-chart").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /update/i })).toBeVisible();
});
