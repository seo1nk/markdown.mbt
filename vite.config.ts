import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@luna_ui/luna",
  },
  root: "playground",
  server: {
    fs: {
      // chord-language (sibling repo) の JS ビルドを playground から import するため
      allow: [".", resolve(__dirname, "../chord-language")],
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "playground/index.html"),
        literal: resolve(__dirname, "playground/literal/index.html"),
      },
    },
  },
});
