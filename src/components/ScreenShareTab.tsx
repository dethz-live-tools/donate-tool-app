import React, { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n.tsx";
import type { ScreenShareStatus } from "../types";

interface ScreenShareTabProps {
  apiBase?: string;
  status: ScreenShareStatus;
  stream: MediaStream | null;
  busy: boolean;
  onStart: (port: number) => void;
  onStop: () => void;
  onRegenerateToken: () => void;
  onDisconnectStream: () => void;
  onVideoDimensions?: (width: number, height: number) => void;
}

export const ScreenShareTab: React.FC<ScreenShareTabProps> = ({
  apiBase,
  status,
  stream,
  busy,
  onStart,
  onStop,
  onRegenerateToken,
  onDisconnectStream,
  onVideoDimensions,
}) => {
  const { t } = useLang();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [portInput, setPortInput] = useState(String(status.port || 3002));
  const [showToken, setShowToken] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!status.running) {
      setPortInput(String(status.port || 3002));
    }
  }, [status.port, status.running]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) {
      el.play().catch(() => {
        setMuted(true);
        el.muted = true;
        void el.play().catch(() => {});
      });
    } else {
      setVideoSize(null);
    }
  }, [stream]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = Math.max(0, Math.min(1, volume));
  }, [muted, volume]);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {}
  }

  function handleStartSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(portInput);
    onStart(Number.isFinite(parsed) ? parsed : 3002);
  }

  function toggleFullscreen() {
    const target = stageRef.current || videoRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void target.requestFullscreen?.().catch(() => {});
    }
  }

  const session = status.activeSession;
  const isLive = Boolean(stream || session?.state === "connected");
  const isNegotiating = Boolean(session && session.state === "negotiating");

  const effectiveObsUrl = apiBase ? `${apiBase}/overlays/screen-share/` : status.obsUrl;

  const statusChipClass = status.error
    ? "error"
    : isLive
    ? "connected"
    : status.running
    ? "connecting"
    : "disconnected";

  const statusLabel = status.error
    ? t("SCREEN: ERROR")
    : isLive
    ? t("SCREEN: LIVE")
    : isNegotiating
    ? t("SCREEN: NEGOTIATING")
    : status.running
    ? t("SCREEN: WAITING")
    : t("SCREEN: OFF");

  const resolutionText =
    videoSize && videoSize.w > 0
      ? `${videoSize.w}×${videoSize.h}`
      : session?.width && session?.height
      ? `${session.width}×${session.height}`
      : null;

  return (
    <>
      {/* Live Preview Stage */}
      <section className="raw-card elevated">
        <div className="card-title">
          <div className="card-title-left">
            <h2>{t("SCREEN SHARE RECEIVER // WHIP")}</h2>
            <span className={`status-chip ${statusChipClass}`} style={{ padding: "2px 8px", fontSize: "11px" }}>
              <span className="status-dot"></span>
              <span>{statusLabel}</span>
            </span>
          </div>
          <div className="card-title-actions">
            {resolutionText && (
              <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-sapphire)" }}>
                {resolutionText}
              </span>
            )}
            {session?.remoteAddress && (
              <span className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
                {session.remoteAddress}
              </span>
            )}
            <span className="mono-font" style={{ fontSize: "11px", color: "var(--ctp-subtext0)" }}>
              {t("VIEWERS: {n}", { n: status.receiverCount })}
            </span>
          </div>
        </div>

        {status.error && (
          <div className="alert-banner" style={{ marginBottom: "12px" }}>
            <span>[!]</span>
            <span>{status.error}</span>
          </div>
        )}

        <div
          ref={stageRef}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: "var(--ctp-crust)",
            border: "3px solid var(--border-color)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) {
                setVideoSize({ w: v.videoWidth, h: v.videoHeight });
                onVideoDimensions?.(v.videoWidth, v.videoHeight);
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: fitMode,
              display: stream ? "block" : "none",
              background: "#000",
            }}
          />

          {!stream && (
            <div style={{ textAlign: "center", padding: "24px", maxWidth: "520px" }}>
              <div
                className="mono-font"
                style={{
                  fontSize: "14px",
                  fontWeight: "bold",
                  color: status.running ? "var(--ctp-sapphire)" : "var(--ctp-subtext0)",
                  marginBottom: "8px",
                }}
              >
                {status.running
                  ? t("[ WAITING FOR LAN WHIP STREAM ]")
                  : t("[ RECEIVER STOPPED ]")}
              </div>
              <p className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)", lineHeight: 1.6 }}>
                {status.running
                  ? t("Point your WHIP sender (e.g. OBS Stream -> WHIP) to the LAN URL and Bearer Token below.")
                  : t("Click START RECEIVER to open the LAN WHIP ingest endpoint.")}
              </p>
            </div>
          )}
        </div>

        {/* Preview Controls */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginTop: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className={`btn ${muted ? "btn-secondary" : "btn-primary"}`}
              style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={() => setMuted((m) => !m)}
              disabled={!stream}
            >
              {muted ? t("UNMUTE PREVIEW") : t("MUTE PREVIEW")}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              aria-label={t("Preview volume")}
              disabled={!stream}
              style={{ width: "100px" }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={() => setFitMode((m) => (m === "contain" ? "cover" : "contain"))}
            >
              {fitMode === "contain" ? t("FIT: CONTAIN") : t("FIT: COVER")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={toggleFullscreen}
              disabled={!stream}
            >
              {t("FULLSCREEN")}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {session && (
              <button
                type="button"
                className="btn btn-destructive"
                style={{ padding: "6px 12px", fontSize: "12px" }}
                onClick={onDisconnectStream}
                disabled={busy}
              >
                {t("DISCONNECT STREAM")}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* WHIP Ingest & OBS Endpoint Configuration */}
      <section className="raw-card elevated">
        <div className="card-title">
          <h2>{t("LAN WHIP ENDPOINT & OBS SOURCE")}</h2>
          <span className="mono-font" style={{ fontSize: "12px", color: "var(--ctp-subtext0)" }}>
            RFC 9725 // WEBRTC
          </span>
        </div>

        <form onSubmit={handleStartSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
            <div className="form-group" style={{ width: "160px" }}>
              <label className="form-label" htmlFor="whip-port">
                {t("WHIP LAN PORT")}
              </label>
              <input
                id="whip-port"
                className="raw-input mono-font"
                type="number"
                min={1024}
                max={65535}
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                disabled={status.running || busy}
              />
            </div>

            {status.running ? (
              <button
                type="button"
                className="btn btn-destructive"
                onClick={onStop}
                disabled={busy}
              >
                {t("STOP RECEIVER")}
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy}
              >
                {busy ? t("STARTING...") : t("START RECEIVER")}
              </button>
            )}
          </div>

          {/* LAN WHIP URLs */}
          <div className="form-group">
            <label className="form-label">{t("WHIP SERVER URL (FOR SENDER ON LAN)")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {status.lanUrls.map((url) => (
                <div key={url} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    className="raw-input mono-font"
                    type="text"
                    readOnly
                    value={url}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "8px 14px", fontSize: "12px" }}
                    onClick={() => void copyText(url, url)}
                  >
                    {copiedKey === url ? t("COPIED") : t("COPY")}
                  </button>
                </div>
              ))}
            </div>
            <span className="form-helper">
              {t("All bridge, overlay, and WHIP servers listen on LAN (0.0.0.0); remote OBS sources can use your LAN IP on port 3001.")}
            </span>
          </div>

          {/* Built-in HTTPS Web Screen Sharer URLs */}
          <div className="form-group">
            <label className="form-label">{t("HTTPS WEB SCREEN SHARER URL (BROWSER SENDER)")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {status.lanUrls.map((url) => {
                const shareUrl = url
                  .replace(/\/whip$/, "/share")
                  .replace(/^http:\/\/(?!127\.0\.0\.1(?::|$)|localhost(?::|$))/i, "https://");
                return (
                  <div key={shareUrl} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      className="raw-input mono-font"
                      type="text"
                      readOnly
                      value={shareUrl}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "8px 14px", fontSize: "12px" }}
                      onClick={() => void copyText(shareUrl, shareUrl)}
                    >
                      {copiedKey === shareUrl ? t("COPIED") : t("COPY")}
                    </button>
                  </div>
                );
              })}
            </div>
            <span className="form-helper">
              {t("Open in any browser on LAN, accept the self-signed HTTPS warning once (Advanced -> Proceed), paste the Bearer Token, and click SHARE SCREEN.")}
            </span>
          </div>

          {/* Bearer Token */}
          <div className="form-group">
            <label className="form-label" htmlFor="whip-token">
              {t("WHIP BEARER TOKEN")}
            </label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="whip-token"
                className="raw-input mono-font"
                type={showToken ? "text" : "password"}
                readOnly
                value={status.token}
                style={{ flex: 1, minWidth: "220px" }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "8px 12px", fontSize: "12px" }}
                onClick={() => setShowToken((s) => !s)}
              >
                {showToken ? t("HIDE") : t("SHOW")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "8px 12px", fontSize: "12px" }}
                onClick={() => void copyText("token", status.token)}
              >
                {copiedKey === "token" ? t("COPIED") : t("COPY")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "8px 12px", fontSize: "12px" }}
                onClick={onRegenerateToken}
                disabled={busy}
              >
                {t("REGENERATE")}
              </button>
            </div>
            <span className="form-helper">
              {t("Required as Authorization: Bearer <token> (paste into OBS Settings -> Stream -> WHIP Bearer Token).")}
            </span>
          </div>

          {/* OBS Browser Source URL */}
          <div className="form-group">
            <label className="form-label" htmlFor="obs-screen-url">
              {t("OBS BROWSER SOURCE URL")}
            </label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                id="obs-screen-url"
                className="raw-input mono-font"
                type="text"
                readOnly
                value={effectiveObsUrl}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "8px 14px", fontSize: "12px" }}
                onClick={() => void copyText("obs", effectiveObsUrl)}
              >
                {copiedKey === "obs" ? t("COPIED") : t("COPY OBS URL")}
              </button>
            </div>
            <span className="form-helper">
              {t("Transparent when idle. Optional query params: ?fit=cover (or fill/contain) and ?muted=1.")}
            </span>
          </div>
        </form>
      </section>
    </>
  );
};
