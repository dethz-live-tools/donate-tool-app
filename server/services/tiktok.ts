// @ts-expect-error type declarations missing in legacy bundle
import { WebcastPushConnection } from "tiktok-live-connector/legacy";
import { saveConfig } from "../config.ts";
import { broadcastChat, broadcastState, spotifyState, state } from "../state.ts";
import type { TikTokChatMessage, TikTokGiftPayload } from "../types.ts";
import { requestSong } from "./spotify.ts";
import { sendWebhook } from "./webhook.ts";

let activeConnection: any = null;

interface ActiveStreak {
  timer: NodeJS.Timeout;
  payload: TikTokGiftPayload;
}

const activeStreaks = new Map<string, ActiveStreak>();

export function clearAllStreaks() {
  for (const streak of activeStreaks.values()) {
    clearTimeout(streak.timer);
  }
  activeStreaks.clear();
}

export function getActiveConnection() {
  return activeConnection;
}

export function disconnectLive() {
  clearAllStreaks();
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
      clearAllStreaks();
      state.status = "disconnected";
      state.roomId = null;
      broadcastState();
    });

    conn.on("streamEnd", () => {
      if (activeConnection !== conn) return;
      clearAllStreaks();
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

    conn.on("chat", (data: any) => {
      if (activeConnection !== conn) return;

      const gifter = data.uniqueId || data.nickname || data.user?.uniqueId || data.user?.nickname || "viewer";
      const nickname = data.nickname || data.user?.nickname || gifter;
      const comment = String(data.comment || "").trim();

      const chatPayload: TikTokChatMessage = {
        id: data.msgId ? String(data.msgId) : Math.random().toString(36).slice(2, 9),
        userId: data.userId || data.user?.userId || "",
        uniqueId: gifter,
        nickname,
        comment,
        profilePictureUrl: data.profilePictureUrl || data.user?.profilePictureUrl || null,
        timestamp: Date.now(),
      };

      if (!state.recentChats) state.recentChats = [];
      state.recentChats.unshift(chatPayload);
      if (state.recentChats.length > 50) state.recentChats.pop();

      // Emit SSE chat event for live TTS reader & chat box
      broadcastChat(chatPayload);
      broadcastState();

      // Check for song request command: !sr <song> or !request <song>
      const lower = comment.toLowerCase();
      const srPrefixes = ["!sr ", "!songrequest ", "!request ", "!song "];
      const matchedPrefix = srPrefixes.find((p) => lower.startsWith(p));
      if (matchedPrefix && spotifyState.connected) {
        const query = comment.slice(matchedPrefix.length).trim();
        if (query) {
          requestSong(query, gifter, "tiktok_chat").catch((err) => {
            console.error("[tiktok-chat] Auto song request error:", err);
          });
        }
      }
    });

    conn.on("gift", (data: any) => {
      if (activeConnection !== conn) return;

      const gifter = data.uniqueId || data.nickname || data.user?.uniqueId || data.user?.nickname || "gifter_name";
      const nickname = data.nickname || data.user?.nickname || gifter;
      const rawDescribe = typeof data.describe === "string" ? data.describe.trim() : "";
      const cleanDescribe = rawDescribe && !rawDescribe.includes("%s") && !rawDescribe.toLowerCase().includes("sent") ? rawDescribe : "";
      const giftName =
        data.giftName ||
        data.extendedGiftInfo?.name ||
        data.gift?.name ||
        cleanDescribe ||
        "Gift";

      const diamondCount = Number(
        data.diamondCount ??
        data.diamond_count ??
        data.extendedGiftInfo?.diamond_count ??
        data.gift?.diamond_count ??
        1
      ) || 1;

      const repeatCount = Number(
        data.repeatCount ??
        data.repeat_count ??
        data.gift?.repeat_count ??
        1
      ) || 1;

      const coins = diamondCount * repeatCount;
      const giftType = Number(data.giftType ?? data.gift?.gift_type ?? data.gift_type ?? 0);
      const isRepeatEnd = Boolean(data.repeatEnd || data.repeat_end === 1 || data.gift?.repeat_end === 1);

      const payload: TikTokGiftPayload = {
        username: gifter,
        nickname,
        giftName,
        coins,
        diamondCount,
        repeatCount,
        giftId: data.giftId || data.gift?.gift_id,
        giftPictureUrl: data.giftPictureUrl || data.extendedGiftInfo?.image?.url_list?.[0] || data.gift?.image?.urlList?.[0],
        profilePictureUrl: data.profilePictureUrl || data.user?.profilePictureUrl,
        userId: data.userId || data.user?.userId,
        timestamp: Date.now(),
      };

      // Handle combo / streak gifts (giftType === 1)
      if (giftType === 1) {
        const streakKey = `${data.userId || data.uniqueId || gifter}_${data.giftId || giftName}`;

        if (isRepeatEnd) {
          // Streak completed
          const existing = activeStreaks.get(streakKey);
          if (existing) {
            clearTimeout(existing.timer);
            activeStreaks.delete(streakKey);
          }
          sendWebhook(payload, "gift").catch((err) => {
            console.error("[tiktok] Webhook dispatch error:", err);
          });
          return;
        }

        // Streak continuing: debounce with fallback timer
        const existing = activeStreaks.get(streakKey);
        if (existing) {
          clearTimeout(existing.timer);
        }

        const timer = setTimeout(() => {
          activeStreaks.delete(streakKey);
          sendWebhook(payload, "gift").catch((err) => {
            console.error("[tiktok] Fallback streak webhook dispatch error:", err);
          });
        }, 3500);

        activeStreaks.set(streakKey, { timer, payload });
        return;
      }

      // Non-streakable gift: dispatch immediately
      sendWebhook(payload, "gift").catch((err) => {
        console.error("[tiktok] Webhook dispatch error:", err);
      });
    });

    await conn.connect();
  } catch (err: any) {
    clearAllStreaks();
    state.status = "error";
    state.error = err?.message || "Failed to connect to TikTok LIVE";
    activeConnection = null;
    broadcastState();
  }
}
