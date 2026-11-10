import {
  ControlEvent,
  RouteConfig,
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";
import { loadConfig, saveConfig } from "../config.ts";
import { broadcastChat, broadcastState, spotifyState, state } from "../state.ts";
import type { TikTokChatMessage, TikTokGiftPayload, TikTokTtsPayload } from "../types.ts";
import { requestSong } from "./spotify.ts";
import { sendWebhook } from "./webhook.ts";

// Safely intercept signature provider to prevent unhandled Euler Stream paywall errors
try {
  const origSignature = RouteConfig.fetchWebcastSignatureFromProvider;
  RouteConfig.fetchWebcastSignatureFromProvider = async (args: any) => {
    try {
      return await origSignature(args);
    } catch (err: any) {
      if (err?.message?.includes("Business plan") || err?.message?.includes("Euler")) {
        console.warn("[tiktok] Euler Stream sign server paywall bypassed");
        return { response: { signedUrl: args.url, userAgent: args.userAgent } } as any;
      }
      throw err;
    }
  };
} catch (e) {
  console.warn("[tiktok] RouteConfig signature patch skipped:", e);
}

let activeConnection: TikTokLiveConnection | null = null;

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
    const conn = new TikTokLiveConnection(state.username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
    });
    activeConnection = conn;

    conn.on(ControlEvent.CONNECTED, (connState: any) => {
      if (activeConnection !== conn) return;
      state.status = "connected";
      state.roomId = conn.roomId ? String(conn.roomId) : (connState?.roomId ? String(connState.roomId) : "live");
      state.error = null;
      broadcastState();
    });

    conn.on(ControlEvent.DISCONNECTED, () => {
      if (activeConnection !== conn) return;
      clearAllStreaks();
      state.status = "disconnected";
      state.roomId = null;
      broadcastState();
    });

    conn.on(ControlEvent.STREAM_END, () => {
      if (activeConnection !== conn) return;
      clearAllStreaks();
      state.status = "disconnected";
      state.error = "Live stream ended";
      state.roomId = null;
      broadcastState();
    });

    conn.on(ControlEvent.ERROR, (err: any) => {
      if (activeConnection !== conn) return;
      const msg = err?.message || String(err);
      if (msg.includes("offline") || err?.name === "UserOfflineError") {
        state.status = "disconnected";
        state.error = `@${state.username} is currently offline`;
      } else {
        state.status = "error";
        state.error = msg;
      }
      broadcastState();
    });

    conn.on(WebcastEvent.CHAT, (data: any) => {
      if (activeConnection !== conn) return;

      const uniqueId =
        data.user?.displayId ||
        data.user?.uniqueId ||
        data.displayId ||
        data.uniqueId ||
        data.user?.nickname ||
        data.nickname ||
        "viewer";

      const nickname =
        data.user?.nickname ||
        data.nickname ||
        uniqueId;

      const comment = String(
        data.content ||
        data.comment ||
        data.text ||
        ""
      ).trim();

      const profilePictureUrl =
        data.user?.avatarThumb?.urlList?.[0] ||
        data.user?.avatarLarge?.urlList?.[0] ||
        data.profilePictureUrl ||
        null;

      const chatPayload: TikTokChatMessage = {
        id: data.msgId ? String(data.msgId) : Math.random().toString(36).slice(2, 9),
        userId: data.user?.id ? String(data.user.id) : (data.userId || ""),
        uniqueId,
        nickname,
        comment,
        profilePictureUrl,
        timestamp: Date.now(),
      };

      if (!state.recentChats) state.recentChats = [];
      state.recentChats.unshift(chatPayload);
      if (state.recentChats.length > 50) state.recentChats.pop();

      // Emit SSE chat event for live TTS reader & chat box
      broadcastChat(chatPayload);
      broadcastState();

      // Check if TTS webhook is enabled
      const cfg = loadConfig();
      const sendTtsWebhook = Boolean(cfg.tts?.sendWebhook ?? cfg.sendTtsWebhook);
      const ignoreBotCommands = Boolean(cfg.tts?.ignoreBotCommands ?? true);
      const isCmd = comment.startsWith("!");

      if (sendTtsWebhook && (!ignoreBotCommands || !isCmd)) {
        const template = cfg.tts?.template || "{nickname} says {comment}";
        const speechText = template
          .replace("{nickname}", nickname)
          .replace("{username}", uniqueId)
          .replace("{comment}", comment);

        const ttsPayload: TikTokTtsPayload = {
          event: "tts",
          username: uniqueId,
          nickname,
          comment,
          text: speechText,
          voice: cfg.tts?.voice || "th-TH-NiwatNeural",
          timestamp: Date.now(),
        };

        sendWebhook(ttsPayload, "tts").catch((err) => {
          console.error("[tiktok-chat] TTS webhook dispatch error:", err);
        });
      }

      // Check for song request command: !sr <song> or !request <song>
      const lower = comment.toLowerCase();
      const srPrefixes = ["!sr ", "!songrequest ", "!request ", "!song "];
      const matchedPrefix = srPrefixes.find((p) => lower.startsWith(p));
      if (matchedPrefix && spotifyState.connected) {
        const query = comment.slice(matchedPrefix.length).trim();
        if (query) {
          requestSong(query, uniqueId, "tiktok_chat").catch((err) => {
            console.error("[tiktok-chat] Auto song request error:", err);
          });
        }
      }
    });

    conn.on(WebcastEvent.GIFT, (data: any) => {
      if (activeConnection !== conn) return;

      const uniqueId =
        data.user?.displayId ||
        data.user?.uniqueId ||
        data.displayId ||
        data.uniqueId ||
        data.user?.nickname ||
        data.nickname ||
        "gifter";

      const nickname =
        data.user?.nickname ||
        data.nickname ||
        uniqueId;

      const rawDescribe = typeof data.describe === "string" ? data.describe.trim() : "";
      const cleanDescribe = rawDescribe && !rawDescribe.includes("%s") && !rawDescribe.toLowerCase().includes("sent") ? rawDescribe : "";

      const giftName =
        data.giftDetails?.giftName ||
        data.giftName ||
        data.extendedGiftInfo?.name ||
        data.gift?.name ||
        cleanDescribe ||
        "Gift";

      const diamondCount = Number(
        data.giftDetails?.diamondCount ??
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
      const giftType = Number(
        data.giftDetails?.giftType ??
        data.giftType ??
        data.gift?.gift_type ??
        data.gift_type ??
        0
      );
      const isRepeatEnd = Boolean(
        data.repeatEnd ||
        data.repeat_end === 1 ||
        data.gift?.repeat_end === 1
      );

      const giftPictureUrl =
        data.giftPictureUrl ||
        data.giftDetails?.giftImage?.urlList?.[0] ||
        data.extendedGiftInfo?.image?.url_list?.[0] ||
        data.gift?.image?.urlList?.[0] ||
        null;

      const profilePictureUrl =
        data.user?.avatarThumb?.urlList?.[0] ||
        data.user?.avatarLarge?.urlList?.[0] ||
        data.profilePictureUrl ||
        null;

      const payload: TikTokGiftPayload = {
        event: "tiktok_gift",
        username: uniqueId,
        nickname,
        giftName,
        coins,
        diamondCount,
        repeatCount,
        giftId: data.giftId || data.gift?.gift_id,
        giftPictureUrl,
        profilePictureUrl,
        userId: data.user?.id ? String(data.user.id) : (data.userId || data.user?.userId),
        timestamp: Date.now(),
      };

      const streakKey = `${payload.userId || uniqueId}_${data.giftId || giftName}`;

      // A gift is part of an ongoing combo if:
      // 1) repeatEnd is explicitly false / 0, OR
      // 2) giftType is 1 and !isRepeatEnd, OR
      // 3) repeatCount is greater than 1 and !isRepeatEnd
      const isComboInProgress = !isRepeatEnd && (
        data.repeatEnd === false ||
        data.repeat_end === 0 ||
        data.gift?.repeat_end === 0 ||
        giftType === 1 ||
        repeatCount > 1
      );

      if (isComboInProgress) {
        // Combo still in progress: update accumulated count in activeStreaks and DO NOT send webhook
        const existing = activeStreaks.get(streakKey);
        if (existing) {
          clearTimeout(existing.timer);
        }

        // Fallback timer: if TikTok drops the repeatEnd event, send the accumulated streak after 3.5s
        const timer = setTimeout(() => {
          activeStreaks.delete(streakKey);
          console.log(`[tiktok] Combo ended via timeout for ${streakKey}: ${payload.repeatCount}x ${payload.giftName} (${payload.coins} coins)`);
          sendWebhook(payload, "gift").catch((err) => {
            console.error("[tiktok] Fallback streak webhook dispatch error:", err);
          });
        }, 3500);

        activeStreaks.set(streakKey, { timer, payload });
        return;
      }

      // Combo ended (or single non-combo gift): send exactly once
      const existing = activeStreaks.get(streakKey);
      if (existing) {
        clearTimeout(existing.timer);
        activeStreaks.delete(streakKey);
        if (existing.payload.repeatCount && existing.payload.repeatCount > (payload.repeatCount || 1)) {
          payload.repeatCount = existing.payload.repeatCount;
          payload.coins = payload.diamondCount! * payload.repeatCount;
        }
      }

      console.log(`[tiktok] Sending gift webhook (combo ended): ${payload.repeatCount}x ${payload.giftName} (${payload.coins} coins) for ${payload.username}`);
      sendWebhook(payload, "gift").catch((err) => {
        console.error("[tiktok] Webhook dispatch error:", err);
      });
    });

    await conn.connect();
  } catch (err: any) {
    clearAllStreaks();
    const msg = err?.message || "Failed to connect to TikTok LIVE";
    if (msg.includes("offline") || err?.name === "UserOfflineError") {
      state.status = "disconnected";
      state.error = `@${state.username} is currently offline`;
    } else {
      state.status = "error";
      state.error = msg;
    }
    activeConnection = null;
    broadcastState();
  }
}
