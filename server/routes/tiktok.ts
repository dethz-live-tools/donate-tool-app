import type http from "node:http";
import { loadConfig, saveConfig } from "../config.ts";
import { resetSpotifyWebhookTracker } from "../services/spotify.ts";
import { connectLive, disconnectLive } from "../services/tiktok.ts";
import { sendWebhook } from "../services/webhook.ts";
import { broadcastChat, broadcastState, state } from "../state.ts";
import type { TikTokChatMessage, TikTokTtsPayload, WebhookPayload } from "../types.ts";
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
      const wc = parsed.webhookUriChat !== undefined ? parsed.webhookUriChat : state.webhookUriChat;
      const ws = parsed.webhookUriSpotify !== undefined ? parsed.webhookUriSpotify : state.webhookUriSpotify;
      await connectLive(u, w, wc, ws);
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

      // Check if test requested is tts or gift
      if (parsed.type === "tts" || parsed.event === "tts") {
        const ttsPayload: TikTokTtsPayload = {
          event: "tts",
          username: String(parsed.username || "test_viewer"),
          nickname: String(parsed.nickname || "Test Viewer"),
          comment: String(parsed.comment || "สวัสดีครับ ทดสอบระบบ TTS"),
          text: String(parsed.text || "Test Viewer says สวัสดีครับ ทดสอบระบบ TTS"),
          voice: String(parsed.voice || "th-TH-NiwatNeural"),
          timestamp: Date.now(),
        };
        const result = await sendWebhook(ttsPayload, "tts");
        sendJson(res, 200, { success: result.success, entry: result });
        return true;
      }

      const payload: WebhookPayload = {
        event: "tiktok_gift",
        username: String(parsed.username || "gifter_name"),
        nickname: String(parsed.nickname || parsed.username || "Gifter Name"),
        giftName: String(parsed.giftName || "Rose"),
        coins: Number(parsed.coins) || 20,
        diamondCount: 1,
        repeatCount: Number(parsed.repeatCount) || 20,
        giftId: 5655,
        userId: "test_gifter_id",
        timestamp: Date.now(),
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

      // If sendWebhook or config sendTtsWebhook is active, dispatch webhook
      const cfg = loadConfig();
      const shouldSendWebhook = Boolean(parsed.sendWebhook ?? cfg.tts?.sendWebhook ?? cfg.sendTtsWebhook);
      if (shouldSendWebhook) {
        const ttsPayload: TikTokTtsPayload = {
          event: "tts",
          username: uniqueId,
          nickname,
          comment,
          text: `${nickname} says ${comment}`,
          voice: cfg.tts?.voice || "th-TH-NiwatNeural",
          timestamp: Date.now(),
        };
        sendWebhook(ttsPayload, "tts").catch((e) => console.error("[test-chat] Webhook send error:", e));
      }

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
