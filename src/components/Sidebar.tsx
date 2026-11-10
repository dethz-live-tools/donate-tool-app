import React from "react";
import { SpotifyInfo, SpotifyTrack } from "../types";

interface SidebarProps {
  currentPage: "dashboard" | "config" | "overlays";
  onSelectPage: (page: "dashboard" | "config" | "overlays") => void;
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
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <h1 style={{ fontSize: "18px" }}>TIKTOK // DONATE</h1>
        <span className="header-subtitle">RAWBLOCK // CATPPUCCIN</span>
      </div>

      <nav className="sidebar-nav">
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "dashboard" ? "active" : ""}`}
          onClick={() => onSelectPage("dashboard")}
        >
          <span>[ DASHBOARD ]</span>
          <span>→</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "config" ? "active" : ""}`}
          onClick={() => onSelectPage("config")}
        >
          <span>[ CONFIGURATION ]</span>
          <span>→</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab ${currentPage === "overlays" ? "active" : ""}`}
          onClick={() => onSelectPage("overlays")}
        >
          <span>[ OVERLAYS MARKET ]</span>
          <span>→</span>
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
