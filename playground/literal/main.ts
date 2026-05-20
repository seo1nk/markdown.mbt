/**
 * Demo entry for the literal renderer.
 *
 * Three behaviours wired together:
 *
 *  - Preview mode shows `toHtmlLiteral(source, { positions: true })`.
 *    Clicking flips into edit mode with the cursor placed at the source
 *    offset under the click.
 *  - Edit mode places a transparent textarea over a markdown-highlighted
 *    source layer. Typing in it triggers a *partial* re-render that diffs
 *    the new HTML against the current DOM and replaces only the top-level
 *    blocks that actually changed (see `LiteralEditor`). Press Escape (or
 *    unfocus) to flip back.
 *  - Overlay mode stacks a faded source view on top of the rendered view
 *    so the alignment can be verified visually.
 *
 * A live stats badge reports how many blocks were reused vs replaced vs
 * shifted on the latest update — useful for verifying that the partial-
 * update path is doing its job.
 */

import { toHtmlLiteral, toMarkdown } from "../../js/api.js";
import { LiteralEditor } from "../../frontend/editor/literal-editor.js";
import "../../frontend/editor/overlay.css";

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
  "Inline image example: ![placeholder:w96](/images/literal-preview-a.svg)",
  "and ![another:w96](/images/literal-preview-b.svg).",
  "",
  "/images/literal-preview-a.svg",
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
const imagePreviewToggle = document.getElementById("image-preview-toggle") as HTMLInputElement;
const cursorIndicatorEl = document.getElementById("cursor-indicator") as HTMLSpanElement | null;
const patchStatsEl = document.getElementById("patch-stats") as HTMLSpanElement | null;

sourceEl.value = SAMPLE;

let imagePreviewOn = false;

const renderLiteral = (src: string): string =>
  toHtmlLiteral(src, { positions: true, imagePreview: imagePreviewOn });

const editor = new LiteralEditor(renderedEl, renderLiteral, SAMPLE);

function refreshInvariant(src: string): void {
  const visible = stripHtml(renderedEl.innerHTML);
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

function update(src: string): void {
  const stats = editor.setSource(src);
  renderSourceView(src);
  if (patchStatsEl) {
    patchStatsEl.textContent =
      `patch: reused ${stats.reused} · replaced ${stats.replaced}` +
      ` · shifted ${stats.shifted} · inserted ${stats.inserted}` +
      ` · removed ${stats.removed}`;
  }
  refreshInvariant(src);
}

function renderSourceView(src: string): void {
  sourceViewEl.innerHTML = renderHighlightedSourceView(src);
}

function stripHtml(html: string): string {
  const tmp = document.createElement("template");
  tmp.innerHTML = html;
  return tmp.content.textContent ?? "";
}

interface SourceImageSyntax {
  end: number;
  alt: string;
  url: string | null;
  ref: string | null;
}

interface ImageAltMeta {
  alt: string;
  width: number | null;
}

function renderHighlightedSourceView(src: string): string {
  let html = "";
  let lineStart = 0;
  while (lineStart <= src.length) {
    const newline = src.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? src.length : newline;
    const line = src.slice(lineStart, lineEnd);
    const imageUrl = standaloneImageUrlFromLine(line);
    if (imageUrl != null) {
      html += highlightMarkdownSourceLine(line);
      if (imagePreviewOn) {
        html += renderSourceStandaloneImagePreviewSlot(imageUrl);
      }
    } else {
      html += renderHighlightedSourceInlineLine(line);
    }
    if (newline < 0) break;
    html += "\n";
    lineStart = newline + 1;
  }
  return html;
}

interface LinePrefixHighlight {
  prefixHtml: string;
  rest: string;
  restClass: string | null;
}

function renderHighlightedSourceInlineLine(src: string): string {
  const prefixed = splitMarkdownLinePrefix(src);
  const restHtml = renderHighlightedInlineWithImageSlots(prefixed.rest);
  if (prefixed.restClass == null) return prefixed.prefixHtml + restHtml;
  return `${prefixed.prefixHtml}<span class="${prefixed.restClass}">${restHtml}</span>`;
}

function splitMarkdownLinePrefix(line: string): LinePrefixHighlight {
  const fence = /^(`{3,}|~{3,})(.*)$/.exec(line);
  if (fence) {
    return {
      prefixHtml: span("md-src-code-marker", fence[1]!),
      rest: fence[2]!,
      restClass: "md-src-code",
    };
  }

  const heading = /^(#{1,6})([ \t]+)(.*)$/.exec(line);
  if (heading) {
    return {
      prefixHtml: span("md-src-heading-marker", heading[1]!) + escapeHtml(heading[2]!),
      rest: heading[3]!,
      restClass: "md-src-heading",
    };
  }

  const quote = /^(>[ \t]?)(.*)$/.exec(line);
  if (quote) {
    return {
      prefixHtml: span("md-src-quote-marker", quote[1]!),
      rest: quote[2]!,
      restClass: null,
    };
  }

  const unordered = /^([ \t]*)([-*+])([ \t]+)(.*)$/.exec(line);
  if (unordered) {
    return {
      prefixHtml: escapeHtml(unordered[1]!) +
        span("md-src-list-marker", unordered[2]!) +
        escapeHtml(unordered[3]!),
      rest: unordered[4]!,
      restClass: null,
    };
  }

  const ordered = /^([ \t]*)(\d+[.)])([ \t]+)(.*)$/.exec(line);
  if (ordered) {
    return {
      prefixHtml: escapeHtml(ordered[1]!) +
        span("md-src-list-marker", ordered[2]!) +
        escapeHtml(ordered[3]!),
      rest: ordered[4]!,
      restClass: null,
    };
  }

  if (/^[ \t]*(?:\*{3,}|-{3,}|_{3,})[ \t]*$/.test(line)) {
    return { prefixHtml: "", rest: line, restClass: "md-src-hr" };
  }

  return { prefixHtml: "", rest: line, restClass: null };
}

function highlightMarkdownSourceLine(line: string): string {
  return renderHighlightedSourceInlineLine(line);
}

function renderHighlightedInlineWithImageSlots(src: string): string {
  let html = "";
  let pos = 0;
  while (pos < src.length) {
    const start = src.indexOf("![", pos);
    if (start < 0) {
      html += highlightMarkdownSourceInline(src.slice(pos));
      break;
    }
    const image = parseSourceImageSyntax(src, start);
    if (!image) {
      html += highlightMarkdownSourceInline(src.slice(pos, start + 1));
      pos = start + 1;
      continue;
    }
    html += highlightMarkdownSourceInline(src.slice(pos, image.end));
    if (imagePreviewOn) {
      html += renderSourceImagePreviewSlot(image);
    }
    pos = image.end;
  }
  return html;
}

function highlightMarkdownSourceInline(src: string): string {
  let html = "";
  let pos = 0;
  while (pos < src.length) {
    const code = readDelimited(src, pos, "`", "`", true);
    if (code != null) {
      html += span("md-src-code-marker", "`") +
        span("md-src-code", code.inner) +
        span("md-src-code-marker", "`");
      pos = code.end;
      continue;
    }

    const strong = readDelimited(src, pos, "**", "**");
    if (strong != null) {
      html += span("md-src-strong", src.slice(pos, strong.end));
      pos = strong.end;
      continue;
    }

    const strongUnderscore = readDelimited(src, pos, "__", "__");
    if (strongUnderscore != null) {
      html += span("md-src-strong", src.slice(pos, strongUnderscore.end));
      pos = strongUnderscore.end;
      continue;
    }

    const del = readDelimited(src, pos, "~~", "~~");
    if (del != null) {
      html += span("md-src-del", src.slice(pos, del.end));
      pos = del.end;
      continue;
    }

    const image = parseSourceImageSyntax(src, pos);
    if (image != null) {
      html += highlightImageSyntax(src.slice(pos, image.end), image.alt);
      pos = image.end;
      continue;
    }

    const link = readInlineLink(src, pos);
    if (link != null) {
      html += highlightLinkSyntax(src.slice(pos, link.end), link.text);
      pos = link.end;
      continue;
    }

    const em = readEmphasis(src, pos, "*") ?? readEmphasis(src, pos, "_");
    if (em != null) {
      html += span("md-src-em", src.slice(pos, em.end));
      pos = em.end;
      continue;
    }

    const autoLink = readAutoLink(src, pos);
    if (autoLink != null) {
      html += span("md-src-html", "<") + span("md-src-url", autoLink.inner) +
        span("md-src-html", ">");
      pos = autoLink.end;
      continue;
    }

    const url = readBareUrl(src, pos);
    if (url != null) {
      html += span("md-src-url", src.slice(pos, url.end));
      pos = url.end;
      continue;
    }

    if (src[pos] === "\\") {
      html += span("md-src-escape", src.slice(pos, Math.min(pos + 2, src.length)));
      pos += 2;
      continue;
    }

    html += escapeHtml(src[pos]!);
    pos++;
  }
  return html;
}

interface DelimitedSpan {
  inner: string;
  end: number;
}

interface InlineLinkSyntax {
  text: string;
  end: number;
}

function readDelimited(
  src: string,
  pos: number,
  open: string,
  close: string,
  allowEmpty = false,
): DelimitedSpan | null {
  if (!src.startsWith(open, pos)) return null;
  const innerStart = pos + open.length;
  let end = src.indexOf(close, innerStart);
  while (end >= 0 && src[end - 1] === "\\") {
    end = src.indexOf(close, end + close.length);
  }
  if (end < 0 || (!allowEmpty && end === innerStart)) return null;
  return { inner: src.slice(innerStart, end), end: end + close.length };
}

function readEmphasis(src: string, pos: number, marker: "*" | "_"): DelimitedSpan | null {
  if (!src.startsWith(marker, pos) || src.startsWith(marker + marker, pos)) return null;
  const prev = pos > 0 ? src[pos - 1] : "";
  if (prev != null && /\w/.test(prev)) return null;
  const innerStart = pos + 1;
  const end = src.indexOf(marker, innerStart);
  if (end <= innerStart || src[end + 1] === marker) return null;
  return { inner: src.slice(innerStart, end), end: end + 1 };
}

function readInlineLink(src: string, pos: number): InlineLinkSyntax | null {
  if (!src.startsWith("[", pos) || src.startsWith("![", pos)) return null;
  const textEnd = findMarkdownBracketEnd(src, pos + 1);
  if (textEnd < 0 || src[textEnd + 1] !== "(") return null;
  const destEnd = findMarkdownParenEnd(src, textEnd + 2);
  if (destEnd < 0) return null;
  return { text: src.slice(pos + 1, textEnd), end: destEnd + 1 };
}

function readAutoLink(src: string, pos: number): DelimitedSpan | null {
  const match = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(src.slice(pos));
  if (!match) return null;
  return { inner: match[1]!, end: pos + match[0].length };
}

function readBareUrl(src: string, pos: number): DelimitedSpan | null {
  const match = /^(?:https?:\/\/|\/)[^\s<>()]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:[?#][^\s<>()]*)?|^https?:\/\/[^\s<>()]+/.exec(
    src.slice(pos),
  );
  if (!match) return null;
  return { inner: match[0], end: pos + match[0].length };
}

function highlightImageSyntax(raw: string, alt: string): string {
  const altStart = raw.indexOf("[") + 1;
  const altEnd = altStart + alt.length;
  return span("md-src-marker", raw.slice(0, altStart)) +
    span("md-src-image-alt", raw.slice(altStart, altEnd)) +
    span("md-src-marker", raw.slice(altEnd, altEnd + 2)) +
    span("md-src-url", raw.slice(altEnd + 2, -1)) +
    span("md-src-marker", raw.slice(-1));
}

function highlightLinkSyntax(raw: string, text: string): string {
  const textStart = 1;
  const textEnd = textStart + text.length;
  return span("md-src-link-bracket", "[") +
    span("md-src-link-text", raw.slice(textStart, textEnd)) +
    span("md-src-link-bracket", raw.slice(textEnd, textEnd + 2)) +
    span("md-src-url", raw.slice(textEnd + 2, -1)) +
    span("md-src-link-bracket", raw.slice(-1));
}

function span(className: string, value: string): string {
  return `<span class="${className}">${escapeHtml(value)}</span>`;
}

function parseSourceImageSyntax(src: string, start: number): SourceImageSyntax | null {
  if (!src.startsWith("![", start)) return null;
  const altEnd = findMarkdownBracketEnd(src, start + 2);
  if (altEnd < 0) return null;
  const alt = src.slice(start + 2, altEnd);
  const next = src[altEnd + 1];
  if (next === "(") {
    const destEnd = findMarkdownParenEnd(src, altEnd + 2);
    if (destEnd < 0) return null;
    return {
      end: destEnd + 1,
      alt,
      url: parseInlineImageDestination(src.slice(altEnd + 2, destEnd)),
      ref: null,
    };
  }
  if (next === "[") {
    const labelEnd = findMarkdownBracketEnd(src, altEnd + 2);
    if (labelEnd < 0) return null;
    return {
      end: labelEnd + 1,
      alt,
      url: null,
      ref: src.slice(altEnd + 2, labelEnd),
    };
  }
  return null;
}

function findMarkdownBracketEnd(src: string, pos: number): number {
  let depth = 0;
  for (let i = pos; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") {
      depth++;
      continue;
    }
    if (ch === "]") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function findMarkdownParenEnd(src: string, pos: number): number {
  let depth = 0;
  for (let i = pos; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function parseInlineImageDestination(raw: string): string {
  const value = raw.trimStart();
  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    return end >= 0 ? value.slice(1, end) : "";
  }
  const match = value.match(/^\S+/);
  return match?.[0] ?? "";
}

function parseImageAltMeta(alt: string): ImageAltMeta {
  const match = /^(.*):w([0-9]+)$/.exec(alt);
  if (!match) return { alt, width: null };
  const width = Number.parseInt(match[2]!, 10);
  if (width <= 0) return { alt, width: null };
  return { alt: match[1]!.replace(/[ \t]+$/, ""), width };
}

function standaloneImageUrlFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  return isPreviewableImageUrl(trimmed) ? trimmed : null;
}

function isPreviewableImageUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0]!.toLowerCase();
  return (
    path.startsWith("data:image/") ||
    /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(path)
  );
}

function renderSourceStandaloneImagePreviewSlot(url: string): string {
  return renderSourceImagePreviewSlot(
    { end: 0, alt: "", url, ref: null },
    "md-image-preview-block",
  );
}

function renderSourceImagePreviewSlot(image: SourceImageSyntax, extraClass = ""): string {
  const meta = parseImageAltMeta(image.alt);
  const className = extraClass.length > 0
    ? `md-image-preview-slot md-image-preview-spacer ${extraClass}`
    : "md-image-preview-slot md-image-preview-spacer";
  const attrs = [
    `class="${className}"`,
    'data-md-noneditable="true"',
    'contenteditable="false"',
  ];
  if (meta.width != null) {
    attrs.push(`data-md-image-width="${meta.width}"`);
    attrs.push(`style="--md-literal-image-width:${meta.width}px"`);
  }
  const imgAttrs = [
    'class="md-image-preview"',
    `alt="${escapeHtmlAttr(meta.alt)}"`,
    'loading="lazy"',
  ];
  if (image.url != null) {
    imgAttrs.splice(1, 0, `src="${escapeHtmlAttr(image.url)}"`);
  } else if (image.ref != null) {
    imgAttrs.splice(1, 0, `data-md-image-ref="${escapeHtmlAttr(image.ref)}"`);
  }
  return `<span ${attrs.join(" ")}><img ${imgAttrs.join(" ")} /></span>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

// =============================================================================
// Click-to-cursor
// =============================================================================

function findPositionedAncestor(node: Node | null): HTMLElement | null {
  let el = node instanceof Element ? node : node?.parentElement ?? null;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.srcStart != null) return el;
    el = el.parentElement;
  }
  return null;
}

function visibleOffsetWithin(root: Element, target: Node, targetOffset: number): number {
  if (target === root) {
    let count = 0;
    for (const child of root.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) count += (child as Text).data.length;
      else if (child instanceof Element) count += (child.textContent ?? "").length;
    }
    return Math.min(count, targetOffset);
  }
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  while (current) {
    if (current === target) return count + targetOffset;
    count += current.data.length;
    current = walker.nextNode() as Text | null;
  }
  return count;
}

function sourceOffsetFromPoint(x: number, y: number): number | null {
  if (pointHitsNonEditable(x, y)) return null;
  const range =
    (document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }).caretRangeFromPoint?.(x, y) ?? null;
  if (!range) return null;
  const ancestor = findPositionedAncestor(range.startContainer);
  if (!ancestor || !ancestor.dataset.srcStart) return null;
  const base = Number.parseInt(ancestor.dataset.srcStart, 10);
  const within = visibleOffsetWithin(ancestor, range.startContainer, range.startOffset);
  return base + within;
}

function pointHitsNonEditable(x: number, y: number): boolean {
  for (const root of [renderedEl, sourceViewEl]) {
    const slots = root.querySelectorAll("[data-md-noneditable]");
    for (const slot of slots) {
      for (const rect of Array.from(slot.getClientRects())) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return true;
        }
      }
    }
  }
  return false;
}

// =============================================================================
// Mode toggling
// =============================================================================

function setMode(mode: "preview" | "edit"): void {
  document.body.dataset.mode = mode;
  if (mode === "preview") {
    update(sourceEl.value);
  }
}

function focusSourceAt(offset: number): void {
  setMode("edit");
  requestAnimationFrame(() => {
    sourceEl.focus();
    const clamped = Math.max(0, Math.min(offset, sourceEl.value.length));
    sourceEl.setSelectionRange(clamped, clamped);
    if (cursorIndicatorEl) {
      cursorIndicatorEl.textContent = `cursor → src offset ${clamped}`;
    }
  });
}

renderedEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const hitNonEditable = document
    .elementsFromPoint(event.clientX, event.clientY)
    .some((el) => el instanceof HTMLElement && el.closest("[data-md-noneditable]"));
  if (
    target?.closest("[data-md-noneditable]") ||
    hitNonEditable ||
    pointHitsNonEditable(event.clientX, event.clientY)
  ) {
    event.preventDefault();
    return;
  }
  if (target?.closest("a")) return;
  const offset = sourceOffsetFromPoint(event.clientX, event.clientY);
  if (offset == null) return;
  event.preventDefault();
  focusSourceAt(offset);
});

sourceEl.addEventListener("mousedown", (event) => {
  if (!pointHitsNonEditable(event.clientX, event.clientY)) return;
  event.preventDefault();
});

sourceEl.addEventListener("click", (event) => {
  if (!pointHitsNonEditable(event.clientX, event.clientY)) return;
  event.preventDefault();
});

sourceEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setMode("preview");
  }
});

sourceEl.addEventListener("blur", () => {
  setMode("preview");
});

// Live updates while editing — the partial-update path keeps unchanged
// blocks' DOM nodes intact, so this stays cheap.
sourceEl.addEventListener("input", () => {
  update(sourceEl.value);
});

overlayToggle.addEventListener("change", () => {
  document.body.classList.toggle("overlay", overlayToggle.checked);
});

imagePreviewToggle.addEventListener("change", () => {
  imagePreviewOn = imagePreviewToggle.checked;
  document.body.classList.toggle("with-image-preview", imagePreviewOn);
  renderSourceView(sourceEl.value);
  editor.rerender();
  refreshInvariant(sourceEl.value);
});

document.body.classList.toggle("overlay", overlayToggle.checked);
update(SAMPLE);
setMode("preview");
