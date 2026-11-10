import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import {
  CurrentSongItem,
  LogEntry,
  OverlayMarketItem,
  OverlayMeta,
  ServerState,
  SongRequestItem,
  SpotifyDevice,
  SpotifyInfo,
  SpotifySearchResult,
  TikTokChatMessage,
} from "./types";
import { Sidebar } from "./components/Sidebar";
import { DashboardTab } from "./components/DashboardTab";
import { ConfigTab } from "./components/ConfigTab";
import { OverlaysTab } from "./components/OverlaysTab";

const API_BASE = "http://127.0.0.1:3001";

async function openAuthorizeUrl(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "width=600,height=700");
  }
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<"dashboard" | "config" | "overlays">("dashboard");

  // TikTok & Webhook state
  const [username, setUsername] = useState("");
  const [webhookUri, setWebhookUri] = useState("");
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [roomId, setRoomId] = useState<string | null>(null);
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

  const eventSourceRef = useRef<EventSource | null>(null);

  // Initial load & SSE connection
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
          const data: ServerState = await res.json();
          if (data.username) setUsername(data.username);
          if (data.webhookUri) setWebhookUri(data.webhookUri);
          setStatus(data.status);
          setRoomId(data.roomId);
          if (data.error) setErrorMsg(data.error);
          setLogs(data.logs || []);
          if (data.recentChats) setRecentChats(data.recentChats);
          if (data.songRequests) setSongRequests(data.songRequests);
          if (data.spotify) {
            setSpotify(data.spotify);
            if (data.spotify.clientId) setSpotifyClientId(data.spotify.clientId);
          }
        }
      } catch {
        try {
          const res = await fetch("/api/status");
          if (res.ok) {
            const data: ServerState = await res.json();
            if (data.username) setUsername(data.username);
            if (data.webhookUri) setWebhookUri(data.webhookUri);
            setStatus(data.status);
            setRoomId(data.roomId);
            if (data.error) setErrorMsg(data.error);
            setLogs(data.logs || []);
            if (data.recentChats) setRecentChats(data.recentChats);
            if (data.songRequests) setSongRequests(data.songRequests);
            if (data.spotify) {
              setSpotify(data.spotify);
              if (data.spotify.clientId) setSpotifyClientId(data.spotify.clientId);
            }
          }
        } catch {
          // Backend might still be starting
        }
      }
    }

    fetchStatus();

    function connectSse() {
      try {
        const es = new EventSource(`${API_BASE}/api/events`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            const data: ServerState = JSON.parse(event.data);
            setStatus(data.status);
            setRoomId(data.roomId);
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
  }, []);

  useEffect(() => {
    if (currentPage === "overlays") {
      fetchOverlays();
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
      setErrorMsg("TikTok username is required. Configure it in Settings.");
      setCurrentPage("config");
      return;
    }
    if (!webhookUri.trim()) {
      setErrorMsg("Webhook URI is required. Configure it in Settings.");
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
        body: JSON.stringify({ username: username.trim(), webhookUri: webhookUri.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.error || "Failed to start connection");
      }
    } catch (err: any) {
      setErrorMsg(`Backend unreachable: ${err.message}. Ensure bridge server is running.`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/disconnect`, { method: "POST" });
    } catch (err: any) {
      setErrorMsg(`Error disconnecting: ${err.message}`);
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult("Saved configuration to config.yaml");
      } else {
        setErrorMsg(data.error || "Failed to save configuration");
      }
    } catch (err: any) {
      setErrorMsg(`Failed to save configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleTestWebhook() {
    if (!webhookUri.trim()) {
      setErrorMsg("Please enter a Webhook URI in Settings first");
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
        setTestResult(`Test webhook delivered successfully (Status ${data.entry?.httpStatus || 200})`);
      } else {
        setErrorMsg(`Test webhook failed: ${data.entry?.error || data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setErrorMsg(`Could not trigger test webhook: ${err.message}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleTestSpotifyWebhook() {
    if (!webhookUri.trim()) {
      setErrorMsg("Please enter a Webhook URI in Settings first");
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
          `Spotify webhook delivered successfully (Status ${data.entry?.httpStatus || 200})`
        );
      } else {
        setErrorMsg(
          `Spotify webhook dispatch failed: ${data.entry?.error || data.error || "Unknown error"}`
        );
      }
    } catch (err: any) {
      setErrorMsg(`Could not trigger Spotify test webhook: ${err.message}`);
    } finally {
      setTestingSpotifyWebhook(false);
    }
  }

  async function handleSaveSpotifyConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!spotifyClientId.trim()) {
      setErrorMsg("Spotify Client ID is required");
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
      setErrorMsg(`Failed to save Spotify config: ${err.message}`);
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
      setErrorMsg(`Failed to refresh Spotify: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnectSpotify() {
    try {
      await fetch(`${API_BASE}/api/spotify/disconnect`, { method: "POST" });
    } catch (err: any) {
      setErrorMsg(`Failed to disconnect Spotify: ${err.message}`);
    }
  }

  async function handlePlayerControl(action: "play" | "pause" | "next" | "previous") {
    try {
      const res = await fetch(`${API_BASE}/api/spotify/player/${action}`, { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(`Spotify control error: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to send player command: ${err.message}`);
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
        setErrorMsg(`Song list error: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to fetch song list: ${err.message}`);
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
        setErrorMsg(`Devices error: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to fetch devices: ${err.message}`);
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
        setTestResult("Playback transferred to selected device");
        setTimeout(() => {
          handleFetchDevices();
          handleFetchSongList();
        }, 600);
      } else {
        setErrorMsg(`Device transfer error: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to transfer playback: ${err.message}`);
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
        setErrorMsg(`Spotify play error: ${data.error}`);
      } else {
        setTimeout(handleFetchSongList, 700);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to play track: ${err.message}`);
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
        setTestResult(`Overlay "${data.overlay?.name || overlayId}" installed and ready for OBS!`);
        await fetchOverlays();
      } else {
        setErrorMsg(`Failed to install overlay: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Error installing overlay: ${err.message}`);
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
        setTestResult(`Custom overlay "${data.name}" created at /overlays/${resData.overlay?.id}/`);
        await fetchOverlays();
      } else {
        setErrorMsg(`Failed to create overlay: ${resData.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Error creating overlay: ${err.message}`);
    }
  }

  async function handleDeleteOverlay(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/overlays/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(`Overlay "${id}" deleted.`);
        await fetchOverlays();
      } else {
        setErrorMsg(`Failed to delete overlay: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Error deleting overlay: ${err.message}`);
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
        setTestResult(`Queued "${data.item?.trackName || queryOrUri}" in Spotify!`);
        handleFetchSongList();
        return true;
      } else {
        setErrorMsg(`Song request failed: ${data.error || "Could not queue track"}`);
        return false;
      }
    } catch (err: any) {
      setErrorMsg(`Song request error: ${err.message}`);
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
      setErrorMsg(`Test chat failed: ${err.message}`);
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
              DISMISS
            </button>
          </div>
        )}

        {testResult && (
          <div className="alert-banner success">
            <span>[OK]</span>
            <span>{testResult}</span>
          </div>
        )}

        {currentPage === "dashboard" ? (
          <DashboardTab
            username={username}
            webhookUri={webhookUri}
            status={status}
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
          />
        )}
      </main>
    </div>
  );
}
