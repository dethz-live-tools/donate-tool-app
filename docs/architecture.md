# Architecture Overview

`donate-socket` is a high-performance cross-platform desktop application designed for livestreamers. It connects real-time TikTok LIVE donation events and Spotify playback state to external webhooks and interactive overlay systems.

---

## High-Level Architecture Diagram

```mermaid
graph TD
    subgraph Frontend ["Frontend UI (Tauri Webview)"]
        UI[React 19 + TypeScript + Vite]
        Style[RawBlock Brutalism + Catppuccin Macchiato]
        Dash[Dashboard Tab: Live Spotify & Activity Logs]
        Config[Configuration Tab: TikTok & Spotify Settings]
    end

    subgraph DesktopShell ["Tauri v2 Desktop Shell (Rust)"]
        MainRs[src-tauri/src/main.rs]
        LibRs[src-tauri/src/lib.rs]
        Spawn[Background Process Spawner]
    end

    subgraph Backend ["Backend HTTP & Event Bridge (:3001)"]
        Server[server/index.ts]
        State[server/state.ts (In-Memory State + SSE)]
        ConfigYaml[config.yaml]
        
        subgraph Services ["Services"]
            TikTokSvc[server/services/tiktok.ts]
            SpotifySvc[server/services/spotify.ts]
            WebhookSvc[server/services/webhook.ts]
        end

        subgraph Routes ["Modular Route Handlers"]
            TikTokRoutes[server/routes/tiktok.ts]
            SpotifyRoutes[server/routes/spotify.ts]
            StatusRoutes[server/routes/status.ts]
        end
    end

    subgraph External ["External Services"]
        TikTokLive[TikTok LIVE Servers]
        SpotifyAPI[Spotify Web API]
        WebhookEndpoint[Remote Webhook Target]
    end

    UI -->|HTTP REST & SSE /api/status/stream| Backend
    DesktopShell -->|Spawns on launch| Backend
    TikTokSvc -->|Webcast Push Connection| TikTokLive
    SpotifySvc -->|OAuth & Player / Queue API| SpotifyAPI
    WebhookSvc -->|HTTP POST JSON Payload| WebhookEndpoint
```

---

## Core Components

### 1. Tauri v2 Desktop Wrapper (`src-tauri/`)
- **Framework**: Tauri v2 (`donate-socket`, `zip.kizuna.donate`).
- **Process Management**: On desktop launch, `src-tauri/src/lib.rs` executes `spawn_server()` to automatically spawn the backend server (`server/index.ts`) in the background using Bun (or Node fallback).
- **Security**: Strict sandboxing with zero unnecessary system permissions.

### 2. Backend Bridge Service (`server/`)
The backend is a modular TypeScript service running on `http://127.0.0.1:3001`:
- **`server/index.ts`**: HTTP server entrypoint with CORS, route routing, and lifecycle hooks.
- **`server/state.ts`**: Thread-safe in-memory application state and real-time Server-Sent Events (SSE) broadcaster (`/api/status/stream`).
- **`server/config.ts`**: Persistent YAML configuration manager for `config.yaml` with automatic migration from legacy JSON configs.
- **`server/services/`**:
  - `tiktok.ts`: Integrates with `tiktok-live-connector` to parse gift events, diamonds/coins, and streamer room state.
  - `spotify.ts`: Manages OAuth token refresh, playback state polling (every 3s), queue/device discovery, and change-detection webhook dispatch.
  - `webhook.ts`: Handles HTTP POST dispatch with retry/timeout management and maintains the last 50 activity log entries.
- **`server/routes/`**: Clean RESTful routes separated into `tiktok.ts`, `spotify.ts`, and `status.ts`.

### 3. Frontend Application (`src/`)
- **Technology**: React 19, TypeScript, and Vite.
- **Design System**: RawBlock brutalism:
  - 0px border-radius everywhere (`border-radius: 0px !important`).
  - No drop shadows; structural depth created with 3px and 5px solid borders.
  - Catppuccin Macchiato color palette with Sapphire accent (`#7dc4e4`).
  - Typography: `Archivo Black` (display), `Space Mono` (monospace), `Work Sans` (body), with `IBM Plex Sans Thai` as fallback font across all stacks.
- **Tabs**:
  - **Dashboard**: Live TikTok stream status, interactive Spotify player (album art, track info, progress bar, play/pause/prev/next controls, active queue list, and playback device selector), dispatch specification previews, and live webhook logs.
  - **Configuration**: TikTok streamer username, webhook URI target, Spotify Client ID/Secret OAuth management, and quick test dispatch buttons.
