import type http from "node:http";
import os from "node:os";
import process from "node:process";

export const HOST = process.env.HOST || "0.0.0.0";
export const PORT = Number(process.env.PORT) || 3001;

export function getLanAddresses(): string[] {
  const ips = new Set<string>();
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === "IPv4" && !info.internal && info.address && !info.address.startsWith("169.254.")) {
        ips.add(info.address);
      }
    }
  }
  return Array.from(ips).sort();
}

export function isLoopbackAddress(addr?: string): boolean {
  if (!addr) return false;
  const h = addr.toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  return h === "::1" || h === "localhost" || h === "127.0.0.1" || h.startsWith("127.");
}

export function isPrivateOrLanHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h === "::1") return true;
  if (h.endsWith(".local") && h.length > ".local".length && !h.includes("..")) return true;

  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((n) => n < 0 || n > 255)) return false;
    const [a, b] = octets;
    if (a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  // Allow RFC 4193 IPv6 ULA (fc00::/7) or active host LAN interface IPs
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  if (getLanAddresses().includes(h)) return true;

  return false;
}

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true; // Native desktop apps, curl, direct same-origin requests
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    // Allow Tauri webviews
    if (parsed.protocol === "tauri:" || host === "tauri.localhost") return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // Allow loopback and LAN/private origins (Vite dev/preview, OBS Browser source, LAN tabs)
    return isPrivateOrLanHost(host);
  } catch {
    return false;
  }
}

export function parseRequestUrl(req: { url?: string; headers?: { host?: string | string[] } }): URL | null {
  const rawUrl = req.url || "/";
  const rawHost = Array.isArray(req.headers?.host) ? req.headers.host[0] : req.headers?.host;
  const host = typeof rawHost === "string" && rawHost.trim() ? rawHost.trim() : "localhost";
  try {
    return new URL(rawUrl, `http://${host}`);
  } catch {
    try {
      if (rawUrl.startsWith("/")) {
        return new URL(rawUrl, "http://localhost");
      }
    } catch {}
    return null;
  }
}

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isSelfTargetHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return classifyBlockedHost(h) === "loopback" || getLanAddresses().includes(h);
}

export function classifyBlockedHost(hostname: string): "metadata" | "loopback" | null {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "169.254.169.254" ||
    h === "169.254.169.253" ||
    h === "metadata.google.internal" ||
    h.startsWith("169.254.") ||
    h === "fd00:ec2::254" ||
    h.startsWith("fe80:") ||
    h.startsWith("::ffff:a9fe:") ||
    h.startsWith("::ffff:169.254.")
  ) {
    return "metadata";
  }
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "::" ||
    h.startsWith("127.") ||
    h.startsWith("::ffff:7f") ||
    h.startsWith("::ffff:127.") ||
    h === "::ffff:0:0" ||
    h === "::ffff:0.0.0.0"
  ) {
    return "loopback";
  }
  return null;
}

export function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 1024 * 1024) {
        settled = true;
        try {
          req.destroy();
        } catch {}
        reject(new Error("Payload too large"));
      } else {
        chunks.push(buf);
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks).toString("utf-8");
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err: any) {
        reject(new Error(`Invalid JSON: ${err.message}`));
      }
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

export function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  if (res.headersSent) return;
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
