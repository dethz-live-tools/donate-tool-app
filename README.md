# donate-socket

> Real-time TikTok LIVE donation bridge and Spotify playback status desktop tool. Dispatches instant webhook alerts for live stream gifts and media state changes.

Built with **Tauri v2**, **React 19**, **TypeScript**, **Vite**, and **Bun**, styled in a **RawBlock brutalist** aesthetic using the **Catppuccin Macchiato** palette with a **Sapphire** accent (`#7dc4e4`) and **IBM Plex Sans Thai** fallback typography.

---

## Features

- 🎁 **TikTok LIVE Gift & Coin Listener**
  - Connects to active live streams using `tiktok-live-connector`.
  - Dispatches structured HTTP POST webhooks immediately when gifts or donations are received.
  - Automatically reconnects and displays real-time room status (`connected`, `connecting`, `disconnected`, `error`).
  - Robust combo streak gift debouncing with fallback timeout protection so no gifts are lost.

- 🗣️ **TikTok Chat Reader & Text-to-Speech (TTS)**
  - Real-time live chat listener with native speech synthesis audio output.
  - Configurable TTS voice, speech speed rate, pitch, volume, and message read templates.
  - Automatic bot command filter (skips `!` commands like `!sr`).
  - Interactive speech controls with instant replay button on every incoming chat message.

- 🎵 **Spotify Desktop Integration & Song Requests**
  - **Now Playing Display**: Live cover art, song title, artist, album, playlist context, and duration progress bar.
  - **Player Controls**: Remote playback commands (`play`, `pause`, `next`, `previous`).
  - **Live Queue & Track List**: Browse and jump to songs currently queued in your active Spotify session.
  - **Device / Player Selector**: Switch active playback across your desktop, web player, mobile phone, or smart speakers directly from the interface.
  - **Spotify Song Request**: In-app track search & direct URL/URI queuing with full request history.
  - **TikTok Live Chat Song Requests**: Viewers can request songs live by typing `!sr <song title>` or `!request <spotify link>`.
  - **Proactive Token Auto-Refresh**: Background timer refreshes Spotify tokens before expiration for 24/7 stream stability.
  - **Song-Change Webhooks**: Webhooks trigger strictly when songs change without spamming playback pause/resume state.

- 🗂️ **Modular Minimized Dashboard Boxes**
  - Collapsible RawBlock cards with persistent minimize/expand states.
  - Quick action toolbar (`EXPAND ALL` / `MINIMIZE ALL`) to streamline streamer workspace.

- 📺 **Stream Overlays & In-App Market**
  - **Local Static Serving**: Hosts transparent HTML5/CSS3 widgets directly from `overlays/` at `http://127.0.0.1:3001/overlays/<id>/` for OBS Studio and Streamlabs.
  - **In-App Marketplace**: Browse, install, preview, and copy OBS Browser Source URLs with 1-click.
  - **Built-in Presets**: RawBlock Spotify Player, TikTok Live Gift Alert Box, Minimal Floating Song Pill, and Stream Dual Ticker.
  - **Custom Overlay Scaffolding**: Create and customize custom web widgets directly from the UI.

- ⚡ **Multi-OS Desktop Native App**
  - Packaged with **Tauri v2** for ultra-low memory footprint and instant startup.
  - Self-contained background service spawner for the Node/Bun API bridge.
  - Cross-platform builds for macOS (Apple Silicon + Intel), Linux (Debian/AppImage), and Windows (MSI/EXE).

- 🎨 **RawBlock Brutalist Interface**
  - Anti-design brutalism with strict `0px` border-radius and `0px` drop shadows.
  - High-contrast visual hierarchy built with `3px` and `5px` solid structural borders.
  - Catppuccin Macchiato dark theme with vibrant Sapphire highlights.
  - Comprehensive Thai character support via `IBM Plex Sans Thai` fallback font.

- 📡 **Live Webhook Activity Logs**
  - In-memory dispatch history of the last 50 webhook transmissions.
  - Inspect HTTP status codes, latency, payload JSON, target URIs, and remote server responses.
  - Quick test buttons for both TikTok gift schemas and Spotify status schemas.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [Node.js](https://nodejs.org/) (v20+ LTS)
- [Rust](https://rustup.rs/) (stable toolchain)

### Installation

```bash
# Clone the repository
git clone https://github.com/dethz-tools/donate-tools-pc.git
cd donate-tools-pc

# Install dependencies
bun install
```

### Running Locally

```bash
# Launch full Tauri v2 Desktop App (spawns backend + UI)
bun run dev:ui

# Or run in browser/dev mode (without native desktop window)
bun run dev
```

The background bridge server will start on `http://127.0.0.1:3001` and the frontend UI will be accessible on `http://localhost:1420`.

---

## Configuration

Settings can be managed directly in the application's **CONFIGURATION** tab or by editing `config.yaml` in the project root:

```yaml
tiktok:
  username: your_tiktok_username
webhook:
  uri: https://your-server.com/api/webhook
spotify:
  client_id: your_spotify_client_id
  client_secret: your_spotify_client_secret
  refresh_token: your_spotify_refresh_token
```

---

## Webhook Payloads

Every event posts `application/json` to your configured `webhook.uri`.

### 1. TikTok Gift Event

```json
{
  "username": "gifter_name",
  "giftName": "Rose",
  "coins": 20
}
```

### 2. Spotify Playback Status Event

Dispatched on song change, play/pause, or manual test:

```json
{
  "event": "spotify_status",
  "isPlaying": true,
  "trackName": "Again",
  "artist": "Shiloh Dynasty, timmies",
  "album": "Vivid Pictures",
  "albumArt": "https://i.scdn.co/image/ab67616d0000b273a96efbf231ca824132bfd2fc",
  "durationMs": 157205,
  "progressMs": 132813,
  "playlistName": "just left me alone..",
  "playlistUri": "spotify:playlist:1MT9sutHKwrZ9vaw61yfIE",
  "track": {
    "name": "Again",
    "artist": "Shiloh Dynasty, timmies",
    "album": "Vivid Pictures",
    "albumArt": "https://i.scdn.co/image/ab67616d0000b273a96efbf231ca824132bfd2fc",
    "durationMs": 157205,
    "progressMs": 132813,
    "isPlaying": true,
    "playlistName": "just left me alone..",
    "playlistUri": "spotify:playlist:1MT9sutHKwrZ9vaw61yfIE"
  },
  "device": {
    "id": "7cdb792e692c6f008a4c6683671d47494ec18ca3",
    "name": "Web Player (Chrome)",
    "type": "Computer",
    "isActive": true,
    "volumePercent": 32
  },
  "timestamp": 1794290588909
}
```

---

## Documentation Index

Detailed guides are located in the [`docs/`](file:///docs/) directory:

- 🏛️ [**Architecture & System Design**](file:///docs/architecture.md): Overview of Tauri desktop runtime, Node/Bun server, SSE state synchronization, and services.
- 📺 [**Overlays & Marketplace Guide**](file:///docs/overlays.md): Browser Source configuration in OBS, built-in presets, and building custom widgets.
- 📡 [**Webhook Specifications**](file:///docs/webhooks.md): Full schema definitions, dispatch behavior, edge cases, and logging details.
- 🎵 [**Spotify Setup Guide**](file:///docs/spotify-setup.md): Step-by-step instructions for creating a Spotify Developer App, granting scopes, and linking your account.
- 🔨 [**Build & Release Guide**](file:///docs/build-and-release.md): Compiling binaries locally and understanding the automated multi-OS GitHub Actions workflow.

---

## License

MIT License. Designed and maintained for stream automation and media integration.
