import type http from "node:http";
import { saveConfig } from "../config.ts";
import { broadcastState, getSpotifyPublicState, sseClients, state } from "../state.ts";
import { parseJsonBody, sendJson } from "../utils.ts";

export async function handleStatusRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  if (url.pathname === "/api/status" && req.method === "GET") {
    state.spotify = getSpotifyPublicState();
    sendJson(res, 200, {
      username: state.username,
      webhookUri: state.webhookUri,
      status: state.status,
      roomId: state.roomId,
      error: state.error,
      logs: state.logs,
      spotify: state.spotify,
    });
    return true;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(
      `data: ${JSON.stringify({
        username: state.username,
        webhookUri: state.webhookUri,
        status: state.status,
        roomId: state.roomId,
        error: state.error,
        logs: state.logs,
        spotify: state.spotify,
      })}\n\n`
    );
    sseClients.push(res);
    req.on("close", () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return true;
  }

  // Save and upgrade config.yaml directly
  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      if (parsed.username !== undefined) state.username = String(parsed.username || "").trim();
      if (parsed.webhookUri !== undefined) state.webhookUri = String(parsed.webhookUri || "").trim();
      saveConfig({
        username: state.username,
        webhookUri: state.webhookUri,
      });
      broadcastState();
      sendJson(res, 200, { success: true, message: "Configuration saved to config.yaml" });
    } catch (err: any) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return true;
  }

  return false;
}
