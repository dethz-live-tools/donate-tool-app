# Webhook Specifications & Events

`donate-socket` forwards real-time stream, TTS/chat, and media events to configured HTTP/HTTPS webhook endpoints using `POST` requests with `Content-Type: application/json`.

---

## Event Types & Split Routing

The bridge dispatches three categories of webhook events and supports routing each category to a dedicated URL in `config.yaml` (or the **CONFIGURATION** tab):

| Config Key | Event Category | Fallback |
| :--- | :--- | :--- |
| `webhook.uri` | **TikTok Live Gifts** (`event: "tiktok_gift"`) & manual gift tests | — |
| `webhook.uri_chat` | **TikTok Chat / TTS** (`event: "tts"`) | `webhook.uri` |
| `webhook.uri_spotify` | **Spotify Playback Status** (`event: "spotify_status"`) | `webhook.uri` |

---

## 1. TikTok Live Gift Payload

Dispatched when a viewer sends a gift during the live broadcast. Combo gift streaks are debounced until the streak ends (`repeatEnd`) or a 3.5-second fallback timeout fires.

### Payload Schema

```json
{
  "event": "tiktok_gift",
  "username": "streamer_fan99",
  "nickname": "Fan Display Name",
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

### Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `event` | `string` | Constant identifier: `"tiktok_gift"`. |
| `username` | `string` | TikTok `displayId` / `uniqueId` of the sender. |
| `nickname` | `string` | Display nickname of the sender. |
| `giftName` | `string` | Gift display name (e.g. `Rose`, `Galaxy`). |
| `coins` | `number` | Computed total diamond/coin value (`diamondCount * repeatCount`). |
| `diamondCount` | `number` | Per-gift diamond value. |
| `repeatCount` | `number` | Accumulated streak count for the gift event. |
| `giftId` | `number \| string` | TikTok gift ID when provided. |
| `giftPictureUrl` | `string \| null` | Gift icon URL when provided. |
| `profilePictureUrl` | `string \| null` | Sender avatar URL when provided. |
| `userId` | `string` | Sender numeric/string user ID when provided. |
| `timestamp` | `number` | Epoch timestamp (milliseconds) when the payload was built. |

---

## 2. TikTok Chat / TTS Payload

Dispatched when TTS webhook forwarding is enabled, the viewer's role is permitted by `tts.allowed_roles` (`owner`, `moderator`, `subscriber`, `follower`, `guest`), and `!` bot commands are not excluded by `tts.ignoreBotCommands`. Template variables (`{nickname}`, `{username}`, `{comment}`) are substituted in a single pass.

### Payload Schema

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

### Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `event` | `string` | Constant identifier: `"tts"`. |
| `username` | `string` | TikTok `displayId` / `uniqueId` of the commenter. |
| `nickname` | `string` | Display nickname of the commenter. |
| `comment` | `string` | Raw chat message text. |
| `text` | `string` | Formatted speech string built from `tts.template`. |
| `voice` | `string` | Configured voice ID (defaults to `th-TH-NiwatNeural`). |
| `timestamp` | `number` | Epoch timestamp (milliseconds) when dispatched. |

---

## 3. Spotify Playback Status Payload

Dispatched when playback state changes:
- Track changes (new song title, artist, or album)
- Playback status changes (playing $\leftrightarrow$ paused)
- Playback stops or resumes
- Triggered manually via **TEST SPOTIFY WEBHOOK** in Configuration or Dashboard

> [!NOTE]
> The engine avoids rate-limit spam by tracking track identity and playback state. Continuous progress changes during playback do **not** trigger webhook requests.

### Payload Schema

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

### Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `event` | `string` | Constant identifier: `"spotify_status"`. |
| `isPlaying` | `boolean` | `true` if audio is currently playing; `false` if paused or idle. |
| `trackName` | `string \| null` | Name of the active song (`null` if stopped). |
| `artist` | `string \| null` | Comma-separated list of track artists. |
| `album` | `string \| null` | Name of the album or show. |
| `albumArt` | `string \| null` | High-resolution cover artwork URL. |
| `durationMs` | `number` | Total duration of the track in milliseconds. |
| `progressMs` | `number` | Playback position in milliseconds when dispatched. |
| `playlistName` | `string \| null` | Name of the active playlist (if context is a playlist). |
| `playlistUri` | `string \| null` | Spotify URI of the active context playlist. |
| `track` | `object \| null` | Full track metadata object. |
| `device` | `object \| null` | Active Spotify playback device information. |
| `timestamp` | `number` | Epoch timestamp (milliseconds) when the webhook was sent. |

---

## Validation & SSRF Controls

Before dispatching, `validateWebhookUrl()` and `sendWebhook()` (`server/services/webhook.ts`) enforce:
- Only `http:` and `https:` URLs are allowed; embedded credentials (`user:pass@...`) are rejected.
- `classifyBlockedHost()` (`server/utils.ts`) blocks cloud metadata and link-local addresses (`169.254.*`, `metadata.google.internal`, `fd00:ec2::254`, `fe80:*`, `::ffff:a9fe:*`, `::ffff:169.254.*`) and blocks loopback targets (`localhost`, `127.*`, `0.0.0.0`, `::1`, `::`, IPv4-mapped IPv6 variants) when pointing at the bridge API port (`3001` / `PORT`).
- Requests time out after 10 seconds and disallow HTTP redirects (`redirect: "error"`).

---

## Activity Logging & Inspection

Every outgoing webhook dispatch is recorded into local state:
- Retains up to **50 entries per type** (up to **250 total**) across `gift`, `test`, `system`, `spotify`, and `tts`, preventing high gift traffic from evicting TTS or Spotify history.
- Dashboard log box provides filter tabs: **ALL / GIFT / TTS / SPOTIFY** (**GIFT** includes `test` webhook entries).
- Logs include timestamp, event type tag, HTTP status code, target URI, raw dispatched JSON payload, and truncated response body (up to 300 chars) or error message.
