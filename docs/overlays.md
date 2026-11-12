# Stream Overlays & Marketplace Guide

`donate-socket` provides a built-in static overlay server and an in-app **Overlay Marketplace** for live streamers using OBS Studio, Streamlabs Desktop, vMix, or any broadcasting software supporting Browser Sources.

---

## 1. How It Works

1. **Static Serving**: The local backend server (`http://127.0.0.1:3001`) statically hosts interactive HTML5/CSS3/JS overlays from the `overlays/` folder at `http://127.0.0.1:3001/overlays/<overlay-id>/`.
2. **Real-Time Data (SSE)**: Overlays automatically connect to `http://127.0.0.1:3001/api/status/stream` via Server-Sent Events (SSE). They update instantaneously without polling when:
   - Spotify song changes, pauses, resumes, or stops.
   - TikTok LIVE viewers send gifts or donations.
3. **OBS Transparency**: Every overlay is designed with a transparent background (`background: transparent`), enabling clean layering over live stream gameplay or camera feeds.

---

## 2. Market Presets

The app comes pre-bundled with 4 production-ready stream widgets:

| Overlay ID | Name | Category | Recommended Size | Description |
| :--- | :--- | :--- | :--- | :--- |
| `spotify-brutalist` | **RawBlock Spotify Player** | `spotify` | `480 × 140` | Catppuccin Macchiato Now Playing card with live progress bar and album art. |
| `tiktok-gift-alert` | **TikTok Live Gift Alert Box** | `tiktok` | `440 × 160` | Animated brutalist banner that pops up when gifts are received. |
| `spotify-minimal-pill` | **Minimal Floating Song Pill** | `spotify` | `360 × 60` | Ultra-compact pill widget with artwork thumbnail and animated equalizer bars. |
| `stream-dual-ticker` | **Stream Dual Ticker Bar** | `combined` | `1920 × 44` | Full-width ticker displaying active Spotify song on left and latest gift on right. |

---

## 3. Adding an Overlay to OBS Studio

1. In `donate-socket`, go to the **OVERLAYS MARKET** tab in the sidebar.
2. Find the overlay you want to display on stream.
3. Click **COPY URL** (e.g. `http://127.0.0.1:3001/overlays/spotify-brutalist/`).
4. In OBS Studio:
   - Under **Sources**, click `+` and choose **Browser**.
   - Set **URL** to the copied URL.
   - Set **Width** and **Height** to the recommended dimensions shown on the card.
   - Check **Shutdown source when not visible** (recommended).
5. The overlay will render immediately on stream.

---

## 4. Creating Custom Overlays

You can scaffold and host custom HTML/CSS widgets directly:

1. Click **+ NEW OVERLAY** in the **OVERLAYS MARKET** tab.
2. Enter a name (e.g. `My Retro Music Widget`), select category, and specify target width & height.
3. The server generates a new folder at `overlays/<id>/` with starter `index.html` and `overlay.json`.
4. Edit the files using your favorite code editor. Custom overlays automatically hot-reload when modified!

---

## 5. Overlay Studio (Merging & Rearranging Multiple Overlays)

Instead of managing multiple separate Browser Sources in OBS, **Overlay Studio** lets you combine and position any number of installed or custom overlays onto a single unified scene:

1. Open the **[ OVERLAY STUDIO ]** tab in the sidebar (or click **OPEN STUDIO COMPOSER** inside Overlays Market).
2. Choose a canvas resolution preset (`1920×1080` Landscape, `1280×720` Landscape, `1080×1920` TikTok Vertical) or enter custom dimensions.
3. Click **+ ADD** next to any installed overlay in the right panel to place it on the stage.
4. Drag widgets on the stage to move them, drag the bottom-right handle to resize, or fine-tune `X`, `Y`, `Width`, `Height`, `Scale`, `Opacity`, `Z-Order`, visibility, and lock state in the inspector.
5. Click **COPY OBS STUDIO URL** (`http://127.0.0.1:3001/overlays/studio/`) and add **one** Browser Source in OBS matching your Studio canvas width and height.
6. Layout edits sync live to OBS over Server-Sent Events (`/api/events`) without refreshing or interrupting active widget animations.

### Workspace size and scene profiles

- Use **COLLAPSE NAV** to reclaim sidebar width; the compact navigation keeps every page accessible.
- Expand the Studio editor for a viewport-sized workspace, or expand the preview to hide the layer tools. Restore the workspace with its button or Escape.
- Create a named profile from the current layout, then select it to edit its own canvas and layers.
- Each profile has a stable OBS Browser Source URL: `http://127.0.0.1:3001/overlays/studio/?profile=<id>`. Select a profile and use the copy/open controls for its link.
- Switching profiles in the editor does not switch existing OBS sources. Each profile link follows only that profile's saved changes.
- The original master scene and `/overlays/studio/` link remain available. Profiles persist in `config.yaml` alongside the master scene.
- Use **COPY EDITOR LINK** to share an editor URL with `?page=studio&profile=<id>`. Opening it selects Studio and loads that profile.
- In **PROFILE LINK TOOLS**, paste an editor or OBS URL and choose **LOAD FROM URL**. This loads the matching profile saved on this server, not a remote layout.
- To load an older saved profile, choose it in **PROFILE**, then click **LOAD PROFILE**. Selection alone does not change the current canvas.

### External iframe overlays

Use the external overlay tools in Studio to add an absolute HTTP or HTTPS overlay URL. An optional name identifies the layer. External layers support the same positioning, size, visibility, opacity, ordering, and profile saving as installed overlays.

Only add URLs you trust. Query parameters are preserved and saved in `config.yaml`; private overlay tokens in these URLs remain sensitive. External overlays load in the browser, not through a backend proxy, and use a sandbox permitting scripts and same-origin access but not popups or top-level navigation. Sites that block embedding through CSP or `X-Frame-Options` cannot be shown. HTTPS-hosted editors may also block HTTP overlays as mixed content.

### TikTok LIVE danger zones

Toggle **TIKTOK LIVE DANGER ZONES** in the Studio toolbar to mark approximate header, right-side controls, chat/gift, and bottom-bar areas. The guides scale with the canvas and do not block layer dragging. They are editor-only and never appear in OBS output. TikTok UI varies by device and LIVE layout; verify placement on your phone before streaming.
