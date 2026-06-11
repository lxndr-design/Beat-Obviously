import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The Three.js visualizer is isolated in an async vendor chunk. Keep the
    // warning focused on first-load app chunks instead of that lazy WebGL
    // dependency.
    chunkSizeWarningLimit: 900,
    // Produce assets that JUCE can pack into BinaryData with predictable
    // names. Hashes are kept short to avoid SQLite blob bloat.
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash:8].js",
        chunkFileNames: "assets/[name]-[hash:8].js",
        assetFileNames: "assets/[name]-[hash:8][extname]",
        manualChunks(id) {
          if (id.includes("@react-three") || id.includes("/three/") || id.includes("\\three\\") || id.includes("react-reconciler")) {
            return "vendor-visualizer";
          }
          if (id.includes("node_modules")) {
            if (id.includes("dexie")) return "vendor-db";
            if (id.includes("@iconify")) return "vendor-icons";
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
  css: {
    modules: {
      // Stable, predictable class names (helps when inspecting the DOM in
      // a webview without sourcemaps).
      // `camelCase` keeps BOTH kebab and camelCase keys so dynamic access
      // like `styles[`size-${size}`]` works alongside `styles.sizeMd`.
      // Earlier `camelCaseOnly` silently dropped the kebab keys.
      localsConvention: "camelCase",
      generateScopedName: "[name]_[local]_[hash:base64:4]",
    },
  },
});
