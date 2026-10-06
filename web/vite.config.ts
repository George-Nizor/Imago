import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const target = `http://127.0.0.1:${process.env.PORT || 49321}`;

export default defineConfig({
  root: webRoot,
  base: "/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": target, "/projects": target, "/fonts": target },
  },
});
