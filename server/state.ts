import type http from "node:http";
import { loadConfig } from "./config.ts";
import type { ServerState, SpotifyInfo, SpotifyState } from "./types.ts";

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
    error: spotifyState.error,
  };
}

export const state: ServerState = {
  username: initialConfig.username,
  webhookUri: initialConfig.webhookUri,
  status: "disconnected",
  roomId: null,
  error: null,
  logs: [],
  spotify: {
    clientId: initialConfig.spotifyClientId,
    hasClientSecret: Boolean(initialConfig.spotifyClientSecret),
    connected: isSpotifyConfigured,
    currentTrack: null,
    error: null,
  },
};

export const spotifyState: SpotifyState = {
  clientId: String(initialConfig.spotifyClientId || "").trim(),
  clientSecret: String(initialConfig.spotifyClientSecret || "").trim(),
  accessToken: null,
  refreshToken: initialConfig.spotifyRefreshToken ? String(initialConfig.spotifyRefreshToken).trim() : null,
  tokenExpiresAt: 0,
  connected: isSpotifyConfigured,
  currentTrack: null,
  error: null,
};

export const sseClients: http.ServerResponse[] = [];

export function broadcastState() {
  state.spotify = getSpotifyPublicState();

  const data = JSON.stringify({
    username: state.username,
    webhookUri: state.webhookUri,
    status: state.status,
    roomId: state.roomId,
    error: state.error,
    logs: state.logs,
    spotify: state.spotify,
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
