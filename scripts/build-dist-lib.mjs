// dist-lib/ (ライブラリ配布物) を生成する。
// asobi 等の外部プロジェクトが npm の git 依存(github:seo1nk/markdown.mbt)で
// 取り込めるよう、ビルド済み JS をリポジトリにコミットして配布する。
// 生成物:
//   dist-lib/api.js            Markdown API (md_to_html 等、_build をバンドル済み)
//   dist-lib/chord_language.js コード譜 DSL (render_widget_html / chord_css 等)
//   dist-lib/chord-widget.js   ウィジェットランタイム (installChordWidgets)
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist-lib", { recursive: true });

await build({
  entryPoints: ["js/api.js"],
  bundle: true,
  format: "esm",
  outfile: "dist-lib/api.js",
});

await build({
  entryPoints: ["playground/chord-widget.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist-lib/chord-widget.js",
});

copyFileSync(
  "_build/js/release/build/seo1nk/chord_language/chord_language.js",
  "dist-lib/chord_language.js",
);

console.log("dist-lib/ built");
