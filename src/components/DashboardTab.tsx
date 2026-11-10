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

export interface EdgeTtsVoice {
  name: string;
  shortName: string;
  gender: string;
  locale: string;
  friendlyName: string;
  suggested?: boolean;
}

const DEFAULT_EDGE_VOICE = "th-TH-NiwatNeural";

const FALLBACK_EDGE_VOICES: EdgeTtsVoice[] = [
  {
    name: "Microsoft Niwat Online (Natural) - Thai (Thailand)",
    shortName: "th-TH-NiwatNeural",
    gender: "Male",
    locale: "th-TH",
    friendlyName: "Thai Male (Niwat - Natural)",
    suggested: true,
  },
  {
    name: "Microsoft Premwadee Online (Natural) - Thai (Thailand)",
    shortName: "th-TH-PremwadeeNeural",
    gender: "Female",
    locale: "th-TH",
    friendlyName: "Thai Female (Premwadee - Natural)",
    suggested: true,
  },
  {
    name: "Microsoft Aria Online (Natural) - English (United States)",
    shortName: "en-US-AriaNeural",
    gender: "Female",
    locale: "en-US",
    friendlyName: "English Female (Aria - Natural)",
    suggested: false,
  },
  {
    name: "Microsoft Guy Online (Natural) - English (United States)",
    shortName: "en-US-GuyNeural",
    gender: "Male",
    locale: "en-US",
    friendlyName: "English Male (Guy - Natural)",
    suggested: false,
  },
];

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
  // Helper to persist settings to server config.yaml with 350ms debounce
  const pendingConfigUpdatesRef = React.useRef<any>({});
  const configSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveAppConfig = React.useCallback((updates: any, immediate = false) => {
    pendingConfigUpdatesRef.current = {
      ...pendingConfigUpdatesRef.current,
      ...updates,
      tts: {
        ...(pendingConfigUpdatesRef.current.tts || {}),
        ...(updates.tts || {}),
      },
      ui: {
        ...(pendingConfigUpdatesRef.current.ui || {}),
        ...(updates.ui || {}),
      },
    };

    if (configSaveTimerRef.current) {
      clearTimeout(configSaveTimerRef.current);
      configSaveTimerRef.current = null;
    }

    const flush = () => {
      const payload = pendingConfigUpdatesRef.current;
      pendingConfigUpdatesRef.current = {};
      fetch("http://127.0.0.1:3001/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => console.error("Failed to save config to config.yaml:", err));
    };

    if (immediate) {
      flush();
    } else {
      configSaveTimerRef.current = setTimeout(flush, 350);
    }
  }, []);

  // Panel minimization state (persisted in config.yaml and localStorage)
  const [minimized, setMinimized] = React.useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("donate_socket_minimized_boxes");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleBox = (boxId: string) => {
    userModifiedFieldsRef.current.add("minimizedBoxes");
    setMinimized((prev) => {
      const updated = { ...prev, [boxId]: !prev[boxId] };
      try {
        localStorage.setItem("donate_socket_minimized_boxes", JSON.stringify(updated));
      } catch {}
      saveAppConfig({ ui: { minimizedBoxes: updated } });
      return updated;
    });
  };

  const expandAll = () => {
    userModifiedFieldsRef.current.add("minimizedBoxes");
    setMinimized({});
    try {
      localStorage.setItem("donate_socket_minimized_boxes", JSON.stringify({}));
    } catch {}
    saveAppConfig({ ui: { minimizedBoxes: {} } });
  };

  const minimizeAll = () => {
    userModifiedFieldsRef.current.add("minimizedBoxes");
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
    saveAppConfig({ ui: { minimizedBoxes: all } });
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

  // TikTok Chat Reader & Edge TTS state (persisted in localStorage)
  const [ttsEnabled, setTtsEnabled] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("donate_socket_tts_enabled") === "true";
    } catch {
      return false;
    }
  });
  const [ttsVoice, setTtsVoice] = React.useState<string>(() => {
    try {
      const saved = localStorage.getItem("donate_socket_tts_voice");
      if (saved && saved.includes("Neural")) return saved;
      return DEFAULT_EDGE_VOICE;
    } catch {
      return DEFAULT_EDGE_VOICE;
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
  const [sendTtsWebhook, setSendTtsWebhook] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem("donate_socket_tts_send_webhook") === "true";
    } catch {
      return false;
    }
  });
  const [showTtsSettings, setShowTtsSettings] = React.useState<boolean>(false);
  const [availableVoices, setAvailableVoices] = React.useState<EdgeTtsVoice[]>(FALLBACK_EDGE_VOICES);

  // Track fields the user touched so late server GET responses don't overwrite user changes
  const userModifiedFieldsRef = React.useRef<Set<string>>(new Set());

  // Refs for current audio and active configuration values (prevents stale closure issues)
  const ttsVoiceRef = React.useRef(ttsVoice);
  ttsVoiceRef.current = ttsVoice;
  const ttsRateRef = React.useRef(ttsRate);
  ttsRateRef.current = ttsRate;
  const ttsPitchRef = React.useRef(ttsPitch);
  ttsPitchRef.current = ttsPitch;
  const ttsVolumeRef = React.useRef(ttsVolume);
  ttsVolumeRef.current = ttsVolume;

  // Load available Edge TTS voices and initial config.yaml from server
  React.useEffect(() => {
    let active = true;

    // Load available voices
    fetch("http://127.0.0.1:3001/api/tts/voices")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && Array.isArray(data.voices) && data.voices.length > 0) {
          setAvailableVoices(data.voices);
        }
      })
      .catch((err) => console.warn("[TTS] Could not load Edge TTS voices from server:", err));

    // Load config from config.yaml
    fetch("http://127.0.0.1:3001/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (!active || !cfg) return;
        if (cfg.ui?.minimizedBoxes && !userModifiedFieldsRef.current.has("minimizedBoxes")) {
          setMinimized((prev) => ({ ...prev, ...cfg.ui.minimizedBoxes }));
        }
        if (cfg.tts) {
          if (typeof cfg.tts.enabled === "boolean" && !userModifiedFieldsRef.current.has("enabled")) {
            setTtsEnabled(cfg.tts.enabled);
          }
          if (cfg.tts.voice && !userModifiedFieldsRef.current.has("voice")) {
            setTtsVoice(cfg.tts.voice);
            ttsVoiceRef.current = cfg.tts.voice;
          }
          if (typeof cfg.tts.volume === "number" && !userModifiedFieldsRef.current.has("volume")) {
            setTtsVolume(cfg.tts.volume);
            ttsVolumeRef.current = cfg.tts.volume;
          }
          if (typeof cfg.tts.rate === "number" && !userModifiedFieldsRef.current.has("rate")) {
            setTtsRate(cfg.tts.rate);
            ttsRateRef.current = cfg.tts.rate;
          }
          if (typeof cfg.tts.pitch === "number" && !userModifiedFieldsRef.current.has("pitch")) {
            setTtsPitch(cfg.tts.pitch);
            ttsPitchRef.current = cfg.tts.pitch;
          }
          if (cfg.tts.template && !userModifiedFieldsRef.current.has("template")) {
            setTtsTemplate(cfg.tts.template);
          }
          if (typeof cfg.tts.ignoreBotCommands === "boolean" && !userModifiedFieldsRef.current.has("ignoreBotCommands")) {
            setIgnoreBotCommands(cfg.tts.ignoreBotCommands);
          }
          if (typeof cfg.tts.sendWebhook === "boolean" && !userModifiedFieldsRef.current.has("sendWebhook")) {
            setSendTtsWebhook(cfg.tts.sendWebhook);
          }
        }
        if (typeof cfg.sendTtsWebhook === "boolean" && !userModifiedFieldsRef.current.has("sendWebhook")) {
          setSendTtsWebhook(cfg.sendTtsWebhook);
        }
      })
      .catch((err) => console.warn("[Config] Could not load config.yaml:", err));

    return () => {
      active = false;
    };
  }, []);

  // Sequential Audio Queue for Edge TTS
  const audioQueueRef = React.useRef<string[]>([]);
  const currentAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = React.useRef<boolean>(false);

  const processAudioQueue = React.useCallback(() => {
    if (isPlayingRef.current) return;
    if (audioQueueRef.current.length === 0) return;

    const nextText = audioQueueRef.current.shift();
    if (!nextText) return;

    isPlayingRef.current = true;
    const voiceParam = ttsVoiceRef.current || DEFAULT_EDGE_VOICE;
    const rateParam = ttsRateRef.current;
    const pitchParam = ttsPitchRef.current;
    const volumeParam = ttsVolumeRef.current;

    const url = `http://127.0.0.1:3001/api/tts/speak?text=${encodeURIComponent(
      nextText
    )}&voice=${encodeURIComponent(voiceParam)}&rate=${rateParam}&pitch=${pitchParam}`;

    try {
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, volumeParam));
      currentAudioRef.current = audio;

      const finishCurrent = () => {
        isPlayingRef.current = false;
        currentAudioRef.current = null;
        processAudioQueue();
      };

      audio.onended = finishCurrent;
      audio.onerror = (e) => {
        console.warn("[TTS] Server audio synthesis/playback error:", e);
        finishCurrent();
      };

      audio.play().catch((err) => {
        console.warn("[TTS] Audio playback failed:", err);
        finishCurrent();
      });
    } catch (e) {
      console.error("[TTS] Failed to initialize audio:", e);
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      processAudioQueue();
    }
  }, []);

  const speakMessage = React.useCallback(
    (text: string) => {
      if (!text || !text.trim()) return;
      audioQueueRef.current.push(text);
      processAudioQueue();
    },
    [processAudioQueue]
  );

  const stopTtsSpeech = React.useCallback(() => {
    audioQueueRef.current = [];
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch {}
      currentAudioRef.current = null;
    }
    isPlayingRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

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
    userModifiedFieldsRef.current.add("enabled");
    setTtsEnabled(next);
    try {
      localStorage.setItem("donate_socket_tts_enabled", String(next));
    } catch {}
    saveAppConfig({ tts: { enabled: next } }, true);
    if (next) {
      speakMessage("เปิดระบบอ่านข้อความเสียงภาษาไทยแล้วครับ");
    } else {
      stopTtsSpeech();
    }
  };

  const handleTestTtsWebhook = async () => {
    try {
      const res = await fetch("http://127.0.0.1:3001/api/test-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tts",
          username: "viewer_pro",
          nickname: "Viewer Pro",
          comment: "สวัสดีครับ สตรีมเมอร์ ทดสอบระบบ TTS Webhook",
          voice: ttsVoiceRef.current || DEFAULT_EDGE_VOICE,
        }),
      });
      const data = await res.json();
      if (data.success) {
        speakMessage("ส่งข้อความ TTS Webhook สำเร็จแล้วครับ");
      }
    } catch (err) {
      console.error("Test TTS webhook failed:", err);
    }
  };

  const [payloadSpecTab, setPayloadSpecTab] = React.useState<"tiktok" | "tts" | "spotify">("tiktok");
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
                  onClick={() => {
                    const voice = ttsVoiceRef.current || DEFAULT_EDGE_VOICE;
                    console.log(`[TTS] Testing Edge TTS voice: ${voice}`);
                    speakMessage("ทดสอบระบบอ่านข้อความเสียงภาษาไทย สวัสดีครับ");
                  }}
                  title="Test current Edge TTS voice and speed settings"
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
                    onClick={() => onTestChat("สวัสดีครับ สตรีมเมอร์ สู้ๆ นะครับ")}
                    title="Simulate a viewer message in TikTok chat"
                  >
                    + TEST CHAT
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "11px" }}
                  onClick={handleTestTtsWebhook}
                  title="Send a test TTS webhook payload (event: tts) to configured webhook URI"
                >
                  + TEST TTS WEBHOOK
                </button>
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
                    <span>EDGE TTS VOICE</span>
                    <span>{availableVoices.length} AVAILABLE</span>
                  </label>
                  <select
                    className="song-request-input"
                    style={{ padding: "6px", fontSize: "12px" }}
                    value={ttsVoice}
                    onChange={(e) => {
                      const v = e.target.value;
                      userModifiedFieldsRef.current.add("voice");
                      setTtsVoice(v);
                      ttsVoiceRef.current = v;
                      try {
                        localStorage.setItem("donate_socket_tts_voice", v);
                      } catch {}
                      saveAppConfig({ tts: { voice: v } }, true);
                    }}
                  >
                    {availableVoices.map((v) => (
                      <option key={v.shortName} value={v.shortName}>
                        {v.suggested ? "★ " : ""}
                        {v.friendlyName} [{v.locale}]
                      </option>
                    ))}
                    {ttsVoice && !availableVoices.some((v) => v.shortName === ttsVoice) && (
                      <option value={ttsVoice}>{ttsVoice}</option>
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
                      userModifiedFieldsRef.current.add("volume");
                      setTtsVolume(v);
                      ttsVolumeRef.current = v;
                      if (currentAudioRef.current) {
                        currentAudioRef.current.volume = Math.max(0, Math.min(1, v));
                      }
                      try {
                        localStorage.setItem("donate_socket_tts_vol", String(v));
                      } catch {}
                      saveAppConfig({ tts: { volume: v } });
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
                      userModifiedFieldsRef.current.add("rate");
                      setTtsRate(v);
                      ttsRateRef.current = v;
                      try {
                        localStorage.setItem("donate_socket_tts_rate", String(v));
                      } catch {}
                      saveAppConfig({ tts: { rate: v } });
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
                      userModifiedFieldsRef.current.add("pitch");
                      setTtsPitch(v);
                      ttsPitchRef.current = v;
                      try {
                        localStorage.setItem("donate_socket_tts_pitch", String(v));
                      } catch {}
                      saveAppConfig({ tts: { pitch: v } });
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
                      const v = e.target.value;
                      userModifiedFieldsRef.current.add("template");
                      setTtsTemplate(v);
                      try {
                        localStorage.setItem("donate_socket_tts_template", v);
                      } catch {}
                      saveAppConfig({ tts: { template: v } }, true);
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
                        const v = e.target.checked;
                        userModifiedFieldsRef.current.add("ignoreBotCommands");
                        setIgnoreBotCommands(v);
                        try {
                          localStorage.setItem("donate_socket_tts_ignore_cmd", String(v));
                        } catch {}
                        saveAppConfig({ tts: { ignoreBotCommands: v } }, true);
                      }}
                    />
                    <span>Ignore bot commands (starts with &quot;!&quot;)</span>
                  </label>
                </div>

                {/* Send TTS / Chat to Webhook Checkbox */}
                <div className="tts-setting-item" style={{ justifyContent: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px" }}>
                    <input
                      type="checkbox"
                      checked={sendTtsWebhook}
                      onChange={(e) => {
                        const v = e.target.checked;
                        userModifiedFieldsRef.current.add("sendWebhook");
                        setSendTtsWebhook(v);
                        try {
                          localStorage.setItem("donate_socket_tts_send_webhook", String(v));
                        } catch {}
                        saveAppConfig({ sendTtsWebhook: v, tts: { sendWebhook: v } }, true);
                      }}
                    />
                    <span>Send incoming chats to Webhook (event: &quot;tts&quot;)</span>
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
                  className={`btn ${payloadSpecTab === "tts" ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "2px 8px", fontSize: "11px" }}
                  onClick={() => setPayloadSpecTab("tts")}
                >
                  TIKTOK CHAT / TTS
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
        event: "tiktok_gift",
        username: "gifter_name",
        nickname: "Gifter Name",
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
  : payloadSpecTab === "tts"
  ? JSON.stringify(
      {
        event: "tts",
        username: "viewer_pro",
        nickname: "Viewer Pro",
        comment: "สวัสดีครับ สตรีมเมอร์ สู้ๆ นะครับ",
        text: "Viewer Pro says สวัสดีครับ สตรีมเมอร์ สู้ๆ นะครับ",
        voice: "th-TH-NiwatNeural",
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
