import type http from "node:http";
import { saveConfig } from "../config.ts";
import {
  controlPlayer,
  fetchCurrentlyPlaying,
  getAvailableDevices,
  getCurrentSongList,
  getUserPlaylists,
  resetSpotifyWebhookTracker,
  sendSpotifyStatusWebhook,
  startSpotifyPolling,
  stopSpotifyPolling,
  transferPlayback,
} from "../services/spotify.ts";
import { broadcastState, getSpotifyPublicState, spotifyState, state } from "../state.ts";
import { parseJsonBody, PORT, sendJson } from "../utils.ts";

export async function handleSpotifyRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  // Spotify OAuth - Redirect to Spotify authorize URL
  if (url.pathname === "/api/spotify/login" && req.method === "GET") {
    if (!spotifyState.clientId) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Spotify Client ID not configured");
      return true;
    }

    const redirectUri = `http://127.0.0.1:${PORT}/api/spotify/callback`;
    const scopes = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
      "streaming",
      "app-remote-control",
      "user-read-playback-position",
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
      "user-read-private",
      "user-read-email",
      "user-library-read",
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
    return true;
  }

  // Spotify OAuth - Handle callback & token exchange
  if (url.pathname === "/api/spotify/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h3>Spotify Authentication Failed: ${error || "Missing code"}</h3>`);
      return true;
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
        return true;
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
    return true;
  }

  // Save Spotify Client ID & Secret
  if (url.pathname === "/api/spotify/config" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      const { clientId, clientSecret } = parsed;
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

      if (spotifyState.refreshToken && spotifyState.clientId && spotifyState.clientSecret) {
        spotifyState.connected = true;
        spotifyState.error = null;
        startSpotifyPolling();
      }

      broadcastState();
      sendJson(res, 200, { success: true, spotify: getSpotifyPublicState() });
    } catch (err: any) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return true;
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
    sendJson(res, 200, { success: true, spotify: getSpotifyPublicState() });
    return true;
  }

  // Disconnect Spotify
  if (url.pathname === "/api/spotify/disconnect" && req.method === "POST") {
    stopSpotifyPolling();
    spotifyState.connected = false;
    spotifyState.accessToken = null;
    spotifyState.refreshToken = null;
    spotifyState.currentTrack = null;
    spotifyState.error = null;
    resetSpotifyWebhookTracker();
    saveConfig({ spotifyRefreshToken: "" });
    broadcastState();
    sendJson(res, 200, { success: true, message: "Spotify disconnected" });
    return true;
  }

  // Test Spotify webhook dispatch
  if (url.pathname === "/api/spotify/test-webhook" && req.method === "POST") {
    try {
      let parsed: any = {};
      try {
        parsed = await parseJsonBody(req);
      } catch {}

      if (parsed?.webhookUri) {
        state.webhookUri = String(parsed.webhookUri || "").trim();
        saveConfig({ webhookUri: state.webhookUri });
      }

      const entry = await sendSpotifyStatusWebhook(true);
      sendJson(res, 200, {
        success: Boolean(entry?.success),
        entry,
      });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message });
    }
    return true;
  }

  // Get current Spotify track
  if (url.pathname === "/api/spotify/now-playing" && req.method === "GET") {
    sendJson(res, 200, {
      connected: spotifyState.connected,
      track: spotifyState.currentTrack,
      error: spotifyState.error,
    });
    return true;
  }

  // Get available Spotify devices
  if (url.pathname === "/api/spotify/devices" && req.method === "GET") {
    try {
      const devices = await getAvailableDevices();
      sendJson(res, 200, { success: true, count: devices.length, devices });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message, devices: [] });
    }
    return true;
  }

  // Transfer playback to selected device
  if (url.pathname === "/api/spotify/player/device" && req.method === "POST") {
    try {
      const parsed = await parseJsonBody(req);
      if (!parsed.deviceId) {
        sendJson(res, 400, { success: false, error: "deviceId is required" });
        return true;
      }
      await transferPlayback(parsed.deviceId, parsed.play !== false);
      sendJson(res, 200, { success: true, deviceId: parsed.deviceId });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message });
    }
    return true;
  }

  // Get current playing song list (active track + queue)
  if (
    (url.pathname === "/api/spotify/current-song-list" || url.pathname === "/api/spotify/queue") &&
    req.method === "GET"
  ) {
    try {
      const songList = await getCurrentSongList();
      sendJson(res, 200, { success: true, ...songList });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message, tracks: [] });
    }
    return true;
  }

  // Get user's playlists
  if (url.pathname === "/api/spotify/playlists" && req.method === "GET") {
    try {
      const playlists = await getUserPlaylists();
      sendJson(res, 200, { success: true, count: playlists.length, playlists });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message, playlists: [] });
    }
    return true;
  }

  // Control Spotify Player Actions
  if (url.pathname.startsWith("/api/spotify/player/") && req.method === "POST") {
    const action = url.pathname.replace("/api/spotify/player/", "").toLowerCase();
    try {
      let bodyPayload: any = undefined;
      try {
        bodyPayload = await parseJsonBody(req);
      } catch {}

      if (action === "play") {
        const playPayload: any = {};
        if (bodyPayload?.context_uri) playPayload.context_uri = bodyPayload.context_uri;
        if (bodyPayload?.uris) playPayload.uris = bodyPayload.uris;
        if (bodyPayload?.offset) playPayload.offset = bodyPayload.offset;
        await controlPlayer("play", "PUT", Object.keys(playPayload).length ? playPayload : undefined);
      } else if (action === "pause") {
        await controlPlayer("pause", "PUT");
      } else if (action === "next") {
        await controlPlayer("next", "POST");
      } else if (action === "previous") {
        await controlPlayer("previous", "POST");
      } else {
        sendJson(res, 400, { success: false, error: "Invalid player action" });
        return true;
      }
      sendJson(res, 200, { success: true, action });
    } catch (err: any) {
      sendJson(res, 200, { success: false, error: err.message });
    }
    return true;
  }

  return false;
}
