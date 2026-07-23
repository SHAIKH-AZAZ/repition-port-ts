import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend runs on :4000. Proxy REST (/api → /), the Socket.io upgrade
// (/socket.io, ws), and the static crop/PDF routes.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/socket.io": { target: "http://localhost:4000", ws: true },
      "/crops": "http://localhost:4000",
      "/pdf": "http://localhost:4000",
    },
  },
});
