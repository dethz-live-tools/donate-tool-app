import { saveConfig } from "../config.ts";
import { broadcastState, spotifyState, state } from "../state.ts";
import { sendWebhook } from "./webhook.ts";
import type {
  CurrentSongItem,
  CurrentSongListResponse,
  LogEntry,
  SpotifyDevice,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyWebhookPayload,
} from "../types.ts";

const playlistCache = new Map<string, string>();
let spotifyPollTimer: NodeJS.Timeout | null = null;

let lastDispatchedTrackKey: string | null = null;
let lastDispatchedIsPlaying: boolean | null = null;
let hasDispatchedInitial: boolean = false;

export function resetSpotifyWebhookTracker() {
  lastDispatchedTrackKey = null;
  lastDispatchedIsPlaying = null;
  hasDispatchedInitial = false;
}

export async function sendSpotifyStatusWebhook(force: boolean = false): Promise<LogEntry | null> {
  const uri = String(state.webhookUri || "").trim();
  if (!uri && !force) {
    return null;
  }

  const track = spotifyState.currentTrack;
  const isPlaying = track ? Boolean(track.isPlaying) : false;

  const payload: SpotifyWebhookPayload = {
    event: "spotify_status",
    isPlaying,
    trackName: track ? track.name : null,
    artist: track ? track.artist : null,
    album: track ? track.album : null,
    albumArt: track ? track.albumArt : null,
    durationMs: track ? track.durationMs : 0,
    progressMs: track ? track.progressMs : 0,
    playlistName: track?.playlistName || null,
    playlistUri: track?.playlistUri || null,
    track: track ? { ...track } : null,
    device: spotifyState.activeDevice ? { ...spotifyState.activeDevice } : null,
    timestamp: Date.now(),
  };

  return await sendWebhook(payload, "spotify");
}

export async function checkAndDispatchSpotifyWebhook() {
  const uri = String(state.webhookUri || "").trim();
  if (!uri) return;

  if (!spotifyState.connected && !spotifyState.refreshToken) return;

  const track = spotifyState.currentTrack;
  const currentTrackKey = track
    ? `${track.name}:::${track.artist}:::${track.album}:::${track.playlistUri || ""}`
    : null;
  const currentIsPlaying = track ? Boolean(track.isPlaying) : false;

  if (!hasDispatchedInitial) {
    hasDispatchedInitial = true;
    lastDispatchedTrackKey = currentTrackKey;
    lastDispatchedIsPlaying = currentIsPlaying;
    if (track) {
      await sendSpotifyStatusWebhook();
    }
    return;
  }

  const trackChanged = currentTrackKey !== lastDispatchedTrackKey;
  const playStateChanged = currentIsPlaying !== lastDispatchedIsPlaying;

  if (trackChanged || playStateChanged) {
    lastDispatchedTrackKey = currentTrackKey;
    lastDispatchedIsPlaying = currentIsPlaying;
    await sendSpotifyStatusWebhook();
  }
}

// Spotify token refresh logic
export async function refreshSpotifyToken(): Promise<boolean> {
  const cid = String(spotifyState.clientId || "").trim();
  const csecret = String(spotifyState.clientSecret || "").trim();
  const rtoken = String(spotifyState.refreshToken || "").trim();

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

export async function getPlaylistName(href: string): Promise<string | null> {
  if (playlistCache.has(href)) {
    return playlistCache.get(href)!;
  }
  if (!spotifyState.accessToken) return null;

  try {
    let res = await fetch(href, {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        res = await fetch(href, {
          headers: {
            Authorization: `Bearer ${spotifyState.accessToken}`,
          },
        });
      }
    }

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

// Fetch user's accessible playlists
export async function getUserPlaylists(): Promise<SpotifyPlaylist[]> {
  if (!spotifyState.connected || !spotifyState.refreshToken) {
    return [];
  }
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) return [];
  }

  try {
    let res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
          headers: {
            Authorization: `Bearer ${spotifyState.accessToken}`,
          },
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      let errDetail = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.message) errDetail = parsed.error.message;
      } catch {}
      console.error(`[spotify] Failed to fetch playlists (${res.status}):`, errDetail);
      if (res.status === 403) {
        spotifyState.error = "Playlist read permission missing. Please re-authorize Spotify in Configuration.";
        broadcastState();
      }
      return [];
    }

    const data = await res.json();
    return (data.items || []).map((item: any) => ({
      id: item.id,
      name: item.name || "Untitled Playlist",
      uri: item.uri,
      description: item.description || "",
      totalTracks: Number(item.tracks?.total) || 0,
      image: item.images?.[0]?.url || null,
      isPublic: Boolean(item.public),
      collaborative: Boolean(item.collaborative),
    }));
  } catch (err: any) {
    console.error("[spotify] Error fetching user playlists:", err.message);
    return [];
  }
}

// Fetch available Spotify players/devices
export async function getAvailableDevices(): Promise<SpotifyDevice[]> {
  if (!spotifyState.connected || !spotifyState.refreshToken) {
    return [];
  }
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) return [];
  }

  try {
    let res = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        res = await fetch("https://api.spotify.com/v1/me/player/devices", {
          headers: {
            Authorization: `Bearer ${spotifyState.accessToken}`,
          },
        });
      }
    }

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return (data.devices || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      type: d.type || "Device",
      isActive: Boolean(d.is_active),
      volumePercent: typeof d.volume_percent === "number" ? d.volume_percent : undefined,
    }));
  } catch (err: any) {
    console.error("[spotify] Error fetching devices:", err.message);
    return [];
  }
}

// Transfer playback to selected device
export async function transferPlayback(deviceId: string, play: boolean = true): Promise<boolean> {
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) {
      throw new Error("Spotify not authorized or token refresh failed");
    }
  }

  const res = await fetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${spotifyState.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play,
    }),
  });

  if (res.status === 204 || res.ok) {
    setTimeout(fetchCurrentlyPlaying, 500);
    return true;
  }

  const errText = await res.text();
  throw new Error(`Failed to transfer playback: ${errText.slice(0, 150)}`);
}

// Fetch current playing song list (active track + upcoming queue)
export async function getCurrentSongList(): Promise<CurrentSongListResponse> {
  if (!spotifyState.connected || !spotifyState.refreshToken) {
    return { contextName: null, contextType: null, contextUri: null, total: 0, tracks: [] };
  }
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) return { contextName: null, contextType: null, contextUri: null, total: 0, tracks: [] };
  }

  try {
    let res = await fetch("https://api.spotify.com/v1/me/player/queue", {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        res = await fetch("https://api.spotify.com/v1/me/player/queue", {
          headers: {
            Authorization: `Bearer ${spotifyState.accessToken}`,
          },
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[spotify] Queue fetch failed (${res.status}):`, errText);
      return { contextName: null, contextType: null, contextUri: null, total: 0, tracks: [] };
    }

    const data = await res.json();
    const tracks: CurrentSongItem[] = [];

    if (data.currently_playing && data.currently_playing.id) {
      const cp = data.currently_playing;
      tracks.push({
        id: cp.id,
        name: cp.name || "Unknown Track",
        artist: cp.artists?.map((a: any) => a.name).join(", ") || cp.show?.name || "Unknown Artist",
        album: cp.album?.name || cp.show?.publisher || "",
        albumArt: cp.album?.images?.[0]?.url || cp.images?.[0]?.url || null,
        durationMs: Number(cp.duration_ms) || 0,
        uri: cp.uri,
        isPlaying: true,
      });
    }

    for (const item of (data.queue || [])) {
      if (!item || !item.id) continue;
      tracks.push({
        id: item.id,
        name: item.name || "Unknown Track",
        artist: item.artists?.map((a: any) => a.name).join(", ") || item.show?.name || "Unknown Artist",
        album: item.album?.name || item.show?.publisher || "",
        albumArt: item.album?.images?.[0]?.url || item.images?.[0]?.url || null,
        durationMs: Number(item.duration_ms) || 0,
        uri: item.uri,
        isPlaying: false,
      });
    }

    const contextName = spotifyState.currentTrack?.playlistName || (tracks.length ? "Player Queue" : null);

    return {
      contextName,
      contextType: spotifyState.currentTrack?.playlistUri ? "playlist" : "queue",
      contextUri: spotifyState.currentTrack?.playlistUri || null,
      total: tracks.length,
      tracks,
    };
  } catch (err: any) {
    console.error("[spotify] Error fetching current song list:", err.message);
    return { contextName: null, contextType: null, contextUri: null, total: 0, tracks: [] };
  }
}

// Control Spotify playback (play, pause, next, previous)
export async function controlPlayer(
  endpoint: "play" | "pause" | "next" | "previous",
  method: "PUT" | "POST" = "POST",
  payload?: any
): Promise<boolean> {
  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) {
      throw new Error("Spotify not authorized or token refresh failed");
    }
  }

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${spotifyState.accessToken}`,
      "Content-Type": "application/json",
    },
  };

  if (payload && method === "PUT") {
    options.body = JSON.stringify(payload);
  }

  let res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, options);

  // If token expired, refresh and retry once
  if (res.status === 401) {
    const refreshed = await refreshSpotifyToken();
    if (refreshed) {
      options.headers = {
        Authorization: `Bearer ${spotifyState.accessToken}`,
        "Content-Type": "application/json",
      };
      res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, options);
    }
  }

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

  if (res.status === 403) {
    msg += " (Insufficient permission: please re-authorize Spotify in Configuration)";
  }

  spotifyState.error = msg;
  broadcastState();
  throw new Error(msg);
}

// Fetch currently playing track & playlist from Spotify API
export async function fetchCurrentlyPlaying() {
  if (!spotifyState.connected || !spotifyState.refreshToken) {
    return;
  }

  if (!spotifyState.accessToken || Date.now() >= spotifyState.tokenExpiresAt - 60000) {
    const refreshed = await refreshSpotifyToken();
    if (!refreshed) return;
  }

  try {
    const res = await fetch("https://api.spotify.com/v1/me/player", {
      headers: {
        Authorization: `Bearer ${spotifyState.accessToken}`,
      },
    });

    if (res.status === 204) {
      if (spotifyState.currentTrack !== null) {
        spotifyState.currentTrack = null;
        broadcastState();
        await checkAndDispatchSpotifyWebhook();
      }
      return;
    }

    if (res.status === 401) {
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
        await checkAndDispatchSpotifyWebhook();
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
    if (data.device) {
      spotifyState.activeDevice = {
        id: data.device.id,
        name: data.device.name,
        type: data.device.type || "Device",
        isActive: Boolean(data.device.is_active),
        volumePercent: typeof data.device.volume_percent === "number" ? data.device.volume_percent : undefined,
      };
    } else {
      spotifyState.activeDevice = null;
    }

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
    await checkAndDispatchSpotifyWebhook();
  } catch (err: any) {
    console.error("[spotify] Fetch error:", err.message);
    spotifyState.error = `Network error: ${err.message}`;
    broadcastState();
  }
}

export function startSpotifyPolling() {
  if (spotifyPollTimer) clearInterval(spotifyPollTimer);
  spotifyPollTimer = setInterval(fetchCurrentlyPlaying, 3000);
  fetchCurrentlyPlaying();
}

export function stopSpotifyPolling() {
  if (spotifyPollTimer) {
    clearInterval(spotifyPollTimer);
    spotifyPollTimer = null;
  }
}
