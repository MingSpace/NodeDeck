import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// `pnpm dev:verify` 把后端起在另一个端口,好和常驻的 `pnpm dev` 并存
const backend = `http://localhost:${process.env.NODEDECK_BACKEND_PORT ?? 8080}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/sub": backend,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
