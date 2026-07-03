// コード譜ウィジェットのクライアントランタイム。
// タブ切替（ディグリー ⇄ コード）とキープルダウンによる移調を
// document への委譲イベントで処理する。ウィジェット HTML 自体は
// chord-language の render_widget_html が生成する（単一ソース）ため、
// SSR ページでもライブプレビューでも、このモジュールを一度読み込むだけで動く。
// @ts-ignore -- MoonBit ビルド出力 (型定義なし)
import { parse_to_notes_html } from "../../chord-language/_build/js/release/build/chord_language.js";

let installed = false;

export function installChordWidgets(): void {
  if (installed) return;
  installed = true;

  // タブ切替
  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
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
