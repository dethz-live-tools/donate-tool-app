import type http from "node:http";
import { saveConfig } from "../config.ts";
import { connectLive, disconnectLive } from "../services/tiktok.ts";
import { sendWebhook } from "../services/webhook.ts";
import { state } from "../state.ts";
import type { WebhookPayload } from "../types.ts";
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

  return false;
}
