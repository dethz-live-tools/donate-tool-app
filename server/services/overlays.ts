import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { OverlayMarketItem, OverlayMeta } from "../types.ts";

export const OVERLAYS_DIR = path.resolve(process.cwd(), "overlays");

export interface OverlayPreset {
  meta: OverlayMarketItem;
  files: Record<string, string>;
}

// Built-in presets for the Overlay Market
export const MARKET_PRESETS: OverlayPreset[] = [
  {
    meta: {
      id: "spotify-brutalist",
      name: "RawBlock Spotify Player",
      description: "Catppuccin Macchiato & Sapphire brutalist Now Playing card with live progress and album art.",
      version: "1.0.0",
      author: "dethz",
      category: "spotify",
      width: 480,
      height: 140,
      tags: ["SPOTIFY", "BRUTALIST", "NOW PLAYING", "SAPPHIRE"],
      isInstalled: false,
    },
    files: {
      "overlay.json": JSON.stringify(
        {
          id: "spotify-brutalist",
          name: "RawBlock Spotify Player",
          description: "Catppuccin Macchiato & Sapphire brutalist Now Playing card with live progress and album art.",
          version: "1.0.0",
          author: "dethz",
          category: "spotify",
          width: 480,
          height: 140,
        },
        null,
        2
      ),
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Spotify Brutalist Overlay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Work+Sans:wght@500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }
    body {
      background: transparent;
      font-family: "Work Sans", "IBM Plex Sans Thai", sans-serif;
      overflow: hidden;
      padding: 10px;
    }
    .card {
      width: 460px;
      height: 120px;
      background: #1e2030;
      border: 3px solid #cad3f5;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      box-shadow: 4px 4px 0px #181926;
      transition: opacity 0.3s ease;
    }
    .art-wrap {
      width: 96px;
      height: 96px;
      border: 2px solid #cad3f5;
      background: #181926;
      flex-shrink: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .art-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .art-placeholder {
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      font-size: 11px;
      color: #737994;
      font-weight: bold;
    }
    .info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border: 1px solid #7dc4e4;
      color: #7dc4e4;
      background: #24273a;
      letter-spacing: 0.5px;
    }
    .badge.paused {
      border-color: #eed49f;
      color: #eed49f;
    }
    .playlist-name {
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      font-size: 9px;
      color: #b7bdf8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .title {
      font-family: "Archivo Black", "IBM Plex Sans Thai", sans-serif;
      font-size: 16px;
      color: #7dc4e4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    .artist {
      font-size: 12px;
      font-weight: 600;
      color: #cad3f5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .progress-wrap {
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: #363a4f;
      border: 1px solid #cad3f5;
    }
    .progress-fill {
      height: 100%;
      background: #7dc4e4;
      width: 0%;
      transition: width 0.3s linear;
    }
    .time-row {
      display: flex;
      justify-content: space-between;
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      font-size: 9px;
      color: #a5adce;
    }
    .empty-state {
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      font-size: 12px;
      color: #a5adce;
      text-align: center;
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="empty-state" id="empty-state">[ WAITING FOR SPOTIFY... ]</div>
    <div class="art-wrap" id="art-wrap" style="display: none;">
      <img id="album-art" src="" alt="Album Art" />
    </div>
    <div class="info" id="info-wrap" style="display: none;">
      <div class="header-row">
        <span class="playlist-name" id="playlist-tag"></span>
        <span class="badge" id="status-badge">PLAYING</span>
      </div>
      <div class="title" id="track-title">--</div>
      <div class="artist" id="track-artist">--</div>
      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" id="progress-fill"></div>
        </div>
        <div class="time-row">
          <span id="time-cur">0:00</span>
          <span id="time-dur">0:00</span>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentTrack = null;
    let localProgress = 0;
    let duration = 0;
    let isPlaying = false;
    let progressTimer = null;

    function formatTime(ms) {
      if (!ms || isNaN(ms)) return "0:00";
      const totalSec = Math.floor(Math.max(0, ms) / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function updateUI() {
      const emptyState = document.getElementById("empty-state");
      const artWrap = document.getElementById("art-wrap");
      const infoWrap = document.getElementById("info-wrap");

      if (!currentTrack) {
        emptyState.style.display = "block";
        emptyState.textContent = "[ SPOTIFY IDLE / STOPPED ]";
        artWrap.style.display = "none";
        infoWrap.style.display = "none";
        return;
      }

      emptyState.style.display = "none";
      artWrap.style.display = "flex";
      infoWrap.style.display = "flex";

      document.getElementById("track-title").textContent = currentTrack.name || "Unknown Track";
      document.getElementById("track-artist").textContent = currentTrack.artist || "Unknown Artist";
      
      const badge = document.getElementById("status-badge");
      if (isPlaying) {
        badge.textContent = "PLAYING";
        badge.className = "badge";
      } else {
        badge.textContent = "PAUSED";
        badge.className = "badge paused";
      }

      const playlistTag = document.getElementById("playlist-tag");
      if (currentTrack.playlistName) {
        playlistTag.textContent = "▶ " + currentTrack.playlistName;
        playlistTag.style.display = "inline";
      } else {
        playlistTag.style.display = "none";
      }

      const img = document.getElementById("album-art");
      if (currentTrack.albumArt) {
        img.src = currentTrack.albumArt;
        img.style.display = "block";
      } else {
        img.style.display = "none";
      }

      const pct = duration > 0 ? Math.min(100, (localProgress / duration) * 100) : 0;
      document.getElementById("progress-fill").style.width = pct + "%";
      document.getElementById("time-cur").textContent = formatTime(localProgress);
      document.getElementById("time-dur").textContent = formatTime(duration);
    }

    function connectSSE() {
      const es = new EventSource("/api/status/stream");
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const t = data.spotify?.currentTrack;
          if (t) {
            currentTrack = t;
            isPlaying = Boolean(t.isPlaying);
            localProgress = Number(t.progressMs) || 0;
            duration = Number(t.durationMs) || 0;
          } else {
            currentTrack = null;
            isPlaying = false;
          }
          updateUI();
        } catch (e) {}
      };
      es.onerror = () => {
        document.getElementById("empty-state").textContent = "[ RECONNECTING BRIDGE... ]";
      };
    }

    setInterval(() => {
      if (isPlaying && duration > 0 && localProgress < duration) {
        localProgress += 500;
        const pct = Math.min(100, (localProgress / duration) * 100);
        document.getElementById("progress-fill").style.width = pct + "%";
        document.getElementById("time-cur").textContent = formatTime(localProgress);
      }
    }, 500);

    connectSSE();
  </script>
</body>
</html>`
    }
  },
  {
    meta: {
      id: "tiktok-gift-alert",
      name: "TikTok Live Gift Alert Box",
      description: "Animated brutalist alert banner with gift animations and coin totals for live stream donations.",
      version: "1.0.0",
      author: "dethz",
      category: "tiktok",
      width: 440,
      height: 160,
      tags: ["TIKTOK", "ALERTS", "GIFTS", "BRUTALIST"],
      isInstalled: false,
    },
    files: {
      "overlay.json": JSON.stringify(
        {
          id: "tiktok-gift-alert",
          name: "TikTok Live Gift Alert Box",
          description: "Animated brutalist alert banner with gift animations and coin totals for live stream donations.",
          version: "1.0.0",
          author: "dethz",
          category: "tiktok",
          width: 440,
          height: 160,
        },
        null,
        2
      ),
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TikTok Live Gift Alert</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Sans+Thai:wght@400;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }
    body {
      background: transparent;
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      overflow: hidden;
      padding: 12px;
    }
    .alert-box {
      width: 410px;
      background: #1e2030;
      border: 4px solid #7dc4e4;
      box-shadow: 6px 6px 0px #181926;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      opacity: 0;
      transform: translateY(-20px);
      transition: all 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    }
    .alert-box.show {
      opacity: 1;
      transform: translateY(0);
    }
    .alert-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #7dc4e4;
      padding-bottom: 6px;
    }
    .alert-label {
      font-family: "Archivo Black", "IBM Plex Sans Thai", sans-serif;
      font-size: 13px;
      color: #7dc4e4;
      letter-spacing: 1.5px;
    }
    .alert-coins {
      background: #eed49f;
      color: #181926;
      font-weight: bold;
      font-size: 11px;
      padding: 2px 8px;
    }
    .alert-content {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 4px;
    }
    .gift-icon {
      font-size: 32px;
      line-height: 1;
    }
    .user-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .username {
      font-family: "Archivo Black", "IBM Plex Sans Thai", sans-serif;
      font-size: 16px;
      color: #cad3f5;
    }
    .gift-msg {
      font-size: 13px;
      color: #a5adce;
    }
    .gift-name {
      color: #f5a97f;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="alert-box" id="alert">
    <div class="alert-header">
      <span class="alert-label">★ TIKTOK LIVE GIFT</span>
      <span class="alert-coins" id="coins-tag">+20 COINS</span>
    </div>
    <div class="alert-content">
      <div class="gift-icon">🎁</div>
      <div class="user-info">
        <div class="username" id="username">username</div>
        <div class="gift-msg">Sent <span class="gift-name" id="gift-name">Rose</span>!</div>
      </div>
    </div>
  </div>

  <script>
    const alertBox = document.getElementById("alert");
    const userEl = document.getElementById("username");
    const giftEl = document.getElementById("gift-name");
    const coinsEl = document.getElementById("coins-tag");

    const queue = [];
    let isShowing = false;
    let lastSeenId = null;

    function showAlert(item) {
      isShowing = true;
      userEl.textContent = item.username || "Anonymous";
      giftEl.textContent = item.giftName || "Gift";
      coinsEl.textContent = "+" + (item.coins || 1) + " COINS";

      alertBox.classList.add("show");

      setTimeout(() => {
        alertBox.classList.remove("show");
        setTimeout(() => {
          isShowing = false;
          if (queue.length > 0) {
            showAlert(queue.shift());
          }
        }, 500);
      }, 4500);
    }

    function queueAlert(payload) {
      if (isShowing) {
        queue.push(payload);
      } else {
        showAlert(payload);
      }
    }

    function connectSSE() {
      const es = new EventSource("/api/status/stream");
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const logs = data.logs || [];
          if (logs.length > 0) {
            const latest = logs[0];
            if (latest.type === "gift" || latest.type === "test") {
              if (latest.id !== lastSeenId) {
                lastSeenId = latest.id;
                queueAlert({
                  username: latest.payload?.username,
                  giftName: latest.payload?.giftName,
                  coins: latest.payload?.coins
                });
              }
            }
          }
        } catch (e) {}
      };
    }

    connectSSE();
  </script>
</body>
</html>`
    }
  },
  {
    meta: {
      id: "spotify-minimal-pill",
      name: "Minimal Floating Song Pill",
      description: "Ultra-compact streaming pill widget with rotating artwork thumbnail and animated visualizer equalizer bars.",
      version: "1.0.0",
      author: "dethz",
      category: "spotify",
      width: 360,
      height: 60,
      tags: ["SPOTIFY", "MINIMAL", "COMPACT", "PILL"],
      isInstalled: false,
    },
    files: {
      "overlay.json": JSON.stringify(
        {
          id: "spotify-minimal-pill",
          name: "Minimal Floating Song Pill",
          description: "Ultra-compact streaming pill widget with rotating artwork thumbnail and animated visualizer equalizer bars.",
          version: "1.0.0",
          author: "dethz",
          category: "spotify",
          width: 360,
          height: 60,
        },
        null,
        2
      ),
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Minimal Song Pill</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Sans+Thai:wght@400;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: transparent;
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      overflow: hidden;
      padding: 6px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #181926;
      border: 2px solid #7dc4e4;
      padding: 6px 12px 6px 6px;
      max-width: 340px;
      box-shadow: 3px 3px 0px rgba(0,0,0,0.4);
    }
    .cover {
      width: 36px;
      height: 36px;
      border: 1px solid #7dc4e4;
      flex-shrink: 0;
      background: #24273a;
      object-fit: cover;
    }
    .text-wrap {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      white-space: nowrap;
    }
    .song {
      font-family: "Archivo Black", "IBM Plex Sans Thai", sans-serif;
      font-size: 12px;
      color: #7dc4e4;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .artist {
      font-size: 10px;
      color: #cad3f5;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .eq {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 14px;
      margin-left: 6px;
    }
    .bar {
      width: 3px;
      background: #7dc4e4;
      height: 4px;
      transition: height 0.15s ease;
    }
    .playing .bar:nth-child(1) { animation: jump 0.8s infinite alternate ease-in-out; }
    .playing .bar:nth-child(2) { animation: jump 0.6s 0.2s infinite alternate ease-in-out; }
    .playing .bar:nth-child(3) { animation: jump 0.9s 0.4s infinite alternate ease-in-out; }
    @keyframes jump { 0% { height: 3px; } 100% { height: 14px; } }
  </style>
</head>
<body>
  <div class="pill" id="pill" style="display: none;">
    <img class="cover" id="cover" src="" alt="Cover" />
    <div class="text-wrap">
      <div class="song" id="song">--</div>
      <div class="artist" id="artist">--</div>
    </div>
    <div class="eq" id="eq">
      <div class="bar"></div>
      <div class="bar"></div>
      <div class="bar"></div>
    </div>
  </div>

  <script>
    const pill = document.getElementById("pill");
    const cover = document.getElementById("cover");
    const song = document.getElementById("song");
    const artist = document.getElementById("artist");
    const eq = document.getElementById("eq");

    function connectSSE() {
      const es = new EventSource("/api/status/stream");
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const t = data.spotify?.currentTrack;
          if (t && t.name) {
            pill.style.display = "inline-flex";
            song.textContent = t.name;
            artist.textContent = t.artist;
            if (t.albumArt) {
              cover.src = t.albumArt;
              cover.style.display = "block";
            } else {
              cover.style.display = "none";
            }
            if (t.isPlaying) {
              eq.classList.add("playing");
            } else {
              eq.classList.remove("playing");
            }
          } else {
            pill.style.display = "none";
          }
        } catch (e) {}
      };
    }
    connectSSE();
  </script>
</body>
</html>`
    }
  },
  {
    meta: {
      id: "stream-dual-ticker",
      name: "Stream Dual Ticker Bar",
      description: "Full-width stream ticker displaying active Spotify song on the left and recent TikTok live donations on the right.",
      version: "1.0.0",
      author: "dethz",
      category: "combined",
      width: 1920,
      height: 44,
      tags: ["TICKER", "COMBINED", "SPOTIFY", "TIKTOK"],
      isInstalled: false,
    },
    files: {
      "overlay.json": JSON.stringify(
        {
          id: "stream-dual-ticker",
          name: "Stream Dual Ticker Bar",
          description: "Full-width stream ticker displaying active Spotify song on the left and recent TikTok live donations on the right.",
          version: "1.0.0",
          author: "dethz",
          category: "combined",
          width: 1920,
          height: 44,
        },
        null,
        2
      ),
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stream Dual Ticker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Sans+Thai:wght@400;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }
    body {
      background: transparent;
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      overflow: hidden;
    }
    .ticker {
      width: 100vw;
      height: 44px;
      background: #181926;
      border-top: 2px solid #cad3f5;
      border-bottom: 2px solid #cad3f5;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 16px;
      color: #cad3f5;
    }
    .ticker-side {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
    }
    .tag {
      font-family: "Archivo Black", "IBM Plex Sans Thai", sans-serif;
      font-size: 11px;
      padding: 2px 6px;
      background: #7dc4e4;
      color: #181926;
    }
    .tag.tiktok {
      background: #ee99a0;
      color: #181926;
    }
    .val {
      color: #cad3f5;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="ticker">
    <div class="ticker-side">
      <span class="tag">♪ NOW PLAYING</span>
      <span class="val" id="spotify-info">Waiting for Spotify...</span>
    </div>
    <div class="ticker-side">
      <span class="tag tiktok">★ LATEST DONATION</span>
      <span class="val" id="tiktok-info">No gifts yet this stream</span>
    </div>
  </div>

  <script>
    const spotEl = document.getElementById("spotify-info");
    const tiktokEl = document.getElementById("tiktok-info");

    function connectSSE() {
      const es = new EventSource("/api/status/stream");
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const t = data.spotify?.currentTrack;
          if (t && t.name) {
            spotEl.textContent = t.name + " - " + t.artist;
          } else {
            spotEl.textContent = "Spotify Idle";
          }

          const logs = data.logs || [];
          const gift = logs.find(l => l.type === "gift" || l.type === "test");
          if (gift && gift.payload) {
            tiktokEl.textContent = gift.payload.username + " sent " + gift.payload.giftName + " (" + gift.payload.coins + " coins)";
          }
        } catch (e) {}
      };
    }
    connectSSE();
  </script>
</body>
</html>`
    }
  }
];

export function ensureOverlaysDir() {
  if (!fs.existsSync(OVERLAYS_DIR)) {
    fs.mkdirSync(OVERLAYS_DIR, { recursive: true });
    // Auto-install presets on first run
    for (const preset of MARKET_PRESETS) {
      installMarketOverlay(preset.meta.id);
    }
  }
}

export function getInstalledOverlays(): OverlayMeta[] {
  ensureOverlaysDir();
  const list: OverlayMeta[] = [];

  try {
    const entries = fs.readdirSync(OVERLAYS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const folderPath = path.join(OVERLAYS_DIR, entry.name);
        const metaPath = path.join(folderPath, "overlay.json");
        const indexPath = path.join(folderPath, "index.html");

        if (fs.existsSync(metaPath)) {
          try {
            const raw = fs.readFileSync(metaPath, "utf-8");
            const parsed = JSON.parse(raw);
            list.push({
              ...parsed,
              id: entry.name,
              previewUrl: `/overlays/${entry.name}/`,
            });
            continue;
          } catch {}
        }

        // If no overlay.json but index.html exists, generate fallback meta
        if (fs.existsSync(indexPath)) {
          list.push({
            id: entry.name,
            name: entry.name.replace(/[-_]/g, " ").toUpperCase(),
            description: "Custom user-defined overlay widget",
            version: "1.0.0",
            author: "custom",
            category: "custom",
            width: 400,
            height: 200,
            previewUrl: `/overlays/${entry.name}/`,
            isCustom: true,
          });
        }
      }
    }
  } catch (err: any) {
    console.error("[overlays] Error reading overlays dir:", err.message);
  }

  return list;
}

export function getMarketCatalog(): OverlayMarketItem[] {
  ensureOverlaysDir();
  const installed = new Set(getInstalledOverlays().map((o) => o.id));

  return MARKET_PRESETS.map((preset) => ({
    ...preset.meta,
    isInstalled: installed.has(preset.meta.id),
    previewUrl: `/overlays/${preset.meta.id}/`,
  }));
}

export function installMarketOverlay(overlayId: string): OverlayMeta | null {
  ensureOverlaysDir();
  const preset = MARKET_PRESETS.find((p) => p.meta.id === overlayId);
  if (!preset) return null;

  const targetDir = path.join(OVERLAYS_DIR, preset.meta.id);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const [filename, content] of Object.entries(preset.files)) {
    fs.writeFileSync(path.join(targetDir, filename), content, "utf-8");
  }

  return {
    ...preset.meta,
    isInstalled: true,
    previewUrl: `/overlays/${preset.meta.id}/`,
  };
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function createCustomOverlay(data: {
  id: string;
  name: string;
  description?: string;
  category?: "spotify" | "tiktok" | "combined" | "custom";
  width?: number;
  height?: number;
}): OverlayMeta {
  ensureOverlaysDir();
  const rawId = data.id.toLowerCase().replace(/[^a-z0-9-_]/g, "-").trim() || "my-overlay";
  const safeId = rawId === "studio" ? "custom-studio" : rawId;
  const targetDir = path.join(OVERLAYS_DIR, safeId);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const meta: OverlayMeta = {
    id: safeId,
    name: data.name || safeId,
    description: data.description || "Custom stream overlay",
    version: "1.0.0",
    author: "local",
    category: data.category || "custom",
    width: Number(data.width) || 400,
    height: Number(data.height) || 150,
    previewUrl: `/overlays/${safeId}/`,
    isCustom: true,
  };

  fs.writeFileSync(path.join(targetDir, "overlay.json"), JSON.stringify(meta, null, 2), "utf-8");

  const safeName = escapeHtml(meta.name);
  const starterHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Sans+Thai:wght@400;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: transparent;
      font-family: "Space Mono", "IBM Plex Sans Thai", monospace;
      padding: 10px;
    }
    .overlay-box {
      background: #181926;
      border: 3px solid #7dc4e4;
      padding: 14px;
      color: #cad3f5;
      box-shadow: 4px 4px 0px #1e2030;
      max-width: ${meta.width}px;
    }
    h2 { font-family: "Archivo Black", "IBM Plex Sans Thai", sans-serif; font-size: 14px; color: #7dc4e4; }
    p { font-size: 12px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="overlay-box">
    <h2>${safeName.toUpperCase()}</h2>
    <p id="status">Connecting to donate-socket live bridge...</p>
    <div id="content" style="margin-top: 8px; font-size: 11px; color: #a5adce;"></div>
  </div>

  <script>
    const statusEl = document.getElementById("status");
    const contentEl = document.getElementById("content");

    const es = new EventSource("/api/events");
    es.onopen = () => { statusEl.textContent = "Connected to live stream bridge ✓"; };
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const t = data.spotify?.currentTrack;
        contentEl.textContent = t ? ("Now: " + t.name + " (" + t.artist + ")") : "Spotify Idle";
      } catch (e) {}
    };
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(targetDir, "index.html"), starterHtml, "utf-8");
  return meta;
}

export function deleteOverlay(overlayId: string): boolean {
  ensureOverlaysDir();
  const safeId = path.basename(overlayId).trim();
  if (!safeId || safeId === "." || safeId === ".." || !/^[a-zA-Z0-9_-]+$/.test(safeId)) {
    return false;
  }
  const targetDir = path.resolve(OVERLAYS_DIR, safeId);
  const relative = path.relative(OVERLAYS_DIR, targetDir);
  if (relative.startsWith("..") || path.isAbsolute(relative) || targetDir === OVERLAYS_DIR) {
    return false;
  }

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

export function openFolderInOS(subpath?: string): Promise<{ success: boolean; path: string; platform: string; error?: string }> {
  ensureOverlaysDir();
  let targetPath = OVERLAYS_DIR;

  if (subpath && typeof subpath === "string") {
    const cleanSub = path.basename(subpath.trim());
    if (cleanSub && /^[a-zA-Z0-9_-]+$/.test(cleanSub)) {
      const candidate = path.join(OVERLAYS_DIR, cleanSub);
      if (fs.existsSync(candidate)) {
        targetPath = candidate;
      }
    }
  }

  const platform = process.platform;
  return new Promise((resolve) => {
    let cmd = "";
    if (platform === "darwin") {
      cmd = `open "${targetPath}"`;
    } else if (platform === "win32") {
      cmd = `explorer "${targetPath.replace(/\//g, "\\")}"`;
    } else {
      cmd = `xdg-open "${targetPath}"`;
    }

    exec(cmd, (err) => {
      if (err) {
        console.error(`[Overlays] Failed to open folder (${cmd}):`, err.message);
        resolve({ success: false, path: targetPath, platform, error: err.message });
      } else {
        resolve({ success: true, path: targetPath, platform });
      }
    });
  });
}

export function extractRepoName(url: string): string {
  if (!url || typeof url !== "string") return "";
  let clean = url.trim().split("?")[0].split("#")[0].replace(/\/+$/, "");

  // Match git hosts like github.com, gitlab.com, bitbucket.org
  const gitHostMatch = clean.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[:/]([^/]+)\/([^/]+)/i);
  if (gitHostMatch) {
    let repoName = gitHostMatch[2];
    repoName = repoName.replace(/\.git$/i, "");
    return repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  // Handle SSH git format git@...:owner/repo.git
  const sshMatch = clean.match(/[:/]([^/:]+?)(?:\.git)?$/i);
  if (sshMatch && sshMatch[1]) {
    return sshMatch[1].toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  // Path-based fallback
  const parts = clean.split("/").filter(Boolean);
  let last = parts.pop() || "";
  last = last.replace(/\.git$/i, "").replace(/\.zip$/i, "");
  if ((last === "main" || last === "master" || last === "head") && parts.length > 0) {
    const prev = parts.pop() || "";
    if (prev && !["archive", "refs", "heads"].includes(prev)) {
      last = prev;
    }
  }

  return last.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function checkGitAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("git --version", (err, stdout) => {
      resolve(!err && typeof stdout === "string" && stdout.includes("git version"));
    });
  });
}

function resolveZipUrl(gitUrl: string): string[] {
  const trimmed = gitUrl.trim().replace(/\.git$/, "");
  const urls: string[] = [];

  if (trimmed.endsWith(".zip")) {
    return [trimmed];
  }

  // GitHub: https://github.com/owner/repo
  const ghMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
  if (ghMatch) {
    const owner = ghMatch[1];
    const repo = ghMatch[2].replace(/\/.*$/, "");
    urls.push(`https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`);
    urls.push(`https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`);
    urls.push(`https://api.github.com/repos/${owner}/${repo}/zipball`);
    return urls;
  }

  // GitLab: https://gitlab.com/owner/repo
  const glMatch = trimmed.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+)/i);
  if (glMatch) {
    const owner = glMatch[1];
    const repo = glMatch[2].replace(/\/.*$/, "");
    urls.push(`https://gitlab.com/${owner}/${repo}/-/archive/main/${repo}-main.zip`);
    urls.push(`https://gitlab.com/${owner}/${repo}/-/archive/master/${repo}-master.zip`);
    return urls;
  }

  // Bitbucket: https://bitbucket.org/owner/repo
  const bbMatch = trimmed.match(/^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)/i);
  if (bbMatch) {
    const owner = bbMatch[1];
    const repo = bbMatch[2].replace(/\/.*$/, "");
    urls.push(`https://bitbucket.org/${owner}/${repo}/get/main.zip`);
    urls.push(`https://bitbucket.org/${owner}/${repo}/get/master.zip`);
    return urls;
  }

  urls.push(trimmed);
  return urls;
}

function extractZip(zipFilePath: string, destDir: string): Promise<boolean> {
  const platform = process.platform;
  return new Promise((resolve) => {
    let cmd = "";
    if (platform === "win32") {
      cmd = `tar -xf "${zipFilePath}" -C "${destDir}" 2>nul || powershell -command "Expand-Archive -LiteralPath '${zipFilePath}' -DestinationPath '${destDir}' -Force"`;
    } else {
      cmd = `unzip -q -o "${zipFilePath}" -d "${destDir}"`;
    }
    exec(cmd, (err) => {
      if (err) {
        console.error("[Overlays] Extract zip error:", err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function copyRecursiveSync(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "__MACOSX") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function downloadAndExtractZip(candidateUrls: string[], targetDir: string): Promise<boolean> {
  const tmpZip = path.join(os.tmpdir(), `overlay-download-${Date.now()}.zip`);
  const tmpExtract = path.join(os.tmpdir(), `overlay-extract-${Date.now()}`);

  try {
    let downloaded = false;
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "donate-socket-overlay-importer",
            Accept: "*/*",
          },
        });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          if (arrayBuf.byteLength > 100) {
            fs.writeFileSync(tmpZip, Buffer.from(arrayBuf));
            downloaded = true;
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[Overlays] Failed to download from ${url}:`, err.message);
      }
    }

    if (!downloaded || !fs.existsSync(tmpZip)) {
      throw new Error("Failed to download zip from repository");
    }

    fs.mkdirSync(tmpExtract, { recursive: true });
    const extracted = await extractZip(tmpZip, tmpExtract);
    if (!extracted) {
      throw new Error("Failed to extract zip archive");
    }

    // Check if the zip extracted into a single wrapper folder (e.g. repo-main/)
    const entries = fs.readdirSync(tmpExtract).filter((e) => !e.startsWith(".") && e !== "__MACOSX");
    let sourceDir = tmpExtract;
    if (entries.length === 1) {
      const singleDir = path.join(tmpExtract, entries[0]);
      if (fs.statSync(singleDir).isDirectory()) {
        sourceDir = singleDir;
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });
    copyRecursiveSync(sourceDir, targetDir);
    return true;
  } finally {
    try {
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
      if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
    } catch {}
  }
}

export async function pullOverlayFromGit(options: {
  gitUrl: string;
  id?: string;
}): Promise<{
  success: boolean;
  method: "git_clone" | "zip_download";
  overlay: OverlayMeta;
  path: string;
  hasGit: boolean;
}> {
  const gitUrl = (options.gitUrl || "").trim();
  if (!gitUrl) {
    throw new Error("Git repository URL is required");
  }

  ensureOverlaysDir();

  // Auto-generate ID from repo name if not provided
  let safeId = (options.id || "").trim();
  if (!safeId) {
    safeId = extractRepoName(gitUrl) || "imported-overlay";
  } else {
    safeId = safeId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  if (!safeId || safeId === "." || safeId === "..") {
    safeId = `overlay-${Date.now()}`;
  }

  const targetDir = path.resolve(OVERLAYS_DIR, safeId);
  const relative = path.relative(OVERLAYS_DIR, targetDir);
  if (relative.startsWith("..") || path.isAbsolute(relative) || targetDir === OVERLAYS_DIR) {
    throw new Error("Invalid overlay destination path");
  }

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  const hasGit = await checkGitAvailable();
  let method: "git_clone" | "zip_download" = "git_clone";

  if (hasGit) {
    try {
      console.log(`[Overlays] Git detected. Cloning ${gitUrl}...`);
      await new Promise<void>((resolve, reject) => {
        exec(`git clone --depth 1 "${gitUrl}" "${targetDir}"`, (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`git clone error: ${stderr || err.message}`));
          } else {
            resolve();
          }
        });
      });

      // Remove .git inside overlay directory to avoid nested repo issues
      const dotGit = path.join(targetDir, ".git");
      if (fs.existsSync(dotGit)) {
        fs.rmSync(dotGit, { recursive: true, force: true });
      }
    } catch (cloneErr: any) {
      console.warn(`[Overlays] git clone failed (${cloneErr.message}), falling back to zip download...`);
      method = "zip_download";
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      const candidateUrls = resolveZipUrl(gitUrl);
      await downloadAndExtractZip(candidateUrls, targetDir);
    }
  } else {
    console.log(`[Overlays] Git not detected. Fetching repository ZIP archive...`);
    method = "zip_download";
    const candidateUrls = resolveZipUrl(gitUrl);
    await downloadAndExtractZip(candidateUrls, targetDir);
  }

  // Ensure index.html exists
  let indexPath = path.join(targetDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    const subdirs = ["dist", "public", "build", "overlay", "src"];
    for (const sub of subdirs) {
      const candidate = path.join(targetDir, sub, "index.html");
      if (fs.existsSync(candidate)) {
        copyRecursiveSync(path.join(targetDir, sub), targetDir);
        break;
      }
    }
  }

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeId}</title></head><body><h1>Overlay: ${safeId}</h1><p>Imported from ${gitUrl}</p></body></html>`,
      "utf-8"
    );
  }

  // Ensure overlay.json exists
  const metaPath = path.join(targetDir, "overlay.json");
  let meta: OverlayMeta;

  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta = {
        id: safeId,
        name: parsed.name || safeId,
        description: parsed.description || `Imported from ${gitUrl}`,
        version: parsed.version || "1.0.0",
        author: parsed.author || "git",
        category: parsed.category || "custom",
        width: Number(parsed.width) || 480,
        height: Number(parsed.height) || 160,
        previewUrl: `/overlays/${safeId}/`,
        isCustom: true,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch {
      meta = {
        id: safeId,
        name: safeId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `Imported from ${gitUrl}`,
        version: "1.0.0",
        author: "git",
        category: "custom",
        width: 480,
        height: 160,
        previewUrl: `/overlays/${safeId}/`,
        isCustom: true,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    }
  } else {
    meta = {
      id: safeId,
      name: safeId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: `Imported from ${gitUrl}`,
      version: "1.0.0",
      author: "git",
      category: "custom",
      width: 480,
      height: 160,
      previewUrl: `/overlays/${safeId}/`,
      isCustom: true,
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  return {
    success: true,
    method,
    overlay: meta,
    path: targetDir,
    hasGit,
  };
}
