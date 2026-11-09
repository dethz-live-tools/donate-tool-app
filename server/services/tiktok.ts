// @ts-expect-error type declarations missing in legacy bundle
import { WebcastPushConnection } from "tiktok-live-connector/legacy";
import { saveConfig } from "../config.ts";
import { broadcastState, state } from "../state.ts";
import type { WebhookPayload } from "../types.ts";
import { sendWebhook } from "./webhook.ts";

let activeConnection: any = null;

export function getActiveConnection() {
  return activeConnection;
}

export function disconnectLive() {
  if (activeConnection) {
    try {
      activeConnection.disconnect();
    } catch (e) {
      console.error("[tiktok] Error disconnecting:", e);
    }
    activeConnection = null;
  }
  state.status = "disconnected";
  state.roomId = null;
  broadcastState();
}

export async function connectLive(username?: string, webhookUri?: string) {
  disconnectLive();

  state.username = String(username !== undefined ? username : state.username || "").trim();
  state.webhookUri = String(webhookUri !== undefined ? webhookUri : state.webhookUri || "").trim();
  saveConfig({ username: state.username, webhookUri: state.webhookUri });

  if (!state.username) {
    state.status = "error";
    state.error = "TikTok username is required";
    broadcastState();
    return;
  }

  state.status = "connecting";
  state.error = null;
  broadcastState();

  try {
    const conn = new WebcastPushConnection(state.username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: true,
    });
    activeConnection = conn;

    conn.on("connected", (connState: any) => {
      if (activeConnection !== conn) return;
      state.status = "connected";
      state.roomId = connState?.roomId ? String(connState.roomId) : "live";
      state.error = null;
      broadcastState();
    });

    conn.on("disconnected", () => {
      if (activeConnection !== conn) return;
      state.status = "disconnected";
      state.roomId = null;
      broadcastState();
    });

    conn.on("streamEnd", () => {
      if (activeConnection !== conn) return;
      state.status = "disconnected";
      state.error = "Live stream ended";
      state.roomId = null;
      broadcastState();
    });

    conn.on("error", (err: any) => {
      if (activeConnection !== conn) return;
      state.status = "error";
      state.error = err?.message || String(err);
      broadcastState();
    });

    conn.on("gift", (data: any) => {
      if (activeConnection !== conn) return;

      const isStreakContinuing = data.giftType === 1 && !data.repeatEnd;
      if (isStreakContinuing) {
        return;
      }

      const gifter = data.uniqueId || data.nickname || "gifter_name";
      const gift = data.giftName || data.gift?.name || data.describe || "Rose";
      const diamondCount = Number(data.diamondCount) || 1;
      const repeatCount = Number(data.repeatCount) || 1;
      const coins = diamondCount * repeatCount;

      const payload: WebhookPayload = {
        username: gifter,
        giftName: gift,
        coins,
      };

      sendWebhook(payload, "gift").catch((err) => {
        console.error("[tiktok] Webhook dispatch error:", err);
      });
    });

    await conn.connect();
  } catch (err: any) {
    state.status = "error";
    state.error = err?.message || "Failed to connect to TikTok LIVE";
    activeConnection = null;
    broadcastState();
  }
}
