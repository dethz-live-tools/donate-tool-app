import http from "node:http";
import process from "node:process";
import { handleRoutes } from "./routes/index.ts";
import { ensureOverlaysDir } from "./services/overlays.ts";
import { startScreenShareServer } from "./services/screenShare.ts";
import { startSpotifyPolling } from "./services/spotify.ts";
import { initialConfig, spotifyState } from "./state.ts";
import { getLanAddresses, HOST, isAllowedOrigin, parseRequestUrl, PORT, sendJson } from "./utils.ts";

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

// Auto-start WHIP screen share receiver if previously enabled in config.yaml
if (initialConfig.screenShare?.enabled) {
  startScreenShareServer(initialConfig.screenShare.port, false).catch((err) => {
    console.error("[screen-share] Failed to auto-start WHIP receiver:", err);
  });
}

export { isAllowedOrigin } from "./utils.ts";

export const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    const allowed = isAllowedOrigin(origin);

    if (allowed) {
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, *");
    }

    if (req.method === "OPTIONS") {
      if (!allowed) {
        res.writeHead(403);
        res.end("Cross-Origin Request Blocked");
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const url = parseRequestUrl(req);
    if (!url) {
      sendJson(res, 400, { error: "Bad Request" });
      return;
    }

    // Block cross-origin requests from untrusted external web pages targeting /api/* or /whip*
    const cleanPath = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    const isProtectedCrossOriginPath =
      url.pathname.startsWith("/api/") ||
      cleanPath === "/whip" ||
      cleanPath.startsWith("/whip/");
    if (!allowed && isProtectedCrossOriginPath) {
      sendJson(res, 403, { error: "Cross-Origin Request Blocked" });
      return;
    }

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

server.listen(PORT, HOST, () => {
  console.log(`TikTok Live Webhook Bridge running on http://${HOST}:${PORT}`);
  for (const ip of getLanAddresses()) {
    console.log(`  LAN: http://${ip}:${PORT}`);
  }
});
