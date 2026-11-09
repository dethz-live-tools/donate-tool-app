import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import { LogEntry, ServerState, SpotifyInfo, SpotifyPlaylist } from "./types";
import { Sidebar } from "./components/Sidebar";
import { DashboardTab } from "./components/DashboardTab";
import { ConfigTab } from "./components/ConfigTab";

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
  const [currentPage, setCurrentPage] = useState<"dashboard" | "config">("dashboard");

  // TikTok & Webhook state
  const [username, setUsername] = useState("");
  const [webhookUri, setWebhookUri] = useState("");
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
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
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

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
            if (data.spotify) {
              setSpotify(data.spotify);
            }
          } catch (e) {
            console.error("SSE parse error:", e);
          }
        };

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

  async function handleFetchPlaylists() {
    setLoadingPlaylists(true);
    try {
      const res = await fetch(`${API_BASE}/api/spotify/playlists`);
      const data = await res.json();
      if (data.success) {
        setPlaylists(data.playlists || []);
      } else if (data.error) {
        setErrorMsg(`Playlists error: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to fetch playlists: ${err.message}`);
    } finally {
      setLoadingPlaylists(false);
    }
  }

  async function handlePlayPlaylist(uri: string) {
    try {
      const res = await fetch(`${API_BASE}/api/spotify/player/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context_uri: uri }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(`Spotify play error: ${data.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to play playlist: ${err.message}`);
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
            playlists={playlists}
            loadingPlaylists={loadingPlaylists}
            onConnect={() => handleConnect()}
            onDisconnect={handleDisconnect}
            onTestWebhook={handleTestWebhook}
            onClearLogs={() => setLogs([])}
            onRefreshSpotify={handleRefreshSpotify}
            onPlayerControl={handlePlayerControl}
            onFetchPlaylists={handleFetchPlaylists}
            onPlayPlaylist={handlePlayPlaylist}
            onGoToConfig={() => setCurrentPage("config")}
          />
        ) : (
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
            onSaveSpotifyConfig={handleSaveSpotifyConfig}
            onRefreshSpotify={handleRefreshSpotify}
            onDisconnectSpotify={handleDisconnectSpotify}
          />
        )}
      </main>
    </div>
  );
}
