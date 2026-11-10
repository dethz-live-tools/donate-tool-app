# Spotify Integration Setup Guide

`donate-socket` integrates directly with Spotify Web API to display live playback status, provide player controls, list active playing queue songs, switch playback devices, and dispatch status webhooks.

---

## 1. Create a Spotify Developer Application

1. Log into the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Click **Create app**.
3. Fill in the App details:
   - **App name**: `Donate Socket Bridge` (or your preferred name)
   - **App description**: Desktop companion tool for live stream media alerts
   - **Redirect URI**: 
     ```text
     http://127.0.0.1:3001/api/spotify/callback
     ```
     > [!IMPORTANT]
     > The redirect URI must match exactly: `http://127.0.0.1:3001/api/spotify/callback`.
   - **APIs used**: Select **Web API**.
4. Check the Terms of Service checkbox and click **Save**.

---

## 2. Obtain Credentials

1. Go to your app's **Settings** tab in the Spotify Developer Dashboard.
2. Copy your **Client ID**.
3. Click **View client secret** and copy your **Client Secret**.

---

## 3. Configure in `donate-socket`

1. Open `donate-socket` and navigate to the **CONFIGURATION** tab.
2. In the **SPOTIFY INTEGRATION CONFIGURATION** section:
   - Paste your **Spotify Client ID**.
   - Paste your **Spotify Client Secret**.
3. Click **AUTHORIZE SPOTIFY**.
4. Your default browser will open the official Spotify authorization page.
5. Click **Agree** to grant permissions.
6. The browser will redirect back to `http://127.0.0.1:3001/api/spotify/callback`, which exchanges the authorization code for a long-lived refresh token and closes or displays success.
7. The status in `donate-socket` will change to **✓ LINKED**.

---

## 4. Granted Permissions (Scopes)

The integration requests the following scopes:

| Scope | Purpose |
| :--- | :--- |
| `user-read-playback-state` | Read active player state, track, and connected devices |
| `user-modify-playback-state` | Control playback (play, pause, next, previous, switch devices) |
| `user-read-currently-playing` | Track real-time progress and now playing song |
| `streaming` & `app-remote-control` | Remote control streaming playback |
| `playlist-read-private` & `collaborative` | Resolve playlist context names |
| `user-library-read` | Resolve saved track information |

---

## 5. Features in Dashboard

Once linked, open the **DASHBOARD** tab:

### Player Selector Dropdown
- Located at the top of the Spotify Card.
- Displays all available Spotify devices (e.g. `Web Player (Chrome)`, `MacBook Pro`, `iPhone`, `Spotify Connect Speakers`).
- Select any device from the dropdown to instantly transfer playback to that device.
- Click **🔄 DEVICES** to refresh the device list.

### Player Controls & Progress
- Displays live cover art, song title, artist, album, and playlist name.
- Real-time progress bar with current and total duration (`mm:ss`).
- Interactive controls: `|◀ PREV`, `▶ PLAY` / `❚❚ PAUSE`, and `NEXT ▶|`.
- **📡 WEBHOOK TEST**: Immediately dispatches the current track and device status to your configured webhook URI.

### Current Playing Song List
- Below the player card, click **▶ LOAD SONG LIST** to view the active queue.
- Shows the currently playing track with a green `▶ NOW PLAYING` chip.
- Shows all upcoming queue tracks with track numbers, album art, title, artist, and duration.
- Individual **▶ PLAY** button next to each song to jump directly to that track.
