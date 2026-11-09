import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebcastPushConnection } from "tiktok-live-connector/legacy";

const PORT = 3001;
const CONFIG_FILE = path.join(process.cwd(), "connector-config.json");

interface WebhookPayload {
  username: string;
  giftName: string;
  coins: number;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: "gift" | "test" | "system";
  payload: WebhookPayload;
  webhookUri: string;
  httpStatus?: number;
  response?: string;
  success: boolean;
  error?: string;
}

interface ServerState {
  username: string;
  webhookUri: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  roomId: string | null;
  error: string | null;
  logs: LogEntry[];
}

// Load saved config
function loadConfig(): { username: string; webhookUri: string } {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      return {
        username: data.username || "",
        webhookUri: data.webhookUri || "",
      };
    }
  } catch (e) {
    console.error("Failed to load config file:", e);
  }
  return { username: "", webhookUri: "" };
}

function saveConfig(username: string, webhookUri: string) {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ username, webhookUri }, null, 2),
      "utf-8"
    );
  } catch (e) {
    console.error("Failed to save config file:", e);
  }
}

const initialConfig = loadConfig();

const state: ServerState = {
  username: initialConfig.username,
  webhookUri: initialConfig.webhookUri,
  status: "disconnected",
  roomId: null,
  error: null,
  logs: [],
};

let activeConnection: any = null;
const sseClients: http.ServerResponse[] = [];

function broadcastState() {
  const data = JSON.stringify({
    username: state.username,
    webhookUri: state.webhookUri,
    status: state.status,
    roomId: state.roomId,
    error: state.error,
    logs: state.logs,
  });

  const message = `data: ${data}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const res = sseClients[i];
    try {
      res.write(message);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

async function sendWebhook(
  payload: WebhookPayload,
  type: "gift" | "test" = "gift"
): Promise<LogEntry> {
  const uri = state.webhookUri.trim();

  if (!uri) {
    const entry: LogEntry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: "(not configured)",
      success: false,
      error: "Webhook URI is empty",
    };
    state.logs.unshift(entry);
    if (state.logs.length > 50) state.logs.pop();
    broadcastState();
    return entry;
  }

  let entry: LogEntry;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(uri, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const responseText = await res.text();
    entry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      httpStatus: res.status,
      response: responseText.slice(0, 300),
      success: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}: ${res.statusText}`,
    };
  } catch (err: any) {
    entry = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      payload,
      webhookUri: uri,
      httpStatus: 0,
      success: false,
      error: err.name === "AbortError" ? "Request timed out" : (err.message || "Network error"),
    };
  }

  state.logs.unshift(entry);
  if (state.logs.length > 50) state.logs.pop();
  broadcastState();
  return entry;
}

function disconnectLive() {
  if (activeConnection) {
    try {
      activeConnection.disconnect();
    } catch (e) {
      console.error("Error disconnecting:", e);
    }
    activeConnection = null;
  }
  state.status = "disconnected";
  state.roomId = null;
  broadcastState();
}

async function connectLive(username: string, webhookUri: string) {
  disconnectLive();

  state.username = username.trim();
  state.webhookUri = webhookUri.trim();
  saveConfig(state.username, state.webhookUri);

  if (!state.username) {
    state.status = "error";
    state.error = "TikTok username is required";
    broadcastState();
    return;
  }

  state.status = "connecting";
  state.error = null;
  broadcastState();

  try {
    const conn = new WebcastPushConnection(state.username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: true,
    });
    activeConnection = conn;

    conn.on("connected", (connState: any) => {
      if (activeConnection !== conn) return;
      state.status = "connected";
      state.roomId = connState?.roomId ? String(connState.roomId) : "live";
      state.error = null;
      broadcastState();
    });

    conn.on("disconnected", () => {
      if (activeConnection !== conn) return;
      state.status = "disconnected";
      state.roomId = null;
      broadcastState();
    });

    conn.on("streamEnd", () => {
      if (activeConnection !== conn) return;
      state.status = "disconnected";
      state.error = "Live stream ended";
      state.roomId = null;
      broadcastState();
    });

    conn.on("error", (err: any) => {
      if (activeConnection !== conn) return;
      state.status = "error";
      state.error = err?.message || String(err);
      broadcastState();
    });

    conn.on("gift", (data: any) => {
      if (activeConnection !== conn) return;

      // Filter intermediate streak progress
      const isStreakContinuing = data.giftType === 1 && !data.repeatEnd;
      if (isStreakContinuing) {
        return;
      }

      const gifter = data.uniqueId || data.nickname || "gifter_name";
      const gift = data.giftName || data.gift?.name || data.describe || "Rose";
      const diamondCount = Number(data.diamondCount) || 1;
      const repeatCount = Number(data.repeatCount) || 1;
      const coins = diamondCount * repeatCount;

      const payload: WebhookPayload = {
        username: gifter,
        giftName: gift,
        coins,
      };

      sendWebhook(payload, "gift").catch((err) => {
        console.error("Webhook dispatch error:", err);
      });
    });

    await conn.connect();
  } catch (err: any) {
    state.status = "error";
    state.error = err?.message || "Failed to connect to TikTok LIVE";
    activeConnection = null;
    broadcastState();
  }
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        username: state.username,
        webhookUri: state.webhookUri,
        status: state.status,
        roomId: state.roomId,
        error: state.error,
        logs: state.logs,
      })
    );
    return;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(
      `data: ${JSON.stringify({
        username: state.username,
        webhookUri: state.webhookUri,
        status: state.status,
        roomId: state.roomId,
        error: state.error,
        logs: state.logs,
      })}\n\n`
    );
    sseClients.push(res);
    req.on("close", () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  if (url.pathname === "/api/connect" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { username, webhookUri } = JSON.parse(body || "{}");
        connectLive(username, webhookUri);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Connection initiated" }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/disconnect" && req.method === "POST") {
    disconnectLive();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Disconnected" }));
    return;
  }

  if (url.pathname === "/api/test-webhook" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (parsed.webhookUri) {
          state.webhookUri = parsed.webhookUri.trim();
          saveConfig(state.username, state.webhookUri);
        }
        const payload: WebhookPayload = {
          username: parsed.username || "gifter_name",
          giftName: parsed.giftName || "Rose",
          coins: Number(parsed.coins) || 20,
        };

        const result = await sendWebhook(payload, "test");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: result.success, entry: result }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} in use; assuming existing server is active.`);
    process.exit(0);
  } else {
    console.error("Server error:", err);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`TikTok Live Webhook Bridge running on http://127.0.0.1:${PORT}`);
});
