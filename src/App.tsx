import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import {
  CurrentSongItem,
  LogEntry,
  OverlayMarketItem,
  OverlayMeta,
  ScreenShareStatus,
  ServerState,
  SongRequestItem,
  SpotifyDevice,
  SpotifyInfo,
  SpotifySearchResult,
  StudioScene,
  TikTokChatMessage,
} from "./types";
import { useLang } from "./i18n.tsx";
import { API_BASE } from "./lib/apiBase";
import { ScreenShareClient } from "./lib/screenShareClient";
import { type AppPage, Sidebar } from "./components/Sidebar";
import { DashboardTab } from "./components/DashboardTab";
import { ConfigTab } from "./components/ConfigTab";
import { OverlaysTab } from "./components/OverlaysTab";
import { StudioTab } from "./components/StudioTab";
import { ScreenShareTab } from "./components/ScreenShareTab";
import { AboutTab } from "./components/AboutTab";

const UPDATE_REPO = "dethz-live-tools/donate-tool-app";

// Strip leading "v" and compare as numeric parts (0.1.10 > 0.1.9, non-numeric => 0)
function isNewer(tag: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(tag);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function openAuthorizeUrl(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "width=600,height=700");
  }
}

export default function App() {
  const { t } = useLang();
  const [currentPage, setCurrentPage] = useState<AppPage>(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("page") === "studio" || query.has("profile")) return "studio";
    if (query.get("page") === "screen") return "screen";
    return "dashboard";
  });

  // TikTok & Webhook state
  const [username, setUsername] = useState("");
  const [webhookUri, setWebhookUri] = useState("");
  const [webhookUriChat, setWebhookUriChat] = useState("");
  const [webhookUriSpotify, setWebhookUriSpotify] = useState("");
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [backendOnline, setBackendOnline] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [tiktokError, setTiktokError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingSpotifyWebhook, setTestingSpotifyWebhook] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Spotify state
  const [spotify, setSpotify] = useState<SpotifyInfo>({
    clientId: "",
    hasClientSecret: false,
    connected: false,
    currentTrack: null,
    error: null,
  });
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyClientSecret, setSpotifyClientSecret] = useState("");
  const [savingSpotify, setSavingSpotify] = useState(false);
  const [currentSongs, setCurrentSongs] = useState<CurrentSongItem[]>([]);
  const [songListContext, setSongListContext] = useState<string | null>(null);
  const [loadingSongList, setLoadingSongList] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  // TikTok Live Chat & Song Request state
  const [recentChats, setRecentChats] = useState<TikTokChatMessage[]>([]);
  const [songRequests, setSongRequests] = useState<SongRequestItem[]>([]);

  // Overlays state
  const [installedOverlays, setInstalledOverlays] = useState<OverlayMeta[]>([]);
  const [marketCatalog, setMarketCatalog] = useState<OverlayMarketItem[]>([]);
  const [loadingOverlays, setLoadingOverlays] = useState(false);
  const [studioScene, setStudioScene] = useState<StudioScene>({
    width: 1920,
    height: 1080,
    layers: [],
  });

  // Screen Share (WHIP) state — kept at App level so switching tabs never drops the live WebRTC stream
  const [screenShare, setScreenShare] = useState<ScreenShareStatus>({
    running: false,
    port: 3002,
    token: "",
    lanUrls: [],
    obsUrl: `${API_BASE}/overlays/screen-share/`,
    receiverCount: 0,
    activeSession: null,
    error: null,
  });
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const screenShareClientRef = useRef<ScreenShareClient | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Update check against GitHub releases
  const [latestRelease, setLatestRelease] = useState<{ tag: string; url: string } | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      setLatestRelease(isNewer(data.tag_name, __APP_VERSION__) ? { tag: data.tag_name, url: data.html_url } : null);
    } catch (err: unknown) {
      setUpdateError(err instanceof Error ? err.message : "update check failed");
    } finally {
      setCheckingUpdate(false);
      setUpdateChecked(true);
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  // Initial load & SSE connection
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
          setBackendOnline(true);
          const data: ServerState = await res.json();
          if (data.username) setUsername(data.username);
          if (data.webhookUri) setWebhookUri(data.webhookUri);
          if (data.webhookUriChat) setWebhookUriChat(data.webhookUriChat);
          if (data.webhookUriSpotify) setWebhookUriSpotify(data.webhookUriSpotify);
          setStatus(data.status);
          setRoomId(data.roomId);
          setTiktokError(data.error || null);
          if (data.status === "error" && data.error) setErrorMsg(data.error);
          setLogs(data.logs || []);
          if (data.recentChats) setRecentChats(data.recentChats);
          if (data.songRequests) setSongRequests(data.songRequests);
          if (data.spotify) {
            setSpotify(data.spotify);
            if (data.spotify.clientId) setSpotifyClientId(data.spotify.clientId);
          }
          if (data.config?.studio) {
            setStudioScene(data.config.studio);
          }
        }
      } catch {
        try {
          const res = await fetch("/api/status");
          if (res.ok) {
            setBackendOnline(true);
            const data: ServerState = await res.json();
            if (data.username) setUsername(data.username);
            if (data.webhookUri) setWebhookUri(data.webhookUri);
            setStatus(data.status);
            setRoomId(data.roomId);
            setTiktokError(data.error || null);
            if (data.status === "error" && data.error) setErrorMsg(data.error);
            setLogs(data.logs || []);
            if (data.recentChats) setRecentChats(data.recentChats);
            if (data.songRequests) setSongRequests(data.songRequests);
            if (data.spotify) {
              setSpotify(data.spotify);
              if (data.spotify.clientId) setSpotifyClientId(data.spotify.clientId);
            }
            if (data.config?.studio) {
              setStudioScene(data.config.studio);
            }
          }
        } catch {
          // Backend might still be starting
          setBackendOnline(false);
        }
      }
    }

    fetchStatus();

    function connectSse() {
      try {
        const es = new EventSource(`${API_BASE}/api/events`);
        eventSourceRef.current = es;
        es.onopen = () => setBackendOnline(true);

        es.onmessage = (event) => {
          try {
            const data: ServerState = JSON.parse(event.data);
            setStatus(data.status);
            setRoomId(data.roomId);
            setTiktokError(data.error || null);
            setLogs(data.logs || []);
            if (data.recentChats) {
              setRecentChats(data.recentChats);
            }
            if (data.songRequests) {
              setSongRequests(data.songRequests);
            }
            if (data.spotify) {
              setSpotify(data.spotify);
            }
            if (data.config?.studio) {
              setStudioScene(data.config.studio);
            }
          } catch (e) {
            console.error("SSE parse error:", e);
          }
        };

        es.addEventListener("chat", (e: MessageEvent) => {
          try {
            const chat: TikTokChatMessage = JSON.parse(e.data);
            setRecentChats((prev) => [chat, ...prev.slice(0, 49)]);
          } catch (err) {
            console.error("Failed to parse SSE chat event:", err);
          }
        });

        es.onerror = () => {
          es.close();
          setTimeout(connectSse, 3000);
        };
      } catch (err) {
        console.error("Failed to connect SSE:", err);
      }
    }

    connectSse();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    fetchOverlays();
    fetchScreenShareStatus();
  }, []);

  useEffect(() => {
    if (backendOnline) {
      fetchScreenShareStatus();
    }
  }, [backendOnline]);

  useEffect(() => {
    if (!screenShare.running) {
      if (screenShareClientRef.current) {
        screenShareClientRef.current.stop();
        screenShareClientRef.current = null;
      }
      setScreenShareStream(null);
      return;
    }

    if (!screenShareClientRef.current) {
      const client = new ScreenShareClient(API_BASE, {
        onStatus: (nextStatus) => setScreenShare(nextStatus),
        onStream: (nextStream) => setScreenShareStream(nextStream),
        onError: (msg) => setErrorMsg(msg),
      });
      screenShareClientRef.current = client;
      client.start();
    }
  }, [screenShare.running]);

  useEffect(() => {
    return () => {
      if (screenShareClientRef.current) {
        screenShareClientRef.current.stop();
        screenShareClientRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (currentPage === "overlays" || currentPage === "studio") {
      fetchOverlays();
    }
    if (currentPage === "screen") {
      fetchScreenShareStatus();
    }
  }, [currentPage]);

  useEffect(() => {
    if (spotify.connected) {
      handleFetchDevices();
      handleFetchSongList();
    }
  }, [spotify.connected]);

  useEffect(() => {
    if (spotify.connected && spotify.currentTrack) {
      handleFetchSongList();
    }
  }, [spotify.currentTrack?.name]);

  async function handleConnect(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!username.trim()) {
      setErrorMsg(t("TikTok username is required. Configure it in Settings."));
      setCurrentPage("config");
      return;
    }
    if (!webhookUri.trim()) {
      setErrorMsg(t("Webhook URI is required. Configure it in Settings."));
      setCurrentPage("config");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setTestResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          webhookUri: webhookUri.trim(),
          webhookUriChat: webhookUriChat.trim(),
          webhookUriSpotify: webhookUriSpotify.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.error || t("Failed to start connection"));
      }
    } catch (err: any) {
      setErrorMsg(t("Backend unreachable: {err}. Ensure bridge server is running.", { err: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/disconnect`, { method: "POST" });
    } catch (err: any) {
      setErrorMsg(t("Error disconnecting: {err}", { err: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConfig(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setTestResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          webhookUri: webhookUri.trim(),
          webhookUriChat: webhookUriChat.trim(),
          webhookUriSpotify: webhookUriSpotify.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(t("Saved configuration to config.yaml"));
      } else {
        setErrorMsg(data.error || t("Failed to save configuration"));
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to save configuration: {err}", { err: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleTestWebhook() {
    if (!webhookUri.trim()) {
      setErrorMsg(t("Please enter a Webhook URI in Settings first"));
      setCurrentPage("config");
      return;
    }

    setTesting(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/test-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUri: webhookUri.trim(),
          username: "gifter_name",
          giftName: "Rose",
          coins: 20,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(t("Test webhook delivered successfully (Status {status})", { status: data.entry?.httpStatus || 200 }));
      } else {
        setErrorMsg(t("Test webhook failed: {err}", { err: data.entry?.error || data.error || t("Unknown error") }));
      }
    } catch (err: any) {
      setErrorMsg(t("Could not trigger test webhook: {err}", { err: err.message }));
    } finally {
      setTesting(false);
    }
  }

  async function handleTestSpotifyWebhook() {
    if (!webhookUri.trim()) {
      setErrorMsg(t("Please enter a Webhook URI in Settings first"));
      setCurrentPage("config");
      return;
    }

    setTestingSpotifyWebhook(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/spotify/test-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUri: webhookUri.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(
          t("Spotify webhook delivered successfully (Status {status})", { status: data.entry?.httpStatus || 200 })
        );
      } else {
        setErrorMsg(
          t("Spotify webhook dispatch failed: {err}", { err: data.entry?.error || data.error || t("Unknown error") })
        );
      }
    } catch (err: any) {
      setErrorMsg(t("Could not trigger Spotify test webhook: {err}", { err: err.message }));
    } finally {
      setTestingSpotifyWebhook(false);
    }
  }

  async function handleSaveSpotifyConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!spotifyClientId.trim()) {
      setErrorMsg(t("Spotify Client ID is required"));
      return;
    }

    setSavingSpotify(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/spotify/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: spotifyClientId.trim(),
          clientSecret: spotifyClientSecret.trim(),
        }),
      });
      const data = await res.json();
      if (data.spotify) {
        setSpotify(data.spotify);
      }
      setSavingSpotify(false);
      await openAuthorizeUrl(`${API_BASE}/api/spotify/login`);
    } catch (err: any) {
      setErrorMsg(t("Failed to save Spotify config: {err}", { err: err.message }));
      setSavingSpotify(false);
    }
  }

  async function handleRefreshSpotify() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/spotify/refresh`, { method: "POST" });
      const data = await res.json();
      if (data.spotify) {
        setSpotify(data.spotify);
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to refresh Spotify: {err}", { err: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnectSpotify() {
    try {
      await fetch(`${API_BASE}/api/spotify/disconnect`, { method: "POST" });
    } catch (err: any) {
      setErrorMsg(t("Failed to disconnect Spotify: {err}", { err: err.message }));
    }
  }

  async function handlePlayerControl(action: "play" | "pause" | "next" | "previous") {
    try {
      const res = await fetch(`${API_BASE}/api/spotify/player/${action}`, { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(t("Spotify control error: {err}", { err: data.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to send player command: {err}", { err: err.message }));
    }
  }

  async function handleFetchSongList() {
    setLoadingSongList(true);
    try {
      const res = await fetch(`${API_BASE}/api/spotify/current-song-list`);
      const data = await res.json();
      if (data.success) {
        setCurrentSongs(data.tracks || []);
        setSongListContext(data.contextName || null);
      } else if (data.error) {
        setErrorMsg(t("Song list error: {err}", { err: data.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to fetch song list: {err}", { err: err.message }));
    } finally {
      setLoadingSongList(false);
    }
  }

  async function handleFetchDevices() {
    setLoadingDevices(true);
    try {
      const res = await fetch(`${API_BASE}/api/spotify/devices`);
      const data = await res.json();
      if (data.success) {
        setDevices(data.devices || []);
      } else if (data.error) {
        setErrorMsg(t("Devices error: {err}", { err: data.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to fetch devices: {err}", { err: err.message }));
    } finally {
      setLoadingDevices(false);
    }
  }

  async function handleSelectDevice(deviceId: string) {
    if (!deviceId) return;
    try {
      const res = await fetch(`${API_BASE}/api/spotify/player/device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(t("Playback transferred to selected device"));
        setTimeout(() => {
          handleFetchDevices();
          handleFetchSongList();
        }, 600);
      } else {
        setErrorMsg(t("Device transfer error: {err}", { err: data.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to transfer playback: {err}", { err: err.message }));
    }
  }

  async function handlePlayTrack(uri: string) {
    try {
      const res = await fetch(`${API_BASE}/api/spotify/player/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [uri] }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(t("Spotify play error: {err}", { err: data.error }));
      } else {
        setTimeout(handleFetchSongList, 700);
      }
    } catch (err: any) {
      setErrorMsg(t("Failed to play track: {err}", { err: err.message }));
    }
  }

  async function fetchOverlays() {
    setLoadingOverlays(true);
    try {
      let instData: any = null;
      let mktData: any = null;

      try {
        const res = await fetch(`${API_BASE}/api/overlays`);
        if (res.ok) instData = await res.json();
      } catch {
        const res = await fetch("/api/overlays");
        if (res.ok) instData = await res.json();
      }

      try {
        const res = await fetch(`${API_BASE}/api/overlays/market`);
        if (res.ok) mktData = await res.json();
      } catch {
        const res = await fetch("/api/overlays/market");
        if (res.ok) mktData = await res.json();
      }

      if (instData?.overlays) setInstalledOverlays(instData.overlays);
      if (mktData?.catalog) setMarketCatalog(mktData.catalog);
    } catch (err: any) {
      console.error("[overlays] Fetch failed:", err.message);
    } finally {
      setLoadingOverlays(false);
    }
  }

  async function handleInstallOverlay(overlayId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/overlays/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlayId }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(t('Overlay "{name}" installed and ready for OBS!', { name: data.overlay?.name || overlayId }));
        await fetchOverlays();
      } else {
        setErrorMsg(t("Failed to install overlay: {err}", { err: data.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Error installing overlay: {err}", { err: err.message }));
    }
  }

  async function handleCreateCustomOverlay(data: any) {
    try {
      const res = await fetch(`${API_BASE}/api/overlays/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (resData.success) {
        setTestResult(t('Custom overlay "{name}" created at /overlays/{id}/', { name: data.name, id: resData.overlay?.id }));
        await fetchOverlays();
      } else {
        setErrorMsg(t("Failed to create overlay: {err}", { err: resData.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Error creating overlay: {err}", { err: err.message }));
    }
  }

  async function handleDeleteOverlay(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/overlays/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(t('Overlay "{id}" deleted.', { id }));
        await fetchOverlays();
      } else {
        setErrorMsg(t("Failed to delete overlay: {err}", { err: data.error }));
      }
    } catch (err: any) {
      setErrorMsg(t("Error deleting overlay: {err}", { err: err.message }));
    }
  }
  async function handleSaveStudio(nextScene: StudioScene) {
    try {
      const res = await fetch(`${API_BASE}/api/overlays/studio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: nextScene }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.studio) {
        throw new Error(data.error || t("Save failed ({status})", { status: res.status }));
      }
      setStudioScene(data.studio);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("Unknown error");
      setErrorMsg(t("Error saving studio layout: {err}", { err: msg }));
      throw err;
    }
  }


  async function handleSearchSpotify(query: string): Promise<SpotifySearchResult[]> {
    try {
      const res = await fetch(`${API_BASE}/api/spotify/search?q=${encodeURIComponent(query)}&limit=8`);
      if (res.ok) {
        const data = await res.json();
        return data.tracks || [];
      }
    } catch (e) {
      console.error("Spotify search error:", e);
    }
    return [];
  }

  async function handleRequestSong(queryOrUri: string, requester: string = "Streamer"): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/spotify/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryOrUri, requester }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(t('Queued "{name}" in Spotify!', { name: data.item?.trackName || queryOrUri }));
        handleFetchSongList();
        return true;
      } else {
        setErrorMsg(t("Song request failed: {err}", { err: data.error || t("Could not queue track") }));
        return false;
      }
    } catch (err: any) {
      setErrorMsg(t("Song request error: {err}", { err: err.message }));
      return false;
    }
  }

  async function handleClearSongRequests() {
    try {
      await fetch(`${API_BASE}/api/spotify/clear-requests`, { method: "POST" });
      setSongRequests([]);
    } catch (e) {
      console.error("Failed to clear song requests:", e);
    }
  }

  async function handleTestChat(comment?: string) {
    try {
      const res = await fetch(`${API_BASE}/api/tiktok/test-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment || "Hello streamer! This is a test chat message for TTS reader." }),
      });
      const data = await res.json();
      if (data.success && data.chat) {
        setRecentChats((prev) => [data.chat, ...prev.slice(0, 49)]);
      }
    } catch (err: any) {
      setErrorMsg(t("Test chat failed: {err}", { err: err.message }));
    }
  }

  async function handleClearChats() {
    try {
      await fetch(`${API_BASE}/api/tiktok/clear-chats`, { method: "POST" });
      setRecentChats([]);
    } catch (e) {
      console.error("Failed to clear chats:", e);
    }
  }

  async function fetchScreenShareStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/screen-share/status`);
      if (res.ok) {
        const data = await res.json();
        if (data?.status) setScreenShare(data.status);
      }
    } catch {}
  }

  async function handleStartScreenShare(port: number) {
    setScreenShareBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/screen-share/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const data = await res.json();
      if (res.status === 404) {
        setErrorMsg(t("Outdated backend running on port 3001 — stop the old backend process and restart."));
      } else if (data.success && data.status) {
        setScreenShare(data.status);
      } else {
        setErrorMsg(data.error || t("Failed to start WHIP receiver"));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("Failed to start WHIP receiver"));
    } finally {
      setScreenShareBusy(false);
    }
  }

  async function handleStopScreenShare() {
    setScreenShareBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/screen-share/stop`, { method: "POST" });
      const data = await res.json();
      if (data.success && data.status) {
        setScreenShare(data.status);
        setScreenShareStream(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("Failed to stop WHIP receiver"));
    } finally {
      setScreenShareBusy(false);
    }
  }

  async function handleRegenerateScreenShareToken() {
    setScreenShareBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/screen-share/regenerate-token`, { method: "POST" });
      const data = await res.json();
      if (data.success && data.status) {
        setScreenShare(data.status);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("Failed to regenerate token"));
    } finally {
      setScreenShareBusy(false);
    }
  }

  async function handleDisconnectScreenShare() {
    setScreenShareBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/screen-share/disconnect`, { method: "POST" });
      const data = await res.json();
      if (data.success && data.status) {
        setScreenShare(data.status);
        setScreenShareStream(null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("Failed to disconnect stream"));
    } finally {
      setScreenShareBusy(false);
    }
  }

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        currentPage={currentPage}
        onSelectPage={setCurrentPage}
        status={status}
        roomId={roomId}
        spotify={spotify}
        track={spotify.currentTrack}
        screenShare={screenShare}
        backendOnline={backendOnline}
      />

      {/* Main Page Content */}
      <main className="app-content">
        {/* Global Alerts */}
        {errorMsg && (
          <div className="alert-banner">
            <span>[!]</span>
            <span>{errorMsg}</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px", marginLeft: "auto" }}
              onClick={() => setErrorMsg(null)}
            >
              {t("DISMISS")}
            </button>
          </div>
        )}

        {testResult && (
          <div className="alert-banner success">
            <span>[OK]</span>
            <span>{testResult}</span>
          </div>
        )}

        {latestRelease && !dismissedUpdate && (
          <div className="alert-banner info">
            <span>[UPDATE]</span>
            <span>
              {t("{tag} is available (you have {v})", { tag: latestRelease.tag, v: __APP_VERSION__ })}{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  (async () => {
                    try {
                      const { openUrl } = await import("@tauri-apps/plugin-opener");
                      await openUrl(latestRelease.url);
                    } catch {
                      window.open(latestRelease.url, "_blank", "noopener");
                    }
                  })();
                }}
              >
                {t("download")}
              </a>
            </span>
            <button type="button" onClick={() => setDismissedUpdate(true)}>
              {t("DISMISS")}
            </button>
          </div>
        )}

        {currentPage === "about" ? (
          <AboutTab
            updateChecked={updateChecked}
            checkingUpdate={checkingUpdate}
            updateError={updateError}
            latestRelease={latestRelease}
            onCheckUpdate={checkForUpdate}
          />
        ) : currentPage === "dashboard" ? (
          <DashboardTab
            username={username}
            webhookUri={webhookUri}
            status={status}
            tiktokError={tiktokError}
            loading={loading}
            testing={testing}
            spotify={spotify}
            logs={logs}
            currentSongs={currentSongs}
            songListContext={songListContext}
            loadingSongList={loadingSongList}
            devices={devices}
            loadingDevices={loadingDevices}
            recentChats={recentChats}
            songRequests={songRequests}
            onConnect={() => handleConnect()}
            onDisconnect={handleDisconnect}
            onTestWebhook={handleTestWebhook}
            onTestSpotifyWebhook={handleTestSpotifyWebhook}
            testingSpotifyWebhook={testingSpotifyWebhook}
            onClearLogs={() => setLogs([])}
            onRefreshSpotify={handleRefreshSpotify}
            onPlayerControl={handlePlayerControl}
            onFetchSongList={handleFetchSongList}
            onPlayTrack={handlePlayTrack}
            onFetchDevices={handleFetchDevices}
            onSelectDevice={handleSelectDevice}
            onSearchSpotify={handleSearchSpotify}
            onRequestSong={handleRequestSong}
            onClearSongRequests={handleClearSongRequests}
            onTestChat={handleTestChat}
            onClearChats={handleClearChats}
            onGoToConfig={() => setCurrentPage("config")}
          />
        ) : currentPage === "config" ? (
          <ConfigTab
            username={username}
            setUsername={setUsername}
            webhookUri={webhookUri}
            setWebhookUri={setWebhookUri}
            webhookUriChat={webhookUriChat}
            setWebhookUriChat={setWebhookUriChat}
            webhookUriSpotify={webhookUriSpotify}
            setWebhookUriSpotify={setWebhookUriSpotify}
            status={status}
            loading={loading}
            testing={testing}
            spotify={spotify}
            spotifyClientId={spotifyClientId}
            setSpotifyClientId={setSpotifyClientId}
            spotifyClientSecret={spotifyClientSecret}
            setSpotifyClientSecret={setSpotifyClientSecret}
            savingSpotify={savingSpotify}
            onSaveConfig={handleSaveConfig}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onTestWebhook={handleTestWebhook}
            onTestSpotifyWebhook={handleTestSpotifyWebhook}
            testingSpotifyWebhook={testingSpotifyWebhook}
            onSaveSpotifyConfig={handleSaveSpotifyConfig}
            onRefreshSpotify={handleRefreshSpotify}
            onDisconnectSpotify={handleDisconnectSpotify}
          />
        ) : currentPage === "studio" ? (
          <StudioTab
            apiBase={API_BASE}
            installedOverlays={installedOverlays}
            studio={studioScene}
            onSaveStudio={handleSaveStudio}
            onGoToMarket={() => setCurrentPage("overlays")}
          />
        ) : currentPage === "screen" ? (
          <ScreenShareTab
            apiBase={API_BASE}
            status={screenShare}
            stream={screenShareStream}
            busy={screenShareBusy}
            onStart={handleStartScreenShare}
            onStop={handleStopScreenShare}
            onRegenerateToken={handleRegenerateScreenShareToken}
            onDisconnectStream={handleDisconnectScreenShare}
            onVideoDimensions={(w, h) => screenShareClientRef.current?.reportVideoDimensions(w, h)}
          />
        ) : (
          <OverlaysTab
            apiBase={API_BASE}
            installedOverlays={installedOverlays}
            marketCatalog={marketCatalog}
            loading={loadingOverlays}
            onRefresh={fetchOverlays}
            onInstall={handleInstallOverlay}
            onCreateCustom={handleCreateCustomOverlay}
            onDeleteOverlay={handleDeleteOverlay}
            onOpenStudio={() => setCurrentPage("studio")}
          />
        )}
      </main>
    </div>
  );
}
