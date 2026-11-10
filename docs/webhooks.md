# Webhook Specifications & Events

`donate-socket` forwards real-time stream and media events to any configured HTTP/HTTPS webhook endpoint using `POST` requests with `Content-Type: application/json`.

---

## Event Types

The bridge sends two main categories of webhook events:
1. **TikTok Live Gifts** (Donations and gift animations)
2. **Spotify Playback Status** (Track transitions and play/pause state updates)

---

## 1. TikTok Live Gift Payload

Dispatched immediately whenever a viewer sends a gift during the live broadcast.

### Payload Schema

```json
{
  "username": "streamer_fan99",
  "giftName": "Rose",
  "coins": 1
}
```

### Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `username` | `string` | The TikTok username (`uniqueId`) of the user who sent the gift. |
| `giftName` | `string` | The display name of the gift (e.g. `Rose`, `Leon the Kitten`, `Galaxy`). |
| `coins` | `number` | The diamond / coin value of the gift. |

---

## 2. Spotify Playback Status Payload

Dispatched when playback state changes:
- Track changes (new song title, artist, or album)
- Playback status changes (playing $\leftrightarrow$ paused)
- Playback stops or resumes
- Triggered manually via **📡 WEBHOOK TEST** in Dashboard or Configuration

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

## Activity Logging & Inspection

Every outgoing webhook dispatch is recorded into local state:
- Keeps the last 50 entries in memory.
- Logs include: timestamp, event type tag (`gift`, `test`, `spotify`), HTTP status code, target URI, raw dispatched payload, and remote server response snippet.
- Visual status indicators in the UI:
  - Green tag: `spotify`
  - Mauve / Sapphire tag: `gift`
  - Lavender tag: `test`
  - Green status text: `STATUS 200 OK`
  - Red status text: `FAILED (HTTP 500)` or network error message
