# `@mizchi/markdown/editor`

Luna-based markdown editor with on-demand syntax highlighting. Published as a
subpath of [`@mizchi/markdown`](../../README.md) — install the package once and
import the editor via its dedicated entry point.

## Installation

```bash
pnpm add @mizchi/markdown @luna_ui/luna
```

`@luna_ui/luna` is an **optional peer dependency** of `@mizchi/markdown`. The
core parser does not require it; only the `/editor` entry does, so consumers
that don't render the editor can omit it.

## Usage

```tsx
import { SyntaxHighlightEditor } from "@mizchi/markdown/editor";
import "@mizchi/markdown/editor/style.css";

<SyntaxHighlightEditor
  value={() => markdown}
  onChange={(next) => setMarkdown(next)}
/>;
```

The stylesheet ships as a separate subpath export (`@mizchi/markdown/editor/style.css`)
so build tools don't pull it into the JS module graph automatically — import it
explicitly once, anywhere in your app.

## Code-block highlighting

Highlighters for individual languages live behind dynamic imports under
`@mizchi/markdown/highlight`. They are loaded only when the editor first
encounters that language inside a fenced code block; nothing is bundled into
the initial editor module.

Currently available: `typescript`, `moonbit`, `json`, `html`, `css`, `bash`,
`rust`.

You can preload or invoke a highlighter explicitly:

```ts
import { loadHighlighter } from "@mizchi/markdown/highlight";

const highlightMoonBit = await loadHighlighter("moonbit");
const html = highlightMoonBit?.("fn main { println(\"hi\") }");
```

### How lazy loading works in your build

The published artifact uses native ES dynamic `import()`:

```js
// dist/frontend/highlight/index.js (excerpt)
const highlighterLoaders = {
  typescript: () => import("./languages/typescript.js"),
  moonbit:    () => import("./languages/moonbit.js"),
  json:       () => import("./languages/json.js"),
  // ...
};
```

Any modern bundler — Vite, Rollup, webpack, esbuild, Parcel — recognises
these calls and emits one chunk per language. As a reference point, an
unmodified Vite build of a small app that uses the editor produces roughly:

| Chunk | Size | gzip |
|---|---|---|
| main bundle (parser + editor + shared utils) | ~210 KB | ~53 KB |
| `typescript-*.js` | ~23 KB | ~6 KB |
| `moonbit-*.js`    | ~20 KB | ~5 KB |
| `rust-*.js`       | ~18 KB | ~5 KB |
| `bash-*.js`       | ~17 KB | ~5 KB |
| `json-*.js`       | ~16 KB | ~5 KB |
| `css-*.js`        | ~15 KB | ~5 KB |
| `html-*.js`       | ~12 KB | ~4 KB |

Only the main bundle is fetched on page load. A language chunk is fetched
the first time a fenced code block of that language renders. The fetch is
deduped (concurrent calls share a single promise) and the resulting
highlighter is cached in memory for the rest of the session.

While a language is still loading, the editor renders the code block as
HTML-escaped plain text. As soon as the chunk arrives, the cache is
invalidated and the affected blocks re-render with highlighting.

### Preloading languages

If you already know which languages a page will use, you can warm the cache
ahead of time so the first code block paints with colour:

```ts
import { preloadHighlighter } from "@mizchi/markdown/highlight";

await Promise.all([
  preloadHighlighter("typescript"),
  preloadHighlighter("moonbit"),
]);
```

`preloadHighlighter` resolves to `true` when the highlighter is ready and
returns `false` for unknown languages.

### One-shot highlighting outside the editor

The same API works without the editor — useful for SSR, static rendering,
or just highlighting a single snippet:

```ts
import { highlight } from "@mizchi/markdown/highlight";

const html = await highlight(source, "typescript");
```

`highlight` falls back to HTML-escaped plain text when the language is
unknown, so it is safe to call with arbitrary user input.

### Bypassing the lazy loader

If you want a specific language eagerly bundled into your main chunk
(for example because you control the document and never see other
languages), import it directly:

```ts
import highlightTs from "@mizchi/markdown/highlight/typescript";

const html = highlightTs("const x = 1;");
```

Each `@mizchi/markdown/highlight/<lang>` entry is a thin synchronous
wrapper around the MoonBit-built highlighter for that language. Mixing
this with the lazy API is fine; whichever entry runs first populates the
shared cache.

### Bundler notes

- **Vite / Rollup** — works out of the box; each `import()` becomes a
  separate chunk in the build output.
- **webpack 5+** — same; the chunks land under `output.chunkFilename`.
  Set `output.publicPath` correctly so the editor can fetch them at
  runtime.
- **esbuild** — emits chunks when `--splitting --format=esm` is set, which
  is the default for ESM library builds.
- **No bundler (browser ESM)** — the editor still works; the browser
  fetches each `./languages/<lang>.js` on demand the first time it is
  needed.

## JSX runtime

The editor is authored against Luna's JSX runtime
(`jsxImportSource: "@luna_ui/luna"`). The published artifact is plain ES
modules with JSX already compiled, so consumers don't need any special
TypeScript config to use it. If you re-export the editor's types and rely on
TS type-checking, ensure `@luna_ui/luna` is resolvable in your
`tsconfig.json`.

## Exports

| Subpath | Contents |
|---|---|
| `@mizchi/markdown/editor` | `SyntaxHighlightEditor`, `SyntaxHighlightEditorHandle`, `SyntaxHighlightEditorProps`, plus the `highlight` re-exports below |
| `@mizchi/markdown/editor/style.css` | Editor stylesheet |
| `@mizchi/markdown/highlight` | `loadHighlighter`, `highlight`, `highlightIfLoaded`, `preloadHighlighter`, `getLoadedHighlighter`, `normalizeHighlightLanguage` |
| `@mizchi/markdown/highlight/<lang>` | Direct (non-lazy) import of a single highlighter |
