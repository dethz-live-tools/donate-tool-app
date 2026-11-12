import React from "react";
import { SpotifyInfo } from "../types";

interface ConfigTabProps {
  username: string;
  setUsername: (v: string) => void;
  webhookUri: string;
  setWebhookUri: (v: string) => void;
  webhookUriChat: string;
  setWebhookUriChat: (v: string) => void;
  webhookUriSpotify: string;
  setWebhookUriSpotify: (v: string) => void;
  status: "disconnected" | "connecting" | "connected" | "error";
  loading: boolean;
  testing: boolean;
  spotify: SpotifyInfo;
  spotifyClientId: string;
  setSpotifyClientId: (v: string) => void;
  spotifyClientSecret: string;
  setSpotifyClientSecret: (v: string) => void;
  savingSpotify: boolean;
  onSaveConfig: (e: React.FormEvent) => void;
  onConnect: (e: React.FormEvent) => void;
  onDisconnect: () => void;
  onTestWebhook: () => void;
  onTestSpotifyWebhook?: () => void;
  testingSpotifyWebhook?: boolean;
  onSaveSpotifyConfig: (e: React.FormEvent) => void;
  onRefreshSpotify: () => void;
  onDisconnectSpotify: () => void;
}

export const ConfigTab: React.FC<ConfigTabProps> = ({
  username,
  setUsername,
  webhookUri,
  setWebhookUri,
  webhookUriChat,
  setWebhookUriChat,
  webhookUriSpotify,
  setWebhookUriSpotify,
  status,
  loading,
  testing,
  spotify,
  spotifyClientId,
  setSpotifyClientId,
  spotifyClientSecret,
  setSpotifyClientSecret,
  savingSpotify,
  onSaveConfig,
  onConnect,
  onDisconnect,
  onTestWebhook,
  onTestSpotifyWebhook,
  testingSpotifyWebhook = false,
  onSaveSpotifyConfig,
  onRefreshSpotify,
  onDisconnectSpotify,
}) => {
  return (
    <>
      {/* TikTok & Webhook Configuration */}
      <section className="raw-card elevated">
        <div className="card-title">
          <h2>TIKTOK LIVE CONFIGURATION</h2>
          <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
            ENDPOINT SETTINGS
          </span>
        </div>

        <form onSubmit={onConnect} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="tiktok-username">
              TIKTOK USERNAME
            </label>
            <input
              id="tiktok-username"
              className="raw-input"
              type="text"
              placeholder="e.g. streamer_name (without or with @)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={status === "connected" || status === "connecting"}
            />
            <span className="form-helper">
              Username of the TikTok account currently broadcasting live.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="webhook-uri">
              TIKTOK GIFT WEBHOOK (event: "gift")
            </label>
            <input
              id="webhook-uri"
              className="raw-input"
              type="url"
              placeholder="https://your-server.com/api/webhook"
              value={webhookUri}
              onChange={(e) => setWebhookUri(e.target.value)}
            />
            <span className="form-helper">
              Endpoint that receives HTTP POST requests when gifts are sent.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="webhook-chat-uri">
              TIKTOK CHAT / TTS WEBHOOK (event: "tts")
            </label>
            <input
              id="webhook-chat-uri"
              className="raw-input"
              type="url"
              placeholder="https://your-server.com/api/chat-webhook"
              value={webhookUriChat}
              onChange={(e) => setWebhookUriChat(e.target.value)}
            />
            <span className="form-helper">
              Receives chat messages when TTS/chat webhook is enabled. Empty falls back to gift webhook.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="webhook-spotify-uri">
              SPOTIFY WEBHOOK (event: "spotify")
            </label>
            <input
              id="webhook-spotify-uri"
              className="raw-input"
              type="url"
              placeholder="https://your-server.com/api/spotify-webhook"
              value={webhookUriSpotify}
              onChange={(e) => setWebhookUriSpotify(e.target.value)}
            />
            <span className="form-helper">
              Receives song-change events. Empty falls back to gift webhook.
            </span>
          </div>

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onSaveConfig}
              disabled={loading}
            >
              SAVE CONFIG
            </button>

            {status === "connected" || status === "connecting" ? (
              <button
                type="button"
                className="btn btn-destructive"
                onClick={onDisconnect}
                disabled={loading}
              >
                DISCONNECT STREAM
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "CONNECTING..." : "SAVE & CONNECT"}
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={onTestWebhook}
              disabled={testing || !webhookUri.trim()}
            >
              {testing ? "SENDING..." : "SEND TEST WEBHOOK"}
            </button>
          </div>
        </form>
      </section>

      {/* Spotify Integration Configuration */}
      <section className="raw-card elevated">
        <div className="card-title">
          <h2>SPOTIFY INTEGRATION CONFIGURATION</h2>
          <span
            className="mono-font"
            style={{
              fontSize: "12px",
              color: spotify.error
                ? "var(--status-error)"
                : spotify.connected
                ? "var(--status-success)"
                : "var(--ctp-subtext0)",
              fontWeight: "bold",
            }}
          >
            {spotify.error ? "! ERROR" : spotify.connected ? "✓ LINKED" : "UNLINKED"}
          </span>
        </div>

        {spotify.error && (
          <div className="alert-banner">
            <span>[!]</span>
            <span>{spotify.error}</span>
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

        <form onSubmit={onSaveSpotifyConfig} className="spotify-setup-panel">
          <div className="form-group">
            <label className="form-label" htmlFor="spotify-client-id">
              SPOTIFY CLIENT ID
            </label>
            <input
              id="spotify-client-id"
              className="raw-input"
              type="text"
              placeholder="Paste Client ID from Spotify Dashboard"
              value={spotifyClientId}
              onChange={(e) => setSpotifyClientId(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="spotify-client-secret">
              SPOTIFY CLIENT SECRET
            </label>
            <input
              id="spotify-client-secret"
              className="raw-input"
              type="password"
              placeholder={
                spotify.hasClientSecret
                  ? "•••••••• (Secret saved. Leave blank to keep)"
                  : "Paste Client Secret"
              }
              value={spotifyClientSecret}
              onChange={(e) => setSpotifyClientSecret(e.target.value)}
            />
          </div>

          <div className="form-helper" style={{ color: "var(--ctp-subtext0)" }}>
            Add this exact Redirect URI to your Spotify Developer App settings:{" "}
            <code
              className="mono-font"
              style={{
                color: "var(--ctp-blue)",
                background: "var(--ctp-crust)",
                padding: "2px 6px",
                display: "inline-block",
                marginTop: "4px",
              }}
            >
              http://127.0.0.1:3001/api/spotify/callback
            </code>
            <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--ctp-lavender)" }}>
              Includes permissions for player control, active playlist discovery, and full playback state. Click AUTHORIZE SPOTIFY to refresh scopes if granted previously.
            </div>
          </div>

          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingSpotify || !spotifyClientId.trim()}
            >
              {savingSpotify ? "SAVING..." : "AUTHORIZE SPOTIFY"}
            </button>

            {spotify.connected && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onRefreshSpotify}
                  disabled={loading}
                >
                  RECHECK STATUS
                </button>
                {onTestSpotifyWebhook && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onTestSpotifyWebhook}
                    disabled={testingSpotifyWebhook || !webhookUri.trim()}
                    title="Send current Spotify playback status to webhook"
                  >
                    {testingSpotifyWebhook ? "SENDING..." : "TEST SPOTIFY WEBHOOK"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={onDisconnectSpotify}
                >
                  DISCONNECT SPOTIFY
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </>
  );
};
