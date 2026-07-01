import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    manifest: true,
    outDir: "dist",
    rollupOptions: {
      input: "src/entry-client.jsx",
    },
  },
});
