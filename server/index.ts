import http from "node:http";
import process from "node:process";
import { handleRoutes } from "./routes/index.ts";
import { ensureOverlaysDir } from "./services/overlays.ts";
import { startSpotifyPolling } from "./services/spotify.ts";
import { spotifyState } from "./state.ts";
import { PORT, sendJson } from "./utils.ts";

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

// Ensure default overlays are initialized
ensureOverlaysDir();

// Auto-start Spotify polling if refresh token and credentials already exist
if (spotifyState.refreshToken && spotifyState.clientId && spotifyState.clientSecret) {
  startSpotifyPolling();
}

export const server = http.createServer(async (req, res) => {
  try {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, *");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const handled = await handleRoutes(req, res, url);

    if (!handled) {
      sendJson(res, 404, { error: "Not Found" });
    }
  } catch (err: any) {
    console.error("[server] Request handling error:", err);
    sendJson(res, 500, { error: err?.message || "Internal server error" });
  }
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} in use; assuming existing server is active.`);
    process.exit(0);
  } else {
    console.error("[server] Server error:", err);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`TikTok Live Webhook Bridge running on http://127.0.0.1:${PORT}`);
});
