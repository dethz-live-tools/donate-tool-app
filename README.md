# donate-socket

> Real-time TikTok LIVE donation bridge and Spotify playback status desktop tool. Dispatches instant webhook alerts for live stream gifts and media state changes.

Built with **Tauri v2**, **React 19**, **TypeScript**, **Vite**, and **Bun**, styled in a **RawBlock brutalist** aesthetic using the **Catppuccin Macchiato** palette with a **Sapphire** accent (`#7dc4e4`) and **IBM Plex Sans Thai** fallback typography.

---

## Features

- 🎁 **TikTok LIVE Gift & Coin Listener**
  - Connects to active live streams using `tiktok-live-connector`.
  - Automatically polls every 30 seconds (`LIVE_CHECK_INTERVAL_MS`) while offline and connects when the streamer goes live, resuming polling after disconnects or stream end.
  - Dispatches structured HTTP POST webhooks immediately when gifts or donations are received.
  - Robust combo streak gift debouncing with a 3.5s fallback timeout so no gifts are lost.

- 🗣️ **TikTok Chat Reader & Text-to-Speech (TTS)**
  - Real-time live chat listener with `msedge-tts` synthesis (`/api/tts/speak`) and Web Speech audio output.
  - Role-based access control (`owner`, `moderator`, `subscriber`, `follower`, `guest`) for both TTS read-out and chat bot commands (`!sr`, `!songrequest`, `!request`, `!song`).
  - Configurable TTS voice, speech speed rate, pitch, volume, and single-pass message read templates (`{nickname}`, `{username}`, `{comment}`).
  - Optional chat/TTS webhook forwarding (`webhook.uri_chat` with fallback to `webhook.uri`) and instant replay button per message.

- 🎵 **Spotify Desktop Integration & Song Requests**
  - **Now Playing Display**: Live cover art, song title, artist, album, playlist context, and duration progress bar.
  - **Player Controls**: Remote playback commands (`play`, `pause`, `next`, `previous`).
  - **Live Queue & Track List**: Browse and jump to songs currently queued in your active Spotify session.
  - **Device / Player Selector**: Switch active playback across your desktop, web player, mobile phone, or smart speakers directly from the interface.
  - **Spotify Song Request**: In-app track search & direct URL/URI queuing with full request history.
  - **TikTok Live Chat Song Requests**: Viewers can request songs live by typing `!sr <song title>` or `!request <spotify link>`.
  - **Proactive Token Auto-Refresh**: Background timer refreshes Spotify tokens before expiration for 24/7 stream stability.
  - **Song-Change Webhooks**: Webhooks trigger when songs or playback states change without spamming progress ticks, supporting a dedicated `webhook.uri_spotify` endpoint.

- 🗂️ **Modular Minimized Dashboard Boxes & Bilingual UI**
  - Collapsible RawBlock cards with persistent minimize/expand states (`EXPAND ALL` / `MINIMIZE ALL`) and collapsible sidebar navigation.
  - Full **English / Thai (`EN` / `ไทย`)** UI translation switcher in the sidebar (`localStorage` persisted).
  - Built-in GitHub release update checker on launch and in the **ABOUT** tab.

- 📺 **Overlays Market & Overlay Studio**
  - **Local Static Serving**: Hosts transparent HTML5/CSS3 widgets directly from `overlays/` at `http://127.0.0.1:3001/overlays/<id>/` for OBS Studio and Streamlabs.
  - **In-App Marketplace & Custom Widgets**: Browse, preview, scaffold custom widgets, and copy OBS Browser Source URLs with 1-click.
  - **Built-in Presets**: RawBlock Spotify Player, TikTok Live Gift Alert Box, Minimal Floating Song Pill, and Stream Dual Ticker.
  - **Overlay Studio**: Combine multiple overlays plus external HTTP/HTTPS iframe layers onto a unified scene, save named OBS scene profiles (`?profile=<id>`), preview TikTok LIVE safe zones, and sync live via SSE.

- ⚡ **Multi-OS Desktop Native App**
  - Packaged with **Tauri v2** for ultra-low memory footprint and instant startup.
  - Self-contained background service spawner for the Bun-compiled backend (with hidden console window on Windows and `BRIDGE: ONLINE/OFFLINE` sidebar status).
  - Persistent per-OS configuration in app data directories (`%APPDATA%\dethz-lab\dethz-socket\config.yaml` on Windows with legacy migration; `~/Library/Application Support/zip.kizuna.donate/config.yaml` on macOS; `~/.local/share/zip.kizuna.donate/config.yaml` on Linux).
  - Cross-platform release builds for macOS (Apple Silicon + Intel), Linux (Debian/RPM/AppImage), and Windows (NSIS/MSI + Portable ZIP).

- 🎨 **RawBlock Brutalist Interface**
  - Anti-design brutalism with strict `0px` border-radius and `0px` drop shadows.
  - High-contrast visual hierarchy built with `3px` and `5px` solid structural borders.
  - Catppuccin Macchiato dark theme with vibrant Sapphire highlights.
  - Comprehensive Thai character support via `IBM Plex Sans Thai` fallback font.

- 📡 **Live Webhook Activity Logs & SSRF Hardening**
  - Per-type retention of up to 50 webhook transmissions per type (250 total) with **ALL / GIFT / TTS / SPOTIFY** filter tabs.
  - Inspect HTTP status codes, target URIs, payload JSON, and remote server responses, with quick test buttons per event type.
  - Blocks disallowed protocols, embedded credentials, cloud metadata/link-local addresses (including IPv6 and IPv4-mapped forms), internal API port loopbacks, and HTTP redirects (`redirect: "error"`).

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [Node.js](https://nodejs.org/) (v20+ LTS; CI runs Node 24)
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

### Testing & Verification

```bash
# Run backend, security, Studio, and i18n unit tests
bun test

# Type-check and build frontend bundle
bun run build

# Run Tauri Rust tests (Windows config resolution & legacy migration)
cd src-tauri && cargo test
```

---

## Configuration

Settings can be managed directly in the application's **CONFIGURATION** tab or by editing `config.yaml` in the project root (during development; packaged builds store `config.yaml` in the OS application data directory):

```yaml
tiktok:
  username: your_tiktok_username
webhook:
  uri: https://your-server.com/api/webhook # Gift events
  uri_chat: "" # Optional: chat/TTS events (falls back to uri)
  uri_spotify: "" # Optional: Spotify events (falls back to uri)
spotify:
  client_id: your_spotify_client_id
  client_secret: your_spotify_client_secret
  refresh_token: your_spotify_refresh_token
tts:
  allowed_roles: [owner, moderator, subscriber] # Omit or empty = all roles
commands:
  allowed_roles: [owner, moderator] # Chat commands (!sr / !songrequest / !request / !song)
```

---

## Webhook Payloads

Every event posts `application/json` to the matching configured endpoint (`webhook.uri`, `webhook.uri_chat`, or `webhook.uri_spotify`, falling back to `webhook.uri`).

### 1. TikTok Gift Event

```json
{
  "event": "tiktok_gift",
  "username": "gifter_name",
  "nickname": "Gifter Name",
  "giftName": "Rose",
  "coins": 20,
  "diamondCount": 1,
  "repeatCount": 20,
  "giftId": 5655,
  "giftPictureUrl": "https://...",
  "profilePictureUrl": "https://...",
  "userId": "123456789",
  "timestamp": 1794290588909
}
```

### 2. TikTok Chat / TTS Event

Dispatched when TTS webhook forwarding is enabled and the viewer matches `tts.allowed_roles` (excluding `!` bot commands when ignored):

```json
{
  "event": "tts",
  "username": "viewer_name",
  "nickname": "Viewer Display Name",
  "comment": "Hello streamer!",
  "text": "Viewer Display Name says Hello streamer!",
  "voice": "th-TH-NiwatNeural",
  "timestamp": 1794290588909
}
```

### 3. Spotify Playback Status Event

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

Detailed guides are located in the [`docs/`](docs/) directory:

- 🏛️ [**Architecture & System Design**](docs/architecture.md): Overview of Tauri desktop runtime, Bun bridge server, SSE state synchronization, i18n, and services.
- 🆕 [**Latest Features (v0.1.11+)**](docs/latest-features.md): Update checker, role-based bot access, split webhooks, log filters, EN/TH language switcher, auto live polling, portable builds, and hardening.
- 📺 [**Overlays & Marketplace Guide**](docs/overlays.md): Browser Source configuration in OBS, Overlay Studio, named profiles, and custom widgets.
- 📡 [**Webhook Specifications**](docs/webhooks.md): Full schema definitions for gift, TTS/chat, and Spotify webhooks plus SSRF checks and log retention.
- 🎵 [**Spotify Setup Guide**](docs/spotify-setup.md): Step-by-step instructions for creating a Spotify Developer App, granting scopes, and linking your account.
- 🔨 [**Build & Release Guide**](docs/build-and-release.md): Running tests, compiling binaries locally, packaged config paths, and multi-OS GitHub Actions workflows.
- 🛡️ [**Security Audit & Hardening Guide**](docs/security-audit.md): Vulnerability hardening record, CI CodeQL / `bun audit` / Shannon checks, and local pentest setup.

---

## License

MIT License. Designed and maintained for stream automation and media integration.
