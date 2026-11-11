import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
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
import { parseJsonBody, sendJson } from "../utils.ts";

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
