import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  DEFAULT_SCREEN_SHARE_PORT,
  loadConfig,
  normalizeScreenSharePort,
  saveConfig,
} from "../config.ts";
import type { ScreenShareSessionInfo, ScreenShareStatus } from "../types.ts";
import { getLanAddresses, HOST, PORT } from "../utils.ts";
import { loadOrCreateScreenShareTlsCert } from "./tlsCert.ts";

export type ReceiverRole = "app" | "obs";

export interface TrickleIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

interface ReceiverPeer {
  id: string;
  role: ReceiverRole;
  res: http.ServerResponse;
}

interface ActiveSessionInternal extends ScreenShareSessionInfo {
  etag: string;
  primaryPeerId: string;
}

interface PendingOffer {
  sessionId: string;
  peerId: string;
  resolve: (sdp: string) => void;
  reject: (err: Error & { statusCode?: number }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_SDP_BYTES = 128 * 1024;
const OFFER_TIMEOUT_MS = 15_000;
export const SCREEN_SHARE_API_REVISION = 5;

const WHIP_SHARER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>donate-socket // HTTP Screen Sharer (WHIP)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }
    :root {
      --base: #24273a;
      --mantle: #1e2030;
      --crust: #181926;
      --surface0: #363a4f;
      --surface1: #494d64;
      --text: #cad3f5;
      --subtext: #a5adcb;
      --sapphire: #7dc4e4;
      --green: #a6da95;
      --peach: #f5a97f;
      --red: #ed8796;
    }
    body {
      background: var(--base);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 20px;
      min-height: 100vh;
    }
    .wrap { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .card {
      background: var(--mantle);
      border: 3px solid var(--surface1);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      border-bottom: 2px solid var(--surface0);
      padding-bottom: 10px;
    }
    h1 { font-size: 16px; letter-spacing: 0.8px; text-transform: uppercase; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 2px solid var(--surface1);
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--subtext);
    }
    .chip.live { border-color: var(--green); color: var(--green); }
    .chip.connecting { border-color: var(--peach); color: var(--peach); }
    .chip.error { border-color: var(--red); color: var(--red); }
    .dot { width: 8px; height: 8px; background: currentColor; display: inline-block; }
    .alert {
      border: 3px solid var(--red);
      background: var(--crust);
      color: var(--red);
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      display: none;
    }
    .alert.warn { border-color: var(--peach); color: var(--peach); }
    .alert.show { display: block; }
    .stage {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: var(--crust);
      border: 3px solid var(--surface0);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    video { width: 100%; height: 100%; object-fit: contain; display: none; background: #000; }
    video.active { display: block; }
    .placeholder { color: var(--subtext); font-size: 13px; text-align: center; padding: 16px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
    .field { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 180px; }
    label { font-size: 11px; font-weight: 700; letter-spacing: 0.6px; color: var(--subtext); text-transform: uppercase; }
    input[type="text"], input[type="password"], select {
      background: var(--crust);
      color: var(--text);
      border: 2px solid var(--surface1);
      padding: 8px 10px;
      font-size: 13px;
      outline: none;
    }
    input:focus, select:focus { border-color: var(--sapphire); }
    .check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px 0; cursor: pointer; }
    .btn {
      border: 3px solid var(--surface1);
      background: var(--surface0);
      color: var(--text);
      padding: 9px 16px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      cursor: pointer;
    }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn.primary { background: var(--sapphire); border-color: var(--sapphire); color: var(--crust); }
    .btn.danger { background: var(--red); border-color: var(--red); color: var(--crust); }
    .helper { font-size: 11px; color: var(--subtext); line-height: 1.5; }
    code { background: var(--crust); padding: 1px 5px; color: var(--sapphire); }
    .log-list {
      background: var(--crust);
      border: 2px solid var(--surface0);
      padding: 8px 10px;
      max-height: 180px;
      overflow-y: auto;
      font-size: 11px;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .log-row { word-break: break-word; color: var(--text); }
    .log-row.ok { color: var(--green); }
    .log-row.warn { color: var(--peach); }
    .log-row.err { color: var(--red); }
    .log-time { color: var(--subtext); margin-right: 6px; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <div class="header">
        <h1>HTTP SCREEN SHARER // WHIP</h1>
        <span id="status-chip" class="chip mono"><span class="dot"></span><span id="status-text">IDLE</span></span>
      </div>

      <div id="insecure-banner" class="alert warn mono">
        <strong>[!] Browser blocked screen capture on plain HTTP LAN.</strong><br>
        Use the built-in HTTPS page on port <code id="https-port-code"></code> and accept the self-signed certificate warning once (Advanced -&gt; Proceed):<br>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <a id="https-switch-link" class="btn primary" style="text-decoration:none;padding:5px 12px;font-size:11px;" href="#">OPEN HTTPS SHARER</a>
          <button id="copy-origin-btn" type="button" class="btn" style="padding:5px 10px;font-size:11px;">COPY HTTP ORIGIN</button>
        </div>
        <div class="helper" style="margin-top:8px;">
          Or in Chrome / Edge / Brave, enable <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> with
          <code id="origin-code"></code> and fully relaunch the browser.
        </div>
      </div>

      <div id="error-banner" class="alert mono"></div>

      <div class="stage">
        <video id="preview" autoplay playsinline muted></video>
        <div id="placeholder" class="placeholder mono">[ CLICK "SHARE SCREEN" TO STREAM TO RECEIVER ]</div>
      </div>

      <div class="row">
        <div class="field" style="flex:2;min-width:240px;">
          <label for="token-input">WHIP BEARER TOKEN</label>
          <div style="display:flex;gap:6px;">
            <input id="token-input" class="mono" type="password" placeholder="Paste Bearer token from donate-socket" style="flex:1;" autocomplete="off">
            <button id="toggle-token-btn" type="button" class="btn" style="padding:8px 10px;">SHOW</button>
          </div>
        </div>
        <div class="field" style="flex:0 0 130px;min-width:120px;">
          <label for="res-select">RESOLUTION</label>
          <select id="res-select" class="mono">
            <option value="1080" selected>1080p max</option>
            <option value="720">720p max</option>
            <option value="native">Native</option>
          </select>
        </div>
        <div class="field" style="flex:0 0 110px;min-width:100px;">
          <label for="fps-select">FPS</label>
          <select id="fps-select" class="mono">
            <option value="30" selected>30 FPS</option>
            <option value="60">60 FPS</option>
          </select>
        </div>
      </div>

      <div class="row" style="justify-content:space-between;align-items:center;">
        <label class="check-row">
          <input id="audio-check" type="checkbox" checked>
          <span>Include tab / system audio (if supported by browser)</span>
        </label>
        <div style="display:flex;gap:8px;">
          <button id="share-btn" type="button" class="btn primary">SHARE SCREEN</button>
          <button id="stop-btn" type="button" class="btn danger" style="display:none;">STOP SHARING</button>
        </div>
      </div>

      <p class="helper mono">
        Endpoint: <code id="endpoint-code"></code>
      </p>
    </section>

    <section class="card">
      <div class="header">
        <h1>CONNECTION LOGS (<span id="log-count">0</span>)</h1>
        <div style="display:flex;gap:6px;">
          <button id="copy-logs-btn" type="button" class="btn" style="padding:4px 10px;font-size:11px;">COPY</button>
          <button id="clear-logs-btn" type="button" class="btn" style="padding:4px 10px;font-size:11px;">CLEAR</button>
        </div>
      </div>
      <div id="log-list" class="log-list mono" aria-live="polite"></div>
    </section>
  </div>

  <script>
    const tokenInput = document.getElementById("token-input");
    const toggleTokenBtn = document.getElementById("toggle-token-btn");
    const resSelect = document.getElementById("res-select");
    const fpsSelect = document.getElementById("fps-select");
    const audioCheck = document.getElementById("audio-check");
    const shareBtn = document.getElementById("share-btn");
    const stopBtn = document.getElementById("stop-btn");
    const preview = document.getElementById("preview");
    const placeholder = document.getElementById("placeholder");
    const statusChip = document.getElementById("status-chip");
    const statusText = document.getElementById("status-text");
    const errorBanner = document.getElementById("error-banner");
    const insecureBanner = document.getElementById("insecure-banner");
    const originCode = document.getElementById("origin-code");
    const httpsPortCode = document.getElementById("https-port-code");
    const httpsSwitchLink = document.getElementById("https-switch-link");
    const copyOriginBtn = document.getElementById("copy-origin-btn");
    const endpointCode = document.getElementById("endpoint-code");
    const logList = document.getElementById("log-list");
    const logCount = document.getElementById("log-count");
    const copyLogsBtn = document.getElementById("copy-logs-btn");
    const clearLogsBtn = document.getElementById("clear-logs-btn");

    const logLines = [];
    function appendLog(level, msg) {
      const now = new Date();
      const ts = now.toTimeString().slice(0, 8);
      const line = "[" + ts + "] " + msg;
      logLines.push(line);
      if (logLines.length > 150) logLines.shift();

      const row = document.createElement("div");
      row.className = "log-row" + (level ? " " + level : "");
      const timeSpan = document.createElement("span");
      timeSpan.className = "log-time";
      timeSpan.textContent = "[" + ts + "]";
      row.appendChild(timeSpan);
      row.appendChild(document.createTextNode(msg));
      logList.appendChild(row);
      while (logList.childNodes.length > 150) {
        logList.removeChild(logList.firstChild);
      }
      logCount.textContent = String(logLines.length);
      logList.scrollTop = logList.scrollHeight;
    }

    const configuredWhipPort = __WHIP_PORT__;
    const whipEndpoint = window.location.origin + "/whip";
    endpointCode.textContent = whipEndpoint;
    originCode.textContent = window.location.origin;
    const httpsTargetPort =
      window.location.port && window.location.port !== "3001" ? window.location.port : String(configuredWhipPort);
    httpsPortCode.textContent = httpsTargetPort;
    httpsSwitchLink.href =
      "https://" +
      window.location.hostname +
      ":" +
      httpsTargetPort +
      window.location.pathname +
      window.location.search +
      window.location.hash;

    clearLogsBtn.addEventListener("click", () => {
      logLines.length = 0;
      logList.textContent = "";
      logCount.textContent = "0";
    });
    copyLogsBtn.addEventListener("click", () => {
      void copyTextFallback(logLines.join("\\n")).then(() => {
        copyLogsBtn.textContent = "COPIED";
        setTimeout(() => { copyLogsBtn.textContent = "COPY"; }, 1500);
      });
    });

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashToken = hashParams.get("token");
    if (hashToken) {
      tokenInput.value = hashToken.trim();
      try { sessionStorage.setItem("whip_bearer_token", tokenInput.value); } catch {}
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {}
    } else {
      try {
        const saved = sessionStorage.getItem("whip_bearer_token");
        if (saved) tokenInput.value = saved;
      } catch {}
    }

    tokenInput.addEventListener("input", () => {
      try { sessionStorage.setItem("whip_bearer_token", tokenInput.value.trim()); } catch {}
    });

    toggleTokenBtn.addEventListener("click", () => {
      const hidden = tokenInput.type === "password";
      tokenInput.type = hidden ? "text" : "password";
      toggleTokenBtn.textContent = hidden ? "HIDE" : "SHOW";
    });

    function copyTextFallback(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      }
      legacyCopy(text);
      return Promise.resolve();
    }

    function legacyCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }

    copyOriginBtn.addEventListener("click", () => {
      void copyTextFallback(window.location.origin).then(() => {
        copyOriginBtn.textContent = "COPIED";
        setTimeout(() => { copyOriginBtn.textContent = "COPY ORIGIN"; }, 1500);
      });
    });

    const captureAvailable = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
    if (!captureAvailable) {
      insecureBanner.classList.add("show");
      shareBtn.disabled = true;
      appendLog("warn", "Screen capture unavailable on insecure origin (" + window.location.origin + ", isSecureContext=" + Boolean(window.isSecureContext) + ")");
    } else {
      appendLog("info", "Ready (" + window.location.protocol + ", secure=" + Boolean(window.isSecureContext) + "). Endpoint: " + whipEndpoint);
    }

    let pc = null;
    let captureStream = null;
    let resourceUrl = null;
    let activeToken = "";

    function setStatus(kind, label) {
      statusChip.className = "chip mono" + (kind ? " " + kind : "");
      statusText.textContent = label;
    }

    function showError(msg) {
      if (!msg) {
        errorBanner.classList.remove("show");
        errorBanner.textContent = "";
        return;
      }
      errorBanner.textContent = "[!] " + msg;
      errorBanner.classList.add("show");
    }

    function waitForIceGathering(peer, timeoutMs) {
      if (peer.iceGatheringState === "complete") return Promise.resolve();
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          peer.removeEventListener("icegatheringstatechange", onState);
          peer.removeEventListener("icecandidate", onCand);
          resolve();
        };
        const onState = () => { if (peer.iceGatheringState === "complete") finish(); };
        const onCand = (e) => { if (!e.candidate) finish(); };
        const timer = setTimeout(finish, timeoutMs);
        peer.addEventListener("icegatheringstatechange", onState);
        peer.addEventListener("icecandidate", onCand);
      });
    }

    async function stopSharing(keepalive) {
      const urlToDelete = resourceUrl;
      const tok = activeToken;
      resourceUrl = null;
      activeToken = "";

      if (pc) {
        try { pc.close(); } catch {}
        pc = null;
      }
      if (captureStream) {
        for (const track of captureStream.getTracks()) {
          try { track.stop(); } catch {}
        }
        captureStream = null;
      }

      preview.srcObject = null;
      preview.classList.remove("active");
      placeholder.style.display = "block";
      shareBtn.style.display = "inline-block";
      shareBtn.disabled = !captureAvailable;
      stopBtn.style.display = "none";
      tokenInput.disabled = false;
      resSelect.disabled = false;
      fpsSelect.disabled = false;
      audioCheck.disabled = false;
      setStatus("", "IDLE");

      if (urlToDelete && tok) {
        appendLog("info", "Sending WHIP DELETE " + urlToDelete);
        try {
          const delRes = await fetch(urlToDelete, {
            method: "DELETE",
            headers: { Authorization: "Bearer " + tok },
            keepalive: Boolean(keepalive),
          });
          appendLog(delRes.ok ? "ok" : "warn", "WHIP DELETE -> HTTP " + delRes.status);
        } catch (err) {
          appendLog("warn", "WHIP DELETE failed: " + (err && err.message ? err.message : "network error"));
        }
      } else {
        appendLog("info", "Stopped sharing.");
      }
    }

    async function startSharing() {
      showError("");
      const token = tokenInput.value.trim();
      if (!token) {
        showError("Enter the WHIP Bearer Token from donate-socket first.");
        appendLog("warn", "Blocked start: missing WHIP Bearer Token.");
        tokenInput.focus();
        return;
      }
      if (!captureAvailable) {
        insecureBanner.classList.add("show");
        return;
      }

      const fps = Number(fpsSelect.value) || 30;
      const res = resSelect.value;
      const videoConstraints = { frameRate: { ideal: fps, max: fps } };
      if (res === "1080") {
        videoConstraints.width = { max: 1920 };
        videoConstraints.height = { max: 1080 };
      } else if (res === "720") {
        videoConstraints.width = { max: 1280 };
        videoConstraints.height = { max: 720 };
      }

      shareBtn.disabled = true;
      setStatus("connecting", "PICKING SCREEN...");
      appendLog("info", "Requesting display capture (" + res + ", " + fps + "fps, audio=" + audioCheck.checked + ")...");

      try {
        captureStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: audioCheck.checked,
        });
      } catch (err) {
        const name = err && err.name ? err.name : "";
        if (name === "OverconstrainedError" || name === "TypeError" || name === "NotSupportedError") {
          appendLog("warn", "Capture constraints rejected (" + name + "); retrying with default video-only...");
          try {
            captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          } catch (retryErr) {
            shareBtn.disabled = false;
            setStatus("", "IDLE");
            appendLog("warn", "Display capture aborted: " + (retryErr && retryErr.name ? retryErr.name : "cancelled"));
            if (retryErr && retryErr.name !== "NotAllowedError") {
              showError(retryErr.message || "Screen capture cancelled.");
            }
            return;
          }
        } else {
          shareBtn.disabled = false;
          setStatus("", "IDLE");
          appendLog("warn", "Display capture aborted: " + (name || "cancelled"));
          if (err && name !== "NotAllowedError") {
            showError(err.message || "Screen capture cancelled.");
          }
          return;
        }
      }

      preview.srcObject = captureStream;
      preview.classList.add("active");
      placeholder.style.display = "none";
      shareBtn.style.display = "none";
      stopBtn.style.display = "inline-block";
      tokenInput.disabled = true;
      resSelect.disabled = true;
      fpsSelect.disabled = true;
      audioCheck.disabled = true;
      setStatus("connecting", "CONNECTING...");

      const videoTrack = captureStream.getVideoTracks()[0];
      const audioCount = captureStream.getAudioTracks().length;
      if (videoTrack) {
        const st = videoTrack.getSettings ? videoTrack.getSettings() : {};
        appendLog("ok", "Captured video " + (st.width || "?") + "x" + (st.height || "?") + " @ " + Math.round(st.frameRate || fps) + "fps, audio tracks: " + audioCount);
        try { videoTrack.contentHint = fps >= 60 ? "motion" : "detail"; } catch {}
        videoTrack.addEventListener("ended", () => {
          appendLog("info", "Capture ended by browser stop control.");
          void stopSharing(false);
        });
      }

      const peer = new RTCPeerConnection({ iceServers: [] });
      pc = peer;
      activeToken = token;
      let gatheredCount = 0;

      peer.addEventListener("icecandidate", (e) => {
        if (e.candidate) {
          gatheredCount++;
          const candStr = e.candidate.candidate || "";
          const parts = candStr.split(" ");
          const addr = parts[4] || "";
          const typIdx = parts.indexOf("typ");
          const typ = typIdx >= 0 ? (parts[typIdx + 1] || "") : "";
          if (addr) {
            appendLog("info", "Local ICE candidate #" + gatheredCount + ": " + (typ || "host") + " " + addr);
          }
        }
      });

      for (const track of captureStream.getTracks()) {
        peer.addTransceiver(track, { direction: "sendonly", streams: [captureStream] });
      }

      peer.oniceconnectionstatechange = () => {
        if (pc !== peer) return;
        appendLog("info", "ICE state: " + peer.iceConnectionState);
      };

      peer.onconnectionstatechange = () => {
        if (pc !== peer) return;
        appendLog(peer.connectionState === "connected" ? "ok" : "info", "Peer state: " + peer.connectionState);
        if (peer.connectionState === "connected") {
          setStatus("live", "LIVE");
        } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          showError("WebRTC connection closed.");
          appendLog("err", "WebRTC peer " + peer.connectionState + ".");
          void stopSharing(false);
        }
      };

      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        appendLog("info", "Gathering local ICE candidates...");
        await waitForIceGathering(peer, 2000);
        appendLog("info", "ICE gathered (" + gatheredCount + " candidates). Sending POST /whip...");

        const response = await fetch(whipEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            Authorization: "Bearer " + token,
          },
          body: peer.localDescription ? peer.localDescription.sdp : offer.sdp,
        });

        if (!response.ok) {
          const detail = (await response.text()).trim();
          throw new Error("HTTP " + response.status + (detail ? ": " + detail : ""));
        }

        const loc = response.headers.get("Location");
        if (loc) {
          resourceUrl = new URL(loc, window.location.origin).href;
        }
        appendLog("ok", "WHIP POST -> HTTP " + response.status + (loc ? " (" + loc + ")" : ""));
        const answerSdp = await response.text();
        await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
        appendLog("ok", "Applied remote SDP answer.");
        if (peer.connectionState === "connected") {
          setStatus("live", "LIVE");
        }
      } catch (err) {
        const msg = err && err.message ? err.message : "Failed to publish WHIP stream";
        appendLog("err", "Publish failed: " + msg);
        showError(msg);
        await stopSharing(false);
        setStatus("error", "ERROR");
      }
    }

    shareBtn.addEventListener("click", () => { void startSharing(); });
    stopBtn.addEventListener("click", () => { void stopSharing(false); });
    window.addEventListener("pagehide", () => { void stopSharing(true); });
  </script>
</body>
</html>`;

interface WhipServerBundle {
  tcpServer: net.Server;
  httpServer: http.Server;
  httpsServer: https.Server;
  activeSockets: Set<net.Socket>;
}

let whipServer: WhipServerBundle | null = null;
const proxyRemoteIpByPort = new Map<number, string>();
let currentPort = DEFAULT_SCREEN_SHARE_PORT;
let currentToken = "";
let serverError: string | null = null;

const peers = new Map<string, ReceiverPeer>();
let activeSession: ActiveSessionInternal | null = null;
let pendingOffer: PendingOffer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureConfigLoaded() {
  const cfg = loadConfig();
  currentPort = normalizeScreenSharePort(cfg.screenShare?.port);
  if (!currentToken && cfg.screenShare?.token) {
    currentToken = cfg.screenShare.token;
  }
}

function ensureToken(): string {
  ensureConfigLoaded();
  if (!currentToken) {
    currentToken = randomBytes(16).toString("hex");
  }
  return currentToken;
}

export function getLanUrls(port: number = currentPort): string[] {
  const ips = getLanAddresses();
  if (ips.length === 0) {
    return [`http://127.0.0.1:${port}/whip`];
  }
  return ips.map((ip) => `http://${ip}:${port}/whip`);
}

export function verifyBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!expectedToken || typeof authHeader !== "string") return false;
  const match = authHeader.trim().match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;
  const providedHash = createHash("sha256").update(match[1]).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function parseTrickleIceSdpFrag(body: string): TrickleIceCandidate[] {
  const candidates: TrickleIceCandidate[] = [];
  let currentMid: string | null = null;
  let currentMLineIndex = -1;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("m=")) {
      currentMLineIndex++;
      currentMid = null;
    } else if (line.startsWith("a=mid:")) {
      currentMid = line.slice("a=mid:".length).trim() || null;
    } else if (line.startsWith("a=candidate:")) {
      const value = line.slice("a=".length).trim();
      if (value) {
        candidates.push({
          candidate: value,
          sdpMid: currentMid,
          sdpMLineIndex: currentMLineIndex >= 0 ? currentMLineIndex : null,
        });
      }
    }
  }

  return candidates;
}

function sendSseEvent(peer: ReceiverPeer, event: string, data: unknown): boolean {
  try {
    peer.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    peers.delete(peer.id);
    return false;
  }
}

function broadcastEvent(event: string, data: unknown) {
  for (const peer of Array.from(peers.values())) {
    sendSseEvent(peer, event, data);
  }
}

function ensureHeartbeat() {
  if (heartbeatTimer || peers.size === 0) return;
  heartbeatTimer = setInterval(() => {
    for (const peer of Array.from(peers.values())) {
      try {
        peer.res.write(": keep-alive\n\n");
      } catch {
        peers.delete(peer.id);
      }
    }
    if (peers.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, 15_000);
  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }
}

function publicSessionInfo(): ScreenShareSessionInfo | null {
  if (!activeSession) return null;
  return {
    id: activeSession.id,
    state: activeSession.state,
    startedAt: activeSession.startedAt,
    remoteAddress: activeSession.remoteAddress,
    ...(activeSession.width !== undefined ? { width: activeSession.width } : {}),
    ...(activeSession.height !== undefined ? { height: activeSession.height } : {}),
    ...(activeSession.hasAudio !== undefined ? { hasAudio: activeSession.hasAudio } : {}),
  };
}

export function isScreenShareRunning(): boolean {
  return Boolean(whipServer && whipServer.tcpServer.listening);
}

export function serveWhipSharerHtml(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
  } else {
    res.end(WHIP_SHARER_HTML.replace("__WHIP_PORT__", String(currentPort)));
  }
}

export function getScreenShareStatus(): ScreenShareStatus {
  const token = ensureToken();
  return {
    apiRevision: SCREEN_SHARE_API_REVISION,
    running: isScreenShareRunning(),
    port: currentPort,
    token,
    lanUrls: getLanUrls(currentPort),
    obsUrl: `http://127.0.0.1:${PORT}/overlays/screen-share/`,
    receiverCount: peers.size,
    activeSession: publicSessionInfo(),
    error: serverError,
  };
}

function statusForPeer(role: ReceiverRole): ScreenShareStatus {
  const status = getScreenShareStatus();
  return role === "obs" ? { ...status, token: "" } : status;
}

function broadcastStatus() {
  for (const peer of Array.from(peers.values())) {
    sendSseEvent(peer, "status", statusForPeer(peer.role));
  }
}

function pickPrimaryPeer(): ReceiverPeer | null {
  // Prefer desktop app peer so OBS scene switches never drop the external WHIP sender
  for (const peer of peers.values()) {
    if (peer.role === "app") return peer;
  }
  for (const peer of peers.values()) {
    return peer;
  }
  return null;
}

function clearPendingOffer(reason?: string, statusCode = 502) {
  if (!pendingOffer) return;
  const offer = pendingOffer;
  pendingOffer = null;
  clearTimeout(offer.timer);
  if (reason) {
    const err = Object.assign(new Error(reason), { statusCode });
    offer.reject(err);
  }
}

function endActiveSession(reason = "Session ended") {
  clearPendingOffer(reason, 409);
  if (!activeSession) return;
  const endedId = activeSession.id;
  activeSession = null;
  broadcastEvent("session-ended", { sessionId: endedId, reason });
  broadcastStatus();
}

export function disconnectActiveSession(): ScreenShareStatus {
  endActiveSession("Disconnected by host");
  return getScreenShareStatus();
}

export const MAX_RECEIVER_PEERS = 50;

export function canAcceptReceiverPeer(): boolean {
  return peers.size < MAX_RECEIVER_PEERS;
}

export function registerReceiverPeer(role: ReceiverRole, res: http.ServerResponse): string {
  if (peers.size >= MAX_RECEIVER_PEERS) {
    throw Object.assign(new Error("Too many connected screen share receivers"), { statusCode: 503 });
  }
  const id = randomUUID();
  const peer: ReceiverPeer = { id, role, res };
  peers.set(id, peer);
  ensureHeartbeat();

  sendSseEvent(peer, "welcome", { peerId: id, status: statusForPeer(role) });
  broadcastStatus();

  // If a stream is already live on another peer, ask primary to mirror to this viewer
  if (activeSession && activeSession.state === "connected" && activeSession.primaryPeerId !== id) {
    const primary = peers.get(activeSession.primaryPeerId);
    if (primary) {
      sendSseEvent(primary, "mirror-start", {
        sessionId: activeSession.id,
        viewerId: id,
      });
    }
  }

  return id;
}

export function unregisterReceiverPeer(peerId: string) {
  const removed = peers.get(peerId);
  if (!removed) return;
  peers.delete(peerId);

  if (peers.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (activeSession && activeSession.primaryPeerId === peerId) {
    endActiveSession("Primary receiver closed");
    return;
  }

  if (activeSession) {
    const primary = peers.get(activeSession.primaryPeerId);
    if (primary) {
      sendSseEvent(primary, "mirror-stop", {
        sessionId: activeSession.id,
        viewerId: peerId,
      });
    }
  }

  broadcastStatus();
}

export function submitWhipAnswer(
  sessionId: string,
  peerId: string,
  sdp?: string,
  error?: string
): { ok: boolean; error?: string } {
  if (!pendingOffer || pendingOffer.sessionId !== sessionId || pendingOffer.peerId !== peerId) {
    return { ok: false, error: "No matching pending WHIP offer" };
  }
  const offer = pendingOffer;
  pendingOffer = null;
  clearTimeout(offer.timer);

  if (error || !sdp || !sdp.includes("v=0")) {
    const err = Object.assign(new Error(error || "Receiver failed to generate SDP answer"), {
      statusCode: 502,
    });
    offer.reject(err);
    return { ok: true };
  }

  offer.resolve(sdp);
  return { ok: true };
}

export function markSessionConnected(
  sessionId: string,
  peerId: string,
  meta?: { width?: number; height?: number; hasAudio?: boolean }
): boolean {
  if (!activeSession || activeSession.id !== sessionId || activeSession.primaryPeerId !== peerId) {
    return false;
  }
  const wasConnected = activeSession.state === "connected";
  activeSession.state = "connected";
  if (typeof meta?.width === "number" && meta.width > 0) activeSession.width = Math.round(meta.width);
  if (typeof meta?.height === "number" && meta.height > 0) activeSession.height = Math.round(meta.height);
  if (typeof meta?.hasAudio === "boolean") activeSession.hasAudio = meta.hasAudio;
  broadcastStatus();

  if (!wasConnected) {
    const primary = peers.get(peerId);
    if (primary) {
      for (const peer of peers.values()) {
        if (peer.id !== peerId) {
          sendSseEvent(primary, "mirror-start", {
            sessionId: activeSession.id,
            viewerId: peer.id,
          });
        }
      }
    }
  }
  return true;
}

export function markSessionDisconnected(sessionId: string, peerId: string): boolean {
  if (!activeSession || activeSession.id !== sessionId || activeSession.primaryPeerId !== peerId) {
    return false;
  }
  endActiveSession("WebRTC connection closed");
  return true;
}

export function relayMirrorOffer(
  sessionId: string,
  fromPeerId: string,
  viewerId: string,
  sdp: string
): boolean {
  if (!activeSession || activeSession.id !== sessionId || activeSession.primaryPeerId !== fromPeerId) {
    return false;
  }
  const viewer = peers.get(viewerId);
  if (!viewer || !sdp) return false;
  return sendSseEvent(viewer, "mirror-offer", { sessionId, viewerId, sdp });
}

export function relayMirrorAnswer(
  sessionId: string,
  fromPeerId: string,
  sdp: string
): boolean {
  if (!activeSession || activeSession.id !== sessionId) return false;
  const primary = peers.get(activeSession.primaryPeerId);
  if (!primary || !sdp) return false;
  return sendSseEvent(primary, "mirror-answer", { sessionId, viewerId: fromPeerId, sdp });
}

function readBoundedText(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;

    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        settled = true;
        try {
          req.destroy();
        } catch {}
        reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function setWhipCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, If-Match");
  res.setHeader("Access-Control-Expose-Headers", "Location, ETag, Link");
  res.setHeader("Accept-Patch", "application/trickle-ice-sdpfrag");
}

function sendWhipError(res: http.ServerResponse, statusCode: number, message: string, extraHeaders?: Record<string, string>) {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders,
  });
  res.end(message);
}

export async function handleWhipRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setWhipCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const rawPath = url.pathname.replace(/\/+$/, "") || "/";
  const pathname = rawPath.toLowerCase();

  if (
    (pathname === "/" || pathname === "/share" || pathname === "/screen" || pathname === "/whip") &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    serveWhipSharerHtml(req, res);
    return;
  }

  const isIngest = pathname === "/whip" || pathname === "/" || pathname === "/screen" || pathname === "/share";
  const sessionMatch = rawPath.match(/^\/whip\/([a-zA-Z0-9-]+)$/i);
  if (!isIngest && !sessionMatch) {
    sendWhipError(res, 404, "Not Found");
    return;
  }

  const token = ensureToken();
  if (!verifyBearerToken(req.headers.authorization, token)) {
    sendWhipError(res, 401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
    return;
  }

  if (isIngest && req.method === "POST") {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/sdp")) {
      sendWhipError(res, 415, "Unsupported Media Type: expected application/sdp");
      return;
    }

    let offerSdp: string;
    try {
      offerSdp = await readBoundedText(req, MAX_SDP_BYTES);
    } catch (err: any) {
      sendWhipError(res, err?.statusCode || 400, err?.message || "Invalid request body");
      return;
    }

    if (!offerSdp.includes("v=0")) {
      sendWhipError(res, 400, "Invalid SDP offer");
      return;
    }

    const primary = pickPrimaryPeer();
    if (!primary) {
      sendWhipError(res, 503, "No screen share receiver window is open");
      return;
    }

    endActiveSession("Replaced by new WHIP publisher");

    const sessionId = randomUUID();
    const etag = randomBytes(8).toString("hex");
    const remotePort = req.socket?.remotePort;
    const remoteAddress =
      (remotePort !== undefined ? proxyRemoteIpByPort.get(remotePort) : undefined) ||
      req.socket?.remoteAddress?.replace(/^::ffff:/, "") ||
      "unknown";

    activeSession = {
      id: sessionId,
      etag,
      primaryPeerId: primary.id,
      state: "negotiating",
      startedAt: Date.now(),
      remoteAddress,
    };

    try {
      const answerSdp = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pendingOffer?.sessionId === sessionId) {
            pendingOffer = null;
          }
          reject(Object.assign(new Error("Timed out waiting for receiver SDP answer"), { statusCode: 504 }));
        }, OFFER_TIMEOUT_MS);

        pendingOffer = { sessionId, peerId: primary.id, resolve, reject, timer };
        const sent = sendSseEvent(primary, "whip-offer", { sessionId, sdp: offerSdp });
        if (!sent) {
          clearTimeout(timer);
          pendingOffer = null;
          reject(Object.assign(new Error("Primary receiver disconnected"), { statusCode: 503 }));
        }
      });

      if (!activeSession || activeSession.id !== sessionId) {
        sendWhipError(res, 409, "WHIP session superseded");
        return;
      }

      broadcastStatus();
      res.writeHead(201, {
        "Content-Type": "application/sdp",
        Location: `/whip/${sessionId}`,
        ETag: `"${etag}"`,
      });
      res.end(answerSdp);
    } catch (err: any) {
      if (activeSession?.id === sessionId) {
        activeSession = null;
        broadcastEvent("session-ended", { sessionId, reason: err?.message || "Negotiation failed" });
        broadcastStatus();
      }
      sendWhipError(res, err?.statusCode || 502, err?.message || "Failed to negotiate WebRTC session");
    }
    return;
  }

  if (sessionMatch && req.method === "PATCH") {
    const sessionId = sessionMatch[1];
    if (!activeSession || activeSession.id !== sessionId) {
      sendWhipError(res, 404, "WHIP session not found");
      return;
    }

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/trickle-ice-sdpfrag")) {
      sendWhipError(res, 415, "Unsupported Media Type: expected application/trickle-ice-sdpfrag");
      return;
    }

    const ifMatch = req.headers["if-match"];
    if (ifMatch !== undefined) {
      const normalized = String(ifMatch).trim().replace(/^W\//, "").replace(/^"|"$/g, "");
      if (normalized !== "*" && normalized !== activeSession.etag) {
        sendWhipError(res, 412, "ETag mismatch");
        return;
      }
    }

    let body: string;
    try {
      body = await readBoundedText(req, MAX_SDP_BYTES);
    } catch (err: any) {
      sendWhipError(res, err?.statusCode || 400, err?.message || "Invalid request body");
      return;
    }

    const candidates = parseTrickleIceSdpFrag(body);
    const primary = peers.get(activeSession.primaryPeerId);
    if (primary && candidates.length > 0) {
      sendSseEvent(primary, "whip-ice", { sessionId, candidates });
    }

    res.writeHead(204, { ETag: `"${activeSession.etag}"` });
    res.end();
    return;
  }

  if (sessionMatch && req.method === "DELETE") {
    const sessionId = sessionMatch[1];
    if (!activeSession || activeSession.id !== sessionId) {
      sendWhipError(res, 404, "WHIP session not found");
      return;
    }
    endActiveSession("Publisher disconnected");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK");
    return;
  }

  sendWhipError(res, 405, "Method Not Allowed");
}

function closeServerSafe(srv: net.Server | http.Server | https.Server): Promise<void> {
  return new Promise((resolve) => {
    try {
      srv.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function closeWhipBundle(bundle: WhipServerBundle): Promise<void> {
  for (const sock of bundle.activeSockets) {
    try {
      sock.destroy();
    } catch {}
  }
  bundle.activeSockets.clear();
  proxyRemoteIpByPort.clear();
  await Promise.all([
    closeServerSafe(bundle.tcpServer),
    closeServerSafe(bundle.httpServer),
    closeServerSafe(bundle.httpsServer),
  ]);
}

function listenOn(srv: net.Server | http.Server | https.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      srv.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      srv.removeListener("error", onError);
      const addr = srv.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    srv.once("error", onError);
    srv.once("listening", onListening);
    srv.listen(port, host);
  });
}

export async function startScreenShareServer(
  requestedPort?: number,
  persist: boolean = true
): Promise<ScreenShareStatus> {
  const token = ensureToken();
  const targetPort =
    requestedPort !== undefined ? normalizeScreenSharePort(requestedPort) : currentPort;

  if (whipServer && whipServer.tcpServer.listening && currentPort === targetPort) {
    if (persist) {
      saveConfig({ screenShare: { enabled: true, port: targetPort, token } });
    }
    return getScreenShareStatus();
  }

  if (whipServer) {
    await stopScreenShareServer(false);
  }

  const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    void handleWhipRequest(req, res).catch((err) => {
      console.error("[screen-share] WHIP request error:", err);
      sendWhipError(res, 500, "Internal Server Error");
    });
  };

  const tlsIdentity = loadOrCreateScreenShareTlsCert(getLanAddresses());
  const httpServer = http.createServer(requestHandler);
  const httpsServer = https.createServer({ key: tlsIdentity.key, cert: tlsIdentity.cert }, requestHandler);
  const activeSockets = new Set<net.Socket>();

  let httpPort = 0;
  let httpsPort = 0;
  const tcpServer = net.createServer((client) => {
    const clientIp = client.remoteAddress?.replace(/^::ffff:/, "") || "unknown";
    activeSockets.add(client);

    const firstByteTimer = setTimeout(() => {
      try {
        client.destroy();
      } catch {}
    }, 10_000);

    client.on("close", () => {
      clearTimeout(firstByteTimer);
      activeSockets.delete(client);
    });
    client.on("error", () => {
      clearTimeout(firstByteTimer);
      try {
        client.destroy();
      } catch {}
    });

    client.once("data", (firstChunk: Buffer) => {
      clearTimeout(firstByteTimer);
      client.pause();
      const internalPort = firstChunk.length > 0 && firstChunk[0] === 0x16 ? httpsPort : httpPort;
      const upstream = net.connect(internalPort, "127.0.0.1", () => {
        if (client.destroyed) {
          upstream.destroy();
          return;
        }
        const localPort = upstream.localPort;
        if (localPort) {
          proxyRemoteIpByPort.set(localPort, clientIp);
          upstream.once("close", () => proxyRemoteIpByPort.delete(localPort));
        }
        upstream.write(firstChunk);
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
      activeSockets.add(upstream);
      const cleanup = () => {
        try {
          client.destroy();
        } catch {}
        try {
          upstream.destroy();
        } catch {}
      };
      upstream.on("close", () => activeSockets.delete(upstream));
      upstream.on("error", cleanup);
      client.on("error", cleanup);
      client.on("close", () => {
        if (!upstream.destroyed) upstream.destroy();
      });
    });
  });

  try {
    httpPort = await listenOn(httpServer, 0, "127.0.0.1");
    httpsPort = await listenOn(httpsServer, 0, "127.0.0.1");
    await listenOn(tcpServer, targetPort, HOST);
  } catch (err: any) {
    await closeWhipBundle({ tcpServer, httpServer, httpsServer, activeSockets });
    serverError =
      err?.code === "EADDRINUSE"
        ? `Port ${targetPort} is already in use`
        : err?.message || "Failed to bind WHIP listener";
    throw new Error(serverError);
  }

  tcpServer.on("error", (err) => {
    console.error("[screen-share] WHIP server error:", err);
    serverError = err.message;
    broadcastStatus();
  });

  whipServer = { tcpServer, httpServer, httpsServer, activeSockets };
  currentPort = targetPort;
  serverError = null;

  if (persist) {
    saveConfig({ screenShare: { enabled: true, port: targetPort, token } });
  }

  console.log(`[screen-share] WHIP HTTP+HTTPS receiver listening on ${HOST}:${targetPort}`);
  broadcastStatus();
  return getScreenShareStatus();
}

export async function stopScreenShareServer(persist: boolean = true): Promise<ScreenShareStatus> {
  endActiveSession("Receiver stopped");
  const srv = whipServer;
  whipServer = null;
  serverError = null;

  if (srv) {
    await closeWhipBundle(srv);
  }

  if (persist) {
    saveConfig({ screenShare: { enabled: false, port: currentPort, token: ensureToken() } });
  }

  broadcastStatus();
  return getScreenShareStatus();
}

export function regenerateScreenShareToken(): ScreenShareStatus {
  currentToken = randomBytes(16).toString("hex");
  endActiveSession("Token rotated");
  saveConfig({
    screenShare: {
      enabled: isScreenShareRunning(),
      port: currentPort,
      token: currentToken,
    },
  });
  broadcastStatus();
  return getScreenShareStatus();
}

export function _resetScreenShareForTest(opts?: { token?: string; port?: number }) {
  clearPendingOffer("Test reset", 409);
  activeSession = null;
  peers.clear();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  serverError = null;
  if (opts?.token !== undefined) currentToken = opts.token;
  if (opts?.port !== undefined) currentPort = opts.port;
}
