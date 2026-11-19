import type http from "node:http";
import process from "node:process";

export const PORT = Number(process.env.PORT) || 3001;

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
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
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
    req.on("error", (err) => reject(err));
  });
}

export function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  if (res.headersSent) return;
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
