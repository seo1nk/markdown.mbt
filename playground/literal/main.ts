/**
 * Demo entry for the literal renderer.
 *
 * Two views of the same Markdown:
 *  - left:  editable textarea (the source).
 *  - right: `toHtmlLiteral(source)` injected as innerHTML; optionally
 *           overlaid on top of the source view in monospace so glyphs
 *           can be compared character-by-character.
 *
 * The invariant indicator at the top reports whether stripping HTML from
 * the rendered output yields the same string as `toMarkdown(source)`
 * (i.e. the visible text matches the serializer). For any input the
 * library handles, the indicator should stay green.
 */

import { toHtmlLiteral, toMarkdown } from "../../js/api.js";

const SAMPLE = [
  "# Compression Dictionary Transport 用の Toolkit",
  "",
  "## Intro",
  "",
  "CDT は あらかじめ辞書を作って クライアントに取得させておき、それを用いて 転送を圧縮することができる。",
  "",
  "- コマンドラインツール `cdt-toolkit` を定義した",
  "  - Rust で実装し crates.io で公開中",
  "- 詳細は <https://github.com/example/cdt-toolkit> を参照",
  "",
  "## Sample emphasis",
  "",
  "This paragraph contains *italic*, **bold**, ~~strike~~, and `inline code`.",
  "",
  "> Block quotes also render with their leading `> ` marker visible.",
  "> Second line of the quote.",
  "",
  "```rust",
  "fn main() {",
  '    println!("hello, world!");',
  "}",
  "```",
  "",
].join("\n");

const sourceEl = document.getElementById("source") as HTMLTextAreaElement;
const renderedEl = document.getElementById("rendered") as HTMLDivElement;
const sourceViewEl = document.getElementById("source-view") as HTMLPreElement;
const invariantEl = document.getElementById("invariant-state") as HTMLSpanElement;
const overlayToggle = document.getElementById("overlay-toggle") as HTMLInputElement;

sourceEl.value = SAMPLE;

function update(): void {
  const src = sourceEl.value;
  const html = toHtmlLiteral(src);
  renderedEl.innerHTML = html;
  sourceViewEl.textContent = src;

  const visible = stripHtml(html);
  const normalized = toMarkdown(src);
  if (visible === normalized) {
    invariantEl.textContent = "✓ overlay invariant holds";
    invariantEl.style.color = "#3fb950";
  } else {
    invariantEl.textContent = "✗ overlay drift — see console for diff";
    invariantEl.style.color = "#f85149";
    console.warn("overlay drift", { visible, normalized });
  }
}

function stripHtml(html: string): string {
  // Mirror src/renderer_literal_test.mbt's `strip_html` to validate the
  // invariant client-side as well.
  const tmp = document.createElement("template");
  tmp.innerHTML = html;
  return (tmp.content.textContent ?? "").replaceAll(" ", " ");
}

overlayToggle.addEventListener("change", () => {
  document.body.classList.toggle("overlay", overlayToggle.checked);
});

sourceEl.addEventListener("input", update);
update();
