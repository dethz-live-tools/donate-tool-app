import React from "react";
import { LogEntry, SpotifyInfo } from "../types";

interface DashboardTabProps {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  loading: boolean;
  testing: boolean;
  spotify: SpotifyInfo;
  logs: LogEntry[];
  onConnect: () => void;
  onDisconnect: () => void;
  onTestWebhook: () => void;
  onClearLogs: () => void;
  onRefreshSpotify: () => void;
  onPlayerControl: (action: "play" | "pause" | "next" | "previous") => void;
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
  onConnect,
  onDisconnect,
  onTestWebhook,
  onClearLogs,
  onRefreshSpotify,
  onPlayerControl,
  onGoToConfig,
}) => {
  const track = spotify.currentTrack;
  const progressPercent =
    track && track.durationMs > 0
      ? Math.min(100, Math.max(0, (track.progressMs / track.durationMs) * 100))
      : 0;

  return (
    <>
      {/* Quick Stream Controls */}
      <section className="raw-card">
        <div className="card-title">
          <h2>STREAM CONTROLS</h2>
          <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
            TARGET: {username ? `@${username}` : "(NOT CONFIGURED)"}
          </span>
        </div>

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
      </section>

      {/* Spotify Now Playing Display */}
      <section className="raw-card elevated">
        <div className="card-title">
          <h2>NOW PLAYING // SPOTIFY</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {spotify.connected && (
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
          </div>
        </div>

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
              </div>
            </div>
          </div>
        ) : spotify.connected ? (
          <div className="empty-state">
            [ SPOTIFY CONNECTED // NO ACTIVE PLAYBACK ]
            <br />
            Play music on Spotify desktop, web, or mobile app to view live track data.
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
      </section>

      {/* Payload Schema Card */}
      <section className="raw-card">
        <div className="card-title">
          <h3>DISPATCH PAYLOAD SPECIFICATION</h3>
          <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-lavender)" }}>
            APPLICATION/JSON
          </span>
        </div>
        <pre className="code-preview">
{JSON.stringify(
  {
    username: "gifter_name",
    giftName: "Rose",
    coins: 20,
  },
  null,
  2
)}
        </pre>
      </section>

      {/* Live Webhook Dispatch Logs */}
      <section className="raw-card">
        <div className="card-title">
          <h3>WEBHOOK DISPATCH LOGS ({logs.length})</h3>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: "11px" }}
            onClick={onClearLogs}
          >
            CLEAR LOGS
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="empty-state">
            [ NO DISPATCHES RECORDED YET ]
            <br />
            Connect to a stream or click &quot;TEST WEBHOOK&quot; to test.
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
                        color: log.type === "test" ? "var(--ctp-lavender)" : "var(--ctp-mauve)",
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
      </section>
    </>
  );
};
