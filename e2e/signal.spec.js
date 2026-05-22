import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportDataset = path.join(repoRoot, "sample_data", "e2e_mock_datasets", "support_timeseries.csv");

test("uploads a CSV and renders a generated dashboard", async ({ page }) => {
  await page.goto("/upload");

  await page.getByLabel(/dataset file/i).setInputFiles(supportDataset);
  await page.getByLabel(/context/i).fill("Show support ticket volume over time by channel.");
  await page.getByRole("button", { name: /generate dashboard/i }).click();

  await expect(page).toHaveURL(/\/results\/session_/, { timeout: 180_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/rendered visuals/i)).toBeVisible();
  await expect(page.locator(".dashboard-chart").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /update/i })).toBeVisible();
});
