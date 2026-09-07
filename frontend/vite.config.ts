import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Backend origin for dev proxying. Inside docker-compose set
// VITE_PROXY_TARGET=http://app:8000; on the host the default is fine.
const target = process.env.VITE_PROXY_TARGET ?? "http://localhost:8000";
const wsTarget = target.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target },
      // Report artifacts (stored HTML / PDF) keep their non-/api paths.
      "/reports": { target },
      "/health": { target },
      // PTY WebSockets keep their original paths too.
      "/provider/claude/login/ws": { target: wsTarget, ws: true },
      "^/projects/\\d+/terminal/ws": { target: wsTarget, ws: true },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
          // Mermaid is the heaviest dependency in the app — larger than xterm.
          // It is imported dynamically (see components/shared/Mermaid.tsx) so it
          // only loads for a reader who opens a document containing a diagram;
          // naming it here keeps that payload in one cacheable chunk instead of
          // smeared across the route chunks.
          mermaid: ["mermaid"],
          vendor: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
        },
      },
    },
  },
});
