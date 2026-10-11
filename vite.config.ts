import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("three")) return "three";
          if (id.includes("@elevenlabs")) return "voice";
          if (id.includes("zod")) return "schema";
          if (id.includes("react")) return "react";
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/outputs/**", "**/quest-game/**"]
    },
    proxy: {
      "/api": "http://127.0.0.1:8080"
    }
  }
});
