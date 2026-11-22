import type http from "node:http";
import {
  canAcceptReceiverPeer,
  disconnectActiveSession,
  getScreenShareStatus,
  handleWhipRequest,
  isScreenShareRunning,
  markSessionConnected,
  markSessionDisconnected,
  type ReceiverRole,
  regenerateScreenShareToken,
  registerReceiverPeer,
  relayMirrorAnswer,
  relayMirrorOffer,
  serveWhipSharerHtml,
  startScreenShareServer,
  stopScreenShareServer,
  submitWhipAnswer,
  unregisterReceiverPeer,
} from "../services/screenShare.ts";
import { parseJsonBody, sendJson } from "../utils.ts";

const SCREEN_SHARE_OBS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OBS Screen Share Receiver</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100vw;
      height: 100vh;
      background: transparent !important;
      overflow: hidden;
    }
    #screen {
      width: 100vw;
      height: 100vh;
      display: none;
      background: transparent;
      object-fit: contain;
    }
    #screen.active {
      display: block;
    }
    #controls {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 10;
      display: none;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: rgba(30, 32, 48, 0.92);
      border: 3px solid #7dc4e4;
      color: #cad3f5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    #controls.enabled {
      display: flex;
    }
    #controls.enabled.visible {
      opacity: 1;
      pointer-events: auto;
    }
    #mute-btn {
      background: #363a4f;
      color: #cad3f5;
      border: 2px solid #7dc4e4;
      padding: 4px 10px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      cursor: pointer;
    }
    #mute-btn.muted {
      background: #f5a97f;
      border-color: #f5a97f;
      color: #181926;
    }
    #volume-slider {
      width: 110px;
      accent-color: #7dc4e4;
      cursor: pointer;
    }
    #volume-pct {
      min-width: 36px;
      text-align: right;
      color: #a5adcb;
    }
    .hud-btn {
      background: #363a4f;
      color: #cad3f5;
      border: 2px solid #7dc4e4;
      padding: 4px 10px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      cursor: pointer;
    }
    .hud-btn.active {
      background: #7dc4e4;
      color: #181926;
    }
    #log-panel {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 11;
      width: min(520px, calc(100vw - 32px));
      display: none;
      flex-direction: column;
      background: rgba(24, 25, 38, 0.94);
      border: 3px solid #7dc4e4;
      color: #cad3f5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
    }
    #log-panel.open {
      display: flex;
    }
    .log-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #1e2030;
      border-bottom: 2px solid #363a4f;
      font-weight: 700;
    }
    #log-list {
      max-height: 200px;
      overflow-y: auto;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      line-height: 1.45;
    }
    .log-row { word-break: break-word; }
    .log-row.ok { color: #a6da95; }
    .log-row.warn { color: #f5a97f; }
    .log-row.err { color: #ed8796; }
    .log-time { color: #a5adcb; margin-right: 6px; }
  </style>
</head>
<body>
  <video id="screen" autoplay playsinline></video>
  <div id="controls" role="region" aria-label="Playback volume controls">
    <button id="mute-btn" type="button">MUTE</button>
    <input id="volume-slider" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
    <span id="volume-pct">100%</span>
    <button id="logs-btn" class="hud-btn" type="button">LOGS</button>
  </div>
  <div id="log-panel" role="region" aria-label="Playback connection logs">
    <div class="log-head">
      <span>PLAYBACK LOGS (<span id="log-count">0</span>)</span>
      <div style="display:flex;gap:6px;">
        <button id="log-clear-btn" class="hud-btn" type="button" style="padding:2px 8px;font-size:10px;">CLEAR</button>
        <button id="log-close-btn" class="hud-btn" type="button" style="padding:2px 8px;font-size:10px;">CLOSE</button>
      </div>
    </div>
    <div id="log-list" aria-live="polite"></div>
  </div>
  <script>
    const video = document.getElementById("screen");
    const controlsEl = document.getElementById("controls");
    const muteBtn = document.getElementById("mute-btn");
    const volumeSlider = document.getElementById("volume-slider");
    const volumePct = document.getElementById("volume-pct");
    const logsBtn = document.getElementById("logs-btn");
    const logPanel = document.getElementById("log-panel");
    const logList = document.getElementById("log-list");
    const logCount = document.getElementById("log-count");
    const logClearBtn = document.getElementById("log-clear-btn");
    const logCloseBtn = document.getElementById("log-close-btn");

    const params = new URLSearchParams(window.location.search);
    const fit = params.get("fit");
    if (fit === "cover" || fit === "fill" || fit === "contain") {
      video.style.objectFit = fit;
    }
    const controlsEnabled = params.get("controls") !== "0" && params.get("controls") !== "false";
    const startWithLogs = params.get("logs") === "1" || params.get("logs") === "true" || params.get("debug") === "1";
    const forceMuted = params.get("muted") === "1" || params.get("muted") === "true";

    let logTotal = 0;
    function appendLog(level, msg) {
      const ts = new Date().toTimeString().slice(0, 8);
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
      logTotal = logList.childNodes.length;
      logCount.textContent = String(logTotal);
      logList.scrollTop = logList.scrollHeight;
    }

    function setLogsOpen(open) {
      logPanel.classList.toggle("open", open);
      logsBtn.classList.toggle("active", open);
    }

    if (startWithLogs && controlsEnabled) {
      setLogsOpen(true);
    }

    logClearBtn.addEventListener("click", () => {
      logList.textContent = "";
      logTotal = 0;
      logCount.textContent = "0";
    });
    logCloseBtn.addEventListener("click", () => setLogsOpen(false));
    logsBtn.addEventListener("click", () => {
      setLogsOpen(!logPanel.classList.contains("open"));
      revealControls(2500);
    });

    function resolveInitialVolume() {
      const rawParam = params.get("volume");
      if (rawParam !== null && rawParam.trim() !== "") {
        const n = Number(rawParam);
        if (Number.isFinite(n)) {
          const normalized = n > 1 ? n / 100 : n;
          return Math.max(0, Math.min(1, normalized));
        }
      }
      try {
        const saved = Number(localStorage.getItem("donate_socket_screen_share_vol"));
        if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
      } catch {}
      return 1;
    }

    let savedVolume = resolveInitialVolume();
    video.volume = savedVolume;
    video.muted = forceMuted || savedVolume === 0;

    let hideTimer = null;
    let pointerInControls = false;

    function syncVolumeUi() {
      const effective = video.muted ? 0 : video.volume;
      const isMuted = video.muted || effective === 0;
      muteBtn.textContent = isMuted ? "UNMUTE" : "MUTE";
      muteBtn.classList.toggle("muted", isMuted);
      volumeSlider.value = String(effective);
      volumePct.textContent = Math.round(effective * 100) + "%";
    }

    function revealControls(durationMs) {
      if (!controlsEnabled) return;
      controlsEl.classList.add("enabled", "visible");
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!pointerInControls) controlsEl.classList.remove("visible");
      }, durationMs || 2500);
    }

    syncVolumeUi();

    if (controlsEnabled) {
      const onActivity = () => revealControls(2500);
      window.addEventListener("mousemove", onActivity, { passive: true });
      window.addEventListener("pointermove", onActivity, { passive: true });
      window.addEventListener("touchstart", onActivity, { passive: true });
      controlsEl.addEventListener("mouseenter", () => {
        pointerInControls = true;
        revealControls(2500);
      });
      controlsEl.addEventListener("mouseleave", () => {
        pointerInControls = false;
        revealControls(1500);
      });
      controlsEl.addEventListener("focusin", () => revealControls(4000));

      muteBtn.addEventListener("click", () => {
        if (video.muted || video.volume === 0) {
          if (savedVolume <= 0) savedVolume = 0.5;
          video.volume = savedVolume;
          video.muted = false;
        } else {
          video.muted = true;
        }
        try { localStorage.setItem("donate_socket_screen_share_vol", String(savedVolume)); } catch {}
        syncVolumeUi();
        void video.play().catch(() => {});
        revealControls(2500);
      });

      volumeSlider.addEventListener("input", () => {
        const next = Math.max(0, Math.min(1, Number(volumeSlider.value) || 0));
        savedVolume = next;
        video.volume = next;
        video.muted = next === 0;
        try { localStorage.setItem("donate_socket_screen_share_vol", String(savedVolume)); } catch {}
        syncVolumeUi();
        void video.play().catch(() => {});
        revealControls(2500);
      });
    }

    let peerId = null;
    let activeSessionId = null;
    let isPrimary = false;
    let mainPc = null;
    let remoteStream = null;
    let pendingIce = [];
    let connectedTimer = null;
    const mirrorPcs = new Map();

    function waitForIceGathering(pc, timeoutMs) {
      if (pc.iceGatheringState === "complete") return Promise.resolve();
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pc.removeEventListener("icegatheringstatechange", onState);
          pc.removeEventListener("icecandidate", onCand);
          resolve();
        };
        const onState = () => { if (pc.iceGatheringState === "complete") finish(); };
        const onCand = (e) => { if (!e.candidate) finish(); };
        const timer = setTimeout(finish, timeoutMs);
        pc.addEventListener("icegatheringstatechange", onState);
        pc.addEventListener("icecandidate", onCand);
      });
    }

    async function playVideo() {
      if (controlsEnabled) controlsEl.classList.add("enabled");
      try {
        await video.play();
        appendLog("ok", "Playback started (muted=" + video.muted + ", vol=" + Math.round(video.volume * 100) + "%).");
      } catch {
        video.muted = true;
        syncVolumeUi();
        appendLog("warn", "Autoplay blocked unmuted audio; muted fallback active.");
        if (!forceMuted) revealControls(5000);
        try { await video.play(); } catch {}
      }
    }

    function cleanupSession() {
      if (connectedTimer) { clearTimeout(connectedTimer); connectedTimer = null; }
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      for (const pc of mirrorPcs.values()) {
        try { pc.close(); } catch {}
      }
      mirrorPcs.clear();
      if (mainPc) {
        try { mainPc.close(); } catch {}
        mainPc = null;
      }
      remoteStream = null;
      pendingIce = [];
      activeSessionId = null;
      isPrimary = false;
      video.srcObject = null;
      video.classList.remove("active");
      controlsEl.classList.remove("visible");
    }

    function postJson(path, body) {
      return fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    }

    async function handleWhipOffer(payload) {
      appendLog("info", "Received WHIP offer (session " + payload.sessionId.slice(0, 8) + ")");
      cleanupSession();
      activeSessionId = payload.sessionId;
      isPrimary = true;

      const pc = new RTCPeerConnection({ iceServers: [] });
      mainPc = pc;
      const stream = new MediaStream();
      remoteStream = stream;

      const notifyConnected = () => {
        if (mainPc !== pc || !activeSessionId) return;
        const hasAudio = stream.getAudioTracks().length > 0;
        postJson("/api/screen-share/connected", {
          sessionId: activeSessionId,
          peerId,
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          hasAudio,
        });
      };

      pc.ontrack = (event) => {
        if (mainPc !== pc) return;
        appendLog("ok", "Received " + event.track.kind + " track (primary).");
        stream.addTrack(event.track);
        video.srcObject = stream;
        video.classList.add("active");
        void playVideo();
        if (connectedTimer) clearTimeout(connectedTimer);
        connectedTimer = setTimeout(notifyConnected, 150);
      };

      video.onloadedmetadata = () => {
        if (mainPc === pc && activeSessionId) {
          appendLog("ok", "Video metadata: " + video.videoWidth + "x" + video.videoHeight);
          notifyConnected();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (mainPc === pc) appendLog("info", "ICE state: " + pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        if (mainPc !== pc) return;
        appendLog(pc.connectionState === "connected" ? "ok" : "info", "Peer state: " + pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          const sid = activeSessionId;
          cleanupSession();
          if (sid) postJson("/api/screen-share/disconnected", { sessionId: sid, peerId });
        }
      };

      try {
        await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        for (const c of pendingIce) {
          try { await pc.addIceCandidate(c); } catch {}
        }
        pendingIce = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc, 2000);
        await postJson("/api/screen-share/answer", {
          sessionId: payload.sessionId,
          peerId,
          sdp: pc.localDescription ? pc.localDescription.sdp : answer.sdp,
        });
        appendLog("ok", "Sent WHIP SDP answer.");
      } catch (err) {
        const msg = err && err.message ? err.message : "WebRTC negotiation failed";
        appendLog("err", "WHIP answer failed: " + msg);
        await postJson("/api/screen-share/answer", {
          sessionId: payload.sessionId,
          peerId,
          error: msg,
        });
        cleanupSession();
      }
    }

    async function handleWhipIce(payload) {
      if (!mainPc || !isPrimary || payload.sessionId !== activeSessionId) return;
      const list = payload.candidates || [];
      appendLog("info", "Applied " + list.length + " trickle ICE candidate(s).");
      for (const c of list) {
        if (!mainPc.remoteDescription) {
          pendingIce.push(c);
        } else {
          try { await mainPc.addIceCandidate(c); } catch {}
        }
      }
    }

    async function handleMirrorStart(payload) {
      if (!isPrimary || !remoteStream || payload.sessionId !== activeSessionId) return;
      appendLog("info", "Starting local mirror for viewer " + payload.viewerId.slice(0, 8));
      const old = mirrorPcs.get(payload.viewerId);
      if (old) { try { old.close(); } catch {} }
      const pc = new RTCPeerConnection({ iceServers: [] });
      mirrorPcs.set(payload.viewerId, pc);
      for (const track of remoteStream.getTracks()) {
        pc.addTrack(track, remoteStream);
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          if (mirrorPcs.get(payload.viewerId) === pc) mirrorPcs.delete(payload.viewerId);
        }
      };
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc, 1000);
        await postJson("/api/screen-share/mirror/offer", {
          sessionId: payload.sessionId,
          peerId,
          viewerId: payload.viewerId,
          sdp: pc.localDescription ? pc.localDescription.sdp : offer.sdp,
        });
      } catch {
        try { pc.close(); } catch {}
        mirrorPcs.delete(payload.viewerId);
      }
    }

    async function handleMirrorAnswer(payload) {
      const pc = mirrorPcs.get(payload.viewerId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      } catch {}
    }

    function handleMirrorStop(payload) {
      const pc = mirrorPcs.get(payload.viewerId);
      if (!pc) return;
      try { pc.close(); } catch {}
      mirrorPcs.delete(payload.viewerId);
    }

    async function handleMirrorOffer(payload) {
      appendLog("info", "Received local mirror offer (session " + payload.sessionId.slice(0, 8) + ")");
      cleanupSession();
      activeSessionId = payload.sessionId;
      isPrimary = false;
      const pc = new RTCPeerConnection({ iceServers: [] });
      mainPc = pc;
      const stream = new MediaStream();
      remoteStream = stream;
      pc.ontrack = (event) => {
        if (mainPc !== pc) return;
        appendLog("ok", "Received " + event.track.kind + " track (mirror).");
        stream.addTrack(event.track);
        video.srcObject = stream;
        video.classList.add("active");
        void playVideo();
      };
      pc.oniceconnectionstatechange = () => {
        if (mainPc === pc) appendLog("info", "Mirror ICE state: " + pc.iceConnectionState);
      };
      pc.onconnectionstatechange = () => {
        if (mainPc === pc) {
          appendLog(pc.connectionState === "connected" ? "ok" : "info", "Mirror peer state: " + pc.connectionState);
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            cleanupSession();
          }
        }
      };
      try {
        await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc, 1000);
        await postJson("/api/screen-share/mirror/answer", {
          sessionId: payload.sessionId,
          peerId,
          sdp: pc.localDescription ? pc.localDescription.sdp : answer.sdp,
        });
        appendLog("ok", "Sent mirror SDP answer.");
      } catch (err) {
        appendLog("err", "Mirror setup failed: " + (err && err.message ? err.message : "unknown"));
        cleanupSession();
      }
    }

    function connectEvents() {
      appendLog("info", "Connecting to SSE /api/screen-share/events...");
      const es = new EventSource("/api/screen-share/events?role=obs");
      es.addEventListener("welcome", (e) => {
        const data = JSON.parse(e.data);
        peerId = data.peerId;
        appendLog("ok", "Connected as viewer " + (peerId ? peerId.slice(0, 8) : "?"));
      });
      es.addEventListener("whip-offer", (e) => { void handleWhipOffer(JSON.parse(e.data)); });
      es.addEventListener("whip-ice", (e) => { void handleWhipIce(JSON.parse(e.data)); });
      es.addEventListener("mirror-start", (e) => { void handleMirrorStart(JSON.parse(e.data)); });
      es.addEventListener("mirror-answer", (e) => { void handleMirrorAnswer(JSON.parse(e.data)); });
      es.addEventListener("mirror-stop", (e) => { handleMirrorStop(JSON.parse(e.data)); });
      es.addEventListener("mirror-offer", (e) => { void handleMirrorOffer(JSON.parse(e.data)); });
      es.addEventListener("session-ended", (e) => {
        let reason = "";
        try { reason = JSON.parse(e.data).reason || ""; } catch {}
        appendLog("warn", "Session ended" + (reason ? ": " + reason : "."));
        cleanupSession();
      });
      es.onerror = () => {
        appendLog("warn", "SSE disconnected; retrying in 2s...");
        es.close();
        setTimeout(connectEvents, 2000);
      };
    }

    connectEvents();
  </script>
</body>
</html>`;

export async function handleScreenShareRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  const rawPath = url.pathname.replace(/\/+$/, "") || "/";
  const cleanPath = rawPath.toLowerCase();

  if ((cleanPath === "/screen" || cleanPath === "/share") && (req.method === "GET" || req.method === "HEAD")) {
    serveWhipSharerHtml(req, res);
    return true;
  }

  if (
    cleanPath === "/whip" ||
    /^\/whip\/[a-zA-Z0-9-]+$/i.test(rawPath) ||
    ((cleanPath === "/screen" || cleanPath === "/share") && req.method === "POST")
  ) {
    if (!isScreenShareRunning() && req.method === "POST") {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Screen share receiver is stopped — click START RECEIVER in donate-socket first.");
      return true;
    }
    await handleWhipRequest(req, res);
    return true;
  }

  if (
    (url.pathname === "/overlays/screen-share" || url.pathname === "/overlays/screen-share/") &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(SCREEN_SHARE_OBS_HTML);
    }
    return true;
  }

  if (url.pathname === "/api/screen-share/status" && req.method === "GET") {
    sendJson(res, 200, { success: true, status: getScreenShareStatus() });
    return true;
  }

  if (url.pathname === "/api/screen-share/start" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const port = body?.port !== undefined ? Number(body.port) : undefined;
      const status = await startScreenShareServer(port, true);
      sendJson(res, 200, { success: true, status });
    } catch (err: any) {
      sendJson(res, 400, { success: false, error: err?.message || "Failed to start WHIP receiver" });
    }
    return true;
  }

  if (url.pathname === "/api/screen-share/stop" && req.method === "POST") {
    const status = await stopScreenShareServer(true);
    sendJson(res, 200, { success: true, status });
    return true;
  }

  if (url.pathname === "/api/screen-share/regenerate-token" && req.method === "POST") {
    const status = regenerateScreenShareToken();
    sendJson(res, 200, { success: true, status });
    return true;
  }

  if (url.pathname === "/api/screen-share/disconnect" && req.method === "POST") {
    const status = disconnectActiveSession();
    sendJson(res, 200, { success: true, status });
    return true;
  }

  if (url.pathname === "/api/screen-share/events" && req.method === "GET") {
    if (!canAcceptReceiverPeer()) {
      sendJson(res, 503, { error: "Too many connected screen share receivers" });
      return true;
    }
    const role: ReceiverRole = url.searchParams.get("role") === "obs" ? "obs" : "app";
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": keep-alive\n\n");
    const peerId = registerReceiverPeer(role, res);
    req.on("close", () => {
      unregisterReceiverPeer(peerId);
    });
    return true;
  }

  if (url.pathname === "/api/screen-share/answer" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const result = submitWhipAnswer(
        String(body?.sessionId || ""),
        String(body?.peerId || ""),
        typeof body?.sdp === "string" ? body.sdp : undefined,
        typeof body?.error === "string" ? body.error : undefined
      );
      sendJson(res, result.ok ? 200 : 404, result);
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || "Invalid payload" });
    }
    return true;
  }

  if (url.pathname === "/api/screen-share/connected" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const ok = markSessionConnected(String(body?.sessionId || ""), String(body?.peerId || ""), {
        width: typeof body?.width === "number" ? body.width : undefined,
        height: typeof body?.height === "number" ? body.height : undefined,
        hasAudio: typeof body?.hasAudio === "boolean" ? body.hasAudio : undefined,
      });
      sendJson(res, ok ? 200 : 404, { ok });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || "Invalid payload" });
    }
    return true;
  }

  if (url.pathname === "/api/screen-share/disconnected" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const ok = markSessionDisconnected(String(body?.sessionId || ""), String(body?.peerId || ""));
      sendJson(res, ok ? 200 : 404, { ok });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || "Invalid payload" });
    }
    return true;
  }

  if (url.pathname === "/api/screen-share/mirror/offer" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const ok = relayMirrorOffer(
        String(body?.sessionId || ""),
        String(body?.peerId || ""),
        String(body?.viewerId || ""),
        String(body?.sdp || "")
      );
      sendJson(res, ok ? 200 : 404, { ok });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || "Invalid payload" });
    }
    return true;
  }

  if (url.pathname === "/api/screen-share/mirror/answer" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const ok = relayMirrorAnswer(
        String(body?.sessionId || ""),
        String(body?.peerId || ""),
        String(body?.sdp || "")
      );
      sendJson(res, ok ? 200 : 404, { ok });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || "Invalid payload" });
    }
    return true;
  }

  return false;
}
