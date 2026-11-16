# Latest Features (v0.1.11 — v0.1.16)

Guide to features added after the original documentation set. Covers update
checking, role-based access, split webhooks, log filtering, and build changes.

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

## Backend Terminal & Bridge Indicator

- On Windows the backend process launches with `CREATE_NO_WINDOW` — no console
  window pops up next to the app.
- Sidebar **SYSTEM STATUS** shows `BRIDGE: ONLINE/OFFLINE`, fed by the
  `/api/status` probe and SSE connection. Expect `OFFLINE` briefly during
  backend cold start.

## Build & Release

- `bun run build:full` — frontend (`tsc && vite build`) → backend binary
  (`scripts/build-backend.ts`) → Tauri release bundle in one command.
- GitHub release workflow (`release.yml`) builds Windows
  `nsis,msi,portable` — a portable `.exe` (no installer) is attached alongside
  the setup and MSI artifacts.

## Related

- Webhook payload schemas: [webhooks.md](webhooks.md)
- Build workflow details: [build-and-release.md](build-and-release.md)
- Pentest findings: `pentest_log/2026-11-16.md` and `docs/security-audit.md`