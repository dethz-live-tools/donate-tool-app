import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { spawn } from "node:child_process";

const host = process.env.TAURI_DEV_HOST;

function bridgePlugin(): Plugin {
  let proc: any = null;
  return {
    name: "tiktok-bridge-autostart",
    configureServer(server) {
      // Auto-start backend bridge if port 3001 is not running
      fetch("http://127.0.0.1:3001/api/status")
        .then(() => {
          console.log("[bridge] Backend already running on port 3001.");
        })
        .catch(() => {
          console.log("[bridge] Auto-starting server.ts on port 3001...");
          const runner = process.execPath || "bun";
          proc = spawn(runner, ["server.ts"], {
            stdio: "inherit",
            env: process.env,
          });
          proc.on("error", (err: any) => {
            console.error("[bridge] Failed to spawn server.ts:", err.message);
          });
        });

      server.httpServer?.on("close", () => {
        if (proc) {
          try {
            proc.kill();
          } catch {}
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), bridgePlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            // Gracefully handle backend startup delay without proxy crash logs
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: "Bridge server starting...",
                  detail: err.message,
                })
              );
            }
          });
        },
      },
    },
  },
}));
