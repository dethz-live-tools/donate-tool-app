import { saveConfig } from "../config.ts";
import { broadcastState, spotifyState } from "../state.ts";
import type { SpotifyPlaylist, SpotifyTrack } from "../types.ts";

const playlistCache = new Map<string, string>();
let spotifyPollTimer: NodeJS.Timeout | null = null;

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
