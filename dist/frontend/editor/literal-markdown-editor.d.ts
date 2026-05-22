/**
 * DOM controller for the source-preserving ("literal") renderer.
 *
 * This is framework-agnostic: callers provide the DOM nodes and a renderer
 * function, and the controller wires preview/edit switching, source-view
 * highlighting, partial DOM patching, image-preview caret mapping, selection
 * overlays, and IME anchor correction.
 */
import { type PatchStats } from "./literal-editor.js";
export type LiteralMarkdownMode = "preview" | "edit";
export interface LiteralMarkdownRenderOptions {
    positions: true;
    imagePreview: boolean;
}
export type LiteralMarkdownRenderer = (source: string, options: LiteralMarkdownRenderOptions) => string;
export type LiteralMarkdownHighlightTag = number | string;
export interface LiteralMarkdownSyntreeHighlightToken {
    from: number;
    to: number;
    tag: LiteralMarkdownHighlightTag;
    color?: string;
    className?: string;
}
export interface LiteralMarkdownHighlightTheme {
    name?: string;
    background?: string;
    foreground?: string;
    colors?: Partial<Record<string, string>>;
    getColor?: (tag: LiteralMarkdownHighlightTag, token: LiteralMarkdownSyntreeHighlightToken) => string | null | undefined;
}
export interface LiteralMarkdownSyntreeHighlightResult {
    tokens: readonly LiteralMarkdownSyntreeHighlightToken[];
    theme?: LiteralMarkdownHighlightTheme;
}
export type LiteralMarkdownHighlightResult = string | {
    html: string;
} | LiteralMarkdownSyntreeHighlightResult | readonly LiteralMarkdownSyntreeHighlightToken[];
export type LiteralMarkdownCodeHighlighter = (source: string) => LiteralMarkdownHighlightResult;
export interface LiteralMarkdownSyntaxHighlightAdapter {
    normalizeLanguage?: (raw: string) => string | null;
    getLoadedHighlighter?: (language: string) => LiteralMarkdownCodeHighlighter | null;
    loadHighlighter?: (language: string) => Promise<LiteralMarkdownCodeHighlighter | null>;
}
export type LiteralMarkdownSyntaxHighlightOptions = boolean | LiteralMarkdownSyntaxHighlightAdapter;
export interface LiteralMarkdownEditorElements {
    host: HTMLDivElement;
    rendered: HTMLElement;
    source: HTMLTextAreaElement;
    sourceView: HTMLElement;
    sourceCaret: HTMLDivElement;
    sourceSelection: HTMLDivElement;
    modeRoot?: HTMLElement;
}
export interface LiteralMarkdownInvariantState {
    ok: boolean;
    visible: string;
    expected: string;
}
export interface LiteralMarkdownCursorState {
    kind: "cursor" | "selection";
    start: number;
    end: number;
}
export interface LiteralMarkdownEditorOptions {
    elements: LiteralMarkdownEditorElements;
    renderLiteral: LiteralMarkdownRenderer;
    initialSource?: string;
    mode?: LiteralMarkdownMode;
    imagePreview?: boolean;
    syntaxHighlight?: LiteralMarkdownSyntaxHighlightOptions;
    imagePreviewClass?: string;
    onPatchStats?: (stats: PatchStats) => void;
    onInvariant?: (state: LiteralMarkdownInvariantState) => void;
    onCursor?: (state: LiteralMarkdownCursorState) => void;
}
export interface LiteralMarkdownEditorHandle {
    readonly source: string;
    readonly mode: LiteralMarkdownMode;
    readonly imagePreview: boolean;
    setSource(source: string): PatchStats;
    setMode(mode: LiteralMarkdownMode): void;
    setImagePreview(enabled: boolean): void;
    syncLayout(keepCaretVisible?: boolean): void;
    refreshInvariant(): LiteralMarkdownInvariantState;
    destroy(): void;
}
export declare function createLiteralMarkdownEditor(options: LiteralMarkdownEditorOptions): LiteralMarkdownEditorHandle;
//# sourceMappingURL=literal-markdown-editor.d.ts.map