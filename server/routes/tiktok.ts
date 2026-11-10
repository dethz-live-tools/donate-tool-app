import type http from "node:http";
import { saveConfig } from "../config.ts";
import { resetSpotifyWebhookTracker } from "../services/spotify.ts";
import { connectLive, disconnectLive } from "../services/tiktok.ts";
import { sendWebhook } from "../services/webhook.ts";
import { broadcastChat, broadcastState, state } from "../state.ts";
import type { TikTokChatMessage, WebhookPayload } from "../types.ts";
import { parseJsonBody, sendJson } from "../utils.ts";

export async function handleTiktokRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  if (url.pathname === "/api/connect" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      const u = parsed.username !== undefined ? parsed.username : state.username;
      const w = parsed.webhookUri !== undefined ? parsed.webhookUri : state.webhookUri;
      await connectLive(u, w);
      sendJson(res, 200, { success: true, message: "Connection initiated" });
    } catch (err: any) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return true;
  }

  if (url.pathname === "/api/disconnect" && req.method === "POST") {
    disconnectLive();
    sendJson(res, 200, { success: true, message: "Disconnected" });
    return true;
  }

  if (url.pathname === "/api/test-webhook" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      if (parsed.webhookUri) {
        state.webhookUri = String(parsed.webhookUri || "").trim();
        saveConfig({ webhookUri: state.webhookUri });
        resetSpotifyWebhookTracker();
      }
      const payload: WebhookPayload = {
        username: String(parsed.username || "gifter_name"),
        giftName: String(parsed.giftName || "Rose"),
        coins: Number(parsed.coins) || 20,
      };

      const result = await sendWebhook(payload, "test");
      sendJson(res, 200, { success: result.success, entry: result });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message });
    }
    return true;
  }

  // Dispatch a test chat message to test TikTok Chat Reader & TTS
  if (url.pathname === "/api/tiktok/test-chat" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      const uniqueId = String(parsed?.uniqueId || "viewer_pro").trim();
      const nickname = String(parsed?.nickname || uniqueId).trim();
      const comment = String(parsed?.comment || "Hello streamer! This is a test chat message for TTS reader.").trim();

      const chatPayload: TikTokChatMessage = {
        id: Math.random().toString(36).slice(2, 9),
        userId: "test_user_id",
        uniqueId,
        nickname,
        comment,
        profilePictureUrl: null,
        timestamp: Date.now(),
      };

      if (!state.recentChats) state.recentChats = [];
      state.recentChats.unshift(chatPayload);
      if (state.recentChats.length > 50) state.recentChats.pop();

      broadcastChat(chatPayload);
      broadcastState();

      sendJson(res, 200, { success: true, chat: chatPayload });
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return true;
  }

  // Clear chat history
  if (url.pathname === "/api/tiktok/clear-chats" && req.method === "POST") {
    state.recentChats = [];
    broadcastState();
    sendJson(res, 200, { success: true, message: "Chats cleared" });
    return true;
  }

  return false;
}
