import { test, expect } from "@playwright/test";

test.describe("Moonlight SVG Editor", () => {
  test("loads and initializes moonlight editor", async ({ page }) => {
    await page.goto("/");

    // Wait for preview to be rendered
    await page.waitForSelector(".preview");

    // デフォルト文書に依存せず moonlight-svg ブロックを流し込む
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(
      '```moonlight-svg\n<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="50" width="120" height="80" fill="#3498db" rx="10"/>\n</svg>\n```\n',
    );

    // Wrapper appears and the editor bundle initializes (createEditor renders
    // the interactive SVG into the container)
    const wrapper = page.locator(".moonlight-editor-wrapper");
    await expect(wrapper).toHaveCount(1, { timeout: 20000 });
    await expect(wrapper.locator("svg").first()).toBeVisible({ timeout: 30000 });

    // Neither the loading placeholder nor the error state remains
    await expect(wrapper).not.toContainText("Loading Moonlight Editor");
    await expect(wrapper).not.toContainText("Failed to load Moonlight Editor");

    // The source SVG content is rendered inside the editor
    await expect(wrapper.locator('svg rect[fill="#3498db"]').first()).toBeAttached();
  });
});
