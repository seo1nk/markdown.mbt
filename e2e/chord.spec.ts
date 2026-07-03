import { test, expect } from "@playwright/test";

// ```chord フェンスブロックのライブプレビュー (chord-language 統合の垂直スライス検証)
test.describe("Chord block preview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase("markdown-editor");
    });
    await page.reload();
    await page.waitForSelector(".app-container", { timeout: 10000 });
    await page.waitForSelector(".syntax-editor-container, .simple-editor", { timeout: 10000 });
  });

  test("chord block renders as chord score", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("# Song\n\n```chord\n1 3m7 4M7 5 | b7 1\n```\n");
    await page.waitForTimeout(500);

    const score = page.locator(".preview .chord-score");
    await expect(score).toBeVisible({ timeout: 5000 });
    // コードセルとして描画されている (コードブロックのソース表示ではない)
    await expect(score.locator(".chord-cell.chord").first()).toHaveText("1");
    await expect(score.locator(".chord-barline")).toHaveCount(1);
    await expect(score).toContainText("3m7");
  });

  test("colored chords get color classes", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("```chord\n1@red 3m7@blue 5@green\n```\n");
    await page.waitForTimeout(500);

    await expect(page.locator(".preview .chord--red")).toHaveText("1");
    await expect(page.locator(".preview .chord--blue")).toHaveText("3m7");
    await expect(page.locator(".preview .chord--green")).toHaveText("5");
    // CSS が注入され、色が実際に適用されている
    const redColor = await page
      .locator(".preview .chord--red")
      .evaluate((el) => getComputedStyle(el).color);
    expect(redColor).not.toBe("");
  });

  test("invalid chord input shows error fallback without breaking page", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("before text\n\n```chord\n1 3m7\n8x 5\n```\n\nafter text");
    await page.waitForTimeout(500);

    const error = page.locator(".preview .chord-error");
    await expect(error).toBeVisible({ timeout: 5000 });
    // 行番号つきエラーメッセージ
    await expect(error.locator(".chord-error-msg")).toContainText("line 2");
    // ソースの <pre> フォールバック表示
    await expect(error.locator(".chord-error-src")).toContainText("8x 5");
    // ページの他の部分は壊れていない
    await expect(page.locator(".preview")).toContainText("before text");
    await expect(page.locator(".preview")).toContainText("after text");
  });

  test("edit recovers from error to rendered score", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("```chord\n8x\n```\n");
    await page.waitForTimeout(500);
    await expect(page.locator(".preview .chord-error")).toBeVisible({ timeout: 5000 });

    await textarea.fill("```chord\n1 4 5\n```\n");
    await page.waitForTimeout(500);
    await expect(page.locator(".preview .chord-score")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".preview .chord-error")).not.toBeVisible();
  });

  test("chord:code mode falls through to source highlighting", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("```chord:code\n1 3m7 4M7 5\n```\n");
    await page.waitForTimeout(500);

    // チャート描画ではなくソース表示 (pre) になる
    await expect(page.locator(".preview .chord-score")).not.toBeVisible();
    await expect(page.locator(".preview pre").first()).toContainText("1 3m7 4M7 5");
  });

  test("regular markdown still renders alongside chord blocks", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(
      "# Title\n\n**bold** text\n\n```chord\n1 4 5\n```\n\n```js\nconst x = 1;\n```\n",
    );
    await page.waitForTimeout(500);

    const preview = page.locator(".preview");
    await expect(preview.locator("h1")).toContainText("Title");
    await expect(preview.locator("strong")).toContainText("bold");
    await expect(preview.locator(".chord-score")).toBeVisible();
    // 他言語のコードブロックは通常どおり
    await expect(preview).toContainText("const x = 1;");
  });
});
