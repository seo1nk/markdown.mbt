import { test, expect } from '@playwright/test';

test.describe('Task List Toggle', () => {
  test('clicking checkbox in preview updates source', async ({ page }) => {
    await page.goto('/playground/');

    // Wait for preview to render
    await page.waitForSelector('.preview .task-list-item');

    // Find the first unchecked checkbox in preview
    const checkbox = page.locator('.preview .task-list-item input[type="checkbox"]').first();

    // Verify it's not checked initially
    const isCheckedBefore = await checkbox.isChecked();

    // Click the checkbox
    await checkbox.click();

    // Wait for source to update
    await page.waitForTimeout(200);

    // Verify checkbox state changed
    const isCheckedAfter = await checkbox.isChecked();
    expect(isCheckedAfter).not.toBe(isCheckedBefore);

    // Verify source text was updated
    const editorText = await page.evaluate(() => {
      const textarea = document.querySelector('.editor-textarea') as HTMLTextAreaElement;
      return textarea?.value || '';
    });

    if (isCheckedBefore) {
      // Was checked, now unchecked -> should have [ ]
      expect(editorText).toContain('[ ] タブを');
    } else {
      // Was unchecked, now checked -> should have [x]
      expect(editorText).toContain('[x] タブを');
    }
  });

  test('toggling checkbox moves cursor to that line', async ({ page }) => {
    await page.goto('/playground/');

    // Wait for preview to render
    await page.waitForSelector('.preview .task-list-item');

    // Click the first checkbox
    const checkbox = page.locator('.preview .task-list-item input[type="checkbox"]').first();
    await checkbox.click();

    // Wait for cursor update
    await page.waitForTimeout(200);

    // Editor should have focus
    const activeElement = await page.evaluate(() => {
      return document.activeElement?.className || '';
    });
    expect(activeElement).toContain('editor');
  });
});
