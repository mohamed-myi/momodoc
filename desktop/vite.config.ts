import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron";
import electronRenderer from "vite-plugin-electron-renderer";
import path from "path";

const sharedDependencyAliases = {
  "@": path.resolve(__dirname, "src/renderer"),
  react: path.resolve(__dirname, "node_modules/react"),
  "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
  "lucide-react": path.resolve(__dirname, "node_modules/lucide-react"),
  "react-markdown": path.resolve(__dirname, "node_modules/react-markdown"),
  "rehype-highlight": path.resolve(__dirname, "node_modules/rehype-highlight"),
  "remark-gfm": path.resolve(__dirname, "node_modules/remark-gfm"),
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: "src/main/preload.ts",
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: sharedDependencyAliases,
  },
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
      },
    },
  },
});
