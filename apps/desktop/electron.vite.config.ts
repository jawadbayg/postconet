import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@postconet/core", "@postconet/persistence"] })],
    resolve: {
      alias: {
        bufferutil: resolve("src/main/stubs/empty.ts"),
        "utf-8-validate": resolve("src/main/stubs/empty.ts")
      }
    },
    build: {
      rollupOptions: {
        external: ["node:sqlite", "node:http2", "http2", "undici"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js"
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [react()],
    css: {
      postcss: resolve("postcss.config.js")
    }
  }
});
