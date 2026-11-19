# Latest Features (v0.1.11 — v0.1.17 & Unreleased)

Guide to features added after the original documentation set. Covers update checking, bilingual UI, role-based access, split webhooks, live polling, log filtering, packaged config paths, security hardening, and build changes.

## In-App Update Checker

On launch the app queries the GitHub releases API for
`dethz-live-tools/donate-tool-app` and compares against the running version
(`__APP_VERSION__`, injected at build time from `package.json`).

- Newer release found → dismissible `[UPDATE]` banner with a link to the
  release page.
- **ABOUT** sidebar tab shows current version and update status:
  `CHECKING...`, `CHECK FAILED`, `NOT CHECKED`, `UPDATE AVAILABLE: <tag>`, or
  `UP TO DATE` — plus a manual `CHECK FOR UPDATES` button.
- Offline or GitHub rate-limited (60 req/hr unauthenticated) → status shows
  check failure; retry via the button.

## Role-Based Bot Access

TTS read-out and chat bot commands (`!sr` / `!songrequest`) can be restricted
per TikTok user role. Roles detected from chat data:
`owner`, `moderator`, `subscriber`, `follower`, `guest`.

- Toggle boxes in the chat reader TTS settings drawer:
  - **SPEAK CHATS FROM** — which roles trigger TTS speech.
  - **BOT COMMANDS FROM** — which roles may execute bot commands.
- Persisted to `config.yaml`:

```yaml
tts:
  allowed_roles: [owner, moderator, subscriber]   # absent/empty = all roles
commands:
  allowed_roles: [owner, moderator]
```

- Empty/absent list = everyone allowed (default keeps old behavior).
- Guests detected via `user.isFollower`; other roles from `userIdentity`
  flags. If TikTok omits identity data for a message, that user falls back to
  `guest`.

## Split Webhooks (gift / chat / spotify)

`webhook.uri` now receives TikTok **gift** events only. Optional separate
endpoints:

| config.yaml key        | receives                         | fallback          |
|------------------------|----------------------------------|-------------------|
| `webhook.uri`          | gift events (`event: gift`)      | —                 |
| `webhook.uri_chat`     | chat/TTS events (`event: tts`)   | `webhook.uri`     |
| `webhook.uri_spotify`  | Spotify song change              | `webhook.uri`     |

Empty chat/spotify URL falls back to the gift URL. Configured in the app
**CONFIGURATION** tab (three labeled fields) or directly in `config.yaml`.

## Live Log Filtering

Webhook dispatch log box gained filter tabs: **ALL / GIFT / TTS / SPOTIFY**.
GIFT tab also shows test-webhook entries. Server keeps up to 50 entries per
type (250 total), so high gift volume never evicts TTS/Spotify history.

## Bilingual UI (English / Thai)

- Added in `v0.1.17` (`src/i18n.tsx`) and completed across the sidebar, navigation, status chips, banners, and all five tabs (**Dashboard**, **Configuration**, **Overlays**, **Overlay Studio**, **About**).
- Switch between `ENGLISH` (`en`) and `ไทย` (`th`) from the sidebar **SYSTEM STATUS** panel; choice persists in `localStorage` (`donate_socket_lang`).
- `tFor()` performs prototype-safe dictionary lookups with English fallback and placeholder interpolation (`{username}`, `{room}`, `{tag}`, `{err}`, etc.).

## Automatic TikTok LIVE Polling

When `connectLive()` runs against a configured username that is currently offline (`server/services/tiktok.ts`):
- Polls `fetchIsLive()` every 30 seconds (`LIVE_CHECK_INTERVAL_MS`) while keeping status in `connecting`.
- Automatically establishes the webcast connection once the streamer goes live.
- Resumes 30-second polling after `WebcastEvent.STREAM_END` or unexpected `ControlEvent.DISCONNECTED`, honors `retryAfter` backoff when provided, and stops on `disconnectLive()` or `InvalidUniqueIdError`.

## Backend Terminal, Bridge Indicator & Packaged Config Paths

- On Windows the backend process launches with `CREATE_NO_WINDOW` (and compiled with `--windows-hide-console`) — no console window pops up next to the app.
- Sidebar **SYSTEM STATUS** shows `BRIDGE: ONLINE/OFFLINE`, fed by the `/api/status` probe and SSE connection. Expect `OFFLINE` briefly during backend cold start.
- Packaged desktop builds resolve Windows config files to `%APPDATA%\dethz-lab\dethz-socket\config.yaml` and automatically migrate an existing legacy `zip.kizuna.donate\config.yaml` once on startup without overwriting existing target files (`src-tauri/src/lib.rs`).

## Security & CI Hardening

- Shared `classifyBlockedHost()` (`server/utils.ts`) blocks metadata, link-local, loopback, and bracketed IPv6 / IPv4-mapped IPv6 targets across webhooks and Overlay Studio external iframe layers; webhook requests also set `redirect: "error"`.
- TTS message templates substitute `{nickname}`, `{username}`, and `{comment}` in a single pass.
- GitHub workflows use Node 24 (`actions/checkout@v7`, `actions/setup-node@v7`) and Bun (`oven-sh/setup-bun@v2`), enforce `bun audit` in `.github/workflows/security.yml`, and pass `VERSION` via step `env:` in `.github/workflows/release.yml`.

## Build & Release

- `bun run build:full` — frontend (`tsc && vite build`) → backend binary (`scripts/build-backend.ts`) → Tauri release bundle in one command.
- GitHub release workflow (`release.yml`) builds macOS (`aarch64` + `x86_64`), Linux (`.deb`, `.rpm`, `.AppImage`), and Windows NSIS (`-setup.exe`), MSI (`.msi`), and portable ZIP (`donate-socket_<version>_x64-portable.zip` with `donate-socket.exe`, `backend/donate-server.exe`, `config.example.yaml`, and `overlays/`).

## Related

- Webhook payload schemas & split routing: [webhooks.md](webhooks.md)
- Build & packaged config details: [build-and-release.md](build-and-release.md)
- Hardening & CI scans: [security-audit.md](security-audit.md)
- Latest local pentest logs: `pentest_log/scan-2026-11-20.md` and `pentest_log/pentest-log-2026-11-20.md`