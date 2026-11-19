import {
  ControlEvent,
  RouteConfig,
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";
import { loadConfig, saveConfig } from "../config.ts";
import { broadcastChat, broadcastState, spotifyState, state } from "../state.ts";
import type { ChatRole, TikTokChatMessage, TikTokGiftPayload, TikTokTtsPayload } from "../types.ts";
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

function chatRole(data: any): ChatRole {
  const ui = data.userIdentity;
  if (ui?.isAnchor) return "owner";
  if (ui?.isModeratorOfAnchor) return "moderator";
  if (ui?.isSubscriberOfAnchor) return "subscriber";
  if (ui?.isFollowerOfAnchor === true || data.user?.isFollower) return "follower";
  return "guest";
}

function roleAllowed(allowed: ChatRole[] | undefined, role: ChatRole): boolean {
  return !allowed || allowed.length === 0 || allowed.includes(role);
}

// shortcut: fixed 30s interval (matches tiktok-live-connector rate-limit floor); expose in config.yaml if tuning is requested
export const LIVE_CHECK_INTERVAL_MS = 30_000;

let activeConnection: TikTokLiveConnection | null = null;
let liveCheckTimer: NodeJS.Timeout | null = null;
let monitoring = false;
let sessionId = 0;

interface ActiveStreak {
  timer: NodeJS.Timeout;
  payload: TikTokGiftPayload;
}

const activeStreaks = new Map<string, ActiveStreak>();

function extractErrorMessage(err: any): string {
  return err?.exception?.message || err?.message || err?.info || String(err);
}

function isOfflineError(err: any): boolean {
  const inner = err?.exception || err;
  const msg = extractErrorMessage(err).toLowerCase();
  return inner?.name === "UserOfflineError" || msg.includes("offline") || msg.includes("isn't online");
}

function isFatalConfigError(err: any): boolean {
  const inner = err?.exception || err;
  return inner?.name === "InvalidUniqueIdError";
}

function retryDelayMs(err: any): number {
  const inner = err?.exception || err;
  const retryAfter = Number(inner?.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > LIVE_CHECK_INTERVAL_MS) {
    return retryAfter;
  }
  return LIVE_CHECK_INTERVAL_MS;
}

function clearLiveCheckTimer() {
  if (liveCheckTimer) {
    clearTimeout(liveCheckTimer);
    liveCheckTimer = null;
  }
}

function scheduleLiveCheck(mySession: number, delayMs: number = LIVE_CHECK_INTERVAL_MS) {
  clearLiveCheckTimer();
  if (mySession !== sessionId || !monitoring) return;
  liveCheckTimer = setTimeout(() => {
    liveCheckTimer = null;
    void checkAndConnect(mySession);
  }, delayMs);
}

function stopLiveSession() {
  sessionId++;
  monitoring = false;
  clearLiveCheckTimer();
  clearAllStreaks();
  if (activeConnection) {
    const conn = activeConnection;
    activeConnection = null;
    try {
      Promise.resolve(conn.disconnect()).catch((e) => {
        console.error("[tiktok] Error disconnecting:", e);
      });
    } catch (e) {
      console.error("[tiktok] Error disconnecting:", e);
    }
  }
}

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
  stopLiveSession();
  state.status = "disconnected";
  state.roomId = null;
  state.error = null;
  broadcastState();
}

function attachConnectionListeners(conn: TikTokLiveConnection, mySession: number) {
  conn.on(ControlEvent.CONNECTED, (connState: any) => {
    if (mySession !== sessionId || activeConnection !== conn) return;
    clearLiveCheckTimer();
    state.status = "connected";
    state.roomId = conn.roomId ? String(conn.roomId) : (connState?.roomId ? String(connState.roomId) : "live");
    state.error = null;
    broadcastState();
  });

  conn.on(ControlEvent.DISCONNECTED, () => {
    if (mySession !== sessionId || activeConnection !== conn) return;
    clearAllStreaks();
    activeConnection = null;
    state.roomId = null;
    if (monitoring) {
      const secs = Math.max(1, Math.round(LIVE_CHECK_INTERVAL_MS / 1000));
      state.status = "connecting";
      state.error = `@${state.username} disconnected (retrying in ${secs}s)`;
      broadcastState();
      scheduleLiveCheck(mySession);
    } else {
      state.status = "disconnected";
      broadcastState();
    }
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    if (mySession !== sessionId || activeConnection !== conn) return;
    clearAllStreaks();
    activeConnection = null;
    state.roomId = null;
    if (monitoring) {
      const secs = Math.max(1, Math.round(LIVE_CHECK_INTERVAL_MS / 1000));
      state.status = "connecting";
      state.error = `Live stream ended (checking every ${secs}s)`;
      broadcastState();
      scheduleLiveCheck(mySession);
    } else {
      state.status = "disconnected";
      state.error = "Live stream ended";
      broadcastState();
    }
  });

  conn.on(ControlEvent.ERROR, (err: any) => {
    if (mySession !== sessionId || activeConnection !== conn) return;
    const msg = extractErrorMessage(err);
    console.warn("[tiktok] Connection error:", msg);
    if (!conn.isConnected && !monitoring) {
      if (isOfflineError(err)) {
        state.status = "disconnected";
        state.error = `@${state.username} is currently offline`;
      } else {
        state.status = "error";
        state.error = msg;
      }
      broadcastState();
    }
  });

  conn.on(WebcastEvent.CHAT, (data: any) => {
    if (mySession !== sessionId || activeConnection !== conn) return;

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

    const role = chatRole(data);

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
      role,
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

    if (
      sendTtsWebhook &&
      roleAllowed(cfg.tts?.allowedRoles, role) &&
      (!ignoreBotCommands || !isCmd)
    ) {
      const template = cfg.tts?.template || "{nickname} says {comment}";
      const speechText = template.replace(/\{(nickname|username|comment)\}/g, (_, k) =>
        k === "nickname" ? nickname : k === "username" ? uniqueId : comment
      );

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
    if (
      matchedPrefix &&
      roleAllowed(cfg.commands?.allowedRoles, role) &&
      spotifyState.connected
    ) {
      const query = comment.slice(matchedPrefix.length).trim();
      if (query) {
        requestSong(query, uniqueId, "tiktok_chat").catch((err) => {
          console.error("[tiktok-chat] Auto song request error:", err);
        });
      }
    }
  });

  conn.on(WebcastEvent.GIFT, (data: any) => {
    if (mySession !== sessionId || activeConnection !== conn) return;

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
      data.gift?.diamondCount ??
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
}

async function checkAndConnect(mySession: number) {
  if (mySession !== sessionId || !monitoring || !state.username) return;
  clearLiveCheckTimer();

  let conn: TikTokLiveConnection | null = null;
  try {
    conn = new TikTokLiveConnection(state.username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
    });

    const isLive = await conn.fetchIsLive();
    if (mySession !== sessionId || !monitoring) return;

    if (!isLive) {
      const secs = Math.max(1, Math.round(LIVE_CHECK_INTERVAL_MS / 1000));
      state.status = "connecting";
      state.roomId = null;
      state.error = `@${state.username} is currently offline (checking every ${secs}s)`;
      broadcastState();
      scheduleLiveCheck(mySession);
      return;
    }

    activeConnection = conn;
    attachConnectionListeners(conn, mySession);

    await conn.connect();
    if (mySession !== sessionId) {
      try {
        await conn.disconnect();
      } catch {}
    }
  } catch (err: any) {
    clearAllStreaks();
    if (conn && activeConnection === conn) {
      activeConnection = null;
    }
    if (mySession !== sessionId) return;

    const msg = extractErrorMessage(err) || "Failed to connect to TikTok LIVE";

    if (!monitoring || isFatalConfigError(err)) {
      monitoring = false;
      state.status = isOfflineError(err) ? "disconnected" : "error";
      state.roomId = null;
      state.error = isOfflineError(err) ? `@${state.username} is currently offline` : msg;
      broadcastState();
      return;
    }

    const delay = retryDelayMs(err);
    const secs = Math.max(1, Math.round(delay / 1000));
    state.status = "connecting";
    state.roomId = null;
    state.error = isOfflineError(err)
      ? `@${state.username} is currently offline (checking every ${secs}s)`
      : `${msg} (retrying in ${secs}s)`;
    broadcastState();
    scheduleLiveCheck(mySession, delay);
  }
}

export async function connectLive(username?: string, webhookUri?: string, webhookUriChat?: string, webhookUriSpotify?: string) {
  stopLiveSession();

  state.username = String(username !== undefined ? username : state.username || "").trim();
  state.webhookUri = String(webhookUri !== undefined ? webhookUri : state.webhookUri || "").trim();
  state.webhookUriChat = String(webhookUriChat !== undefined ? webhookUriChat : state.webhookUriChat || "").trim();
  state.webhookUriSpotify = String(webhookUriSpotify !== undefined ? webhookUriSpotify : state.webhookUriSpotify || "").trim();
  saveConfig({
    username: state.username,
    webhookUri: state.webhookUri,
    webhookUriChat: state.webhookUriChat,
    webhookUriSpotify: state.webhookUriSpotify,
  });

  if (!state.username) {
    state.status = "error";
    state.roomId = null;
    state.error = "TikTok username is required";
    broadcastState();
    return;
  }

  monitoring = true;
  const mySession = sessionId;
  state.status = "connecting";
  state.roomId = null;
  state.error = null;
  broadcastState();

  await checkAndConnect(mySession);
}
