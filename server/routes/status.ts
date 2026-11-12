import type http from "node:http";
import { getPublicConfig, loadConfig, saveConfig } from "../config.ts";
import { resetSpotifyWebhookTracker } from "../services/spotify.ts";
import { broadcastState, getSpotifyPublicState, sseClients, state } from "../state.ts";
import { parseJsonBody, sendJson } from "../utils.ts";

export async function handleStatusRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  if ((url.pathname === "/api/status" || url.pathname === "/api/status/") && req.method === "GET") {
    state.spotify = getSpotifyPublicState();
    sendJson(res, 200, {
      username: state.username,
      webhookUri: state.webhookUri,
      status: state.status,
      roomId: state.roomId,
      error: state.error,
      logs: state.logs,
      spotify: state.spotify,
      recentChats: state.recentChats || [],
      songRequests: state.songRequests || [],
      config: getPublicConfig(state.config),
    });
    return true;
  }

  // SSE stream endpoint (serves /api/status/stream for overlays and /api/events for UI)
  if (
    (url.pathname === "/api/events" ||
      url.pathname === "/api/events/" ||
      url.pathname === "/api/status/stream" ||
      url.pathname === "/api/status/stream/") &&
    req.method === "GET"
  ) {
    state.spotify = getSpotifyPublicState();
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.write(": keep-alive\n\n");
    res.write(
      `data: ${JSON.stringify({
        username: state.username,
        webhookUri: state.webhookUri,
        status: state.status,
        roomId: state.roomId,
        error: state.error,
        logs: state.logs,
        spotify: state.spotify,
        recentChats: state.recentChats || [],
        songRequests: state.songRequests || [],
        config: getPublicConfig(state.config),
      })}\n\n`
    );
    sseClients.push(res);
    req.on("close", () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return true;
  }

  // Get current config.yaml contents
  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = loadConfig();
    sendJson(res, 200, getPublicConfig(config));
    return true;
  }

  // Save and upgrade config.yaml directly
  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      if (parsed.username !== undefined) state.username = String(parsed.username || "").trim();
      if (parsed.webhookUri !== undefined) {
        state.webhookUri = String(parsed.webhookUri || "").trim();
        resetSpotifyWebhookTracker();
      }

      saveConfig(parsed);
      state.config = loadConfig();
      broadcastState();
      sendJson(res, 200, { success: true, message: "Configuration saved to config.yaml", config: getPublicConfig(state.config) });
    } catch (err: any) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return true;
  }

  return false;
}
