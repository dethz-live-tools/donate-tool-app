import React, { useState } from "react";
import { SpotifyInfo, SpotifyTrack } from "../types";
import { useLang, type Lang } from "../i18n.tsx";

interface SidebarProps {
  currentPage: "dashboard" | "config" | "overlays" | "studio" | "about";
  onSelectPage: (page: "dashboard" | "config" | "overlays" | "studio" | "about") => void;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  spotify: SpotifyInfo;
  track: SpotifyTrack | null;
  backendOnline: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onSelectPage,
  status,
  roomId,
  spotify,
  track,
  backendOnline,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const { lang, setLang, t } = useLang();
  const langOptions: Lang[] = ["en", "th"];
  return (
    <aside className={`app-sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="btn btn-secondary sidebar-toggle"
        aria-expanded={!collapsed}
        aria-controls="sidebar-navigation"
        aria-label={collapsed ? t("Expand navigation") : t("Collapse navigation")}
        title={collapsed ? t("Expand navigation") : t("Collapse navigation")}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? "☰" : t("COLLAPSE NAV")}
      </button>
      <div className="sidebar-brand">
        <h1 style={{ fontSize: "18px" }}>TIKTOK // DONATE</h1>
        <span className="header-subtitle">RAWBLOCK // CATPPUCCIN</span>
      </div>

      <nav className="sidebar-nav" id="sidebar-navigation" aria-label="Main navigation">
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "dashboard" ? "active" : ""}`}
          onClick={() => onSelectPage("dashboard")}
          aria-label="Dashboard"
          title="Dashboard"
        >
          <span>[ {t("DASHBOARD")} ]</span>
          <span aria-hidden="true">D</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "config" ? "active" : ""}`}
          onClick={() => onSelectPage("config")}
          aria-label="Configuration"
          title="Configuration"
        >
          <span>[ {t("CONFIGURATION")} ]</span>
          <span aria-hidden="true">C</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "overlays" ? "active" : ""}`}
          onClick={() => onSelectPage("overlays")}
          aria-label="Overlays Market"
          title="Overlays Market"
        >
          <span>[ {t("OVERLAYS")} ]</span>
          <span aria-hidden="true">O</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "studio" ? "active" : ""}`}
          onClick={() => onSelectPage("studio")}
          aria-label="Overlay Studio"
          title="Overlay Studio"
        >
          <span>[ {t("OVERLAY STUDIO")} ]</span>
          <span aria-hidden="true">S</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "about" ? "active" : ""}`}
          onClick={() => onSelectPage("about")}
          aria-label="About"
          title="About"
        >
          <span>[ {t("ABOUT")} ]</span>
          <span aria-hidden="true">A</span>
        </button>
      </nav>

      <div className="sidebar-statuses">
        <select
          className="song-request-input"
          style={{ width: "100%", padding: "6px", fontSize: "12px", marginBottom: "4px" }}
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          aria-label={t("Language")}
        >
          {langOptions.map((l) => (
            <option key={l} value={l}>
              {l === "en" ? "ENGLISH" : "ไทย"}
            </option>
          ))}
        </select>

        <div
          style={{
            fontSize: "10px",
            fontFamily: "Archivo Black, sans-serif",
            color: "var(--ctp-subtext0)",
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          {t("SYSTEM STATUS")}
        </div>

        {/* Backend Status Chip */}
        <div
          className={`status-chip ${backendOnline ? "connected" : "disconnected"}`}
          style={{ width: "100%", justifyContent: "flex-start" }}
        >
          <span className="status-dot"></span>
          <span>{t(backendOnline ? "BRIDGE: ONLINE" : "BRIDGE: OFFLINE")}</span>
        </div>

        {/* TikTok Status Chip */}
        <div className={`status-chip ${status}`} style={{ width: "100%", justifyContent: "flex-start" }}>
          <span className="status-dot"></span>
          <span>
            {status === "connected" && roomId ? t("LIVE: {room}").replace("{room}", roomId) : t(`TIKTOK: ${status.toUpperCase()}`)}
          </span>
        </div>

        {/* Spotify Status Chip */}
        <div
          className={`status-chip ${
            spotify.error
              ? "error"
              : spotify.connected
              ? track?.isPlaying
                ? "connected"
                : "connecting"
              : "disconnected"
          }`}
          style={{ width: "100%", justifyContent: "flex-start" }}
        >
          <span className="status-dot"></span>
          <span>
            {spotify.error
              ? t("SPOTIFY: ERROR")
              : spotify.connected
              ? track?.isPlaying
                ? t("SPOTIFY: PLAYING")
                : t("SPOTIFY: IDLE")
              : t("SPOTIFY: OFF")}
          </span>
        </div>
      </div>
    </aside>
  );
};
