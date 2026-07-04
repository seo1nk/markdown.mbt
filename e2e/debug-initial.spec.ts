import { test, expect } from '@playwright/test';

test('initial load shows preview', async ({ page }) => {
  await page.goto('/playground/');

  // Wait for preview to render
  await page.waitForFunction(() => {
    const preview = document.querySelector('.preview');
    return preview && preview.textContent && preview.textContent.length > 100;
  }, { timeout: 10000 });

  const previewText = await page.evaluate(() => {
    const preview = document.querySelector('.preview');
    return preview?.textContent?.slice(0, 100) || '';
  });
  console.log('Preview text:', previewText);

  expect(previewText).toContain('Markdown プレイグラウンド');
});
