import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.resolve(__dirname, "../..");

export default defineConfig({
  envDir: rootDir,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ai": {
        target: "http://localhost:8001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ai/, "") || "/",
      },
    },
  },
});
