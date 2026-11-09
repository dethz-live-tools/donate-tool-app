import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { WebcastPushConnection } from "tiktok-live-connector/legacy";

const PORT = 3001;
const CONFIG_FILE = path.join(process.cwd(), "config.yaml");
const LEGACY_JSON_FILE = path.join(process.cwd(), "connector-config.json");

interface WebhookPayload {
  username: string;
  giftName: string;
  coins: number;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: "gift" | "test" | "system";
  payload: WebhookPayload;
  webhookUri: string;
  httpStatus?: number;
  response?: string;
  success: boolean;
  error?: string;
}

interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
  playlistName?: string | null;
  playlistUri?: string | null;
}

interface SpotifyState {
  clientId: string;
  clientSecret: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number;
  connected: boolean;
  currentTrack: SpotifyTrack | null;
  error: string | null;
}

interface SpotifyInfo {
  clientId: string;
  hasClientSecret: boolean;
  connected: boolean;
  currentTrack: SpotifyTrack | null;
  error: string | null;
}

interface ServerState {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  error: string | null;
  logs: LogEntry[];
  spotify: SpotifyInfo;
}

interface AppConfig {
  username: string;
  webhookUri: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRefreshToken: string;
}

// Load saved config in YAML format (with JSON fallback migration)
function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const data = YAML.parse(raw) || {};
      return {
        username: data.tiktok?.username || data.username || data.tiktok_username || "",
        webhookUri: data.webhook?.uri || data.webhookUri || data.webhook_uri || "",
        spotifyClientId: data.spotify?.client_id || data.spotifyClientId || data.spotify_client_id || "",
        spotifyClientSecret: data.spotify?.client_secret || data.spotifyClientSecret || data.spotify_client_secret || "",
        spotifyRefreshToken: data.spotify?.refresh_token || data.spotifyRefreshToken || data.spotify_refresh_token || "",
      };
    }

    // Migrate from legacy JSON config if present
    if (fs.existsSync(LEGACY_JSON_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEGACY_JSON_FILE, "utf-8"));
      const migrated: AppConfig = {
        username: data.username || "",
        webhookUri: data.webhookUri || "",
        spotifyClientId: data.spotifyClientId || "",
        spotifyClientSecret: data.spotifyClientSecret || "",
        spotifyRefreshToken: data.spotifyRefreshToken || "",
      };
      saveConfig(migrated);
      return migrated;
    }
  } catch (e) {
    console.error("Failed to load config.yaml:", e);
  }
  return {
    username: "",
    webhookUri: "",
    spotifyClientId: "",
    spotifyClientSecret: "",
    spotifyRefreshToken: "",
  };
}

function saveConfig(updates: Partial<AppConfig>) {
  try {
    const exists = fs.existsSync(CONFIG_FILE);
    const existing = exists ? loadConfig() : {
      username: "",
      webhookUri: "",
      spotifyClientId: "",
      spotifyClientSecret: "",
      spotifyRefreshToken: "",
    };

    const merged = { ...existing, ...updates };
    const yamlData = {
      tiktok: {
        username: merged.username || "",
      },
      webhook: {
        uri: merged.webhookUri || "",
      },
      spotify: {
        client_id: merged.spotifyClientId || "",
        client_secret: merged.spotifyClientSecret || "",
        refresh_token: merged.spotifyRefreshToken || "",
      },
    };

    const serialized = YAML.stringify(yamlData, { indent: 2 });
    // If exists, overwrite it; if not, create and write it
    fs.writeFileSync(CONFIG_FILE, serialized, {
      encoding: "utf-8",
      flag: "w",
    });
    console.log(`[config] ${exists ? "Overwrote existing" : "Created and wrote"} ${CONFIG_FILE}`);
  } catch (e) {
    console.error("Failed to save config.yaml:", e);
  }
}

const initialConfig = loadConfig();
const isSpotifyConfigured = Boolean(
  initialConfig.spotifyRefreshToken &&
  initialConfig.spotifyClientId &&
  initialConfig.spotifyClientSecret
);

function getSpotifyPublicState(): SpotifyInfo {
  return {
    clientId: spotifyState.clientId,
    hasClientSecret: Boolean(spotifyState.clientSecret),
    connected: spotifyState.connected,
    currentTrack: spotifyState.currentTrack,
    error: spotifyState.error,
  };
}

const state: ServerState = {
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

const spotifyState: SpotifyState = {
  clientId: initialConfig.spotifyClientId.trim(),
  clientSecret: initialConfig.spotifyClientSecret.trim(),
  accessToken: null,
  refreshToken: initialConfig.spotifyRefreshToken ? initialConfig.spotifyRefreshToken.trim() : null,
  tokenExpiresAt: 0,
  connected: isSpotifyConfigured,
  currentTrack: null,
  error: null,
};

let activeConnection: any = null;
const sseClients: http.ServerResponse[] = [];
let spotifyPollTimer: NodeJS.Timeout | null = null;

function broadcastState() {
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

// Spotify token refresh logic
async function refreshSpotifyToken(): Promise<boolean> {
  const cid = spotifyState.clientId.trim();
  const csecret = spotifyState.clientSecret.trim();
  const rtoken = spotifyState.refreshToken?.trim();

  if (!rtoken || !cid || !csecret) {
    spotifyState.connected = false;
    spotifyState.currentTrack = null;
    spotifyState.error = "Missing Spotify Client ID, Client Secret, or Refresh Token";
    broadcastState();
    return false;
  }

  try {
    const creds = Buffer.from(`${cid}:${csecret}`).toString("base64");

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: rtoken,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      spotifyState.error = `Token refresh failed (${res.status}): ${errText.slice(0, 150)}`;
      spotifyState.connected = false;
      broadcastState();
      return false;
    }

    const data = await res.json();
    spotifyState.accessToken = data.access_token;
    spotifyState.tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    if (data.refresh_token) {
      spotifyState.refreshToken = data.refresh_token.trim();
      saveConfig({ spotifyRefreshToken: spotifyState.refreshToken });
    }
    spotifyState.connected = true;
    spotifyState.error = null;
    broadcastState();
    return true;
  } catch (err: any) {
    spotifyState.error = err.message || "Failed to refresh Spotify token";
    broadcastState();
    return false;
  }
}

const playlistCache = new Map<string, string>();

async function getPlaylistName(href: string): Promise<string | null> {
  if (playlistCache.has(href)) {
    return playlistCache.get(href)!;
  }
  if (!spotifyState.accessToken) return null;

  try {
    const res = await fetch(href, {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.name) {
        playlistCache.set(href, data.name);
        return data.name;
      }
    }
  } catch {}
  return null;
}

// Control Spotify playback (play, pause, next, previous)
async function controlPlayer(
  endpoint: "play" | "pause" | "next" | "previous",
  method: "PUT" | "POST" = "POST"
): Promise<boolean> {
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) {
      throw new Error("Spotify not authorized or token refresh failed");
    }
  }

  const res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${spotifyState.accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 204 || res.ok) {
    spotifyState.error = null;
    setTimeout(fetchCurrentlyPlaying, 400);
    return true;
  }

  const errText = await res.text();
  let msg = `Playback action failed (${res.status})`;
  try {
    const parsed = JSON.parse(errText);
    if (parsed.error?.message) {
      msg = parsed.error.message;
    }
  } catch {
    if (errText) msg += `: ${errText.slice(0, 100)}`;
  }

  spotifyState.error = msg;
  broadcastState();
  throw new Error(msg);
}

// Fetch currently playing track & playlist from Spotify API
async function fetchCurrentlyPlaying() {
  if (!spotifyState.connected || !spotifyState.refreshToken) {
    return;
  }

  // Refresh if token missing or expiring in < 60s
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) return;
  }

  try {
    // Request full playback state to retrieve context (playlist)
    const res = await fetch("https://api.spotify.com/v1/me/player", {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });

    if (res.status === 204) {
      // Nothing currently playing or device idle
      if (spotifyState.currentTrack !== null) {
        spotifyState.currentTrack = null;
        broadcastState();
      }
      return;
    }

    if (res.status === 401) {
      // Unauthorized, retry token refresh
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        await fetchCurrentlyPlaying();
      }
      return;
    }

    if (!res.ok) {
      const errText = await res.text();
      spotifyState.error = `Spotify API error (${res.status}): ${errText.slice(0, 150)}`;
      broadcastState();
      return;
    }

    const data = await res.json();
    if (!data || !data.item) {
      if (spotifyState.currentTrack !== null) {
        spotifyState.currentTrack = null;
        broadcastState();
      }
      return;
    }

    let playlistName: string | null = null;
    let playlistUri: string | null = null;

    if (data.context && data.context.type === "playlist") {
      playlistUri = data.context.uri || null;
      if (data.context.href) {
        playlistName = await getPlaylistName(data.context.href);
      }
    }

    const item = data.item;
    const track: SpotifyTrack = {
      name: item.name || "Unknown Track",
      artist:
        item.artists?.map((a: any) => a.name).join(", ") ||
        item.show?.name ||
        "Unknown Artist",
      album: item.album?.name || item.show?.publisher || "",
      albumArt:
        item.album?.images?.[0]?.url ||
        item.images?.[0]?.url ||
        item.show?.images?.[0]?.url ||
        null,
      durationMs: Number(item.duration_ms) || 0,
      progressMs: Number(data.progress_ms) || 0,
      isPlaying: Boolean(data.is_playing),
      playlistName,
      playlistUri,
    };

    spotifyState.currentTrack = track;
    spotifyState.error = null;
    broadcastState();
  } catch (err: any) {
    console.error("Spotify fetch error:", err.message);
    spotifyState.error = `Network error: ${err.message}`;
    broadcastState();
  }
}

function startSpotifyPolling() {
  if (spotifyPollTimer) clearInterval(spotifyPollTimer);
  spotifyPollTimer = setInterval(fetchCurrentlyPlaying, 3000);
  fetchCurrentlyPlaying();
}

function stopSpotifyPolling() {
  if (spotifyPollTimer) {
    clearInterval(spotifyPollTimer);
    spotifyPollTimer = null;
  }
}

// Auto-start polling if already configured with refresh token
if (spotifyState.refreshToken && spotifyState.clientId && spotifyState.clientSecret) {
  startSpotifyPolling();
}

async function sendWebhook(
  payload: WebhookPayload,
  type: "gift" | "test" = "gift"
): Promise<LogEntry> {
  const uri = state.webhookUri.trim();

  if (!uri) {
    const entry: LogEntry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: "(not configured)",
      success: false,
      error: "Webhook URI is empty",
    };
    state.logs.unshift(entry);
    if (state.logs.length > 50) state.logs.pop();
    broadcastState();
    return entry;
  }

  let entry: LogEntry;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(uri, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const responseText = await res.text();
    entry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      httpStatus: res.status,
      response: responseText.slice(0, 300),
      success: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
    };
  } catch (err: any) {
    entry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      httpStatus: 0,
      success: false,
      error: err.name === "AbortError" ? "Request timed out" : (err.message || "Network error"),
    };
  }

  state.logs.unshift(entry);
  if (state.logs.length > 50) state.logs.pop();
  broadcastState();
  return entry;
}

function disconnectLive() {
  if (activeConnection) {
    try {
      activeConnection.disconnect();
    } catch (e) {
      console.error("Error disconnecting:", e);
    }
    activeConnection = null;
  }
  state.status = "disconnected";
  state.roomId = null;
  broadcastState();
}

async function connectLive(username: string, webhookUri: string) {
  disconnectLive();

  state.username = username.trim();
  state.webhookUri = webhookUri.trim();
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
        console.error("Webhook dispatch error:", err);
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

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/status" && req.method === "GET") {
    state.spotify = getSpotifyPublicState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        username: state.username,
        webhookUri: state.webhookUri,
        status: state.status,
        roomId: state.roomId,
        error: state.error,
        logs: state.logs,
        spotify: state.spotify,
      })
    );
    return;
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
    return;
  }

  // Save and upgrade config.yaml directly
  if (url.pathname === "/api/config" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { username, webhookUri } = JSON.parse(body || "{}");
        if (username !== undefined) state.username = String(username).trim();
        if (webhookUri !== undefined) state.webhookUri = String(webhookUri).trim();
        saveConfig({
          username: state.username,
          webhookUri: state.webhookUri,
        });
        broadcastState();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Configuration saved to config.yaml" }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/connect" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { username, webhookUri } = JSON.parse(body || "{}");
        connectLive(username, webhookUri);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Connection initiated" }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/disconnect" && req.method === "POST") {
    disconnectLive();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Disconnected" }));
    return;
  }

  if (url.pathname === "/api/test-webhook" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (parsed.webhookUri) {
          state.webhookUri = parsed.webhookUri.trim();
          saveConfig({ webhookUri: state.webhookUri });
        }
        const payload: WebhookPayload = {
          username: parsed.username || "gifter_name",
          giftName: parsed.giftName || "Rose",
          coins: Number(parsed.coins) || 20,
        };

        const result = await sendWebhook(payload, "test");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: result.success, entry: result }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Spotify OAuth - Redirect to Spotify authorize URL
  if (url.pathname === "/api/spotify/login" && req.method === "GET") {
    if (!spotifyState.clientId) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Spotify Client ID not configured");
      return;
    }

    const redirectUri = `http://127.0.0.1:${PORT}/api/spotify/callback`;
    const scopes = [
      "user-read-currently-playing",
      "user-read-playback-state",
      "user-modify-playback-state",
      "playlist-read-private",
      "playlist-read-collaborative",
    ].join(" ");

    const params = new URLSearchParams({
      client_id: spotifyState.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes,
      show_dialog: "true",
    });

    res.writeHead(302, {
      Location: `https://accounts.spotify.com/authorize?${params.toString()}`,
    });
    res.end();
    return;
  }

  // Spotify OAuth - Handle callback & token exchange
  if (url.pathname === "/api/spotify/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h3>Spotify Authentication Failed: ${error || "Missing code"}</h3>`);
      return;
    }

    const redirectUri = `http://127.0.0.1:${PORT}/api/spotify/callback`;
    try {
      const creds = Buffer.from(
        `${spotifyState.clientId}:${spotifyState.clientSecret}`
      ).toString("base64");

      const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h3>Token Exchange Failed:</h3><pre>${text}</pre>`);
        return;
      }

      const tokenData = await tokenRes.json();
      spotifyState.accessToken = tokenData.access_token;
      spotifyState.refreshToken = tokenData.refresh_token;
      spotifyState.tokenExpiresAt = Date.now() + (Number(tokenData.expires_in) || 3600) * 1000;
      spotifyState.connected = true;
      spotifyState.error = null;

      saveConfig({
        spotifyClientId: spotifyState.clientId,
        spotifyClientSecret: spotifyState.clientSecret,
        spotifyRefreshToken: tokenData.refresh_token,
      });

      startSpotifyPolling();
      broadcastState();

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Spotify Connected</title>
            <style>
              body { background: #24273a; color: #cad3f5; font-family: sans-serif; display: grid; place-content: center; height: 100vh; margin: 0; text-align: center; }
              h1 { color: #a6da95; }
            </style>
          </head>
          <body>
            <h1>✓ SPOTIFY CONNECTED</h1>
            <p>You can close this window and return to the application.</p>
            <script>
              setTimeout(() => { window.close(); }, 1500);
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h3>Error: ${err.message}</h3>`);
    }
    return;
  }

  // Save Spotify Client ID & Secret
  if (url.pathname === "/api/spotify/config" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { clientId, clientSecret } = JSON.parse(body || "{}");
        if (clientId !== undefined && typeof clientId === "string") {
          spotifyState.clientId = clientId.trim();
        }
        if (clientSecret !== undefined && typeof clientSecret === "string" && clientSecret.trim() !== "") {
          spotifyState.clientSecret = clientSecret.trim();
        }
        saveConfig({
          spotifyClientId: spotifyState.clientId,
          spotifyClientSecret: spotifyState.clientSecret,
        });

        // Restart polling if refresh token and credentials are ready
        if (spotifyState.refreshToken && spotifyState.clientId && spotifyState.clientSecret) {
          spotifyState.connected = true;
          spotifyState.error = null;
          startSpotifyPolling();
        }

        broadcastState();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, spotify: getSpotifyPublicState() }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Force refresh Spotify connection / playback
  if (url.pathname === "/api/spotify/refresh" && req.method === "POST") {
    if (spotifyState.refreshToken && spotifyState.clientId && spotifyState.clientSecret) {
      spotifyState.connected = true;
      startSpotifyPolling();
      await fetchCurrentlyPlaying();
    } else {
      spotifyState.error = "Spotify configuration incomplete (need Client ID, Secret & Account Authorization)";
      broadcastState();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, spotify: getSpotifyPublicState() }));
    return;
  }

  // Disconnect Spotify
  if (url.pathname === "/api/spotify/disconnect" && req.method === "POST") {
    stopSpotifyPolling();
    spotifyState.connected = false;
    spotifyState.accessToken = null;
    spotifyState.refreshToken = null;
    spotifyState.currentTrack = null;
    spotifyState.error = null;
    saveConfig({ spotifyRefreshToken: "" });
    broadcastState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Spotify disconnected" }));
    return;
  }

  // Get current Spotify track
  if (url.pathname === "/api/spotify/now-playing" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        connected: spotifyState.connected,
        track: spotifyState.currentTrack,
        error: spotifyState.error,
      })
    );
    return;
  }

  // Control Spotify Player Actions
  if (url.pathname.startsWith("/api/spotify/player/") && req.method === "POST") {
    const action = url.pathname.replace("/api/spotify/player/", "").toLowerCase();
    try {
      if (action === "play") {
        await controlPlayer("play", "PUT");
      } else if (action === "pause") {
        await controlPlayer("pause", "PUT");
      } else if (action === "next") {
        await controlPlayer("next", "POST");
      } else if (action === "previous") {
        await controlPlayer("previous", "POST");
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid player action" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, action }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} in use; assuming existing server is active.`);
    process.exit(0);
  } else {
    console.error("Server error:", err);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`TikTok Live Webhook Bridge running on http://127.0.0.1:${PORT}`);
});
