import type http from "node:http";
import process from "node:process";

export const PORT = Number(process.env.PORT) || 3001;

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
