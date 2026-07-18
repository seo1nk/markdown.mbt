import { render, createSignal, createEffect, createMemo, onMount, onCleanup, Show, batch } from "@luna_ui/luna";
import { parse } from "../js/api.js";
import type { Root } from "mdast";
import type { RendererCallbacks } from "./ast-renderer";
import { SyntaxHighlightEditor, type SyntaxHighlightEditorHandle } from "../frontend/editor/SyntaxHighlightEditor";
import { PreviewPane } from "./PreviewPane";
// @ts-ignore -- MoonBit ビルド出力 (型定義なし)
import { chord_cheatsheet_html } from "../_build/js/release/build/seo1nk/chord_language/chord_language.js";
import { installChordWidgets } from "./chord-widget";
import { RawHtml } from "./ast-renderer";

// コード譜ウィジェットのランタイム + 表示 CSS を組み込み、
// チートシートモーダル(ヘッダの ? ボタンから開く)のスタイルだけを
// playground 側の責務としてここで注入する
{
  installChordWidgets();
  const modalStyle = document.createElement("style");
  modalStyle.textContent = `
.chord-help-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; }
.chord-help-modal { background: var(--bg-primary, #fff); color: var(--text-primary, inherit); border: 1px solid var(--border-color, #8886); border-radius: 10px; padding: 1.2em 1.4em; max-width: 660px; width: 100%; max-height: calc(100vh - 96px); overflow-y: auto; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); }
.chord-help-section-title { font-weight: 700; font-size: 0.92em; margin: 0 0 0.7em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-color, #8886); }
.chord-help-modal .chord-help-section-title:not(:first-child) { margin-top: 1.5em; }
.chord-help-hint { font-size: 0.75em; opacity: 0.65; margin: 0 0 0.8em; }
.chord-help-modal .chord-cheatsheet code, .chord-help-modal .chord-cheat-example { cursor: pointer; border-radius: 4px; }
.chord-help-modal .chord-cheatsheet code:hover, .chord-help-modal .chord-cheat-example:hover { background: rgba(125, 125, 125, 0.16); }
.quick-symbol-bar { display: flex; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border-color, #8886); overflow-x: auto; flex: none; -webkit-overflow-scrolling: touch; }
.quick-chip { flex: none; min-width: 2.4em; padding: 5px 9px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; line-height: 1; border: 1px solid var(--border-color, #8886); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.quick-chip:active { background: rgba(125, 125, 125, 0.25); }
`;
  document.head.appendChild(modalStyle);
}

// モバイル記号クイックバー。DSL の主役記号(| % _ など)はスマホキーボードの
// 記号レイヤー切替が毎回必要なので、ワンタップでカーソル位置に挿入できるようにする。
// cursorBack は挿入後にカーソルを戻す文字数([key: ] の中へ置く等)
const QUICK_CHIPS: { label: string; insert: string; cursorBack?: number }[] = [
  { label: "|", insert: "| " },
  { label: "%", insert: "% " },
  { label: "_", insert: "_ " },
  { label: "-", insert: "-" },
  { label: "b", insert: "b" },
  { label: "s", insert: "s" },
  { label: ">", insert: "> " },
  { label: "@", insert: "@" },
  { label: "[key:]", insert: "[key: ]", cursorBack: 1 },
  { label: ":::", insert: ":::\n" },
];

// Markdown 自体の基本記法のチートシート。Markdown を知らない人向けの
// 最小限の一覧(表示スタイルはコード譜チートシート .chord-cheatsheet を流用)
const MARKDOWN_CHEATSHEET_HTML = `<div class="chord-cheatsheet">
<code># 見出し</code><span>見出し（# の数 1〜6 で段階が下がる。# の後に半角スペース）</span>
<code>（空行）</code><span>段落の区切り（空行を挟まないと前の行と繋がったまま）</span>
<code>**太字** *斜体*</code><span>太字・斜体</span>
<code>- 項目</code><span>箇条書き（行頭に - と半角スペース）</span>
<code>1. 項目</code><span>番号つきリスト</span>
<code>- [ ] やること</code><span>チェックリスト（[x] で完了）</span>
<code>[表示する文字](URL)</code><span>リンク</span>
<code>![説明](画像のURL)</code><span>画像</span>
<code>&gt; 引用文</code><span>引用（行頭に &gt;）</span>
<code>\`コード\`</code><span>インラインコード</span>
<code>:2m7:</code><span>インラインコード譜（コード 1 つを文中に。ディグリー表示）</span>
<code>\`\`\`</code><span>コードブロック（\`\`\` だけの行で上下を挟む）</span>
<code>---</code><span>区切りの横線（単独行。前後に空行）</span>
</div>`;

// IndexedDB for content (reliable async storage)
const IDB_NAME = "markdown-editor";
const IDB_STORE = "documents";
const IDB_KEY = "current";

// localStorage for UI state (sync access for initial render)
const UI_STATE_KEY = "markdown-editor-ui";
const DEBOUNCE_DELAY = 300;

const initialMarkdown = `# "Chord Block" がある Markdown エディタ

音楽についてのブログを書いていて、コード進行について触れたくなったとき、何かしら別のツールで作成したコード譜を画像として貼り付けるのは面倒です。
これは、それを解決するために Markdown 内にコード譜を直接書けるようにすることを目指した [mizchi/markdown.mbt](https://github.com/mizchi/markdown.mbt) のフォークプロジェクトです。

通常の Markdown と同様に *斜体*・**太字**・\`インラインコード\`・[リンク](https://github.com/seo1nk/markdown.mbt)・リストや引用・通常のコードブロックはそのまま書けます。

そこに \`:::\` だけのフェンスを置くと、中身が **コード譜ブロック**（ディグリー記法）としてレンダリングされます:

:::
---
key: G
bpm: 108
---
[Aメロ]
| 1M7 % | 4M7 5 |
> ひかりの _ さきへ ゆこう
| 6m7 3m7 | 2-5 1 |
> きみと あるく この-みち へ
:::

試してみてください:

- [ ] タブを **コード** に切り替える（ローマ数字 ⇄ 実音）
- [ ] キーのプルダウンで **移調** する（異名同音も正しく綴られます）
- [ ] **▶ 再生** を押す（フロントマターの bpm・拍子に従ってコードとベースが鳴ります）
- [ ] **画像コピー** で表示中の譜面を PNG としてコピーする
- [ ] 画面右上の **?** ボタンで記法チートシートを開く

## 記法のあらまし

コード譜を記述するための独自の DSL を定義しています。この DSL では、実音ではなく「ディグリー（度数）」でコードを表記します。

\`1\`〜\`7\` が度数、シャープは \`#\`（\`s\` でも可）、フラットは \`b\`。クオリティ（\`m\` \`dim\` \`aug\`）・セブンス（\`7\` \`M7\`/\`maj7\` \`6\` \`add9\` など）・テンション（括弧内）・スラッシュベース・強調色 \`@red @blue @green\` をつなげて書きます:

:::
1maj7 6m7(9) 2m7 5(b9,#11) | #4dim 47/6 b7@blue 1
:::

\`|\` は小節線。1 スロットを分け合って 2 コード鳴らすための  \`-\` グループ、直前のコードを繰り返す \`%\`、無音の \`NC\`、コードを伸ばす空拍 \`_\` もあります:

:::
---
key: Eb
time: 6/8
---
[サビ]
| 4M7 5 | 3m7 6m7 | 2m7-5 1 _ | NC 1 |
:::

フロントマター（\`key\` / \`bpm\` / \`time\`）を使うと表示・再生に用いるキーやテンポ、拍子を指定できます。
省略可能で、省略時は Key C・120 BPM・4/4 拍子になります。
オプショナルな機能として、コードの下部で \`>\` から始まるブロックを書くことで、直上のコード譜に対応した歌詞を表示することもできます。

:::
---
key: Eb
---
[サビ]
| NC |
> ぼく
| 1(9) b3@red 2m 37 |
> の記憶 が_すべ て消えて も
| 6m7 3m/5 6m6 4m/5@green |
| 1/3 4 5 37/b6@red |
> _ _ _ 満
| 6m7 3m/5 4m % |
> 月のよ る_君 をみつけ た
:::
`;

// IndexedDB helpers
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function saveToIDB(content: string): Promise<number> {
  const db = await openDB();
  const timestamp = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const request = store.put({ content, timestamp }, IDB_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(timestamp);
    tx.oncomplete = () => db.close();
  });
}

async function loadFromIDB(): Promise<{ content: string; timestamp: number } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const request = store.get(IDB_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

// Mobile detection
function isMobile(): boolean {
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// 埋め込みモード (?embed=1): 親ページが同一オリジンの iframe として開き、
// postMessage で本文をやり取りする。本文の永続化は親の責務なので、
// IndexedDB への保存とタブ間同期は行わない。
// プロトコル:
//   child -> parent: { type: "md-chord-editor:ready" }            初期化要求
//   parent -> child: { type: "md-chord-editor:init", content }    初期本文
//   child -> parent: { type: "md-chord-editor:change", content }  本文変更(即時)
const EMBED = new URLSearchParams(window.location.search).has("embed");

// 親ページに初期本文を要求する。親側のリスナー登録とタイミングが前後しても
// よいように、init が届くまで ready を再送する。親が応答しない場合は空文書で開く
function requestParentContent(): Promise<string> {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(retry);
      window.removeEventListener("message", onMessage);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve("");
    }, 5000);
    const sendReady = () => {
      window.parent.postMessage({ type: "md-chord-editor:ready" }, window.location.origin);
    };
    const retry = window.setInterval(sendReady, 200);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if (e.data?.type !== "md-chord-editor:init") return;
      cleanup();
      resolve(typeof e.data.content === "string" ? e.data.content : "");
    };
    window.addEventListener("message", onMessage);
    sendReady();
  });
}

// 本文の変更を親ページへ即時通知する(デバウンスしない。親のフォーム送信が
// 最新の本文を取りこぼさないようにするため)
function notifyParentChange(content: string): void {
  if (!EMBED) return;
  window.parent.postMessage({ type: "md-chord-editor:change", content }, window.location.origin);
}

// UI State helpers (localStorage for sync access)
interface UIState {
  viewMode: "split" | "editor" | "preview";
  editorMode: "highlight" | "simple";
  cursorPosition: number;
}

function loadUIState(): UIState {
  const mobile = isMobile();
  try {
    const saved = localStorage.getItem(UI_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // On mobile, force editor-only mode if split was saved
      const viewMode = mobile && parsed.viewMode === "split" ? "editor" : (parsed.viewMode || (mobile ? "editor" : "split"));
      // On mobile, default to simple editor
      const editorMode = parsed.editorMode || (mobile ? "simple" : "highlight");
      return {
        viewMode,
        editorMode,
        cursorPosition: parsed.cursorPosition || 0,
      };
    }
  } catch {
    // ignore parse errors
  }
  // Default: mobile uses editor-only + simple, desktop uses split + highlight
  return {
    viewMode: mobile ? "editor" : "split",
    editorMode: mobile ? "simple" : "highlight",
    cursorPosition: 0,
  };
}

function saveUIState(state: Partial<UIState>): void {
  try {
    const current = loadUIState();
    const updated = { ...current, ...state };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}

// Find block element at cursor position
function findBlockAtPosition(ast: Root, position: number): number | null {
  for (let i = 0; i < ast.children.length; i++) {
    const block = ast.children[i]!;
    const start = block.position?.start?.offset ?? 0;
    const end = block.position?.end?.offset ?? 0;
    if (position >= start && position <= end) {
      return i;
    }
  }
  // If position is beyond all blocks, return the last block
  const lastBlock = ast.children[ast.children.length - 1];
  const lastEnd = lastBlock?.position?.end?.offset ?? 0;
  if (ast.children.length > 0 && lastBlock && position >= lastEnd) {
    return ast.children.length - 1;
  }
  return null;
}

type ViewMode = "split" | "editor" | "preview";
type EditorMode = "highlight" | "simple";

// Simple editor component (created once, updated via effect)
function SimpleEditor(props: {
  value: () => string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
  ref?: (el: HTMLTextAreaElement) => void;
}) {
  let textareaRef: HTMLTextAreaElement | null = null;

  const setupTextarea = (el: HTMLTextAreaElement) => {
    textareaRef = el;
    el.value = props.value();
    props.ref?.(el);
  };

  createEffect(() => {
    const value = props.value();
    if (textareaRef && textareaRef.value !== value) {
      textareaRef.value = value;
    }
  });

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    props.onChange(target.value);
    props.onCursorChange?.(target.selectionStart);
  };

  const handleCursorUpdate = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    props.onCursorChange?.(target.selectionStart);
  };

  return (
    <textarea
      ref={(el) => setupTextarea(el as HTMLTextAreaElement)}
      class="simple-editor"
      onInput={handleInput}
      onKeyUp={handleCursorUpdate}
      onClick={handleCursorUpdate}
      spellcheck={false}
    />
  );
}

// SVG Icons
function Icon(props: { svg: string }) {
  return <span dangerouslySetInnerHTML={{ __html: props.svg }} style={{ display: "flex", alignItems: "center" }} />;
}

const SPLIT_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
  <rect x="1" y="2" width="8" height="16" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <rect x="11" y="2" width="8" height="16" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`;

const EDITOR_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
  <rect x="2" y="2" width="16" height="16" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <line x1="5" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.5"/>
  <line x1="5" y1="10" x2="12" y2="10" stroke="currentColor" stroke-width="1.5"/>
  <line x1="5" y1="14" x2="14" y2="14" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

const PREVIEW_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
  <rect x="2" y="2" width="16" height="16" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <path d="M4 10 Q7 5, 10 5 Q13 5, 16 10 Q13 15, 10 15 Q7 15, 4 10" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`;

const HIGHLIGHT_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none">
  <text x="2" y="14" font-size="12" fill="#d73a49" font-family="monospace" font-weight="bold">&lt;</text>
  <text x="8" y="14" font-size="12" fill="#22863a" font-family="monospace">/</text>
  <text x="12" y="14" font-size="12" fill="#0366d6" font-family="monospace" font-weight="bold">&gt;</text>
</svg>`;

const SIMPLE_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
  <rect x="2" y="2" width="16" height="16" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <line x1="5" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1" opacity="0.5"/>
  <line x1="5" y1="9" x2="13" y2="9" stroke="currentColor" stroke-width="1" opacity="0.5"/>
  <line x1="5" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="1" opacity="0.5"/>
  <line x1="5" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1" opacity="0.5"/>
</svg>`;

const HELP_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
  <path d="M12 17h.01"/>
</svg>`;

const GITHUB_ICON = `<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
</svg>`;



function App() {
  // Load UI state synchronously for initial render
  const initialUIState = loadUIState();
  const mobile = isMobile();

  const [source, setSource] = createSignal("");
  const [ast, setAst] = createSignal<Root | null>(null);
  const [cursorPosition, setCursorPosition] = createSignal(initialUIState.cursorPosition);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [isDark, setIsDark] = createSignal((() => {
    // 埋め込みは基本ライトモード(トグルでの切り替えは可能だが、その場限り)
    if (EMBED) return false;
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  })());
  const [saveStatus, setSaveStatus] = createSignal<"saved" | "saving" | "idle">("idle");
  const [showChordHelp, setShowChordHelp] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<ViewMode>(initialUIState.viewMode);
  const [editorMode, setEditorMode] = createSignal<EditorMode>(initialUIState.editorMode);

  // Memoized class names for reactivity
  const containerClass = createMemo(() => `container view-${viewMode()} editor-mode-${editorMode()}`);
  const splitBtnClass = createMemo(() => `view-mode-btn ${viewMode() === "split" ? "active" : ""}`);
  const editorBtnClass = createMemo(() => `view-mode-btn ${viewMode() === "editor" ? "active" : ""}`);
  const previewBtnClass = createMemo(() => `view-mode-btn ${viewMode() === "preview" ? "active" : ""}`);
  const highlightBtnClass = createMemo(() => `view-mode-btn ${editorMode() === "highlight" ? "active" : ""}`);
  const simpleBtnClass = createMemo(() => `view-mode-btn ${editorMode() === "simple" ? "active" : ""}`);
  const saveStatusClass = createMemo(() => `save-status ${saveStatus()}`);

  // Refs
  let editorRef: SyntaxHighlightEditorHandle | null = null;
  let simpleEditorRef: HTMLTextAreaElement | null = null;
  let previewRef: HTMLDivElement | null = null;

  // Track if content has been modified since load
  let hasModified = false;
  let lastSyncedTimestamp = 0;
  let isSaving = false;

  // Debounced source for saving
  const [debouncedSource, setDebouncedSource] = createSignal("");
  let debounceTimer: number | undefined;

  createEffect(() => {
    const value = source();
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      setDebouncedSource(value);
    }, DEBOUNCE_DELAY);
  });

  // AST parsing moved to handleChange with batch() for efficiency

  const toggleDark = () => {
    setIsDark((v) => !v);
  };

  // Apply dark mode
  createEffect(() => {
    const dark = isDark();
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    // 埋め込みでは保存しない(単体プレイグラウンドのテーマ設定を上書きしないため)
    if (!EMBED) {
      localStorage.setItem("theme", dark ? "dark" : "light");
    }
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    saveUIState({ viewMode: mode });
  };

  const handleEditorModeChange = (mode: EditorMode) => {
    const currentMode = editorMode();
    if (currentMode === mode) return;

    // Get cursor position and scroll from current editor
    let cursorPos = 0;
    let scrollTop = 0;

    if (currentMode === "highlight" && editorRef) {
      cursorPos = editorRef.getCursorPosition();
      scrollTop = editorRef.getScrollTop();
    } else if (currentMode === "simple" && simpleEditorRef) {
      cursorPos = simpleEditorRef.selectionStart;
      scrollTop = simpleEditorRef.scrollTop;
    }

    setEditorMode(mode);
    saveUIState({ editorMode: mode });

    // Apply cursor position and scroll to new editor after mode switch
    requestAnimationFrame(() => {
      if (mode === "highlight" && editorRef) {
        editorRef.setCursorPosition(cursorPos);
        editorRef.setScrollTop(scrollTop);
      } else if (mode === "simple" && simpleEditorRef) {
        simpleEditorRef.setSelectionRange(cursorPos, cursorPos);
        simpleEditorRef.scrollTop = scrollTop;
        simpleEditorRef.focus();
      }
      // Update cursor position signal for preview sync
      setCursorPosition(cursorPos);
    });
  };

  // Keyboard shortcuts for view mode
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "1") {
          e.preventDefault();
          handleViewModeChange("split");
        } else if (e.key === "2") {
          e.preventDefault();
          handleViewModeChange("editor");
        } else if (e.key === "3") {
          e.preventDefault();
          handleViewModeChange("preview");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => { window.removeEventListener("keydown", handleKeyDown); });
  });

  // Load initial content from IndexedDB
  onMount(() => {
    (async () => {
      let content = initialMarkdown;
      let timestamp = 0;

      if (EMBED) {
        // 埋め込み時は親ページの本文が正。空文書(新規投稿)もそのまま使う
        content = await requestParentContent();
      } else {
        try {
          const idbData = await loadFromIDB();
          if (idbData && idbData.content) {
            content = idbData.content;
            timestamp = idbData.timestamp;
          }
        } catch {
          // ignore IndexedDB load errors and fall back to initial content
        }
      }

      const parsedAst = parse(content);
      batch(() => {
        setSource(content);
        setAst(parsedAst);
        setIsInitialized(true);
      });
      lastSyncedTimestamp = timestamp;

      requestAnimationFrame(() => {
        editorRef?.focus();
      });
    })();
  });

  // Handle visibility change for tab sync
  onMount(() => {
    if (EMBED) return;
    async function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (isSaving || hasModified) return;

      try {
        const idbData = await loadFromIDB();
        if (!idbData) return;

        if (idbData.timestamp > lastSyncedTimestamp) {
          setSource(idbData.content);
          // AST will be parsed by debounce effect
          lastSyncedTimestamp = idbData.timestamp;
        }
      } catch (e) {
        console.error("Failed to sync from IndexedDB:", e);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    onCleanup(() => { document.removeEventListener("visibilitychange", handleVisibilityChange); });
  });

  // Save content to IndexedDB with debounce
  createEffect(() => {
    const debounced = debouncedSource();
    if (!isInitialized()) return;
    if (!hasModified) return;
    if (EMBED) return; // 埋め込み時の永続化は親の責務(notifyParentChange で通知済み)

    isSaving = true;
    setSaveStatus("saving");
    saveToIDB(debounced)
      .then((timestamp) => {
        lastSyncedTimestamp = timestamp;
        hasModified = false;
        isSaving = false;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1000);
      })
      .catch((e) => {
        console.error("Failed to save to IndexedDB:", e);
        isSaving = false;
        setSaveStatus("idle");
      });
  });

  // Track last rendered AST version for scroll synchronization
  let lastRenderedAst: Root | null = null;

  // Handle task checkbox toggle from preview
  const handleTaskToggle = (span: string, checked: boolean) => {
    const [startStr = "0", endStr = "0"] = span.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    const currentSource = source();
    const itemText = currentSource.slice(start, end);

    // Toggle [ ] <-> [x]
    const newText = checked
      ? itemText.replace(/\[ \]/, "[x]")
      : itemText.replace(/\[x\]/i, "[ ]");

    const newSource = currentSource.slice(0, start) + newText + currentSource.slice(end);

    // Update source and AST synchronously (bypass debounce for immediate feedback)
    hasModified = true;
    setSource(newSource);
    notifyParentChange(newSource);
    setAst(parse(newSource));

    // Sync editor text with targeted update using span
    if (editorMode() === "highlight" && editorRef) {
      editorRef.setValue(newSource, { start, end });
    } else if (simpleEditorRef) {
      simpleEditorRef.value = newSource;
    }

    // Move cursor to the toggled checkbox position and focus editor
    requestAnimationFrame(() => {
      // Find the checkbox position (the '[' in '- [x]')
      const checkboxPos = newSource.indexOf("[", start);
      if (checkboxPos !== -1) {
        setCursorPosition(checkboxPos);
        if (editorMode() === "highlight" && editorRef) {
          editorRef.setCursorPosition(checkboxPos);
          editorRef.focus();
        } else if (simpleEditorRef) {
          simpleEditorRef.setSelectionRange(checkboxPos, checkboxPos);
          simpleEditorRef.focus();
        }
      }
    });
  };

  // Handle SVG change from Moonlight editor
  // Note: We only update the source text, NOT the AST, to avoid re-rendering
  // the preview and losing focus on the MoonlightEditor
  const handleSvgChange = (newSvg: string, span: string) => {
    const [startStr = "0", endStr = "0"] = span.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    const currentSource = source();

    // Find the code block content boundaries (skip ```moonlight-svg\n and \n```)
    // The span includes the entire code block, we need to find the actual content
    const blockText = currentSource.slice(start, end);
    const contentStart = blockText.indexOf("\n") + 1;
    const contentEnd = blockText.lastIndexOf("\n```");

    if (contentStart > 0 && contentEnd > contentStart) {
      const prefix = currentSource.slice(0, start + contentStart);
      const suffix = currentSource.slice(start + contentEnd);
      const newSource = prefix + newSvg + suffix;

      // Update source only (skip AST re-parse to prevent re-render and focus loss)
      hasModified = true;
      setSource(newSource);
      notifyParentChange(newSource);
      // Don't call setAst() here - AST will be updated on next text editor change

      // Sync editor text
      if (editorMode() === "highlight" && editorRef) {
        editorRef.setValue(newSource);
      } else if (simpleEditorRef) {
        simpleEditorRef.value = newSource;
      }
    }
  };

  // Callbacks for interactive preview
  const rendererCallbacks: RendererCallbacks = {
    onTaskToggle: handleTaskToggle,
  };

  // Track last rendered AST for scroll syncing
  createEffect(() => {
    const currentAst = ast();
    if (currentAst) {
      lastRenderedAst = currentAst;
    }
  });

  // Sync preview scroll with cursor position (debounced to avoid excessive scrolling)
  let scrollTimer: number | undefined;
  createEffect(() => {
    const pos = cursorPosition();
    const currentAst = ast();
    if (!previewRef || !currentAst) return;

    // Debounce scroll updates to avoid jittery scrolling during fast typing
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      // Use requestAnimationFrame to ensure DOM is ready after render
      requestAnimationFrame(() => {
        if (!previewRef || !lastRenderedAst) return;

        const blockIndex = findBlockAtPosition(lastRenderedAst, pos);
        if (blockIndex === null) return;

        const block = lastRenderedAst.children[blockIndex]!;
        const start = block.position?.start?.offset ?? 0;
        const end = block.position?.end?.offset ?? 0;
        const selector = `[data-span="${start}-${end}"]`;
        const element = previewRef.querySelector(selector);

        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }, 150); // Small delay to let render complete first
  });


  // Debounced AST parsing - separate from source updates for better input responsiveness
  let astParseTimer: number | undefined;
  const AST_PARSE_DELAY = 100; // ms - delay AST parsing to not block input

  const handleChange = (newSource: string) => {
    hasModified = true;
    // Update source immediately for responsive input
    setSource(newSource);
    notifyParentChange(newSource);

    // Debounce AST parsing - preview doesn't need to update on every keystroke
    clearTimeout(astParseTimer);
    astParseTimer = window.setTimeout(() => {
      setAst(parse(newSource));
    }, AST_PARSE_DELAY);
  };

  // カーソル位置へのテキスト挿入(記号クイックバー・チートシートのタップ挿入)。
  // simple エディタは execCommand で挿入して undo 履歴とキーボードのフォーカスを保つ
  // (input イベント経由で handleChange が走る)。highlight エディタは
  // setValue + setCursorPosition(チェックボックストグルと同じ経路)
  const insertSnippet = (insert: string, cursorBack: number = 0) => {
    if (editorMode() === "simple" && simpleEditorRef) {
      const el = simpleEditorRef;
      el.focus();
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, insert);
      } catch {
        inserted = false;
      }
      if (!inserted) {
        // execCommand 非対応環境のフォールバック(undo 履歴は諦める)
        const start = el.selectionStart;
        el.value = el.value.slice(0, start) + insert + el.value.slice(el.selectionEnd);
        el.setSelectionRange(start + insert.length, start + insert.length);
        handleChange(el.value);
      }
      if (cursorBack > 0) {
        const pos = el.selectionStart - cursorBack;
        el.setSelectionRange(pos, pos);
      }
      setCursorPosition(el.selectionStart);
    } else if (editorRef) {
      const pos = editorRef.getCursorPosition();
      const newSource = source().slice(0, pos) + insert + source().slice(pos);
      handleChange(newSource);
      editorRef.setValue(newSource);
      const newPos = pos + insert.length - cursorBack;
      editorRef.setCursorPosition(newPos);
      setCursorPosition(newPos);
      editorRef.focus();
    }
  };

  // チートシートの項目タップでカーソル位置に挿入してモーダルを閉じる
  // (code = 1 記法、chord-cheat-example = コピペ実例の複数行)。
  // 「（空行）」のような説明だけの項目は挿入しない
  const handleCheatSheetClick = (e: Event) => {
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const item = target?.closest?.("code, .chord-cheat-example") as HTMLElement | null;
    if (!item) return;
    const text = item.textContent ?? "";
    if (text === "" || text.startsWith("（")) return;
    insertSnippet(item.classList.contains("chord-cheat-example") ? text + "\n" : text);
    setShowChordHelp(false);
  };

  // Debounce cursor position saving
  let cursorSaveTimer: number | undefined;
  const handleCursorChange = (position: number) => {
    setCursorPosition(position);
    // Debounce localStorage write - don't need to save every keystroke
    clearTimeout(cursorSaveTimer);
    cursorSaveTimer = window.setTimeout(() => {
      saveUIState({ cursorPosition: position });
    }, 500);
  };

  return (
    <Show when={isInitialized}>
      {() => (
        <div class="app-container">
          <header class="toolbar">
            <div class="toolbar-left">
              <div class="view-mode-buttons">
                {!mobile && (
                  <button
                    class={splitBtnClass}
                    onClick={() => handleViewModeChange("split")}
                    title="Split view (Ctrl+1)"
                  >
                    <Icon svg={SPLIT_ICON} />
                  </button>
                )}
                <button
                  class={editorBtnClass}
                  onClick={() => handleViewModeChange("editor")}
                  title="Editor only (Ctrl+2)"
                >
                  <Icon svg={EDITOR_ICON} />
                </button>
                <button
                  class={previewBtnClass}
                  onClick={() => handleViewModeChange("preview")}
                  title="Preview only (Ctrl+3)"
                >
                  <Icon svg={PREVIEW_ICON} />
                </button>
              </div>
              <div class="editor-mode-buttons">
                <button
                  class={highlightBtnClass}
                  onClick={() => handleEditorModeChange("highlight")}
                  title="Syntax highlight editor"
                >
                  <Icon svg={HIGHLIGHT_ICON} />
                </button>
                <button
                  class={simpleBtnClass}
                  onClick={() => handleEditorModeChange("simple")}
                  title="Simple text editor"
                >
                  <Icon svg={SIMPLE_ICON} />
                </button>
              </div>
              {/* 埋め込み時の保存はフォーム側の責務なので Saved 表示は出さない */}
              {!EMBED && (
                <span class={saveStatusClass}>
                  {saveStatus() === "saving" && "Saving..."}
                  {saveStatus() === "saved" && "Saved"}
                </span>
              )}
            </div>
            <div class="toolbar-actions">
              <a
                href="https://github.com/mizchi/markdown.mbt"
                target="_blank"
                rel="noopener noreferrer"
                class="credit-link"
                title="Original project by mizchi (MIT License)"
              >
                Based on mizchi/markdown.mbt (MIT)
              </a>
              <button
                onClick={() => setShowChordHelp(!showChordHelp())}
                class="chord-help-button"
                title="コード譜の記法チートシート"
              >
                <Icon svg={HELP_ICON} />
              </button>
              <button onClick={toggleDark} class="theme-toggle" title="Toggle dark mode">
                {isDark() ? "☀️" : "🌙"}
              </button>
              <a
                href="https://github.com/seo1nk/markdown.mbt"
                target="_blank"
                rel="noopener noreferrer"
                class="github-link"
                title="View on GitHub (fork)"
              >
                <Icon svg={GITHUB_ICON} />
              </a>
            </div>
          </header>
          <Show when={showChordHelp}>
            {() => (
              <div class="chord-help-overlay" onClick={() => setShowChordHelp(false)}>
                <div class="chord-help-modal" onClick={handleCheatSheetClick}>
                  <p class="chord-help-hint">記法や実例をタップすると、カーソル位置に挿入されます</p>
                  <div class="chord-help-section-title">Markdown の基本</div>
                  <RawHtml html={MARKDOWN_CHEATSHEET_HTML} />
                  <div class="chord-help-section-title">コード譜ブロック（::: フェンス）</div>
                  <RawHtml html={chord_cheatsheet_html()} />
                </div>
              </div>
            )}
          </Show>
          <div class={containerClass}>
            {/* Editor panel - visibility controlled by CSS class */}
            <div class="editor">
              {/* モバイルのみ: DSL 頻出記号のワンタップ挿入バー。pointerdown を
                  preventDefault してテキストエリアのフォーカス(=キーボード)を保つ */}
              {mobile && (
                <div class="quick-symbol-bar" role="toolbar" aria-label="記号入力">
                  {QUICK_CHIPS.map((c) => (
                    <button
                      type="button"
                      class="quick-chip"
                      onPointerDown={(e: Event) => e.preventDefault()}
                      onClick={() => insertSnippet(c.insert, c.cursorBack ?? 0)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Syntax highlight editor - always mounted, visibility controlled by CSS */}
              <div class="editor-highlight-wrapper">
                <SyntaxHighlightEditor
                  ref={(el) => { editorRef = el; }}
                  value={() => source()}
                  onChange={handleChange}
                  onCursorChange={handleCursorChange}
                  initialCursorPosition={initialUIState.cursorPosition}
                />
              </div>
              {/* Simple editor - always mounted, visibility controlled by CSS */}
              <div class="editor-simple-wrapper">
                <SimpleEditor
                  value={() => source()}
                  onChange={handleChange}
                  onCursorChange={handleCursorChange}
                  ref={(el) => { simpleEditorRef = el; }}
                />
              </div>
            </div>
            {/* Preview panel */}
            <PreviewPane
              ast={ast}
              isDark={isDark}
              callbacks={rendererCallbacks}
              onSvgChange={handleSvgChange}
              containerRef={(el) => {
                previewRef = el;
              }}
            />
          </div>
        </div>
      )}
    </Show>
  );
}

render(document.getElementById("app")!, <App />);
