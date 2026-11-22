# Screen Share Receiver (WHIP) Guide

`donate-socket` includes a LAN **WHIP** (RFC 9725) WebRTC screen-share receiver. Any external WHIP sender on your local network (such as OBS Studio on a second PC, a mobile WHIP app, or a GStreamer/browser publisher) can push video and audio directly into `donate-socket` for both **in-app preview** and a **clean OBS Browser Source**.

---

## 1. Start the Receiver

1. Open the **SCREEN SHARE** tab in `donate-socket`.
2. Choose a **WHIP LAN Port** (default `3002`; valid range `1024–65535`, cannot be `3001`).
3. Click **START RECEIVER**.
4. Copy two values from the **LAN WHIP ENDPOINT & OBS SOURCE** card:
   - **WHIP Server URL**: `http://<receiver-lan-ip>:3002/whip` (pick the IP on the same subnet as your sender, e.g. `192.168.1.x`).
   - **WHIP Bearer Token**: click **COPY** (click **SHOW** to inspect or **REGENERATE** to rotate it).

> Keep either the `donate-socket` app window or the OBS Browser Source open—the browser/webview WebRTC engine terminates the incoming stream.

---

## 2. Connect a Sender

### Option A: Built-in HTTPS Web Screen Sharer (No OBS Needed on Sender)

Port `3002` serves **both HTTP and HTTPS** on the same port using an auto-generated self-signed TLS certificate (stored next to `config.yaml`).

1. On the sending PC, open the **HTTPS Web Screen Sharer URL** shown in `donate-socket`:
   ```text
   https://<receiver-lan-ip>:3002/share
   ```
   *(Also served at `/screen` and `/`.)*
2. Accept the browser's self-signed certificate warning once (**Advanced → Proceed**) so `getDisplayMedia` runs in a real Secure Context (works in Chrome, Brave, Edge, Firefox, and Safari—no `chrome://flags` required).
   - *(On the same machine, `http://127.0.0.1:3002/share` also works directly without HTTPS.)*
3. Paste the **WHIP Bearer Token**, pick resolution (`1080p` / `720p` / `Native`) and FPS (`30` / `60`), and click **SHARE SCREEN**.

### Option B: OBS Studio (on another PC on LAN)

1. Open **Settings → Stream**.
2. Set **Service** to **WHIP**.
3. Set **Server** to `http://<receiver-lan-ip>:3002/whip`.
4. Set **Bearer Token** to the token copied from `donate-socket`.
5. *(Recommended for low-latency WebRTC)* In **Settings → Output**:
   - **Keyframe Interval**: `1` or `2` seconds
   - **B-frames**: `0` (WebRTC video decoders expect no B-frames)
   - **Tune / Preset**: `zerolatency` (x264) or Low-Latency (NVENC/VideoToolbox)
6. Click **Start Streaming**.

### Option C: GStreamer (`whipsink`)

```bash
gst-launch-1.0 videotestsrc is-live=true ! x264enc tune=zerolatency bframes=0 key-int-max=30 ! \
  rtph264pay ! application/x-rtp,media=video,encoding-name=H264,payload=96 ! \
  whipsink whip-endpoint="http://<receiver-lan-ip>:3002/whip" auth-token="<bearer-token>"
```

### Option D: Custom RFC 9725 WHIP Client

| Action | Method & Path | Required Headers | Response |
|---|---|---|---|
| Start stream | `POST /whip` (or `POST /`) | `Authorization: Bearer <token>`, `Content-Type: application/sdp` | `201 Created`, `Content-Type: application/sdp`, `Location: /whip/<id>`, `ETag` |
| Trickle ICE | `PATCH /whip/<id>` | `Authorization: Bearer <token>`, `Content-Type: application/trickle-ice-sdpfrag`, optional `If-Match` | `204 No Content` |
| Stop stream | `DELETE /whip/<id>` | `Authorization: Bearer <token>` | `200 OK` |

- Maximum SDP payload size: **128 KB**.
- Only one WHIP publisher is active at a time; a new valid `POST /whip` replaces the previous session.

---

## 3. Add to OBS Studio (Browser Source)

1. In OBS on the receiving PC, add a **Browser** source.
2. Set **URL** to:
   ```text
   http://127.0.0.1:3001/overlays/screen-share/
   ```
   *(If OBS runs on another computer on the LAN, replace `127.0.0.1` with the receiver's LAN IP.)*
3. Set **Width** and **Height** to match your canvas (e.g. `1920 × 1080`).
4. Optional query parameters:
   - `?fit=contain` (default), `?fit=cover`, or `?fit=fill`
   - `?muted=1` to start muted
   - `?volume=0.5` (or `?volume=50`) to set initial volume (`0–1` or `0–100`)
   - `?controls=0` to disable the hover volume/mute/logs HUD
   - `?logs=1` (or `?debug=1`) to open the playback WebRTC log drawer on load

The overlay stays completely transparent when no stream is active. In web playback (or OBS **Interact** mode), moving the pointer reveals an auto-hiding mute/volume controller (persisted in `localStorage`); it stays hidden in OBS when idle. Switching tabs in `donate-socket` or switching scenes in OBS will not disconnect the sender—the desktop app mirrors the live stream over localhost WebRTC to OBS automatically.

---

## 4. Preview & Audio Controls

- The in-app preview starts **muted** to avoid double audio when OBS is also playing the Browser Source. Use **UNMUTE PREVIEW** and the volume slider to monitor audio inside the app.
- Use **FIT: CONTAIN / COVER** and **FULLSCREEN** for local viewing, and **DISCONNECT STREAM** to drop the current sender without stopping the WHIP listener.

---

## 5. Configuration (`config.yaml`)

Settings persist automatically under `screen_share`:

```yaml
screen_share:
  enabled: true
  port: 3002
  token: "your-32-char-hex-token"
```

When `enabled: true`, the WHIP listener auto-starts on next app launch. The token is masked (`••••••••`) in public `/api/status` and overlay SSE payloads.

---

## 6. Firewall & Troubleshooting

| Symptom / Error | Cause & Fix |
|---|---|
| Sender cannot reach `http://<ip>:3002/whip` | Allow inbound TCP on port `3002` (and ephemeral UDP ports for WebRTC) in Windows Defender Firewall / macOS Firewall on the receiving PC, and confirm both devices are on the same LAN. |
| `401 Unauthorized` | Bearer token is missing or mismatched. Copy the exact token from the **SCREEN SHARE** tab (or click **REGENERATE** and update the sender). |
| `415 Unsupported Media Type` | Sender did not send `Content-Type: application/sdp` (for `POST`) or `application/trickle-ice-sdpfrag` (for `PATCH`). |
| `503 Service Unavailable` | No receiver page is open. Keep either the `donate-socket` app or the OBS Browser Source open so WebRTC can answer the offer. |
| `504 Gateway Timeout` | Receiver page did not return an SDP answer within 15 seconds. Refresh the OBS Browser Source or reopen the app. |
| `Port 3002 is already in use` | Another app uses port `3002`. Stop the receiver, change **WHIP LAN PORT** (e.g. `3005`), and start again. |
| Connected (`LIVE`), but stuttering or blank video | Set encoder **B-frames** to `0` and **Keyframe Interval** to `1–2s` on the sender (e.g. OBS Output settings). |
