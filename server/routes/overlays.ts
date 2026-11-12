import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { loadConfig, normalizeStudioScene, saveConfig } from "../config.ts";
import {
  checkGitAvailable,
  createCustomOverlay,
  deleteOverlay,
  getInstalledOverlays,
  getMarketCatalog,
  installMarketOverlay,
  openFolderInOS,
  OVERLAYS_DIR,
  pullOverlayFromGit,
} from "../services/overlays.ts";
import { broadcastState, state } from "../state.ts";
import { parseJsonBody, sendJson } from "../utils.ts";

const STUDIO_OBS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OBS Overlay Studio Scene</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100vw;
      height: 100vh;
      background: transparent !important;
      overflow: hidden;
    }
    #stage {
      position: relative;
      transform-origin: top left;
      background: transparent;
      overflow: hidden;
    }
    .studio-layer {
      position: absolute;
      border: none;
      background: transparent;
      pointer-events: none;
      transform-origin: top left;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div id="stage"></div>
  <script>
    const stage = document.getElementById("stage");
    const frameMap = new Map();
    const profileId = new URLSearchParams(window.location.search).get("profile");
    let sceneWidth = 1920;
    let sceneHeight = 1080;

    function fitStage() {
      stage.style.width = sceneWidth + "px";
      stage.style.height = sceneHeight + "px";
      const sx = window.innerWidth / sceneWidth;
      const sy = window.innerHeight / sceneHeight;
      const scale = Math.min(sx, sy);
      if (Math.abs(scale - 1) > 0.002 && isFinite(scale) && scale > 0) {
        stage.style.transform = "scale(" + scale + ")";
      } else {
        stage.style.transform = "none";
      }
    }

    window.addEventListener("resize", fitStage);

    function applyScene(studio) {
      if (!studio || typeof studio !== "object") return;
      sceneWidth = Number(studio.width) || 1920;
      sceneHeight = Number(studio.height) || 1080;
      fitStage();

      const layers = Array.isArray(studio.layers) ? studio.layers : [];
      const activeIds = new Set();

      for (const layer of layers) {
        if (!layer || !layer.id || layer.overlayId === "studio" || layer.visible === false) continue;
        const external = layer.url !== undefined;
        let targetSrc;
        if (external) {
          if (typeof layer.url !== "string" || !/^https?:[/][/]/i.test(layer.url)) continue;
          try {
            const parsed = new URL(layer.url);
            if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) continue;
            const host = parsed.hostname.toLowerCase();
            if (host === "169.254.169.254" || host.startsWith("169.254.") || host === "metadata.google.internal" || host.startsWith("fe80:")) continue;
            const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
            if ((host === "localhost" || host === "127.0.0.1" || host === "::1") && (port === 3001 || port === Number(window.location.port))) continue;
            targetSrc = parsed.href;
          } catch {
            continue;
          }
        } else {
          if (!layer.overlayId) continue;
          targetSrc = "/overlays/" + encodeURIComponent(layer.overlayId) + "/";
        }
        activeIds.add(layer.id);

        let iframe = frameMap.get(layer.id);
        if (!iframe) {
          iframe = document.createElement("iframe");
          iframe.className = "studio-layer";
          iframe.setAttribute("allowtransparency", "true");
          stage.appendChild(iframe);
          frameMap.set(layer.id, iframe);
        }
        if (external) {
          iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
          iframe.setAttribute("referrerpolicy", "no-referrer");
        } else {
          iframe.removeAttribute("sandbox");
          iframe.removeAttribute("referrerpolicy");
        }
        if (iframe.dataset.src !== targetSrc) {
          iframe.dataset.src = targetSrc;
          iframe.src = targetSrc;
        }

        iframe.style.left = (Number(layer.x) || 0) + "px";
        iframe.style.top = (Number(layer.y) || 0) + "px";
        iframe.style.width = (Number(layer.width) || 400) + "px";
        iframe.style.height = (Number(layer.height) || 150) + "px";
        iframe.style.zIndex = String(Number(layer.zIndex) || 1);
        iframe.style.opacity = String(layer.opacity !== undefined ? layer.opacity : 1);
        const s = Number(layer.scale || 1);
        iframe.style.transform = s !== 1 ? "scale(" + s + ")" : "none";
      }

      for (const [id, iframe] of frameMap.entries()) {
        if (!activeIds.has(id)) {
          iframe.remove();
          frameMap.delete(id);
        }
      }
    }

    fetch("/api/overlays/studio" + (profileId === null ? "" : "?profile=" + encodeURIComponent(profileId)))
      .then((r) => r.json())
      .then((d) => { if (d && d.studio) applyScene(d.studio); })
      .catch(() => {});

    function connectSse() {
      const es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data && data.config) {
            const studio = profileId === null
              ? data.config.studio
              : data.config.studioProfiles?.find((profile) => profile.id === profileId)?.scene;
            if (studio) applyScene(studio);
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        setTimeout(connectSse, 3000);
      };
    }
    connectSse();
  </script>
</body>
</html>`;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

export async function handleOverlayRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  // 0. OBS Studio Composed Scene Page (/overlays/studio or /overlays/studio/)
  if (
    (url.pathname === "/overlays/studio" ||
      url.pathname === "/overlays/studio/" ||
      url.pathname === "/overlays/studio/index.html") &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    const profileId = url.searchParams.get("profile");
    if (profileId !== null && !loadConfig().studioProfiles?.some((profile) => profile.id === profileId)) {
      sendJson(res, 404, { success: false, error: "Studio profile not found" });
      return true;
    }
    const buf = Buffer.from(STUDIO_OBS_HTML, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": buf.length,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(buf);
    }
    return true;
  }

  if (url.pathname === "/api/overlays/studio/profiles" || url.pathname === "/api/overlays/studio/profiles/") {
    if (req.method === "GET") {
      sendJson(res, 200, { success: true, profiles: loadConfig().studioProfiles ?? [] });
      return true;
    }
    if (req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 100) {
          sendJson(res, 400, { success: false, error: "Profile name must be 1–100 characters" });
          return true;
        }
        if (!body.scene || typeof body.scene !== "object" || Array.isArray(body.scene)) {
          sendJson(res, 400, { success: false, error: "Profile scene must be an object" });
          return true;
        }
        const profile = { id: randomUUID(), name, scene: normalizeStudioScene(body.scene) };
        const profiles = [...(loadConfig().studioProfiles ?? []), profile];
        if (!saveConfig({ studioProfiles: profiles })) {
          sendJson(res, 500, { success: false, error: "Failed to save studio profile" });
          return true;
        }
        state.config = loadConfig();
        broadcastState();
        sendJson(res, 200, { success: true, profile, profiles: state.config.studioProfiles });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to create studio profile";
        sendJson(res, 400, { success: false, error: message });
      }
      return true;
    }
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return true;
  }

  // 0b. API: Get or Save Studio Scene Layout
  if (url.pathname === "/api/overlays/studio" || url.pathname === "/api/overlays/studio/") {
    const profileId = url.searchParams.get("profile");
    const config = loadConfig();
    const profile = profileId === null ? undefined : config.studioProfiles?.find((item) => item.id === profileId);
    if (profileId !== null && !profile) {
      sendJson(res, 404, { success: false, error: "Studio profile not found" });
      return true;
    }
    if (req.method === "GET") {
      const studio = normalizeStudioScene(profile ? profile.scene : config.studio);
      sendJson(res, 200, { success: true, studio });
      return true;
    }
    if (req.method === "POST" || req.method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const rawStudio = body && typeof body === "object" && "studio" in body
          ? body.studio
          : profileId === null ? body : undefined;
        if (!rawStudio || typeof rawStudio !== "object" || Array.isArray(rawStudio)) {
          sendJson(res, 400, { success: false, error: "Studio scene must be an object" });
          return true;
        }
        const normalized = normalizeStudioScene(rawStudio);
        const updates = profileId === null
          ? { studio: normalized }
          : { studioProfiles: (loadConfig().studioProfiles ?? []).map((item) =>
              item.id === profileId ? { ...item, scene: normalized } : item
            ) };
        if (!saveConfig(updates)) {
          sendJson(res, 500, { success: false, error: "Failed to save studio scene" });
          return true;
        }
        state.config = loadConfig();
        broadcastState();
        sendJson(res, 200, { success: true, studio: normalized });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to save studio scene";
        sendJson(res, 400, { success: false, error: message });
      }
      return true;
    }
  }

  // 1. Static file serving for /overlays/...
  if (url.pathname.startsWith("/overlays") && (req.method === "GET" || req.method === "HEAD")) {
    const rawSubpath = url.pathname.replace(/^\/overlays\/?/, "");
    const decodedSubpath = decodeURIComponent(rawSubpath);
    let targetPath = path.resolve(OVERLAYS_DIR, decodedSubpath);

    // Prevent directory traversal attacks
    const relative = path.relative(OVERLAYS_DIR, targetPath);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      (targetPath !== OVERLAYS_DIR && !targetPath.startsWith(OVERLAYS_DIR + path.sep))
    ) {
      sendJson(res, 403, { success: false, error: "Access denied: path traversal detected" });
      return true;
    }

    // If requesting directory, serve index.html inside it
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(targetPath, "index.html");
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      sendJson(res, 404, { success: false, error: "Overlay asset not found" });
      return true;
    }

    try {
      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const fileData = fs.readFileSync(targetPath);

      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": fileData.length,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(fileData);
      }
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return true;
  }

  // 2. API: List installed overlays
  if (url.pathname === "/api/overlays" && req.method === "GET") {
    try {
      const overlays = getInstalledOverlays();
      sendJson(res, 200, { success: true, count: overlays.length, overlays });
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message, overlays: [] });
    }
    return true;
  }

  // 3. API: List Overlay Market catalog
  if (url.pathname === "/api/overlays/market" && req.method === "GET") {
    try {
      const catalog = getMarketCatalog();
      sendJson(res, 200, { success: true, count: catalog.length, catalog });
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message, catalog: [] });
    }
    return true;
  }

  // 4. API: Install preset overlay from market
  if (url.pathname === "/api/overlays/install" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const overlayId = String(body.overlayId || "").trim();
      if (!overlayId) {
        sendJson(res, 400, { success: false, error: "overlayId is required" });
        return true;
      }
      const installed = installMarketOverlay(overlayId);
      if (!installed) {
        sendJson(res, 404, { success: false, error: "Market preset not found" });
        return true;
      }
      sendJson(res, 200, { success: true, overlay: installed });
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return true;
  }

  // 5. API: Create custom overlay
  if (url.pathname === "/api/overlays/create" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      if (!body.name) {
        sendJson(res, 400, { success: false, error: "Overlay name is required" });
        return true;
      }
      const overlay = createCustomOverlay({
        id: body.id || body.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: body.name,
        description: body.description,
        category: body.category,
        width: body.width,
        height: body.height,
      });
      sendJson(res, 200, { success: true, overlay });
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return true;
  }

  // 6. API: Delete an overlay
  if (url.pathname.startsWith("/api/overlays/") && req.method === "DELETE") {
    const overlayId = url.pathname.replace("/api/overlays/", "").trim();
    if (!overlayId) {
      sendJson(res, 400, { success: false, error: "overlayId is required" });
      return true;
    }
    const deleted = deleteOverlay(overlayId);
    sendJson(res, 200, { success: deleted, id: overlayId });
    return true;
  }

  // 7. API: Open overlays folder in OS file manager (Finder / Explorer / File Manager)
  if (
    (url.pathname === "/api/overlays/open-folder" || url.pathname === "/api/overlays/open-folder/") &&
    (req.method === "POST" || req.method === "GET")
  ) {
    try {
      let subpath = url.searchParams.get("id") || undefined;
      if (req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          if (body?.id) subpath = String(body.id);
          if (body?.subpath) subpath = String(body.subpath);
        } catch {}
      }

      const result = await openFolderInOS(subpath);
      sendJson(res, 200, result);
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return true;
  }

  // 8. API: Check if Git is available on system
  if (
    (url.pathname === "/api/overlays/git-status" || url.pathname === "/api/overlays/git-status/") &&
    req.method === "GET"
  ) {
    const hasGit = await checkGitAvailable();
    sendJson(res, 200, { success: true, hasGit });
    return true;
  }

  // 9. API: Pull / clone overlay from Git repository or zip
  if (
    (url.pathname === "/api/overlays/pull-git" || url.pathname === "/api/overlays/pull-git/") &&
    req.method === "POST"
  ) {
    try {
      const body = await parseJsonBody(req);
      const gitUrl = String(body?.url || body?.gitUrl || "").trim();
      if (!gitUrl) {
        sendJson(res, 400, { success: false, error: "Repository URL is required" });
        return true;
      }

      const result = await pullOverlayFromGit({
        gitUrl,
        id: body?.id ? String(body.id).trim() : undefined,
      });

      sendJson(res, 200, {
        success: true,
        method: result.method,
        hasGit: result.hasGit,
        overlay: result.overlay,
        path: result.path,
        message:
          result.method === "git_clone"
            ? `Overlay "${result.overlay.name}" cloned successfully via Git.`
            : `Overlay "${result.overlay.name}" downloaded and extracted from ZIP archive.`,
      });
    } catch (err: any) {
      console.error("[Overlays Route] POST /api/overlays/pull-git failed:", err);
      sendJson(res, 500, { success: false, error: err?.message || "Failed to pull overlay" });
    }
    return true;
  }

  return false;
}
