import React, { useState } from "react";
import { SpotifyInfo, SpotifyTrack } from "../types";

interface SidebarProps {
  currentPage: "dashboard" | "config" | "overlays" | "studio" | "about";
  onSelectPage: (page: "dashboard" | "config" | "overlays" | "studio" | "about") => void;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  spotify: SpotifyInfo;
  track: SpotifyTrack | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onSelectPage,
  status,
  roomId,
  spotify,
  track,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={`app-sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="btn btn-secondary sidebar-toggle"
        aria-expanded={!collapsed}
        aria-controls="sidebar-navigation"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? "☰" : "COLLAPSE NAV"}
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
          <span>[ DASHBOARD ]</span>
          <span aria-hidden="true">D</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "config" ? "active" : ""}`}
          onClick={() => onSelectPage("config")}
          aria-label="Configuration"
          title="Configuration"
        >
          <span>[ CONFIGURATION ]</span>
          <span aria-hidden="true">C</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "overlays" ? "active" : ""}`}
          onClick={() => onSelectPage("overlays")}
          aria-label="Overlays Market"
          title="Overlays Market"
        >
          <span>[ OVERLAYS MARKET ]</span>
          <span aria-hidden="true">O</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "studio" ? "active" : ""}`}
          onClick={() => onSelectPage("studio")}
          aria-label="Overlay Studio"
          title="Overlay Studio"
        >
          <span>[ OVERLAY STUDIO ]</span>
          <span aria-hidden="true">S</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "about" ? "active" : ""}`}
          onClick={() => onSelectPage("about")}
          aria-label="About"
          title="About"
        >
          <span>[ ABOUT ]</span>
          <span aria-hidden="true">A</span>
        </button>
      </nav>

      <div className="sidebar-statuses">
        <div
          style={{
            fontSize: "10px",
            fontFamily: "Archivo Black, sans-serif",
            color: "var(--ctp-subtext0)",
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          SYSTEM STATUS
        </div>

        {/* TikTok Status Chip */}
        <div className={`status-chip ${status}`} style={{ width: "100%", justifyContent: "flex-start" }}>
          <span className="status-dot"></span>
          <span>
            {status === "connected" && roomId ? `LIVE: ${roomId}` : `TIKTOK: ${status.toUpperCase()}`}
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
              ? "SPOTIFY: ERROR"
              : spotify.connected
              ? track?.isPlaying
                ? "SPOTIFY: PLAYING"
                : "SPOTIFY: IDLE"
              : "SPOTIFY: OFF"}
          </span>
        </div>
      </div>
    </aside>
  );
};
