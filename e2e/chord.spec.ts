import { test, expect } from "@playwright/test";

// ::: コード譜ブロックのライブプレビュー (chord-language 統合)
// - ディグリータブ: ローマ数字 + ♭/# 記号 (1→I, b7→♭VII, s4→#IV)
// - コードタブ: キーに基づく実音表示 + キープルダウンで任意移調
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

  // ディグリー表示 (デフォルトタブ) のスコア
  const degreeScore = ".preview .chord-panel--degree .chord-score";
  // コード表示 (notes タブ) のスコア
  const notesScore = ".preview .chord-panel--notes .chord-score";

  test("colon fence renders as chord widget with roman numerals", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("# Song\n\n:::\n1 3m7 4M7 5 | b7 1\n:::\n");
    await page.waitForTimeout(500);

    const widget = page.locator(".preview .chord-widget");
    await expect(widget).toBeVisible({ timeout: 5000 });
    // デフォルトはディグリータブ
    const score = page.locator(degreeScore);
    await expect(score).toBeVisible();
    await expect(score.locator(".chord-cell.chord").first()).toHaveText("I");
    await expect(score).toContainText("IIIm7");
    await expect(score).toContainText("♭VII");
    // 6 コードスロットのグリッド、| はスロット境界の縦線として 1 箇所
    await expect(score.locator(".chord-cell.chord")).toHaveCount(6);
    await expect(score.locator(".chord-cell--bar-before")).toHaveCount(1);
    // コードパネルは非表示
    await expect(page.locator(notesScore)).not.toBeVisible();
  });

  test("tab switch shows note names in declared key", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n---\nkey: G\n---\n1 4 5 3m7 b7\n:::\n");
    await page.waitForTimeout(500);

    // コードタブへ切り替え
    await page.locator('.preview .chord-tab[data-chord-tab="notes"]').click();
    const notes = page.locator(notesScore);
    await expect(notes).toBeVisible({ timeout: 5000 });
    // key=G: 1 4 5 → G C D、3m7 → Bm7、b7 → F
    await expect(notes.locator(".chord-cell.chord").nth(0)).toHaveText("G");
    await expect(notes.locator(".chord-cell.chord").nth(1)).toHaveText("C");
    await expect(notes.locator(".chord-cell.chord").nth(2)).toHaveText("D");
    await expect(notes).toContainText("Bm7");
    await expect(notes).toContainText("F");
    // ディグリーパネルは非表示に
    await expect(page.locator(degreeScore)).not.toBeVisible();
    // ディグリータブへ戻れる
    await page.locator('.preview .chord-tab[data-chord-tab="degree"]').click();
    await expect(page.locator(degreeScore)).toBeVisible();
  });

  test("key pulldown transposes to any key", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n---\nkey: G\n---\n1 4 5\n:::\n");
    await page.waitForTimeout(500);

    await page.locator('.preview .chord-tab[data-chord-tab="notes"]').click();
    const select = page.locator(".preview .chord-key-select");
    await expect(select).toHaveValue("G");
    // A へ移調 → A D E
    await select.selectOption("A");
    const notes = page.locator(notesScore);
    await expect(notes.locator(".chord-cell.chord").nth(0)).toHaveText("A");
    await expect(notes.locator(".chord-cell.chord").nth(1)).toHaveText("D");
    await expect(notes.locator(".chord-cell.chord").nth(2)).toHaveText("E");
    // Bb へ移調 → B♭ E♭ F
    await select.selectOption("Bb");
    await expect(notes.locator(".chord-cell.chord").nth(0)).toHaveText("B♭");
    await expect(notes.locator(".chord-cell.chord").nth(1)).toHaveText("E♭");
    await expect(notes.locator(".chord-cell.chord").nth(2)).toHaveText("F");
  });

  test("key defaults to C when frontmatter is absent", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n1 4 5\n:::\n");
    await page.waitForTimeout(500);

    await expect(page.locator(".preview .chord-key-select")).toHaveValue("C");
    await page.locator('.preview .chord-tab[data-chord-tab="notes"]').click();
    const notes = page.locator(notesScore);
    await expect(notes.locator(".chord-cell.chord").nth(0)).toHaveText("C");
    await expect(notes.locator(".chord-cell.chord").nth(1)).toHaveText("F");
    await expect(notes.locator(".chord-cell.chord").nth(2)).toHaveText("G");
  });

  test("backtick fences render as plain code blocks (::: only)", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("```chord\n1 4 5\n```\n");
    await page.waitForTimeout(500);

    // ::: だけがコード譜ブロック。``` は言語タグに関わらず通常のコードブロック
    await expect(page.locator(".preview .chord-widget")).not.toBeVisible();
    await expect(page.locator(".preview pre").first()).toContainText("1 4 5");
  });

  test("colored chords get color classes in both tabs", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n1@red 3m7@blue 5@green\n:::\n");
    await page.waitForTimeout(500);

    await expect(page.locator(`${degreeScore} .chord--red`)).toHaveText("I");
    await expect(page.locator(`${degreeScore} .chord--blue`)).toHaveText("IIIm7");
    await expect(page.locator(`${degreeScore} .chord--green`)).toHaveText("V");
    // コードタブでも色は保持される (key=C)
    await page.locator('.preview .chord-tab[data-chord-tab="notes"]').click();
    await expect(page.locator(`${notesScore} .chord--red`)).toHaveText("C");
    await expect(page.locator(`${notesScore} .chord--blue`)).toHaveText("Em7");
  });

  test("accidentals render as flat/sharp symbols", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\ns4M7(b5,b9,s11)/b3\n:::\n");
    await page.waitForTimeout(500);

    await expect(page.locator(`${degreeScore} .chord-cell.chord`).first()).toHaveText(
      "#IVM7(♭5,♭9,#11)/♭III",
    );
  });

  test("invalid chord input shows error fallback without breaking page", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill("before text\n\n:::\n1 3m7\n8x 5\n:::\n\nafter text");
    await page.waitForTimeout(500);

    const error = page.locator(".preview .chord-error");
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error.locator(".chord-error-msg")).toContainText("2 行目");
    await expect(error.locator(".chord-error-src")).toContainText("8x 5");
    await expect(page.locator(".preview")).toContainText("before text");
    await expect(page.locator(".preview")).toContainText("after text");
  });

  test("edit recovers from error to rendered widget", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n8x\n:::\n");
    await page.waitForTimeout(500);
    await expect(page.locator(".preview .chord-error")).toBeVisible({ timeout: 5000 });

    await textarea.fill(":::\n1 4 5\n:::\n");
    await page.waitForTimeout(500);
    await expect(page.locator(degreeScore)).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".preview .chord-error")).not.toBeVisible();
  });

  test("partial rendering keeps valid lines with in-place errors", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n1 3m7\n8x 5\n4M7 1\n:::\n");
    await page.waitForTimeout(500);

    const score = page.locator(".preview .chord-score");
    await expect(score).toBeVisible({ timeout: 5000 });
    await expect(score).toContainText("IIIm7");
    await expect(score).toContainText("IVM7");
    const error = score.locator(".chord-error");
    await expect(error).toBeVisible();
    await expect(error.locator(".chord-error-msg")).toContainText("2 行目");
    await expect(error.locator(".chord-error-msg")).toContainText("位置 0");
    await expect(error.locator(".chord-error-src")).toContainText("8x 5");
  });

  test("regular markdown still renders alongside chord blocks", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(
      "# Title\n\n**bold** text\n\n:::\n1 4 5\n:::\n\n```js\nconst x = 1;\n```\n",
    );
    await page.waitForTimeout(500);

    const preview = page.locator(".preview");
    await expect(preview.locator("h1")).toContainText("Title");
    await expect(preview.locator("strong")).toContainText("bold");
    await expect(page.locator(degreeScore)).toBeVisible();
    await expect(preview).toContainText("const x = 1;");
  });

  test("repeat marks and dash groups render and transpose", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(
      ":::\n---\nkey: Eb\n---\n| 1/3 4 5 37/b6@red |\n| 6m7 3m/5 4m 2-5 |\n| 1 % |\n:::\n",
    );
    await page.waitForTimeout(500);

    // ディグリータブ: - グループは 1 スロットに 2 コード
    const group = page.locator(`${degreeScore} .chord-group`);
    await expect(group).toBeVisible({ timeout: 5000 });
    await expect(group.locator(".chord").nth(0)).toHaveText("II");
    await expect(group.locator(".chord").nth(1)).toHaveText("V");
    // % は反復記号として描画
    await expect(page.locator(`${degreeScore} .chord-repeat`)).toHaveText("%");

    // コードタブ (key=Eb): グループは F / B♭、% はそのまま
    await page.locator('.preview .chord-tab[data-chord-tab="notes"]').click();
    const notesGroup = page.locator(`${notesScore} .chord-group`);
    await expect(notesGroup.locator(".chord").nth(0)).toHaveText("F");
    await expect(notesGroup.locator(".chord").nth(1)).toHaveText("B♭");
    await expect(page.locator(`${notesScore} .chord-repeat`)).toHaveText("%");
  });

  test("section labels and lyric lines render under chords", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(
      ":::\n---\nkey: G\n---\n[Aメロ]\n| 1M7 % | 2-5 |\n> ひかりの _ この-みち\n:::\n",
    );
    await page.waitForTimeout(500);

    // セクションラベル(白抜き反転バッジ: 背景が塗られ、文字色は背景色系)
    const section = page.locator(`${degreeScore} .chord-section`);
    await expect(section).toHaveText("Aメロ");
    const sectionStyle = await section.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const name = el.querySelector(".chord-section-name");
      const fg = name ? getComputedStyle(name).color : "";
      return { bg, fg };
    });
    expect(sectionStyle.bg).not.toBe("rgba(0, 0, 0, 0)"); // 背景が塗られている
    expect(sectionStyle.bg).not.toBe(sectionStyle.fg); // 反転している
    // 歌詞がコードの下に付く（_ のスロットには付かない）
    const lyrics = page.locator(`${degreeScore} .chord-lyric`);
    await expect(lyrics.nth(0)).toHaveText("ひかりの");
    // グループには - で分配される
    const group = page.locator(`${degreeScore} .chord-group`);
    await expect(group).toContainText("この");
    await expect(group).toContainText("みち");
    // コードタブでも歌詞・セクションは保持される
    await page.locator('.preview .chord-tab[data-chord-tab="notes"]').click();
    await expect(page.locator(`${notesScore} .chord-section`)).toHaveText("Aメロ");
    await expect(page.locator(`${notesScore} .chord-lyric`).nth(0)).toHaveText("ひかりの");
  });

  test("no-chord and empty beats render with lyrics", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n| NC 1 _ % |\n> ワン Let\'s_go _ フォー\n:::\n");
    await page.waitForTimeout(500);

    const score = page.locator(degreeScore);
    await expect(score.locator(".chord-nc")).toContainText("N.C.");
    // 断片中の _ は表示スペースになる
    await expect(score.locator(".chord-lyric").nth(1)).toHaveText("Let's go");
    // 空拍 _ はスロットを占有する(4スロット)
    await expect(score.locator(".chord-cell")).toHaveCount(4);
    await expect(score.locator(".chord-cell--blank")).toHaveCount(1);
  });

  test("copy score as image button copies a PNG to clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n---\nkey: G\n---\n[Aメロ]\n| 1M7 % | 2-5 |\n> ひかりの _ この-みち\n:::\n");
    await page.waitForTimeout(500);

    const button = page.locator(".preview .chord-copy-img");
    await expect(button).toBeVisible({ timeout: 5000 });
    await button.click();
    // 成功フィードバック(チェックアイコン + トースト)
    await expect(button.locator('svg[data-icon="check"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".chord-toast")).toHaveText("コピーしました");
    // クリップボードに PNG が入っている
    const hasPng = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items.some((item) => item.types.includes("image/png"));
    });
    expect(hasPng).toBe(true);
    // カメラアイコンに戻る
    await expect(button.locator('svg[data-icon="camera"]')).toBeVisible({ timeout: 5000 });
  });

  test("play button starts playback with cursor highlight and toggles to stop", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n---\nkey: G\nbpm: 400\n---\n| 1 4 |\n:::\n");
    await page.waitForTimeout(500);

    const play = page.locator(".preview .chord-play");
    await expect(play.locator('svg[data-icon="play"]')).toBeVisible();
    await play.click();
    // 再生中: ボタンが停止アイコンになり、カーソルがセルをハイライトする
    await expect(play.locator('svg[data-icon="stop"]')).toBeVisible();
    await expect(play).toHaveAttribute("aria-label", "停止");
    await expect(page.locator(".preview .chord-cell--playing")).toHaveCount(1, { timeout: 3000 });
    // 手動停止でアイコンとハイライトが戻る
    await play.click();
    await expect(play.locator('svg[data-icon="play"]')).toBeVisible();
    await expect(play).toHaveAttribute("aria-label", "再生");
    await expect(page.locator(".preview .chord-cell--playing")).toHaveCount(0);
    // 再生し切ると自動停止する (400BPM × 8拍 = 1.2秒)
    await play.click();
    await expect(play.locator('svg[data-icon="stop"]')).toBeVisible();
    await expect(play.locator('svg[data-icon="play"]')).toBeVisible({ timeout: 4000 });
  });

  test("hash sharp and maj7 parse; help button toggles the cheatsheet", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.click();
    await textarea.fill(":::\n1maj7 #4 | 2m7(b9,#11) 5\n:::\n");
    await page.waitForTimeout(500);

    const widget = page.locator(".preview .chord-widget");
    await expect(widget).toBeVisible();
    // maj7 は M7 に正規化、# はシャープとして表示される(エラーなし)
    const degree = page.locator(".preview .chord-panel--degree .chord-score");
    await expect(degree).toContainText("IM7");
    await expect(degree).toContainText("#IV");
    await expect(page.locator(".preview .chord-error")).toHaveCount(0);

    // ヘッダの ? ボタンでチートシートモーダルが開閉する
    const cheat = page.locator(".chord-help-modal .chord-cheatsheet").last();
    await expect(cheat).not.toBeVisible();
    await page.locator(".chord-help-button").click();
    await expect(cheat).toBeVisible();
    await expect(cheat).toContainText("ディグリー 1〜7");
    await expect(cheat.locator(".chord-cheat-example")).toContainText("| 2m7 5(9) | 1M7 % |");
    // オーバーレイのクリックで閉じる
    await page.locator(".chord-help-overlay").click({ position: { x: 5, y: 5 } });
    await expect(cheat).not.toBeVisible();
  });
});
