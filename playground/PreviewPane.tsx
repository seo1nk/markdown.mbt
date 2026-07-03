import { For, createMemo } from "@luna_ui/luna";
import type { Root } from "mdast";
import {
  MarkdownRenderer,
  RawHtml,
  sanitizeSvg,
  type RendererCallbacks,
  type RendererOptions,
} from "./ast-renderer";
import { MoonlightEditor } from "./MoonlightEditor";
// @ts-ignore -- MoonBit ビルド出力 (型定義なし)
import { render_widget_html as chordToHtml } from "../../chord-language/_build/js/release/build/chord_language.js";

interface PreviewRenderState {
  ast: Root;
  dark: boolean;
}

export interface PreviewPaneProps {
  ast: () => Root | null;
  isDark: () => boolean;
  callbacks: RendererCallbacks;
  onSvgChange: (svg: string, span: string) => void;
  containerRef?: (el: HTMLDivElement) => void;
}

export function PreviewPane(props: PreviewPaneProps) {
  const renderStates = createMemo<PreviewRenderState[]>(() => {
    const currentAst = props.ast();
    if (!currentAst) {
      return [];
    }
    return [{ ast: currentAst, dark: props.isDark() }];
  });

  return (
    <div
      class="preview"
      ref={(el) => {
        props.containerRef?.(el as HTMLDivElement);
      }}
    >
      <For each={renderStates}>
        {(state) => {
          const previewOptions: RendererOptions = {
            codeBlockHandlers: {
              svg: {
                render: (code, span, key, mode) => {
                  if (mode === "code") {
                    return null;
                  }
                  return <RawHtml key={key} data-span={span} html={sanitizeSvg(code)} />;
                },
              },
              // ::: フェンス（コード譜ブロック）。render_widget_html はタブ・
              // キープルダウン込みのウィジェット HTML を返す。パース失敗時は
              // 行番号つきエラーHTMLにフォールバックするため、不正な DSL 入力で
              // プレビュー全体は壊れない
              "chord-block": {
                render: (code, span, key) => (
                  <RawHtml key={key} data-span={span} html={chordToHtml(code)} />
                ),
              },
              "moonlight-svg": {
                render: (code, span, key) => (
                  <MoonlightEditor
                    key={key}
                    initialSvg={code}
                    span={span}
                    onSvgChange={props.onSvgChange}
                    width={400}
                    height={300}
                    theme={state.dark ? "dark" : "light"}
                  />
                ),
              },
            },
          };

          return (
            <MarkdownRenderer
              ast={state.ast}
              callbacks={props.callbacks}
              options={previewOptions}
            />
          );
        }}
      </For>
    </div>
  );
}
