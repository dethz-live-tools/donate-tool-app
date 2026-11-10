import React from "react";
import {
  CurrentSongItem,
  LogEntry,
  SongRequestItem,
  SpotifyDevice,
  SpotifyInfo,
  SpotifySearchResult,
  TikTokChatMessage,
} from "../types";

interface DashboardTabProps {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  loading: boolean;
  testing: boolean;
  spotify: SpotifyInfo;
  logs: LogEntry[];
  currentSongs?: CurrentSongItem[];
  songListContext?: string | null;
  loadingSongList?: boolean;
  devices?: SpotifyDevice[];
  loadingDevices?: boolean;
  recentChats?: TikTokChatMessage[];
  songRequests?: SongRequestItem[];
  onConnect: () => void;
  onDisconnect: () => void;
  onTestWebhook: () => void;
  onTestSpotifyWebhook?: () => void;
  testingSpotifyWebhook?: boolean;
  onClearLogs: () => void;
  onRefreshSpotify: () => void;
  onPlayerControl: (action: "play" | "pause" | "next" | "previous") => void;
  onFetchSongList?: () => void;
  onPlayTrack?: (uri: string) => void;
  onFetchDevices?: () => void;
  onSelectDevice?: (deviceId: string) => void;
  onSearchSpotify?: (query: string) => Promise<SpotifySearchResult[]>;
  onRequestSong?: (queryOrUri: string, requester?: string) => Promise<boolean>;
  onClearSongRequests?: () => void;
  onTestChat?: (comment?: string) => void;
  onClearChats?: () => void;
  onGoToConfig: () => void;
}

function formatMs(ms: number): string {
  if (!ms || isNaN(ms)) return "0:00";
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  username,
  webhookUri,
  status,
  loading,
  testing,
  spotify,
  logs,
  currentSongs = [],
  songListContext = null,
  loadingSongList = false,
  devices = [],
  loadingDevices = false,
  recentChats = [],
  songRequests = [],
  onConnect,
  onDisconnect,
  onTestWebhook,
  onTestSpotifyWebhook,
  testingSpotifyWebhook = false,
  onClearLogs,
  onRefreshSpotify,
  onPlayerControl,
  onFetchSongList,
  onPlayTrack,
  onFetchDevices,
  onSelectDevice,
  onSearchSpotify,
  onRequestSong,
  onClearSongRequests,
  onTestChat,
  onClearChats,
  onGoToConfig,
}) => {
  // Panel minimization state (persisted in localStorage)
  const [minimized, setMinimized] = React.useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("donate_socket_minimized_boxes");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleBox = (boxId: string) => {
    setMinimized((prev) => {
      const updated = { ...prev, [boxId]: !prev[boxId] };
      try {
        localStorage.setItem("donate_socket_minimized_boxes", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const expandAll = () => {
    setMinimized({});
    try {
      localStorage.setItem("donate_socket_minimized_boxes", JSON.stringify({}));
    } catch {}
  };

  const minimizeAll = () => {
    const all = {
      stream: true,
      spotify: true,
      songRequest: true,
      chatTts: true,
      payload: true,
      logs: true,
    };
    setMinimized(all);
    try {
      localStorage.setItem("donate_socket_minimized_boxes", JSON.stringify(all));
    } catch {}
  };

  const minimizedCount = Object.values(minimized).filter(Boolean).length;

  // Spotify Song Request state
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<SpotifySearchResult[]>([]);
  const [requestingTrack, setRequestingTrack] = React.useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim() || !onSearchSpotify) return;
    setSearching(true);
    try {
      const results = await onSearchSpotify(searchQuery.trim());
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const handleQueueTrack = async (uri: string, _name?: string) => {
    if (!onRequestSong) return;
    setRequestingTrack(uri);
    try {
      await onRequestSong(uri, "Streamer");
    } finally {
      setRequestingTrack(null);
    }
  };

  const handleDirectQueue = async () => {
    if (!searchQuery.trim() || !onRequestSong) return;
    setRequestingTrack(searchQuery.trim());
    try {
      await onRequestSong(searchQuery.trim(), "Streamer");
      setSearchQuery("");
      setSearchResults([]);
    } finally {
      setRequestingTrack(null);
    }
  };

  // TikTok Chat Reader & TTS state (persisted in localStorage)
  const [ttsEnabled, setTtsEnabled] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("donate_socket_tts_enabled") === "true";
    } catch {
      return false;
    }
  });
  const [ttsVoice, setTtsVoice] = React.useState<string>(() => {
    try {
      return localStorage.getItem("donate_socket_tts_voice") || "";
    } catch {
      return "";
    }
  });
  const [ttsVolume, setTtsVolume] = React.useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("donate_socket_tts_vol"));
      return isNaN(v) || v <= 0 ? 1 : v;
    } catch {
      return 1;
    }
  });
  const [ttsRate, setTtsRate] = React.useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("donate_socket_tts_rate"));
      return isNaN(v) || v <= 0 ? 1 : v;
    } catch {
      return 1;
    }
  });
  const [ttsPitch, setTtsPitch] = React.useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("donate_socket_tts_pitch"));
      return isNaN(v) || v <= 0 ? 1 : v;
    } catch {
      return 1;
    }
  });
  const [ttsTemplate, setTtsTemplate] = React.useState<string>(() => {
    try {
      return localStorage.getItem("donate_socket_tts_template") || "{nickname} says {comment}";
    } catch {
      return "{nickname} says {comment}";
    }
  });
  const [ignoreBotCommands, setIgnoreBotCommands] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("donate_socket_tts_ignore_cmd") !== "false";
    } catch {
      return true;
    }
  });
  const [showTtsSettings, setShowTtsSettings] = React.useState<boolean>(false);
  const [availableVoices, setAvailableVoices] = React.useState<SpeechSynthesisVoice[]>([]);

  // Load available system voices
  React.useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) {
        setAvailableVoices(voices);
        if (!ttsVoice && voices.length) {
          // Default to first local voice or system default
          const def = voices.find((v) => v.default) || voices[0];
          setTtsVoice(def.name);
        }
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [ttsVoice]);

  const speakMessage = React.useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.volume = Math.max(0, Math.min(1, ttsVolume));
        utterance.rate = Math.max(0.1, Math.min(2, ttsRate));
        utterance.pitch = Math.max(0, Math.min(2, ttsPitch));
        if (ttsVoice && availableVoices.length) {
          const found = availableVoices.find((v) => v.name === ttsVoice);
          if (found) utterance.voice = found;
        }
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.error("TTS speak error:", e);
      }
    },
    [ttsVolume, ttsRate, ttsPitch, ttsVoice, availableVoices]
  );

  // Auto-speak incoming TikTok chats in real time
  const lastSpokenChatIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!recentChats.length) return;
    if (!ttsEnabled) {
      lastSpokenChatIdRef.current = recentChats[0].id;
      return;
    }

    if (!lastSpokenChatIdRef.current) {
      const latest = recentChats[0];
      lastSpokenChatIdRef.current = latest.id;
      if (ignoreBotCommands && latest.comment.startsWith("!")) return;
      const text = ttsTemplate
        .replace("{nickname}", latest.nickname || latest.uniqueId)
        .replace("{username}", latest.uniqueId)
        .replace("{comment}", latest.comment);
      speakMessage(text);
      return;
    }

    const newChats: TikTokChatMessage[] = [];
    for (const c of recentChats) {
      if (c.id === lastSpokenChatIdRef.current) break;
      newChats.push(c);
    }

    if (newChats.length > 0) {
      lastSpokenChatIdRef.current = recentChats[0].id;
      // Play oldest to newest
      for (const c of newChats.reverse()) {
        if (ignoreBotCommands && c.comment.startsWith("!")) continue;
        const text = ttsTemplate
          .replace("{nickname}", c.nickname || c.uniqueId)
          .replace("{username}", c.uniqueId)
          .replace("{comment}", c.comment);
        speakMessage(text);
      }
    }
  }, [recentChats, ttsEnabled, ttsTemplate, ignoreBotCommands, speakMessage]);

  const toggleTts = () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    try {
      localStorage.setItem("donate_socket_tts_enabled", String(next));
    } catch {}
    if (next) {
      speakMessage("TikTok Chat Reader activated");
    } else {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    }
  };

  const stopTtsSpeech = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const [payloadSpecTab, setPayloadSpecTab] = React.useState<"tiktok" | "spotify">("tiktok");
  const track = spotify.currentTrack;
  const progressPercent =
    track && track.durationMs > 0
      ? Math.min(100, Math.max(0, (track.progressMs / track.durationMs) * 100))
      : 0;

  return (
    <>
      {/* Dashboard Panels Toolbar */}
      <div className="dashboard-toolbar">
        <span className="dashboard-toolbar-title">
          DASHBOARD PANELS // 6 TOTAL {minimizedCount > 0 ? `(${minimizedCount} MINIMIZED)` : "(ALL EXPANDED)"}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "3px 10px", fontSize: "11px" }}
            onClick={expandAll}
            disabled={minimizedCount === 0}
          >
            [+] EXPAND ALL
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "3px 10px", fontSize: "11px" }}
            onClick={minimizeAll}
            disabled={minimizedCount === 6}
          >
            [_] MINIMIZE ALL
          </button>
        </div>
      </div>

      {/* Box 1: Stream Controls */}
      <section className="raw-card">
        <div className="card-title">
          <div className="card-title-left">
            <h2>STREAM CONTROLS</h2>
            {minimized.stream ? (
              <span className="minimized-summary">
                @{username || "NONE"} • {status.toUpperCase()}
              </span>
            ) : (
              <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
                TARGET: {username ? `@${username}` : "(NOT CONFIGURED)"}
              </span>
            )}
          </div>
          <div className="card-title-actions">
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px" }}
              onClick={() => toggleBox("stream")}
              title={minimized.stream ? "Expand stream controls" : "Minimize box"}
            >
              {minimized.stream ? "[ + ] EXPAND" : "[ _ ] MINIMIZE"}
            </button>
          </div>
        </div>

        {!minimized.stream && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <p style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                {status === "connected"
                  ? `Connected to stream @${username}`
                  : status === "connecting"
                  ? `Connecting to @${username}...`
                  : username
                  ? `Ready to connect to @${username}`
                  : "No streamer configured. Go to Configuration page to set username."}
              </p>
              {webhookUri && (
                <p className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)", marginTop: "4px" }}>
                  Webhook: {webhookUri}
                </p>
              )}
            </div>

            <div className="btn-row" style={{ marginTop: 0 }}>
              {status === "connected" || status === "connecting" ? (
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={onDisconnect}
                  disabled={loading}
                >
                  DISCONNECT
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onConnect}
                  disabled={loading}
                >
                  {loading ? "CONNECTING..." : "CONNECT LIVE"}
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={onTestWebhook}
                disabled={testing || !webhookUri.trim()}
              >
                {testing ? "SENDING..." : "TEST WEBHOOK"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Box 2: Spotify Now Playing Display */}
      <section className="raw-card elevated">
        <div className="card-title">
          <div className="card-title-left">
            <h2>NOW PLAYING // SPOTIFY</h2>
            {minimized.spotify ? (
              <span className="minimized-summary">
                {track
                  ? `▶ ${track.name} - ${track.artist} [${track.isPlaying ? "PLAYING" : "PAUSED"}]`
                  : `SPOTIFY: ${spotify.connected ? "CONNECTED (NO PLAYBACK)" : "OFFLINE"}`}
              </span>
            ) : null}
          </div>
          <div className="card-title-actions">
            {!minimized.spotify && spotify.connected && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "11px" }}
                onClick={onRefreshSpotify}
                disabled={loading}
              >
                REFRESH
              </button>
            )}
            <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-lavender)" }}>
              {spotify.error
                ? "ERROR"
                : spotify.connected
                ? track?.isPlaying
                  ? "ACTIVE"
                  : "PAUSED"
                : "DISCONNECTED"}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px" }}
              onClick={() => toggleBox("spotify")}
              title={minimized.spotify ? "Expand Spotify player" : "Minimize box"}
            >
              {minimized.spotify ? "[ + ] EXPAND" : "[ _ ] MINIMIZE"}
            </button>
          </div>
        </div>

        {!minimized.spotify && (
          <>
            {spotify.error && (
              <div className="alert-banner">
                <span>[!]</span>
                <span>SPOTIFY: {spotify.error}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "2px 8px", fontSize: "11px", marginLeft: "auto" }}
                  onClick={onRefreshSpotify}
                >
                  RETRY
                </button>
              </div>
            )}

            {/* Player / Device Selector */}
            {spotify.connected && (
              <div className="spotify-player-selector-row">
                <div className="player-selector-label">
                  <span className="mono-font" style={{ fontSize: "11px", fontWeight: "bold" }}>
                    PLAYER:
                  </span>
                  <select
                    className="player-select-dropdown"
                    value={spotify.activeDevice?.id || ""}
                    onChange={(e) => onSelectDevice?.(e.target.value)}
                    disabled={loadingDevices || !devices.length}
                  >
                    {devices.length === 0 ? (
                      <option value="">
                        {spotify.activeDevice?.name
                          ? `${spotify.activeDevice.name} (${spotify.activeDevice.type})`
                          : "No active Spotify player"}
                      </option>
                    ) : (
                      devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.isActive ? "▶ " : ""}
                          {d.name} ({d.type}) {d.isActive ? "• ACTIVE" : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                {onFetchDevices && (
                  <button
                    type="button"
                    className="ctrl-btn"
                    style={{ padding: "4px 8px", fontSize: "10px" }}
                    onClick={onFetchDevices}
                    disabled={loadingDevices}
                    title="Refresh available Spotify devices"
                  >
                    {loadingDevices ? "..." : "🔄 DEVICES"}
                  </button>
                )}
              </div>
            )}

            {spotify.connected && track ? (
              <div className="spotify-display">
                {track.albumArt ? (
                  <img
                    src={track.albumArt}
                    alt={track.album || "Album Art"}
                    className="spotify-art"
                  />
                ) : (
                  <div className="spotify-art">NO ART</div>
                )}

                <div className="spotify-info">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="spotify-track-title">{track.name}</span>
                    <span
                      className="mono-font"
                      style={{
                        fontSize: "11px",
                        color: track.isPlaying ? "var(--status-success)" : "var(--status-warning)",
                        fontWeight: "bold",
                      }}
                    >
                      {track.isPlaying ? "▶ PLAYING" : "❚❚ PAUSED"}
                    </span>
                  </div>

                  <span className="spotify-artist">{track.artist}</span>
                  {track.album && <span className="spotify-album">{track.album}</span>}
                  {track.playlistName && (
                    <div className="spotify-playlist-tag">
                      <span>▶ PLAYLIST:</span>
                      <span>{track.playlistName}</span>
                    </div>
                  )}

                  <div className="spotify-progress-wrap">
                    <div className="spotify-progress-bar">
                      <div
                        className="spotify-progress-fill"
                        style={{ width: `${progressPercent}%` }}
                      ></div>
                    </div>
                    <div className="spotify-time-row">
                      <span>{formatMs(track.progressMs)}</span>
                      <span>{formatMs(track.durationMs)}</span>
                    </div>
                  </div>

                  {/* Player Controls */}
                  <div className="spotify-controls">
                    <button
                      type="button"
                      className="ctrl-btn"
                      onClick={() => onPlayerControl("previous")}
                      title="Previous Track"
                    >
                      |◀ PREV
                    </button>
                    <button
                      type="button"
                      className="ctrl-btn"
                      style={{
                        backgroundColor: track.isPlaying ? "var(--status-warning)" : "var(--accent-primary)",
                        color: "var(--accent-contrast)",
                      }}
                      onClick={() => onPlayerControl(track.isPlaying ? "pause" : "play")}
                    >
                      {track.isPlaying ? "❚❚ PAUSE" : "▶ PLAY"}
                    </button>
                    <button
                      type="button"
                      className="ctrl-btn"
                      onClick={() => onPlayerControl("next")}
                      title="Next Track"
                    >
                      NEXT ▶|
                    </button>
                    {onTestSpotifyWebhook && (
                      <button
                        type="button"
                        className="ctrl-btn"
                        onClick={onTestSpotifyWebhook}
                        disabled={testingSpotifyWebhook || !webhookUri.trim()}
                        title="Send current Spotify playback status to webhook"
                        style={{ marginLeft: "auto", fontSize: "11px" }}
                      >
                        {testingSpotifyWebhook ? "DISPATCHING..." : "📡 WEBHOOK TEST"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : spotify.connected ? (
              <div className="empty-state">
                [ SPOTIFY CONNECTED // NO ACTIVE PLAYBACK ]
                <br />
                Play music on Spotify desktop, web, or mobile app to view live track data.
                {onTestSpotifyWebhook && webhookUri.trim() && (
                  <div style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "4px 12px", fontSize: "11px" }}
                      onClick={onTestSpotifyWebhook}
                      disabled={testingSpotifyWebhook}
                    >
                      {testingSpotifyWebhook ? "SENDING..." : "📡 TEST SPOTIFY WEBHOOK"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">
                [ SPOTIFY NOT CONNECTED ]
                <br />
                Go to{" "}
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--ctp-blue)",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                  }}
                  onClick={onGoToConfig}
                >
                  Configuration
                </button>{" "}
                to connect your Spotify account.
              </div>
            )}

            {/* Current Playing Song List / Queue */}
            {spotify.connected && (
              <div className="spotify-playlist-section">
                <div className="spotify-playlist-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span className="mono-font" style={{ fontSize: "12px", fontWeight: "bold" }}>
                      CURRENT PLAYING SONG LIST ({currentSongs.length})
                    </span>
                    {songListContext && (
                      <span className="spotify-playlist-tag" style={{ fontSize: "10px" }}>
                        ▶ {songListContext}
                      </span>
                    )}
                  </div>
                  {onFetchSongList && (
                    <button
                      type="button"
                      className="ctrl-btn"
                      onClick={onFetchSongList}
                      disabled={loadingSongList}
                    >
                      {loadingSongList
                        ? "FETCHING..."
                        : currentSongs.length
                        ? "REFRESH QUEUE"
                        : "LOAD SONG LIST"}
                    </button>
                  )}
                </div>

                {currentSongs.length > 0 ? (
                  <div className="spotify-song-list">
                    {currentSongs.map((s, idx) => (
                      <div
                        key={`${s.id}-${idx}`}
                        className={`spotify-song-card ${s.isPlaying ? "is-playing" : ""}`}
                      >
                        <span className="spotify-song-index">#{idx + 1}</span>
                        {s.albumArt ? (
                          <img src={s.albumArt} alt={s.name} className="spotify-song-cover" />
                        ) : (
                          <div className="spotify-song-cover">NO ART</div>
                        )}
                        <div className="spotify-song-meta">
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span className="spotify-song-title" title={s.name}>
                              {s.name}
                            </span>
                            {s.isPlaying && (
                              <span className="spotify-now-playing-chip">▶ NOW PLAYING</span>
                            )}
                          </div>
                          <span className="spotify-song-artist">
                            {s.artist} {s.album ? `• ${s.album}` : ""}
                          </span>
                        </div>
                        <span className="spotify-song-duration">{formatMs(s.durationMs)}</span>
                        {onPlayTrack && (
                          <button
                            type="button"
                            className="ctrl-btn"
                            style={{
                              padding: "3px 8px",
                              fontSize: "10px",
                              backgroundColor: s.isPlaying ? "var(--status-success)" : undefined,
                              color: s.isPlaying ? "var(--ctp-crust)" : undefined,
                            }}
                            onClick={() => onPlayTrack(s.uri)}
                            title={`Play ${s.name}`}
                          >
                            {s.isPlaying ? "▶ PLAYING" : "▶ PLAY"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: "12px" }}>
                    [ NO SONGS IN QUEUE // CLICK LOAD SONG LIST TO REFRESH ]
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Box 3: Spotify Song Request Box */}
      <section className="raw-card">
        <div className="card-title">
          <div className="card-title-left">
            <h2>SPOTIFY SONG REQUEST</h2>
            {minimized.songRequest ? (
              <span className="minimized-summary">
                {songRequests.length} REQUESTS • {spotify.connected ? "ACTIVE" : "OFFLINE"}
              </span>
            ) : (
              <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-sapphire)" }}>
                QUEUE & TIKTOK CHAT INTEGRATION
              </span>
            )}
          </div>
          <div className="card-title-actions">
            {!minimized.songRequest && songRequests.length > 0 && onClearSongRequests && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "2px 8px", fontSize: "11px" }}
                onClick={onClearSongRequests}
              >
                CLEAR HISTORY
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px" }}
              onClick={() => toggleBox("songRequest")}
              title={minimized.songRequest ? "Expand Song Request box" : "Minimize box"}
            >
              {minimized.songRequest ? "[ + ] EXPAND" : "[ _ ] MINIMIZE"}
            </button>
          </div>
        </div>

        {!minimized.songRequest && (
          <>
            {/* Auto-Queue Banner */}
            <div className="auto-queue-banner">
              <span className="auto-queue-badge">⚡ AUTO-QUEUE ACTIVE</span>
              <span>
                Viewers can request songs live in TikTok chat via:{" "}
                <code className="mono-font" style={{ color: "var(--ctp-sapphire)", fontWeight: "bold" }}>
                  !sr [Song Name or Spotify URL]
                </code>
              </span>
            </div>

            {/* Song Request Search / Input Form */}
            <form onSubmit={handleSearch} className="song-request-search-row">
              <input
                type="text"
                className="song-request-input"
                placeholder="Search Spotify track or paste Spotify URL / URI (e.g. spotify:track:...)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: "6px 14px", fontSize: "12px" }}
                disabled={searching || !searchQuery.trim() || !spotify.connected}
              >
                {searching ? "SEARCHING..." : "SEARCH"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 14px", fontSize: "12px" }}
                onClick={handleDirectQueue}
                disabled={Boolean(requestingTrack) || !searchQuery.trim() || !spotify.connected}
                title="Add directly to queue (searches top match or uses URI)"
              >
                + DIRECT QUEUE
              </button>
            </form>

            {/* Search Results Display */}
            {searchResults.length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span className="mono-font" style={{ fontSize: "11px", fontWeight: "bold", color: "var(--ctp-subtext0)" }}>
                    SEARCH RESULTS ({searchResults.length})
                  </span>
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--ctp-overlay1)", cursor: "pointer", fontSize: "11px" }}
                    onClick={() => setSearchResults([])}
                  >
                    [CLOSE RESULTS]
                  </button>
                </div>
                <div className="song-search-results">
                  {searchResults.map((t) => (
                    <div key={t.id} className="song-search-card">
                      {t.albumArt ? (
                        <img src={t.albumArt} alt={t.name} className="song-search-art" />
                      ) : (
                        <div className="song-search-art" style={{ display: "grid", placeContent: "center", fontSize: "9px" }}>
                          NO ART
                        </div>
                      )}
                      <div className="song-search-meta">
                        <span className="song-search-title" title={t.name}>
                          {t.name}
                        </span>
                        <span className="song-search-artist" title={t.artist}>
                          {t.artist}
                        </span>
                        <span className="song-search-duration">{formatMs(t.durationMs)}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: "4px 8px", fontSize: "10px", flexShrink: 0 }}
                        onClick={() => handleQueueTrack(t.uri, t.name)}
                        disabled={requestingTrack === t.uri}
                      >
                        {requestingTrack === t.uri ? "ADDING..." : "+ QUEUE"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Song Request Queue History */}
            <div style={{ marginTop: "10px" }}>
              <span className="mono-font" style={{ fontSize: "11px", fontWeight: "bold", color: "var(--ctp-subtext0)", display: "block", marginBottom: "6px" }}>
                RECENT SONG REQUESTS ({songRequests.length})
              </span>
              {songRequests.length === 0 ? (
                <div className="empty-state" style={{ padding: "12px" }}>
                  [ NO REQUESTS YET ]
                  <br />
                  Search above or type <code className="mono-font">!sr song_name</code> in TikTok live chat to queue songs.
                </div>
              ) : (
                <div className="song-request-history-list">
                  {songRequests.map((req) => (
                    <div key={req.id} className="song-request-history-item">
                      <div className="song-request-history-left">
                        {req.albumArt && (
                          <img
                            src={req.albumArt}
                            alt=""
                            style={{ width: "28px", height: "28px", objectFit: "cover", border: "1px solid var(--border-color)" }}
                          />
                        )}
                        <div className="song-request-history-meta">
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontWeight: "bold", fontSize: "12px", color: "var(--text-primary)" }}>
                              {req.trackName}
                            </span>
                            {req.artist && (
                              <span style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
                                • {req.artist}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                            <span className="mono-font" style={{ fontSize: "10px", color: "var(--ctp-sapphire)" }}>
                              @{req.requester}
                            </span>
                            <span className="mono-font" style={{ fontSize: "10px", color: "var(--ctp-overlay1)" }}>
                              {new Date(req.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className={`song-request-tag ${req.source === "tiktok_chat" ? "source-chat" : "source-web"}`}>
                          {req.source === "tiktok_chat" ? "CHAT !SR" : "DASHBOARD"}
                        </span>
                        <span className={`song-request-tag ${req.status}`}>
                          {req.status === "queued" ? "QUEUED" : "FAILED"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Box 4: TikTok Chat Reader & TTS */}
      <section className="raw-card">
        <div className="card-title">
          <div className="card-title-left">
            <h2>TIKTOK CHAT READER // TTS</h2>
            {minimized.chatTts ? (
              <span className="minimized-summary">
                TTS: [{ttsEnabled ? "ON" : "OFF"}] • {recentChats.length} CHATS
              </span>
            ) : (
              <span className="mono-font" style={{ fontSize: "12px", color: ttsEnabled ? "var(--ctp-green)" : "var(--ctp-subtext0)" }}>
                STATUS: {ttsEnabled ? "● ACTIVE & READING" : "○ MUTED"}
              </span>
            )}
          </div>
          <div className="card-title-actions">
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px" }}
              onClick={() => toggleBox("chatTts")}
              title={minimized.chatTts ? "Expand TikTok Chat Reader" : "Minimize box"}
            >
              {minimized.chatTts ? "[ + ] EXPAND" : "[ _ ] MINIMIZE"}
            </button>
          </div>
        </div>

        {!minimized.chatTts && (
          <>
            {/* Top TTS Control Bar */}
            <div className="tts-control-bar">
              <button
                type="button"
                className={`tts-toggle-button ${ttsEnabled ? "active" : ""}`}
                onClick={toggleTts}
                title="Toggle Text-to-Speech audio reader"
              >
                <span className="tts-status-dot"></span>
                <span>TTS: {ttsEnabled ? "ON" : "OFF"}</span>
              </button>

              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "11px" }}
                  onClick={() => speakMessage("Testing TikTok text to speech reader. Hello streamer!")}
                  title="Test current TTS voice and speed settings"
                >
                  🔊 TEST VOICE
                </button>
                <button
                  type="button"
                  className="btn btn-destructive"
                  style={{ padding: "6px 12px", fontSize: "11px" }}
                  onClick={stopTtsSpeech}
                  title="Immediately cancel ongoing speech audio"
                >
                  ⏹ STOP SPEECH
                </button>
                <button
                  type="button"
                  className={`btn ${showTtsSettings ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "6px 12px", fontSize: "11px" }}
                  onClick={() => setShowTtsSettings(!showTtsSettings)}
                >
                  ⚙ SETTINGS
                </button>
                {onTestChat && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "11px" }}
                    onClick={() => onTestChat("Hello streamer! Testing chat reader and TTS.")}
                    title="Simulate a viewer message in TikTok chat"
                  >
                    + TEST CHAT
                  </button>
                )}
                {recentChats.length > 0 && onClearChats && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "11px" }}
                    onClick={onClearChats}
                  >
                    CLEAR
                  </button>
                )}
              </div>
            </div>

            {/* TTS Settings Drawer */}
            {showTtsSettings && (
              <div className="tts-settings-drawer">
                {/* Voice Selection */}
                <div className="tts-setting-item">
                  <label className="tts-setting-label">
                    <span>TTS VOICE</span>
                    <span>{availableVoices.length} AVAILABLE</span>
                  </label>
                  <select
                    className="song-request-input"
                    style={{ padding: "6px", fontSize: "12px" }}
                    value={ttsVoice}
                    onChange={(e) => {
                      setTtsVoice(e.target.value);
                      try {
                        localStorage.setItem("donate_socket_tts_voice", e.target.value);
                      } catch {}
                    }}
                  >
                    {availableVoices.length === 0 ? (
                      <option value="">Default System Voice</option>
                    ) : (
                      availableVoices.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.lang}) {v.default ? "• DEFAULT" : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* Volume Slider */}
                <div className="tts-setting-item">
                  <label className="tts-setting-label">
                    <span>VOLUME</span>
                    <span>{Math.round(ttsVolume * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    className="tts-slider"
                    value={ttsVolume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setTtsVolume(v);
                      try {
                        localStorage.setItem("donate_socket_tts_vol", String(v));
                      } catch {}
                    }}
                  />
                </div>

                {/* Speed / Rate Slider */}
                <div className="tts-setting-item">
                  <label className="tts-setting-label">
                    <span>SPEED / RATE</span>
                    <span>{ttsRate.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    className="tts-slider"
                    value={ttsRate}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setTtsRate(v);
                      try {
                        localStorage.setItem("donate_socket_tts_rate", String(v));
                      } catch {}
                    }}
                  />
                </div>

                {/* Pitch Slider */}
                <div className="tts-setting-item">
                  <label className="tts-setting-label">
                    <span>PITCH</span>
                    <span>{ttsPitch.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.1"
                    className="tts-slider"
                    value={ttsPitch}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setTtsPitch(v);
                      try {
                        localStorage.setItem("donate_socket_tts_pitch", String(v));
                      } catch {}
                    }}
                  />
                </div>

                {/* Format Template */}
                <div className="tts-setting-item">
                  <label className="tts-setting-label">
                    <span>READ FORMAT</span>
                  </label>
                  <select
                    className="song-request-input"
                    style={{ padding: "6px", fontSize: "12px" }}
                    value={ttsTemplate}
                    onChange={(e) => {
                      setTtsTemplate(e.target.value);
                      try {
                        localStorage.setItem("donate_socket_tts_template", e.target.value);
                      } catch {}
                    }}
                  >
                    <option value="{comment}">Comment Only (&quot;Hello&quot;)</option>
                    <option value="{nickname} says {comment}">{`{nickname} says {comment}`}</option>
                    <option value="{nickname}: {comment}">{`{nickname}: {comment}`}</option>
                  </select>
                </div>

                {/* Ignore Bot Commands Checkbox */}
                <div className="tts-setting-item" style={{ justifyContent: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px" }}>
                    <input
                      type="checkbox"
                      checked={ignoreBotCommands}
                      onChange={(e) => {
                        setIgnoreBotCommands(e.target.checked);
                        try {
                          localStorage.setItem("donate_socket_tts_ignore_cmd", String(e.target.checked));
                        } catch {}
                      }}
                    />
                    <span>Ignore bot commands (starts with &quot;!&quot;)</span>
                  </label>
                </div>
              </div>
            )}

            {/* Live Chat Message Stream Box */}
            <div className="live-chat-box">
              {recentChats.length === 0 ? (
                <div className="empty-state" style={{ padding: "16px" }}>
                  [ NO TIKTOK CHATS RECEIVED YET ]
                  <br />
                  Connect to a TikTok stream or click &quot;+ TEST CHAT&quot; above to simulate messages.
                </div>
              ) : (
                recentChats.map((chat) => (
                  <div key={chat.id} className="chat-bubble">
                    <div className="chat-bubble-left">
                      <div className="chat-bubble-header">
                        <span className="chat-bubble-user">@{chat.uniqueId}</span>
                        {chat.nickname && chat.nickname !== chat.uniqueId && (
                          <span style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
                            ({chat.nickname})
                          </span>
                        )}
                        <span className="chat-bubble-time">
                          {new Date(chat.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <span className="chat-bubble-text">{chat.comment}</span>
                    </div>

                    <button
                      type="button"
                      className="ctrl-btn"
                      style={{ padding: "3px 8px", fontSize: "11px", flexShrink: 0 }}
                      onClick={() => {
                        const text = ttsTemplate
                          .replace("{nickname}", chat.nickname || chat.uniqueId)
                          .replace("{username}", chat.uniqueId)
                          .replace("{comment}", chat.comment);
                        speakMessage(text);
                      }}
                      title="Speak this message with TTS"
                    >
                      🔊
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {/* Box 5: Payload Schema Card */}
      <section className="raw-card">
        <div className="card-title">
          <div className="card-title-left">
            <h3>DISPATCH PAYLOAD SPECIFICATION</h3>
            {minimized.payload ? (
              <span className="minimized-summary">PAYLOAD: [{payloadSpecTab.toUpperCase()}]</span>
            ) : null}
          </div>
          <div className="card-title-actions">
            {!minimized.payload && (
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className={`btn ${payloadSpecTab === "tiktok" ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "2px 8px", fontSize: "11px" }}
                  onClick={() => setPayloadSpecTab("tiktok")}
                >
                  TIKTOK GIFT
                </button>
                <button
                  type="button"
                  className={`btn ${payloadSpecTab === "spotify" ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "2px 8px", fontSize: "11px" }}
                  onClick={() => setPayloadSpecTab("spotify")}
                >
                  SPOTIFY STATUS
                </button>
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px" }}
              onClick={() => toggleBox("payload")}
              title={minimized.payload ? "Expand payload specification" : "Minimize box"}
            >
              {minimized.payload ? "[ + ] EXPAND" : "[ _ ] MINIMIZE"}
            </button>
          </div>
        </div>

        {!minimized.payload && (
          <pre className="code-preview">
{payloadSpecTab === "tiktok"
  ? JSON.stringify(
      {
        username: "gifter_name",
        giftName: "Rose",
        coins: 20,
        diamondCount: 1,
        repeatCount: 20,
        giftId: 5655,
        userId: "123456789",
        timestamp: 1715000000000,
      },
      null,
      2
    )
  : JSON.stringify(
      {
        event: "spotify_status",
        isPlaying: true,
        trackName: "Starboy",
        artist: "The Weeknd, Daft Punk",
        album: "Starboy",
        albumArt: "https://i.scdn.co/image/...",
        durationMs: 230453,
        progressMs: 51230,
        playlistName: "Top Hits",
        playlistUri: "spotify:playlist:...",
        track: {
          name: "Starboy",
          artist: "The Weeknd, Daft Punk",
          album: "Starboy",
          albumArt: "https://i.scdn.co/image/...",
          durationMs: 230453,
          progressMs: 51230,
          isPlaying: true,
          playlistName: "Top Hits",
          playlistUri: "spotify:playlist:...",
          uri: "spotify:track:7MXVkk9YMctZqd1Srtv4MB",
          id: "7MXVkk9YMctZqd1Srtv4MB",
        },
        device: {
          id: "device_abc123",
          name: "Web Player (Chrome)",
          type: "Computer",
          isActive: true,
          volumePercent: 100,
        },
        timestamp: 1715000000000,
      },
      null,
      2
    )}
          </pre>
        )}
      </section>

      {/* Box 6: Live Webhook Dispatch Logs */}
      <section className="raw-card">
        <div className="card-title">
          <div className="card-title-left">
            <h3>WEBHOOK DISPATCH LOGS ({logs.length})</h3>
            {minimized.logs ? (
              <span className="minimized-summary">
                {logs.length} LOGS • {logs.filter((l) => l.success).length} OK
              </span>
            ) : null}
          </div>
          <div className="card-title-actions">
            {!minimized.logs && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "11px" }}
                onClick={onClearLogs}
              >
                CLEAR LOGS
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 8px", fontSize: "11px" }}
              onClick={() => toggleBox("logs")}
              title={minimized.logs ? "Expand webhook logs" : "Minimize box"}
            >
              {minimized.logs ? "[ + ] EXPAND" : "[ _ ] MINIMIZE"}
            </button>
          </div>
        </div>

        {!minimized.logs && (
          <>
            {logs.length === 0 ? (
              <div className="empty-state">
                [ NO DISPATCHES RECORDED YET ]
                <br />
                Connect to a stream, play Spotify songs, or click &quot;TEST WEBHOOK&quot; to test.
              </div>
            ) : (
              <div className="logs-list">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`log-item ${log.success ? "success" : "failed"}`}
                  >
                    <div className="log-header">
                      <div>
                        <span
                          className="log-type-tag"
                          style={{
                            color:
                              log.type === "test"
                                ? "var(--ctp-lavender)"
                                : log.type === "spotify"
                                ? "var(--ctp-green)"
                                : "var(--accent-primary)",
                            marginRight: "8px",
                          }}
                        >
                          {log.type}
                        </span>
                        <span className="log-time">{log.timestamp}</span>
                      </div>

                      <span className={`log-val ${log.success ? "success" : "error"}`}>
                        {log.success
                          ? `STATUS ${log.httpStatus || 200} OK`
                          : log.error || `FAILED (${log.httpStatus || "ERR"})`}
                      </span>
                    </div>

                    <div className="log-body">
                      <div className="log-line">
                        <span className="log-key">PAYLOAD:</span>
                        <span className="log-val">{JSON.stringify(log.payload)}</span>
                      </div>
                      <div className="log-line">
                        <span className="log-key">TARGET:</span>
                        <span className="log-val" style={{ color: "var(--ctp-blue)" }}>
                          {log.webhookUri}
                        </span>
                      </div>
                      {log.response && (
                        <div className="log-line">
                          <span className="log-key">RESPONSE:</span>
                          <span className="log-val" style={{ color: "var(--ctp-subtext0)" }}>
                            {log.response}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
};
