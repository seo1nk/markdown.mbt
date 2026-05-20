# Literal renderer — HTML & CSS reference

Companion to [`docs/literal-rendering.md`](./literal-rendering.md). This
document is a complete catalog of:

1. The HTML structure the renderer emits for every Block / Inline
   variant.
2. The CSS classes, ARIA roles and data attributes that decorate it.
3. The CSS variables exposed by
   [`@mizchi/markdown/editor/overlay.css`](../frontend/editor/overlay.css)
   for theming.
4. Recipes for common visual treatments.

## At a glance

| Marker family | Class | Notes |
|---|---|---|
| `<span class="md-marker">` | Every syntax marker (`#`, `**`, `>`, list bullets, fence ticks, brackets, …) | Always `aria-hidden="true"` |
| `<span class="md-text">` | _not emitted_ | Inline parser spans are relative, so text isn't wrapped |
| `<span class="md-image">` | Image wrapper | `role="img"` + `aria-label="<alt>"` |
| `<span class="md-html-inline">` | Raw inline HTML rendered as text | Source-faithful, not interpreted |
| `<a class="md-wikilink">` | Wikilink `[[target]]` | `href` is `target[#fragment]` |
| `<a class="md-reflink">` | Reference link `[text][label]` | `href="#ref-<label>"` |
| `<div class="md-fenced-code">` | Fenced **or** indented code block (canonicalised to fenced) | Wraps `<pre><code class="language-<lang>">` |
| `<div role="separator">` | Thematic break (`***`, `---`, `___`) | Marker text inside |
| `<div class="md-table">` | GFM table | `role="table"` + ARIA-roled row / cell descendants |
| `<div class="footnote">` | Footnote definition `[^label]: …` | `id="fn-<label>"` |
| `<sup class="footnote-ref">` | Footnote reference `[^label]` | Inner `<a aria-label="Footnote <label>" href="#fn-<label>">` |

| Attribute | Where it appears | Meaning |
|---|---|---|
| `aria-hidden="true"` | every `<span class="md-marker">`, separator-row | Skip when reading the document content |
| `data-src-start` / `data-src-end` | every **top-level block** when `positions=true` | Character offsets into the original source |
| `data-md-image-ref` | the `<img>` slot for reference images | Label to resolve into a `src` URL on the consumer side |

## HTML structure by node type

The examples below show the literal output for `positions=false`
(default) and elide whitespace between tags for readability. With
`positions=true`, every block-level element grows
`data-src-start="X" data-src-end="Y"` attributes.

### Headings

```markdown
## Intro
```

```html
<h2><span class="md-marker" aria-hidden="true">## </span>Intro</h2>
```

Setext headings keep their underline as a trailing marker on a second
visible line:

```markdown
Title
=====
```

```html
<h1>Title
<span class="md-marker" aria-hidden="true">===</span></h1>
```

### Paragraph

```markdown
Hello *world*.
```

```html
<p>Hello <em><span class="md-marker" aria-hidden="true">*</span>world<span class="md-marker" aria-hidden="true">*</span></em>.</p>
```

### Emphasis / strong / strikethrough / code span

| Source | Output |
|---|---|
| `*em*` | `<em><span class="md-marker" aria-hidden="true">*</span>em<span class="md-marker" aria-hidden="true">*</span></em>` |
| `**strong**` | `<strong><span class="md-marker" aria-hidden="true">**</span>strong<span class="md-marker" aria-hidden="true">**</span></strong>` |
| `~~struck~~` | `<del><span class="md-marker" aria-hidden="true">~~</span>struck<span class="md-marker" aria-hidden="true">~~</span></del>` |
| `` `code` `` | `<code><span class="md-marker" aria-hidden="true">\`</span>code<span class="md-marker" aria-hidden="true">\`</span></code>` |

### Hard break

```markdown
one\
two
```

```html
<p>one<span class="md-marker" aria-hidden="true">\</span>
two</p>
```

### Lists

Bullet, ordered and task lists all share the same shape — a `<li>` with
a leading marker span carrying the indent and bullet glyph.

```markdown
- one
- two
```

```html
<ul><li><span class="md-marker" aria-hidden="true">* </span>one
</li><li><span class="md-marker" aria-hidden="true">* </span>two
</li></ul>
```

```markdown
1. first
2. second
```

```html
<ol><li><span class="md-marker" aria-hidden="true">1. </span>first
</li><li><span class="md-marker" aria-hidden="true">2. </span>second
</li></ol>
```

Ordered lists with `start ≠ 1` add `<ol start="N">`. Lists that contain
at least one task item add `class="contains-task-list"` to the wrapper
and emit an extra marker for each checkbox:

```markdown
- [x] done
- [ ] pending
```

```html
<ul class="contains-task-list">
  <li><span class="md-marker" aria-hidden="true">* </span><span class="md-marker" aria-hidden="true">[x] </span>done
  </li>
  <li><span class="md-marker" aria-hidden="true">* </span><span class="md-marker" aria-hidden="true">[ ] </span>pending
  </li>
</ul>
```

### Blockquote

Each visible line is prefixed with a `<span class="md-marker">&gt; </span>`.

```markdown
> first
> second
```

```html
<blockquote>
  <span class="md-marker" aria-hidden="true">&gt; </span><p>first
  <span class="md-marker" aria-hidden="true">&gt; </span>second</p>
</blockquote>
```

### Code blocks

Both fenced and indented code blocks share the same output. The opening
fence carries the language tag; the inner `<pre><code class="language-…">`
gets the language for syntax-highlighter consumers.

````markdown
```rust
fn main() {}
```
````

```html
<div class="md-fenced-code">
  <span class="md-marker" aria-hidden="true">```rust</span>
  <pre><code class="language-rust">fn main() {}
  </code></pre>
  <span class="md-marker" aria-hidden="true">```</span>
</div>
```

### Thematic break

```markdown
***
```

```html
<div role="separator"><span class="md-marker" aria-hidden="true">***</span></div>
```

### Links / autolinks / wikilinks

```markdown
[text](https://example.com "title")
```

```html
<a href="https://example.com" title="title">
  <span class="md-marker" aria-hidden="true">[</span>
  text
  <span class="md-marker" aria-hidden="true">](https://example.com &quot;title&quot;)</span>
</a>
```

```markdown
<https://example.com>
```

```html
<a href="https://example.com">
  <span class="md-marker" aria-hidden="true">&lt;</span>
  https://example.com
  <span class="md-marker" aria-hidden="true">&gt;</span>
</a>
```

```markdown
[[target|label]]
```

```html
<a class="md-wikilink" href="target">
  <span class="md-marker" aria-hidden="true">[[</span>
  target
  <span class="md-marker" aria-hidden="true">|</span>
  label
  <span class="md-marker" aria-hidden="true">]]</span>
</a>
```

### Images

The `<span class="md-image">` carries `role="img"` and `aria-label="<alt>"`
so the alt text reaches assistive technology even when the visual
`<img>` slot is hidden (the default).

```markdown
![alt](pic.png "caption")
```

```html
<span class="md-image" role="img" aria-label="alt">
  <span class="md-marker" aria-hidden="true">![</span>
  alt
  <span class="md-marker" aria-hidden="true">](pic.png &quot;caption&quot;)</span>
</span>
```

With `imagePreview=true` an `<img>` slot is added (no visible text, so
the overlay invariant is preserved):

```html
<span class="md-image" role="img" aria-label="alt">
  <img class="md-image-preview" src="pic.png" alt="alt" title="caption" loading="lazy" />
  <span class="md-marker" aria-hidden="true">![</span>
  alt
  <span class="md-marker" aria-hidden="true">](pic.png &quot;caption&quot;)</span>
</span>
```

Reference images emit a slot without a resolved `src`, carrying
`data-md-image-ref="<label>"` so the consumer can fill in the URL:

```html
<img class="md-image-preview" data-md-image-ref="label" alt="alt" loading="lazy" />
```

### Tables (GFM)

Native `<table>` / `<tr>` / `<td>` elements would foster-parent the
`<span class="md-marker">` siblings out of the table, so the renderer
uses ARIA-roled `<div>` / `<span>` containers instead.

```markdown
| Lang | Year |
| :--- | ---: |
| Rust | 2010 |
```

```html
<div class="md-table" role="table">
  <div class="md-table-rowgroup" role="rowgroup">
    <div class="md-table-row" role="row">
      <span class="md-marker" aria-hidden="true">|</span>
      <span class="md-table-cell" role="columnheader" style="text-align: left">
        <span class="md-marker" aria-hidden="true"> </span>Lang<span class="md-marker" aria-hidden="true"> </span>
      </span>
      <span class="md-marker" aria-hidden="true">|</span>
      <span class="md-table-cell" role="columnheader" style="text-align: right">
        <span class="md-marker" aria-hidden="true"> </span>Year<span class="md-marker" aria-hidden="true"> </span>
      </span>
      <span class="md-marker" aria-hidden="true">|</span>
    </div>
  </div>
  <div class="md-table-separator" aria-hidden="true">
    <span class="md-marker" aria-hidden="true">|</span>
    <span class="md-marker" aria-hidden="true"> :-- |</span>
    <span class="md-marker" aria-hidden="true"> --: |</span>
  </div>
  <div class="md-table-rowgroup" role="rowgroup">
    <div class="md-table-row" role="row">
      <span class="md-marker" aria-hidden="true">|</span>
      <span class="md-table-cell" role="cell" style="text-align: left">…Rust…</span>
      <span class="md-marker" aria-hidden="true">|</span>
      <span class="md-table-cell" role="cell" style="text-align: right">…2010…</span>
      <span class="md-marker" aria-hidden="true">|</span>
    </div>
  </div>
</div>
```

### Footnotes

```markdown
text[^1].

[^1]: aside
```

```html
<p>text<sup class="footnote-ref"><a href="#fn-1" aria-label="Footnote 1">
  <span class="md-marker" aria-hidden="true">[^1]</span>
</a></sup>.</p>
<div class="footnote" id="fn-1">
  <span class="md-marker" aria-hidden="true">[^1]: </span>aside
</div>
```

### Raw HTML

Both block-level and inline raw HTML appear as **escaped text** in
literal mode — the literal renderer is intended for editing / overlay
contexts where rendering the raw HTML would conflict with the source.

```markdown
<div>raw</div>
```

```html
<span class="md-html-block">&lt;div&gt;raw&lt;/div&gt;</span>
```

## Selectors you can target

All selectors below are intended for consumer overrides — none of them
affect the overlay invariant when their declarations only touch
`color`, `font-weight`, `font-style`, `text-decoration`,
`background-color`, `opacity`, or other properties that do **not**
change horizontal advance.

| Selector | Purpose |
|---|---|
| `.md-literal` | Root wrapper. Sets monospace font, `white-space: pre-wrap`, palette via CSS variables. |
| `.md-literal .md-marker` | Every syntax marker. Default dim grey. |
| `.md-literal strong` / `em` / `del` / `code` / `a` | Semantic inline elements. |
| `.md-literal h1` … `h6` | Headings. Layout is reset to `display: inline`. |
| `.md-literal blockquote` | Blockquote wrapper (inline). |
| `.md-literal .md-fenced-code` | Fenced (or indented) code block wrapper. |
| `.md-literal .md-fenced-code pre code` | The inner code container, with `class="language-<lang>"` when an info string was supplied. |
| `.md-literal .md-image` | Image wrapper (whole `![alt](url)` span). |
| `.md-literal .md-image-preview` | The `<img>` slot. Hidden by default; see "Inline image preview" below. |
| `.md-literal .md-wikilink` | `[[wiki]]` link. |
| `.md-literal .md-reflink` | `[text][ref]` reference link. |
| `.md-literal .md-html-inline` / `.md-html-block` | Raw HTML rendered as text. |
| `.md-literal .md-table` | Table root. |
| `.md-literal .md-table-rowgroup` | Header rowgroup + body rowgroup. |
| `.md-literal .md-table-row` | A data row. |
| `.md-literal .md-table-separator` | GFM separator row (purely syntactic, `aria-hidden`). |
| `.md-literal .md-table-cell` | Header cell (`role="columnheader"`) or data cell (`role="cell"`). |
| `.md-literal .footnote` / `sup.footnote-ref` | Footnote definition and reference. |
| `.md-literal div[role="separator"]` | Thematic break. |

For source-position-aware features:

```css
.md-literal [data-src-start]:hover {
  background: rgba(88, 166, 255, 0.08);
}
```

The selector matches every annotated top-level block when `positions=true`.

## CSS variables

`overlay.css` is intentionally palette-agnostic; everything customisable
is exposed as a CSS variable so a consumer can theme without rewriting
selectors.

| Variable | Default | Used by |
|---|---|---|
| `--md-literal-text` | `#c9d1d9` | `.md-literal` foreground |
| `--md-literal-bg` | `transparent` | `.md-literal` background |
| `--md-literal-heading` | inherits `--md-literal-text` | `<h1>` – `<h6>` color |
| `--md-literal-link` | `#58a6ff` | `<a>` foreground |
| `--md-literal-code` | `#f0883e` | `<code>` foreground |
| `--md-literal-quote` | `inherit` | `<blockquote>` foreground |
| `--md-literal-marker` | `#8b949e` | `.md-marker` foreground |
| `--md-literal-marker-opacity` | `1` | `.md-marker` opacity |
| `--md-literal-image-max-height` | `1.5em` | `.md-image-preview` max height |
| `--md-literal-image-gap` | `0.25em` | horizontal padding around `.md-image-preview` |
| `--md-literal-image-border` | `rgba(110, 118, 129, 0.4)` | thin border around the image preview |
| `--md-overlay-source-opacity` | `0.45` | source view opacity when stacked under the rendered view |

## Recipes

### Light theme

```css
.md-literal {
  --md-literal-text: #1f2328;
  --md-literal-bg: #ffffff;
  --md-literal-heading: #0d1117;
  --md-literal-link: #0969da;
  --md-literal-code: #cf222e;
  --md-literal-marker: #6e7681;
}
```

### Hide markers entirely (preview-only, breaks the overlay invariant)

```css
.md-literal .md-marker { display: none; }
```

Use this when you want the literal renderer's *semantic* output but
not the visible markers — for example a read-only preview that still
keeps `data-src-*` for click-to-cursor. Note that this **breaks the
visible-text invariant** because the rendered text no longer matches
`toMarkdown(source)`; alignment with a syntax-highlighted source view
will be off by one marker run per inline element.

### Dim markers, full content (typical editor look)

```css
.md-literal {
  --md-literal-marker: #6e7681;
  --md-literal-marker-opacity: 0.7;
}
```

### Inline image preview opt-in

```html
<div class="md-literal with-image-preview" id="preview"></div>
```

The slot becomes visible alongside the source characters. To shrink it
to thumbnail height:

```css
.with-image-preview {
  --md-literal-image-max-height: 2em;
  --md-literal-image-gap: 0.5em;
}
```

### Click-to-edit highlight on hover

```css
.md-literal [data-src-start] {
  cursor: text;
  border-radius: 2px;
}
.md-literal [data-src-start]:hover {
  background: rgba(88, 166, 255, 0.08);
}
```

### Two-pane overlay (source under, rendered over)

```html
<div class="md-overlay">
  <pre class="md-literal md-overlay-source"><!-- raw source --></pre>
  <div class="md-literal md-overlay-rendered"><!-- toHtmlLiteral(source) --></div>
</div>
```

`overlay.css` already places `.md-overlay-source` underneath at 45 %
opacity and keeps `.md-overlay-rendered` on top with full pointer
interaction.

### Per-language code-block tinting

```css
.md-literal .md-fenced-code:has(.language-rust) {
  background: rgba(222, 165, 132, 0.06);
}
.md-literal .md-fenced-code:has(.language-typescript) {
  background: rgba(48, 116, 192, 0.06);
}
```

## What to avoid

Anything that changes the **horizontal advance** of a character will
break the overlay invariant and the click-to-cursor mapping. In
practice that means:

- ❌ adding `margin` / `padding` / `border` to any element under
  `.md-literal` (use background / shadow instead).
- ❌ swapping `font-family` away from monospace, or using ligatures
  that collapse characters.
- ❌ `display: block` on block elements (`overlay.css` deliberately
  forces them to `inline`).
- ❌ `text-transform: uppercase / lowercase` on content that contains
  characters with different widths in your font.

Theming should generally limit itself to `color`, `font-weight`,
`font-style`, `text-decoration`, `background`, `box-shadow`,
`opacity`, `cursor`, and `border-radius` (with no border width).
