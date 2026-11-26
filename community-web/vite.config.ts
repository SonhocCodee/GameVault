import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve(__dirname),
  base: "/community/",
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
  build: {
    outDir: path.resolve(__dirname, "../worker/admin-assets/community"),
    emptyOutDir: true,
  },
});
