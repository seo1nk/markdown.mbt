// コード譜ウィジェットのクライアントランタイム。
// タブ切替（ディグリー ⇄ コード）とキープルダウンによる移調を
// document への委譲イベントで処理する。ウィジェット HTML 自体は
// chord-language の render_widget_html が生成する（単一ソース）ため、
// SSR ページでもライブプレビューでも、このモジュールを一度読み込むだけで動く。
// @ts-ignore -- MoonBit ビルド出力 (型定義なし)
import { parse_to_notes_html, chord_css } from "../../chord-language/_build/js/release/build/chord_language.js";

let installed = false;

// 表示中の譜面 (.chord-score) を PNG Blob にする。
// 外部ライブラリを使わず、譜面 HTML + chord_css を SVG の foreignObject に
// 埋め込んで canvas に描く (スタイルが自前 CSS で完結しているため成立する)。
// 画像は貼り付け先を選ばないよう、ページのテーマによらず常にライトテーマで書き出す。
async function scoreToBlob(score: HTMLElement): Promise<Blob> {
  const width = Math.ceil(score.scrollWidth);
  const height = Math.ceil(score.scrollHeight);
  const pad = 16;
  const totalW = width + pad * 2;
  const totalH = height + pad * 2;
  const wrapperStyle = [
    `width:${width}px`,
    "background:#ffffff",
    "color:#1f2328",
    `padding:${pad}px`,
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Helvetica Neue',Arial,sans-serif",
    "font-size:16px",
    "line-height:1.5",
  ].join(";");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${wrapperStyle}">` +
    `<style>${chord_css()}</style>` +
    score.outerHTML +
    `</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = "sync";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg render failed"));
  });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await loaded;
  const scale = 2; // 高解像度で書き出す
  const canvas = document.createElement("canvas");
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob failed"));
    }, "image/png");
  });
}

// クリップボードに書けない環境ではダウンロードにフォールバックする
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyScoreImage(widget: HTMLElement, button: HTMLElement): Promise<void> {
  const active = widget.dataset.chordActive === "notes" ? "notes" : "degree";
  const score = widget.querySelector<HTMLElement>(`.chord-panel--${active} .chord-score`);
  if (!score) return;
  const original = button.textContent;
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      // Safari 対応: ユーザー操作の同期文脈で Promise を渡す形にする
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": scoreToBlob(score) }),
      ]);
    } else {
      downloadBlob(await scoreToBlob(score), "chord-score.png");
    }
    button.textContent = "コピーしました ✓";
  } catch {
    try {
      downloadBlob(await scoreToBlob(score), "chord-score.png");
      button.textContent = "保存しました ✓";
    } catch {
      button.textContent = "失敗しました";
    }
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

export function installChordWidgets(): void {
  if (installed) return;
  installed = true;

  // タブ切替 / 画像コピー
  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    const copyBtn = target?.closest?.(".chord-copy-img") as HTMLElement | null;
    if (copyBtn) {
      const widget = copyBtn.closest(".chord-widget") as HTMLElement | null;
      if (widget) {
        void copyScoreImage(widget, copyBtn);
      }
      return;
    }
    const tab = target?.closest?.(".chord-tab") as HTMLElement | null;
    if (!tab) return;
    const widget = tab.closest(".chord-widget") as HTMLElement | null;
    const mode = tab.dataset.chordTab;
    if (!widget || !mode) return;
    widget.dataset.chordActive = mode;
    for (const el of widget.querySelectorAll<HTMLElement>(".chord-tab")) {
      el.classList.toggle("chord-tab--active", el.dataset.chordTab === mode);
    }
  });

  // キープルダウン: 選択キーで notes パネルを再レンダリング
  // (移調ロジックは MoonBit 側の parse_to_notes_html を呼ぶ — 二重実装しない)
  document.addEventListener("change", (ev) => {
    const select = ev.target as HTMLSelectElement | null;
    if (!select?.classList?.contains("chord-key-select")) return;
    const widget = select.closest(".chord-widget") as HTMLElement | null;
    if (!widget) return;
    const src = widget.dataset.chordSrc ?? "";
    widget.dataset.chordKey = select.value;
    const panel = widget.querySelector(".chord-panel--notes");
    if (panel) {
      panel.innerHTML = parse_to_notes_html(src, select.value);
    }
  });
}
