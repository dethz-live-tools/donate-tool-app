import type http from "node:http";
import { getPublicConfig, loadConfig } from "./config.ts";
import type { ServerState, SongRequestItem, SpotifyInfo, SpotifyState, TikTokChatMessage } from "./types.ts";

export const initialConfig = loadConfig();

export const isSpotifyConfigured = Boolean(
  initialConfig.spotifyRefreshToken &&
  initialConfig.spotifyClientId &&
  initialConfig.spotifyClientSecret
);

export function getSpotifyPublicState(): SpotifyInfo {
  return {
    clientId: spotifyState.clientId,
    hasClientSecret: Boolean(spotifyState.clientSecret),
    connected: spotifyState.connected,
    currentTrack: spotifyState.currentTrack,
    activeDevice: spotifyState.activeDevice || null,
    error: spotifyState.error,
  };
}

export const state: ServerState = {
  username: initialConfig.username,
  webhookUri: initialConfig.webhookUri,
  webhookUriChat: initialConfig.webhookUriChat,
  webhookUriSpotify: initialConfig.webhookUriSpotify,
  status: "disconnected",
  roomId: null,
  error: null,
  logs: [],
  spotify: {
    clientId: initialConfig.spotifyClientId,
    hasClientSecret: Boolean(initialConfig.spotifyClientSecret),
    connected: isSpotifyConfigured,
    currentTrack: null,
    activeDevice: null,
    error: null,
  },
  recentChats: [],
  songRequests: [],
  config: initialConfig,
};

export const spotifyState: SpotifyState = {
  clientId: String(initialConfig.spotifyClientId || "").trim(),
  clientSecret: String(initialConfig.spotifyClientSecret || "").trim(),
  accessToken: null,
  refreshToken: initialConfig.spotifyRefreshToken ? String(initialConfig.spotifyRefreshToken).trim() : null,
  tokenExpiresAt: 0,
  connected: isSpotifyConfigured,
  currentTrack: null,
  activeDevice: null,
  error: null,
};

export const sseClients: http.ServerResponse[] = [];

export function broadcastState() {
  state.spotify = getSpotifyPublicState();

  const data = JSON.stringify({
    username: state.username,
    webhookUri: state.webhookUri,
    webhookUriChat: state.webhookUriChat,
    webhookUriSpotify: state.webhookUriSpotify,
    status: state.status,
    roomId: state.roomId,
    error: state.error,
    logs: state.logs,
    spotify: state.spotify,
    recentChats: state.recentChats,
    songRequests: state.songRequests,
    config: getPublicConfig(state.config),
  });

  const message = `data: ${data}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const res = sseClients[i];
    try {
      res.write(message);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

export function broadcastChat(chat: TikTokChatMessage) {
  const message = `event: chat\ndata: ${JSON.stringify(chat)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const res = sseClients[i];
    try {
      res.write(message);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// 15-second heartbeat ping to prevent OBS Studio and browsers from timing out SSE connections
setInterval(() => {
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const res = sseClients[i];
    try {
      res.write(": keep-alive\n\n");
    } catch {
      sseClients.splice(i, 1);
    }
  }
}, 15000);
