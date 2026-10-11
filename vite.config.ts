import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
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
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/outputs/**", "**/quest-game/**"]
    },
    proxy: {
      "/api": "http://localhost:8080"
    }
  }
});
